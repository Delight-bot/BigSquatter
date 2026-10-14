/**
 * Rep confirmation you can hear and feel — important because the user is
 * several feet from the phone and mid-movement, not looking at the counter.
 *
 * WebAudio is created lazily on the first rep: browsers refuse to start an
 * AudioContext before a user gesture, and starting a workout is that gesture.
 */

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Short sine blip. `frequency` rises with milestones so reps stay distinguishable. */
export function blip(frequency = 880, durationMs = 110): void {
  const audio = audioContext();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  // Ramp instead of a hard stop, which would click.
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + durationMs / 1000);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + durationMs / 1000 + 0.02);
}

export function vibrate(pattern: number | number[] = 35): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Unsupported or blocked by the user's settings — silently fine.
    }
  }
}

/** Called on every counted rep; every tenth rep gets a brighter tone. */
export function repFeedback(repNumber: number, soundOn: boolean): void {
  if (soundOn) blip(repNumber % 10 === 0 ? 1320 : 880);
  vibrate(repNumber % 10 === 0 ? [40, 60, 40] : 35);
}

export function goalFeedback(soundOn: boolean): void {
  if (soundOn) {
    blip(880, 140);
    setTimeout(() => blip(1174, 140), 150);
    setTimeout(() => blip(1568, 260), 300);
  }
  vibrate([60, 80, 60, 80, 140]);
}
