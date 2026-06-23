import { describe, it, expect } from 'vitest';
import { analyzeArrangement } from './arrangementCheck.mjs';

describe('analyzeArrangement', () => {
  it('empty code → layers false, low score', () => {
    const r = analyzeArrangement('');
    expect(r.dimensions.layers).toBe(false);
    expect(r.score).toBeLessThanOrEqual(20);
  });

  it('a flat single-track loop fails layers + form + velocity', () => {
    const r = analyzeArrangement('s("bd sd hh oh")');
    expect(r.trackCount).toBe(1);
    expect(r.dimensions.layers).toBe(false);
    expect(r.dimensions.form).toBe(false);
    expect(r.dimensions.velocity).toBe(false);
    expect(r.failed).toContain('form');
    expect(r.failed).toContain('layers');
  });

  it('multi-track $: but no variation still fails velocity/form/automation', () => {
    const code = ['$: s("bd*4")', '$: s("hh*8")', '$: note("c2 e2").s("sawtooth")'].join('\n');
    const r = analyzeArrangement(code);
    expect(r.dimensions.layers).toBe(true);
    expect(r.dimensions.velocity).toBe(false); // only single-value / no gains
    expect(r.dimensions.form).toBe(false);
  });

  it('stack() counts as multi-track even without $:', () => {
    const r = analyzeArrangement('stack(s("bd"), s("hh"))');
    expect(r.trackCount).toBeGreaterThanOrEqual(2);
    expect(r.dimensions.layers).toBe(true);
  });

  it('a production-grade track passes all 7 dimensions (score 100)', () => {
    const code = [
      'setcpm(124/4)',
      '$: s("bd*4").gain("1 0.9 0.95 0.9")',
      '$: s("hh*8").swing(0.16).gain("<0.4 0.7>").pan("<0.3 0.7>").jux(x => x.late(0.01))',
      '$: note("<c2 eb2 g2 bb2>").s("sawtooth").lpf(perlin.slow(2).range(100,2000)).room(0.3)',
      '$: s("bd*4").mask("<1@12 ~@4>")',
    ].join('\n');
    const r = analyzeArrangement(code);
    expect(r.dimensions).toEqual({
      layers: true,
      velocity: true,
      spatial: true,
      space: true,
      form: true, // .mask(...) detected
      automation: true, // perlin + .range detected
      tempo: true, // setcpm detected
    });
    expect(r.score).toBe(100);
    expect(r.findings).toEqual([]);
  });

  it('findings carry concrete suggestions for each failed dimension', () => {
    const r = analyzeArrangement('note("c3 e3 g3")');
    expect(r.findings.length).toBeGreaterThan(0);
    const form = r.findings.find((f) => f.area === 'form');
    expect(form).toBeTruthy();
    expect(form.severity).toBe('high'); // form is a high-weight dimension
    expect(form.suggestion.length).toBeGreaterThan(10);
  });

  it('summary mentions the score and failed dimensions', () => {
    const r = analyzeArrangement('s("bd")');
    expect(r.summary).toMatch(/\d+\/100/);
    expect(r.failed.length).toBeGreaterThan(0);
  });
});
