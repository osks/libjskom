/**
 * LRU cache backed by a Map (which preserves insertion order).
 * Most-recently-used entries are at the end of the Map.
 */
export class LRUMap<K, V> {
  #max: number;
  #map = new Map<K, V>();

  constructor(max: number) {
    this.#max = max;
  }

  get(key: K): V | undefined {
    const value = this.#map.get(key);
    if (value !== undefined) {
      // Promote to most-recent by re-inserting
      this.#map.delete(key);
      this.#map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // If key already exists, delete first so it moves to end
    if (this.#map.has(key)) {
      this.#map.delete(key);
    }
    this.#map.set(key, value);
    // Evict oldest if over capacity
    if (this.#map.size > this.#max) {
      const oldest = this.#map.keys().next().value!;
      this.#map.delete(oldest);
    }
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  delete(key: K): boolean {
    return this.#map.delete(key);
  }

  clear(): void {
    this.#map.clear();
  }

  get size(): number {
    return this.#map.size;
  }

  /** Return a plain Map snapshot (for structural sharing in state). */
  toMap(): Map<K, V> {
    return new Map(this.#map);
  }
}
