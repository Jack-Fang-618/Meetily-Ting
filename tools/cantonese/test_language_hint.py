import unittest
from worker import language_hint

class LanguageHintTest(unittest.TestCase):
    def test_auto_stays_auto_for_every_variant(self):
        for specialized in (False, True):
            for language in (None, '', 'auto'):
                self.assertIsNone(language_hint(language, specialized))

    def test_explicit_language_is_never_overridden(self):
        for specialized in (False, True):
            for code, expected in [('en', 'English'), ('zh', 'Chinese'), ('yue', 'Cantonese')]:
                self.assertEqual(language_hint(code, specialized), expected)

    def test_invalid_or_translation_mode_is_rejected(self):
        for specialized in (False, True):
            for code in ('auto-translate', 'invalid'):
                with self.assertRaises(ValueError):
                    language_hint(code, specialized)

if __name__ == '__main__':
    unittest.main()
