import unittest

from dialogue import build_dialogue


class SpeakerDialogueTests(unittest.TestCase):
    def test_paragraph_boundary_does_not_turn_main_answer_into_an_interjection(self):
        text = '我再睇下。如果中咗獎，你會繼續做嘢嗎？我會學畫畫。'
        turns = [dict(start=a, end=b, speaker=s) for a, b, s in
                 [(0, 3, 0), (3, 9, 1), (5, 5.4, 0), (9, 20, 0), (10, 12, 1)]]
        clips = {(1, 3): '我再睇下', (3, 9): '如果中了奖你会继续做嘢吗', (9, 11): '我会学画画'}
        rows = build_dialogue([('a', text, 1, 11)], turns, lambda a,b: clips.get((a,b), '嗯'))['a']
        self.assertEqual([(r['speaker'], r['text']) for r in rows if r['text']],
                         [(0, '我再睇下。'), (1, '如果中咗獎，你會繼續做嘢嗎？'), (0, '我會學畫畫。')])
        self.assertEqual([r.get('candidate') for r in rows if r['overlap']], ['嗯', '嗯'])
        self.assertEqual([r['start'] for r in rows if r['overlap']], [5, 10])

    def test_unmatched_answer_is_not_given_to_nearby_speaker(self):
        turns = [dict(start=i, end=i+1, speaker=i%2) for i in range(3)]
        rows = build_dialogue([('a', '第一句。漏掉的一整句。第三句。', 0, 3)], turns,
                              lambda a,b: ['第一句', '', '第三句'][a])['a']
        self.assertFalse(any(r['text'] for r in rows))
