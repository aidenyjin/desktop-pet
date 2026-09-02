/** What the window shows: the real sky, roughly, for the current local time. */

export type Phase = "night" | "dawn" | "day" | "dusk";

export interface SkyState {
  phase: Phase;
  /** 0 at start of the phase, 1 at its end. */
  t: number;
  /** Deterministic per calendar day; some days it rains. */
  rain: boolean;
  dayKey: number;
}

function dayHash(d: Date): number {
  const key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  let h = key ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function skyAt(d: Date): SkyState {
  const hour = d.getHours() + d.getMinutes() / 60;
  const dayKey = dayHash(d);
  const rain = dayKey % 100 < 18;
  let phase: Phase;
  let t: number;
  if (hour >= 5.5 && hour < 7.5) {
    phase = "dawn";
    t = (hour - 5.5) / 2;
  } else if (hour >= 7.5 && hour < 18) {
    phase = "day";
    t = (hour - 7.5) / 10.5;
  } else if (hour >= 18 && hour < 20.5) {
    phase = "dusk";
    t = (hour - 18) / 2.5;
  } else {
    phase = "night";
    t = hour >= 20.5 ? (hour - 20.5) / 9 : (hour + 3.5) / 9;
  }
  return { phase, t, rain, dayKey };
}
