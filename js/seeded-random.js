// Random numbers that are the same every time for the same seed text, so a
// background (its particles, the skyline outside the window) doesn't
// rearrange itself on every visit.
export function seededRandom(seedText) {
  let seed = [...seedText].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7);
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
