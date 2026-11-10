"""JSON-lines preparation progress; byte totals come from HF metadata, never estimates."""
import json
import sys
import threading
import time


class PreparationProgress:
    def __init__(self, emit=None, clock=time.monotonic):
        # Conversion redirects library stdout to stderr. Keep the protocol stream
        # captured here so heartbeat messages still reach the desktop process.
        protocol_stream = sys.stdout
        self.emit = emit or (lambda value: print(json.dumps(value, ensure_ascii=False), file=protocol_stream, flush=True))
        self.clock = clock
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.stage = 'Starting preparation'
        self.started = clock()
        self.total = None
        self.cached = 0
        self.bars = {}
        self.previous_transfer = 0
        self.previous_time = clock()
        self.last_change = clock()
        self.previous_ready = 0

    def start(self):
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def close(self):
        self.stop_event.set()
        if hasattr(self, 'thread'):
            self.thread.join(timeout=2)

    def step(self, message):
        with self.lock:
            self.stage = message
            self.started = self.clock()
            self.total = None
            self.cached = 0
            self.bars = {}
            self.previous_transfer = 0
            self.previous_ready = 0
            self.previous_time = self.last_change = self.clock()
            self.publish()

    def download(self, repo, files):
        self.step('Downloading ' + repo)
        with self.lock:
            self.total = sum(f.file_size for f in files) if all(f.file_size is not None for f in files) else None
            self.cached = sum(f.file_size or 0 for f in files if not f.will_download)
            self.publish()

    def register(self, kind, bar):
        with self.lock:
            self.bars[kind] = bar

    def publish(self):
        with self.lock:
            now = self.clock()
            elapsed = int(now - self.started)
            progress = None
            message = f'{self.stage} · Elapsed {elapsed}s'
            if self.total is not None:
                ready = self.cached + float(getattr(self.bars.get('ready'), 'n', 0))
                ready = max(0, min(self.total, ready))
                transfer = float(getattr(self.bars.get('transfer'), 'n', 0))
                delta = max(0, transfer - self.previous_transfer)
                speed = delta / max(0.001, now-self.previous_time)
                if ready != self.previous_ready or delta:
                    self.last_change = now
                self.previous_ready = ready
                self.previous_transfer, self.previous_time = transfer, now
                progress = 100 * ready/self.total if self.total else 100.0
                message += f'\nFiles ready (including cache){ready/1048576:.1f} / {self.total/1048576:.1f} MiB · {progress:.1f}% · Download {speed/1048576:.1f} MiB/s'
                idle = int(now-self.last_change)
                if idle >= 15 and ready < self.total:
                    message += f'\nNo byte update for {idle}s. Process is running; it may be waiting for the network or writing cache.'
            self.emit({'type':'preparation-progress', 'message':message, 'progress':progress})

    def _run(self):
        while not self.stop_event.wait(1):
            self.publish()

    def tqdm_class(self):
        from huggingface_hub.utils import tqdm
        owner = self

        class DownloadTqdm(tqdm):
            def __init__(self, *args, **kwargs):
                name = kwargs.get('name', '')
                desc = kwargs.get('desc', '')
                # Counters must stay active even when stdout isn't a terminal.
                kwargs['disable'] = False
                super().__init__(*args, **kwargs)
                if name == 'huggingface_hub.snapshot_download.transfer' or desc == 'Downloading bytes':
                    owner.register('transfer', self)
                elif kwargs.get('unit') == 'B' and (name == 'huggingface_hub.snapshot_download' or desc.startswith('Reconstructing')):
                    owner.register('ready', self)

            def display(self, *args, **kwargs):
                # The heartbeat publishes JSON; never emit terminal control codes.
                pass
        return DownloadTqdm
