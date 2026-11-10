import unittest
from types import SimpleNamespace
import numpy as np
from audio_segments import chunks, validate_audio, transcribe_audio, MAX_SAMPLES

class AudioSegmentsTest(unittest.TestCase):
    def test_reported_lengths_preserve_every_sample(self):
        for size in [0, 1, 16000, MAX_SAMPLES, MAX_SAMPLES+1, 982240, 2118880, 1193920]:
            with self.subTest(size=size):
                audio = np.arange(size, dtype=np.float32) / max(size,1)
                parts = list(chunks(audio))
                self.assertTrue(all(0 < len(p) <= MAX_SAMPLES for p in parts))
                np.testing.assert_array_equal(np.concatenate(parts) if parts else np.array([]), audio)

    def test_silence_boundary_and_ordered_transcripts(self):
        audio = np.ones(65*16000,dtype=np.float32)*0.1
        audio[23*16000:23*16000+320]=0
        parts=list(chunks(audio))
        self.assertEqual(len(parts[0]),23*16000+320)
        class Model:
            def __init__(self):self.lengths=[]
            def generate(self,samples,**kwargs):
                self.lengths.append(len(samples))
                return SimpleNamespace(text=f'part{len(self.lengths)}')
        model=Model()
        text=transcribe_audio(model,audio,'Cantonese')
        self.assertEqual(text,'\n'.join(f'part{i+1}' for i in range(len(parts))))
        self.assertEqual(sum(model.lengths),len(audio))

    def test_short_speech_is_padded_not_discarded(self):
        class Model:
            def generate(self, samples, **kwargs):
                self.samples = samples
                return SimpleNamespace(text='tail')
        model = Model()
        self.assertEqual(transcribe_audio(model, [0.2], 'Cantonese'), 'tail')
        self.assertEqual(len(model.samples), 1600)
        self.assertAlmostEqual(float(model.samples[0]), 0.2)
        self.assertTrue(np.all(model.samples[1:] == 0))

    def test_invalid_audio_is_distinct_from_long_audio(self):
        for bad in [[float('nan')],[float('inf')]]:
            with self.assertRaisesRegex(ValueError,'non-finite'): validate_audio(bad)
        with self.assertRaisesRegex(ValueError,'one-dimensional'):validate_audio([[0,0]])
        self.assertEqual(transcribe_audio(None,np.zeros(132*16000),'Cantonese'),'')

if __name__=='__main__':unittest.main()
