import { describe, it, expect } from 'vitest';
import { MIN_UNDO_STEPS, SculptHistory } from './history';

/** A stroke entry touching a single vertex, moving it from `from` to `to`. */
function pushSingleVertexStroke(
  history: SculptHistory,
  vertexIndex: number,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): void {
  history.pushStroke(
    Uint32Array.from([vertexIndex]),
    Float32Array.from(from),
    Float32Array.from(to),
  );
}

describe('SculptHistory', () => {
  it('undo restores bit-identical prior positions; redo reapplies identically', () => {
    const positions = Float32Array.from([1, 2, 3, 10, 20, 30]);
    const history = new SculptHistory();

    const before = positions.slice();
    // Mutate vertex 1 as if a stroke had just run.
    positions[3] = 10.5;
    positions[4] = 20.25;
    positions[5] = 30.125;
    const after = positions.slice();

    history.pushStroke(Uint32Array.from([1]), before.slice(3, 6), after.slice(3, 6));

    const undone = history.undo(positions);
    expect(undone?.kind).toBe('stroke');
    expect(positions).toEqual(before);

    const redone = history.redo(positions);
    expect(redone?.kind).toBe('stroke');
    expect(positions).toEqual(after);
  });

  it('only restores the vertices the stroke touched, leaving others untouched', () => {
    const positions = Float32Array.from([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    const history = new SculptHistory();
    const originalV1 = positions.slice(3, 6);

    positions[3] = 99;
    positions[4] = 99;
    positions[5] = 99;
    history.pushStroke(Uint32Array.from([1]), originalV1, positions.slice(3, 6));

    // Perturb an untouched vertex directly (simulating something else
    // moving it) — undo must not know or care about it.
    positions[6] = 12345;

    history.undo(positions);

    expect(positions.slice(3, 6)).toEqual(originalV1);
    expect(positions[6]).toBe(12345);
  });

  it('undoes at least 50 sequential strokes in order', () => {
    const positions = new Float32Array(3);
    const history = new SculptHistory();
    const steps = 60;

    for (let i = 1; i <= steps; i++) {
      pushSingleVertexStroke(history, 0, [i - 1, 0, 0], [i, 0, 0]);
      positions[0] = i;
    }

    for (let i = steps; i >= 1; i--) {
      expect(history.canUndo).toBe(true);
      history.undo(positions);
      expect(positions[0]).toBeCloseTo(i - 1, 6);
    }
    expect(history.canUndo).toBe(false);
  });

  it('discards the redo branch when a new stroke is committed after undo', () => {
    const positions = new Float32Array(3);
    const history = new SculptHistory();

    pushSingleVertexStroke(history, 0, [0, 0, 0], [1, 0, 0]);
    positions[0] = 1;
    pushSingleVertexStroke(history, 0, [1, 0, 0], [2, 0, 0]);
    positions[0] = 2;

    history.undo(positions); // back to 1
    expect(history.canRedo).toBe(true);

    pushSingleVertexStroke(history, 0, [1, 0, 0], [5, 0, 0]);
    positions[0] = 5;

    expect(history.canRedo).toBe(false);
    expect(history.redo(positions)).toBeNull();
    expect(positions[0]).toBe(5); // unaffected by the discarded redo

    history.undo(positions);
    expect(positions[0]).toBeCloseTo(1, 6); // back to the branch point, not the discarded "2"
  });

  it('treats undo on empty history and redo with nothing ahead as safe no-ops', () => {
    const positions = Float32Array.from([1, 2, 3]);
    const history = new SculptHistory();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo(positions)).toBeNull();
    expect(history.redo(positions)).toBeNull();
    expect(positions).toEqual(Float32Array.from([1, 2, 3]));

    pushSingleVertexStroke(history, 0, [1, 2, 3], [4, 5, 6]);
    expect(history.canRedo).toBe(false);
    expect(history.redo(positions)).toBeNull(); // nothing to redo yet, no undo has happened
  });

  it('evicts oldest entries under memory pressure but never below MIN_UNDO_STEPS', () => {
    // Each stroke entry here is ~3 * (4 + 4 + 4) = 36 bytes (1 index +
    // 1 before-vertex + 1 after-vertex). A tiny budget forces eviction
    // well before 60 such entries would naturally fit.
    const history = new SculptHistory(500);
    const positions = new Float32Array(3);

    for (let i = 1; i <= 60; i++) {
      pushSingleVertexStroke(history, 0, [i - 1, 0, 0], [i, 0, 0]);
    }

    expect(history.size).toBe(MIN_UNDO_STEPS);

    // The retained entries must be the MOST RECENT ones — undo all the
    // way back should land exactly MIN_UNDO_STEPS strokes before the end,
    // i.e. at value (60 - 50) = 10, not 0.
    let undoCount = 0;
    while (history.canUndo) {
      history.undo(positions);
      undoCount++;
    }
    expect(undoCount).toBe(MIN_UNDO_STEPS);
    expect(positions[0]).toBeCloseTo(60 - MIN_UNDO_STEPS, 6);
  });

  it('rejects a pushStroke where before/after length does not match indices', () => {
    const history = new SculptHistory();
    expect(() =>
      history.pushStroke(Uint32Array.from([0, 1]), new Float32Array(3), new Float32Array(6)),
    ).toThrow(RangeError);
  });
});
