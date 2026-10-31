/**
 * Binary min-heap over (key: number, value: int) pairs stored in flat typed arrays.
 * No per-entry objects; grows by doubling. Used by the minimum-travel-time solver.
 */
export class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  private n = 0;

  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  push(key: number, val: number): void {
    if (this.n === this.keys.length) this.grow();
    let i = this.n++;
    const keys = this.keys;
    const vals = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** Key of the minimum entry; NaN when empty. */
  peekKey(): number {
    return this.n === 0 ? NaN : this.keys[0];
  }

  /** Removes and returns the value with the smallest key. Caller checks size() first. */
  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0];
    const last = --this.n;
    if (last > 0) {
      const key = keys[last];
      const val = vals[last];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= last) break;
        if (c + 1 < last && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }

  private grow(): void {
    const keys = new Float64Array(this.keys.length * 2);
    const vals = new Int32Array(this.vals.length * 2);
    keys.set(this.keys);
    vals.set(this.vals);
    this.keys = keys;
    this.vals = vals;
  }
}
