import { describe, it, expect } from 'vitest';
import { splitThinking, extractVisibleText } from './thinkingParse.mjs';

describe('splitThinking', () => {
  it('returns [] for empty/falsy input', () => {
    expect(splitThinking('')).toEqual([]);
    expect(splitThinking(undefined)).toEqual([]);
  });

  it('plain text with no tags → single text segment', () => {
    expect(splitThinking('hello world')).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('closed <think> block → text + thinking(closed) + text', () => {
    expect(splitThinking('a<think>secret</think>b')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'thinking', text: 'secret', closed: true },
      { type: 'text', text: 'b' },
    ]);
  });

  it('unclosed <think> (mid-stream) → thinking(closed=false), rest is thinking', () => {
    expect(splitThinking('a<think>partial')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'thinking', text: 'partial', closed: false },
    ]);
  });

  it('supports <thinking> variant', () => {
    expect(splitThinking('<thinking>hi</thinking>')).toEqual([
      { type: 'thinking', text: 'hi', closed: true },
    ]);
  });

  it('does NOT pair <think> with </thinking> (close tag must match open tag name)', () => {
    // <think> opened; </thinking> is not its closer → stays unclosed, body includes the literal
    expect(splitThinking('<think>x</thinking>')).toEqual([
      { type: 'thinking', text: 'x</thinking>', closed: false },
    ]);
  });

  it('multiple blocks alternate text/thinking', () => {
    const segs = splitThinking('p1<think>a</think>p2<think>b</think>p3');
    expect(segs.map((s) => s.type)).toEqual(['text', 'thinking', 'text', 'thinking', 'text']);
    expect(segs[1]).toMatchObject({ text: 'a', closed: true });
    expect(segs[3]).toMatchObject({ text: 'b', closed: true });
    expect(segs[4]).toMatchObject({ text: 'p3' });
  });

  it('handles <reasoning> and <reflection> tags too', () => {
    expect(splitThinking('<reasoning>r</reasoning>')).toEqual([
      { type: 'thinking', text: 'r', closed: true },
    ]);
    expect(splitThinking('<reflection>f</reflection>')).toEqual([
      { type: 'thinking', text: 'f', closed: true },
    ]);
  });
});

describe('extractVisibleText', () => {
  it('strips all closed thinking segments', () => {
    expect(extractVisibleText('a<think>x</think>b<think>y</think>')).toBe('ab');
  });

  it('strips unclosed (streaming) thinking too', () => {
    expect(extractVisibleText('visible<think>hidden')).toBe('visible');
  });

  it('returns the whole string when there are no tags', () => {
    expect(extractVisibleText('just text')).toBe('just text');
  });
});
