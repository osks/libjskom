import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LRUMap } from '../../dist/lru.js';

describe('LRUMap', () => {
  it('should get and set values', () => {
    const lru = new LRUMap(10);
    lru.set('a', 1);
    lru.set('b', 2);

    assert.equal(lru.get('a'), 1);
    assert.equal(lru.get('b'), 2);
  });

  it('should return undefined for missing keys', () => {
    const lru = new LRUMap(10);
    assert.equal(lru.get('missing'), undefined);
  });

  it('should report has correctly', () => {
    const lru = new LRUMap(10);
    lru.set('a', 1);

    assert.equal(lru.has('a'), true);
    assert.equal(lru.has('b'), false);
  });

  it('should delete keys', () => {
    const lru = new LRUMap(10);
    lru.set('a', 1);
    lru.set('b', 2);

    assert.equal(lru.delete('a'), true);
    assert.equal(lru.has('a'), false);
    assert.equal(lru.get('a'), undefined);
    assert.equal(lru.get('b'), 2);
  });

  it('should return false when deleting a missing key', () => {
    const lru = new LRUMap(10);
    assert.equal(lru.delete('nope'), false);
  });

  it('should evict the oldest entry when exceeding capacity', () => {
    const lru = new LRUMap(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    lru.set('d', 4); // should evict 'a'

    assert.equal(lru.has('a'), false);
    assert.equal(lru.get('a'), undefined);
    assert.equal(lru.size, 3);
    assert.equal(lru.get('b'), 2);
    assert.equal(lru.get('c'), 3);
    assert.equal(lru.get('d'), 4);
  });

  it('should promote accessed entries (get moves to most-recent)', () => {
    const lru = new LRUMap(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);

    // Access 'a' to promote it
    lru.get('a');

    // Now 'b' is the oldest, should be evicted
    lru.set('d', 4);

    assert.equal(lru.has('b'), false);
    assert.equal(lru.get('a'), 1);
    assert.equal(lru.get('c'), 3);
    assert.equal(lru.get('d'), 4);
  });

  it('should move updated existing key to most-recent', () => {
    const lru = new LRUMap(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);

    // Update 'a' — should move it to most-recent
    lru.set('a', 10);

    // Now 'b' is oldest
    lru.set('d', 4);

    assert.equal(lru.has('b'), false);
    assert.equal(lru.get('a'), 10);
    assert.equal(lru.get('c'), 3);
    assert.equal(lru.get('d'), 4);
  });

  it('should clear all entries', () => {
    const lru = new LRUMap(10);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);

    lru.clear();

    assert.equal(lru.size, 0);
    assert.equal(lru.has('a'), false);
    assert.equal(lru.has('b'), false);
    assert.equal(lru.has('c'), false);
  });

  it('should track size correctly', () => {
    const lru = new LRUMap(10);
    assert.equal(lru.size, 0);

    lru.set('a', 1);
    assert.equal(lru.size, 1);

    lru.set('b', 2);
    assert.equal(lru.size, 2);

    lru.delete('a');
    assert.equal(lru.size, 1);

    // Setting same key doesn't increase size
    lru.set('b', 20);
    assert.equal(lru.size, 1);
  });

  it('should return a plain Map snapshot from toMap()', () => {
    const lru = new LRUMap(10);
    lru.set('x', 100);
    lru.set('y', 200);

    const map = lru.toMap();

    assert.ok(map instanceof Map);
    assert.equal(map.size, 2);
    assert.equal(map.get('x'), 100);
    assert.equal(map.get('y'), 200);

    // Snapshot is independent — mutations don't affect LRU
    map.set('z', 300);
    assert.equal(lru.has('z'), false);
  });

  it('should handle capacity of 1', () => {
    const lru = new LRUMap(1);
    lru.set('a', 1);
    assert.equal(lru.get('a'), 1);

    lru.set('b', 2);
    assert.equal(lru.has('a'), false);
    assert.equal(lru.get('b'), 2);
    assert.equal(lru.size, 1);
  });
});
