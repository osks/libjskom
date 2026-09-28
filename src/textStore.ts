import { LRUMap } from './lru.js';
import type { KomTextBody, StoredTextStat, TextStore } from './types.js';

/**
 * A TextStore in memory: for tests, and as a model for real implementations.
 * Keeps at most `maxBodies` bodies (least recently used out); stats are
 * small and kept without a limit.
 */
export class MemoryTextStore implements TextStore {
  #bodies: LRUMap<number, KomTextBody>;
  #stats = new Map<number, StoredTextStat>();

  constructor({ maxBodies = 1000 }: { maxBodies?: number } = {}) {
    this.#bodies = new LRUMap(maxBodies);
  }

  async getBodies(textNos: number[]): Promise<Map<number, KomTextBody>> {
    const found = new Map<number, KomTextBody>();
    for (const textNo of textNos) {
      const body = this.#bodies.get(textNo);
      if (body) found.set(textNo, structuredClone(body));
    }
    return found;
  }

  async getStats(textNos: number[]): Promise<Map<number, StoredTextStat>> {
    const found = new Map<number, StoredTextStat>();
    for (const textNo of textNos) {
      const stat = this.#stats.get(textNo);
      if (stat) found.set(textNo, structuredClone(stat));
    }
    return found;
  }

  async putBody(textNo: number, body: KomTextBody): Promise<void> {
    this.#bodies.set(textNo, structuredClone(body));
  }

  async putStat(textNo: number, stat: StoredTextStat): Promise<void> {
    this.#stats.set(textNo, structuredClone(stat));
  }

  async delete(textNo: number): Promise<void> {
    this.#bodies.delete(textNo);
    this.#stats.delete(textNo);
  }

  async clear(): Promise<void> {
    this.#bodies.clear();
    this.#stats.clear();
  }
}
