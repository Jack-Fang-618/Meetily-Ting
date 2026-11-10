import unittest
import io
from contextlib import redirect_stdout
from types import SimpleNamespace
from preparation_progress import PreparationProgress


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.messages = []
        self.p = PreparationProgress(self.messages.append, lambda: self.now)

    def test_cached_resumed_bytes_and_transfer_rate(self):
        self.p.download('test', [SimpleNamespace(file_size=100, will_download=False), SimpleNamespace(file_size=300, will_download=True)])
        self.assertEqual(self.messages[-1]['progress'], 25)
        self.p.register('ready', SimpleNamespace(n=100))
        self.p.register('transfer', SimpleNamespace(n=50))
        self.now = 2
        self.p.publish()
        self.assertEqual(self.messages[-1]['progress'], 50)
        self.assertIn('Files ready (including cache)', self.messages[-1]['message'])
        self.now = 20
        self.p.publish()
        self.assertIn('No byte update for 18s', self.messages[-1]['message'])

    def test_conversion_resets_percentage_and_counts_elapsed(self):
        self.p.download('test', [SimpleNamespace(file_size=100, will_download=False)])
        self.assertEqual(self.messages[-1]['progress'], 100)
        self.p.step('Converting')
        self.now = 7
        self.p.publish()
        self.assertIsNone(self.messages[-1]['progress'])
        self.assertIn('Elapsed 7s', self.messages[-1]['message'])

    def test_unknown_size_never_invents_percentage(self):
        self.p.download('test', [SimpleNamespace(file_size=None, will_download=True)])
        self.assertIsNone(self.messages[-1]['progress'])

    def test_library_stdout_redirection_cannot_hide_progress(self):
        protocol, library_log = io.StringIO(), io.StringIO()
        with redirect_stdout(protocol):
            reporter = PreparationProgress()
            with redirect_stdout(library_log):
                reporter.step('Converting')
        self.assertIn('preparation-progress', protocol.getvalue())
        self.assertEqual(library_log.getvalue(), '')

    def test_hf_byte_bars_remain_active_without_terminal(self):
        self.p.download('test', [SimpleNamespace(file_size=100, will_download=True)])
        cls = self.p.tqdm_class()
        with cls(total=100, unit='B', name='huggingface_hub.snapshot_download', disable=True) as bar:
            bar.update(50)
            self.p.publish()
            self.assertEqual(self.messages[-1]['progress'], 50)


if __name__ == '__main__': unittest.main()
