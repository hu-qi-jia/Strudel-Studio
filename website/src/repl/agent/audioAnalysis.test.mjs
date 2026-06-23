import { describe, it, expect } from 'vitest';
import { analyzeRenderedAudio } from './audioAnalysis.mjs';

const SR = 22050;
const mono = (gen, durSec = 2) => {
  const n = Math.floor(SR * durSec);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = gen(i / SR, i);
  return d;
};

describe('analyzeRenderedAudio', () => {
  it('empty buffer → ok:false', () => {
    expect(analyzeRenderedAudio([], SR).ok).toBe(false);
    expect(analyzeRenderedAudio([new Float32Array(0)], SR).ok).toBe(false);
  });

  it('silence → critical silence finding', () => {
    const r = analyzeRenderedAudio([mono(() => 0)], SR);
    expect(r.findings.some((f) => f.area === 'silence' && f.severity === 'critical')).toBe(true);
  });

  it('full-scale square wave → clipping (high) finding', () => {
    const r = analyzeRenderedAudio([mono((t) => (Math.sin(2 * Math.PI * 220 * t) >= 0 ? 1 : -1))], SR);
    expect(r.metrics.clipping).toBe(true);
    expect(r.metrics.peak).toBeGreaterThanOrEqual(0.985);
    expect(r.findings.some((f) => f.area === 'clipping' && f.severity === 'high')).toBe(true);
  });

  it('a pure low sine → muddy low-end finding, no clipping', () => {
    const r = analyzeRenderedAudio([mono((t) => 0.5 * Math.sin(2 * Math.PI * 60 * t))], SR);
    expect(r.metrics.clipping).toBe(false);
    expect(r.metrics.bandRatios.low).toBeGreaterThan(0.6);
    expect(r.findings.some((f) => f.area === 'lowend')).toBe(true);
  });

  it('balanced noise → no critical/high findings and reasonable peak', () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const r = analyzeRenderedAudio([mono(() => (rand() * 2 - 1) * 0.2)], SR);
    const severe = r.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
    expect(severe).toEqual([]);
    expect(r.metrics.peak).toBeLessThan(0.95);
  });

  it('two identical channels → stereo correlation ≈ 1', () => {
    const a = mono((t) => Math.sin(2 * Math.PI * 220 * t) * 0.3);
    const r = analyzeRenderedAudio([a, a], SR);
    expect(r.metrics.stereoCorrelation).toBeGreaterThan(0.98);
  });

  it('always exposes peak/rms/crestDb metrics', () => {
    const r = analyzeRenderedAudio([mono((t) => 0.3 * Math.sin(2 * Math.PI * 440 * t))], SR);
    expect(r.metrics).toHaveProperty('peak');
    expect(r.metrics).toHaveProperty('rms');
    expect(r.metrics).toHaveProperty('crestDb');
    expect(r.metrics.samples).toBeGreaterThan(0);
  });
});
