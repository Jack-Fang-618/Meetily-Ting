//! Speech-oriented stereo downmix. Preserve single-sided interviews at source level.
//! Inputs are frames, not concatenated channels; output always has one sample/frame.
pub fn speech_mono(left: &[f32], right: Option<&[f32]>) -> Vec<f32> {
    let clean = |x: f32| if x.is_finite() { x } else { 0.0 };
    let Some(right) = right else { return left.iter().map(|&x| clean(x)).collect() };
    let n = left.len().min(right.len());
    let (mut l2, mut r2, mut sum2) = (0.0f64, 0.0f64, 0.0f64);
    for i in 0..n {
        let (l, r) = (clean(left[i]) as f64, clean(right[i]) as f64);
        l2 += l*l; r2 += r*r; sum2 += (l+r)*(l+r);
    }
    let target = l2.max(r2);
    // Strong negative correlation: averaging would erase speech. Keep one channel
    // for this whole block (never switch channels sample-by-sample).
    if target > 0.0 && sum2 < target * 0.01 {
        let source = if l2 >= r2 { left } else { right };
        return source[..n].iter().map(|&x| clean(x)).collect();
    }
    // Never amplify beyond the unattenuated sum. Identical stereo stays unchanged;
    // a speaker on one side is no longer halved by a fixed (L+R)/2 downmix.
    let gain = if sum2 > 0.0 { (target / sum2).sqrt().min(1.0) as f32 } else { 0.0 };
    (0..n).map(|i| ((clean(left[i])+clean(right[i]))*gain).clamp(-1.0,1.0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn single_sided_and_dual_mono_keep_level_and_duration() {
        let voice: Vec<f32> = (0..4800).map(|i| (i as f32 * 0.13).sin()*0.4).collect();
        let silence = vec![0.0;voice.len()];
        for output in [speech_mono(&voice,Some(&silence)),speech_mono(&silence,Some(&voice)),speech_mono(&voice,Some(&voice)),speech_mono(&voice,None)] {
            assert_eq!(output.len(),voice.len());
            assert!(output.iter().zip(&voice).all(|(a,b)| (a-b).abs()<1e-6));
        }
    }
    #[test]
    fn reversed_phase_does_not_erase_voice() {
        let l = [0.2,-0.3,0.4,-0.5];
        let r = l.map(|x| -x);
        assert_eq!(speech_mono(&l,Some(&r)),l);
    }
    #[test]
    fn silence_invalid_and_overlapping_speakers_are_finite() {
        assert_eq!(speech_mono(&[0.0;4],Some(&[0.0;4])),[0.0;4]);
        let mixed=speech_mono(&[f32::NAN,0.9,-0.9,0.2],Some(&[0.0,0.8,0.6,-0.7]));
        assert!(mixed.iter().all(|x| x.is_finite() && x.abs()<=1.0));
        assert!(mixed[1].abs()>0.1 && mixed[3].abs()>0.1);
    }
}

/// Bounded, smoothed gain for quiet system playback, before speech detection.
/// Does not amplify near-silence; no source is hard-gated or discarded.
pub struct PlaybackGain { gain: f32 }
impl Default for PlaybackGain { fn default()->Self {Self{gain:1.0}} }
impl PlaybackGain {
    pub fn process(&mut self, samples:&mut [f32], sample_rate:u32) {
        if samples.is_empty(){return;}
        let rms=(samples.iter().map(|x| (*x as f64).powi(2)).sum::<f64>()/samples.len() as f64).sqrt() as f32;
        let peak=samples.iter().map(|x| x.abs()).fold(0.0f32,f32::max);
        let target=if rms.is_finite() && rms>=0.0001 { (0.035/rms).clamp(1.0,16.0).min(0.9/peak.max(0.0001)).max(1.0) } else {1.0};
        // Reduce gain immediately on loud transients; smoothly raise over 50ms.
        self.gain=self.gain.min(target);
        let alpha=1.0-(-1.0/(sample_rate.max(1) as f32*0.05)).exp();
        for sample in samples {
            self.gain+=(target-self.gain)*alpha;
            *sample=if sample.is_finite(){(*sample*self.gain).clamp(-1.0,1.0)}else{0.0};
        }
    }
}
#[cfg(test)] mod gain_tests {
    use super::*;
    #[test] fn quiet_voice_is_lifted_without_changing_duration() {
        let mut gain=PlaybackGain::default();
        let mut voice:Vec<f32>=(0..48000).map(|i|(i as f32*0.1).sin()*0.003).collect();
        gain.process(&mut voice,48000);
        assert_eq!(voice.len(),48000);assert!(voice[24000..].iter().any(|x|x.abs()>0.03));
        let mut loud=vec![0.8;480];gain.process(&mut loud,48000);assert!(loud.iter().all(|x|(*x-0.8).abs()<1e-6));
    }
    #[test] fn silence_and_low_noise_are_not_boosted() {
        let mut gain=PlaybackGain::default();let mut noise=vec![0.00001;4800];gain.process(&mut noise,48000);assert_eq!(noise,vec![0.00001;4800]);
        let mut silence=vec![0.0;4800];gain.process(&mut silence,48000);assert!(silence.iter().all(|x|*x==0.0));
    }
}
