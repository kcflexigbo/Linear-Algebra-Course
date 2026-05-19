import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalWorkbench, LOCAL_KEY } from '../src/persistence/useLocalWorkbench';
import type { WorkbenchObject, SageOutput } from '../src/types';

const sampleObjects: WorkbenchObject[] = [
  { id: 0, kind: 'matrix', name: 'A', rows: 2, cols: 2, orient: null, values: { '0,0': '1' } },
];
const sampleOutputs: SageOutput[] = [{ type: 'stream', name: 'stdout', text: 'hi' }];

describe('useLocalWorkbench', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null on first load when storage is empty', () => {
    const { result } = renderHook(() => useLocalWorkbench());
    expect(result.current.restore()).toBeNull();
  });

  it('persists state debounced and restores it', () => {
    const { result } = renderHook(() => useLocalWorkbench());
    act(() => {
      result.current.save({ objects: sampleObjects, code: 'A.rref()', outputs: null });
    });
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const stored = JSON.parse(localStorage.getItem(LOCAL_KEY)!);
    expect(stored.objects).toEqual(sampleObjects);
    expect(stored.code).toBe('A.rref()');
    expect(stored.outputs).toBeNull();

    const { result: r2 } = renderHook(() => useLocalWorkbench());
    expect(r2.current.restore()).toMatchObject({
      objects: sampleObjects,
      code: 'A.rref()',
      outputs: null,
    });
  });

  it('saveImmediate bypasses the debounce', () => {
    const { result } = renderHook(() => useLocalWorkbench());
    act(() => {
      result.current.saveImmediate({ objects: sampleObjects, code: 'x', outputs: sampleOutputs });
    });
    const stored = JSON.parse(localStorage.getItem(LOCAL_KEY)!);
    expect(stored.outputs).toEqual(sampleOutputs);
  });

  it('drops outputs and retries on quota exceeded', () => {
    const { result } = renderHook(() => useLocalWorkbench());
    const big: SageOutput[] = [{ type: 'stream', name: 'stdout', text: 'x'.repeat(10) }];
    const realSetItem = Storage.prototype.setItem;
    const store: Record<string, string> = {};
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    let call = 0;
    setItem.mockImplementation(function (this: Storage, k: string, v: string) {
      call += 1;
      if (call === 1) {
        const e = new Error('quota');
        (e as Error & { name: string }).name = 'QuotaExceededError';
        throw e;
      }
      store[k] = v;
      realSetItem.call(this, k, v);
    });
    act(() => {
      result.current.saveImmediate({ objects: sampleObjects, code: 'x', outputs: big });
    });
    const stored = JSON.parse(localStorage.getItem(LOCAL_KEY)!);
    expect(stored.outputs).toBeNull();
    expect(stored.objects).toEqual(sampleObjects);
    setItem.mockRestore();
  });

  it('returns null and recovers on corrupted JSON', () => {
    localStorage.setItem(LOCAL_KEY, 'not json {{');
    const { result } = renderHook(() => useLocalWorkbench());
    expect(result.current.restore()).toBeNull();
  });
});
