pub const WINDOW: usize = 96_000;
const FRAME: usize = 320;

// Look for 100 ms of relative quiet within the final second already captured.
pub fn boundary(samples: &[f32]) -> (usize, usize) {
    let frames: Vec<f32> = samples[..WINDOW]
        .chunks_exact(FRAME)
        .map(|f| f.iter().map(|x| x * x).sum::<f32>())
        .collect();
    let peak = frames.iter().copied().fold(0.0, f32::max);
    for end in (255..=frames.len()).rev() {
        if frames[end - 5..end].iter().all(|e| *e <= peak * 0.015) {
            return ((end - 2) * FRAME, 0);
        }
    }
    (WINDOW, 8_000)
}

// Compare whole Latin words and individual CJK characters, ignoring punctuation.
pub fn trim_overlap<'a>(previous: &str, current: &'a str) -> &'a str {
    fn tokens(text: &str) -> Vec<(String, usize)> {
        let mut output = Vec::new();
        let mut chars = text.char_indices().peekable();
        while let Some((start, c)) = chars.next() {
            if !c.is_alphanumeric() {
                continue;
            }
            let mut end = start + c.len_utf8();
            if c.is_ascii_alphanumeric() {
                while let Some(&(i, next)) = chars.peek() {
                    if !next.is_ascii_alphanumeric() && next != '\u{27}' {
                        break;
                    }
                    end = i + next.len_utf8();
                    chars.next();
                }
            }
            output.push((text[start..end].to_lowercase(), end));
        }
        output
    }
    let left = tokens(previous);
    let right = tokens(current);
    for n in (1..=left.len().min(right.len()).min(6)).rev() {
        if left[left.len() - n..]
            .iter()
            .zip(&right[..n])
            .all(|(a, b)| a.0 == b.0)
        {
            return current[right[n - 1].1..].trim_start_matches(|c: char| !c.is_alphanumeric());
        }
    }
    // A cut through a sibilant plural can decode its final syllable as a
    // separate word ("diseases" / "disease, as"). Require a complete long
    // stem, the fragment punctuation, and following speech before trimming.
    if let (Some((plural, _)), [stem, syllable, ..]) = (left.last(), right.as_slice()) {
        let word = &stem.0;
        if right.len() > 2
            && word.len() >= 5
            && word.is_ascii()
            && (word.ends_with("se") || word.ends_with("ze"))
            && plural.strip_suffix('s') == Some(word.as_str())
            && syllable.0 == "as"
            && current[stem.1..syllable.1].trim_start().starts_with(',')
        {
            return current[syllable.1..].trim_start();
        }
    }
    current
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_a_pause_only_as_a_cut_and_overlaps_continuous_audio() {
        let mut audio = vec![0.1; WINDOW];
        assert_eq!(boundary(&audio), (WINDOW, 8000));
        audio[86_400..89_600].fill(0.0);
        let (end, overlap) = boundary(&audio);
        assert!((86_400..89_600).contains(&end));
        assert_eq!(overlap, 0);
    }

    #[test]
    fn preserves_the_phrase_after_a_split_plural() {
        let left = "many other diseases.";
        assert_eq!(trim_overlap(left, "Disease, as for the first time"), "for the first time");
        assert_eq!(trim_overlap(left, "Disease as a concept"), "Disease as a concept");
        assert_eq!(trim_overlap(left, "As for the first time"), "As for the first time");
    }

    #[test]
    fn trims_shared_words_or_characters_at_the_join() {
        assert_eq!(trim_overlap("the system.", "System works."), "works.");
        assert_eq!(trim_overlap("今晚開會", "開會討論。"), "討論。");
        assert_eq!(trim_overlap("the art", "article"), "article");
    }
}
