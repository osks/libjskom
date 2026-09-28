import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LyskomClient, MemoryTextStore, disableLogging } from '../../dist/index.js';

disableLogging();

// --- A fake httpkom, just what the text cache uses ---

function makeText(textNo, commentIn = []) {
  return {
    text_no: textNo,
    subject: `Subject ${textNo}`,
    body: `Body ${textNo}`,
    content_type: 'text/plain',
    author: { pers_no: 1, pers_name: 'P' },
    creation_time: '2026-09-28T10:00:00Z',
    no_of_marks: 0,
    recipient_list: [],
    comment_to_list: [],
    comment_in_list: commentIn.map((no) => ({ type: 'comment', text_no: no, author: { pers_no: 2, pers_name: 'Q' } })),
    aux_items: [],
  };
}

function statOf(text) {
  const { subject, body, content_type, ...stat } = text;
  return stat;
}

function json(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

let server; // text_no -> text, as httpkom has it
let calls;  // requests made, e.g. "GET /s/texts/1"

beforeEach(() => {
  server = new Map([1, 2, 3].map((no) => [no, makeText(no)]));
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const { pathname } = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${pathname}`);
    let m;
    if (method === 'GET' && (m = pathname.match(/^\/s\/texts\/(\d+)$/))) {
      const text = server.get(Number(m[1]));
      return text ? json(text) : new Response(null, { status: 404 });
    }
    if (method === 'POST' && pathname === '/s/textstats') {
      const { text_nos } = JSON.parse(init.body);
      return json({ text_stats: Object.fromEntries(text_nos.map((no) => [no, server.has(no) ? statOf(server.get(no)) : null])) });
    }
    if (method === 'POST' && pathname === '/s/sessions/current/logout') {
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  };
});

function newClient(textStore) {
  return new LyskomClient({
    httpkomServer: 'http://httpkom',
    lyskomServerId: 's',
    httpkomId: 'conn-1',
    session: { session_no: 1, person: { pers_no: 1, pers_name: 'P' } },
    textStore,
  });
}

const requests = (prefix) => calls.filter((c) => c.startsWith(prefix));

// --- Tests ---

describe('text cache', () => {
  it('serves a stored text without requests (e.g. after a reload)', async () => {
    const store = new MemoryTextStore();
    await newClient(store).getText(1);

    calls = [];
    const text = await newClient(store).getText(1);
    assert.deepEqual(text, server.get(1));
    assert.deepEqual(calls, []);
  });

  it('loadStoredTexts() fills snapshot.texts without requests', async () => {
    const store = new MemoryTextStore();
    const first = newClient(store);
    await first.getText(1);
    await first.getText(2);

    calls = [];
    const client = newClient(store);
    assert.equal(await client.loadStoredTexts([1, 2, 3]), 2);
    assert.deepEqual([...client.getSnapshot().texts.keys()].sort(), [1, 2]);
    assert.deepEqual(calls, []);
  });

  it('revalidateTexts() updates stats in one request, and never refetches bodies', async () => {
    const store = new MemoryTextStore();
    const client = newClient(store);
    await client.getText(1);
    await client.getText(2);

    // Someone comments on text 1
    server.set(1, makeText(1, [99]));
    calls = [];
    const result = await client.revalidateTexts([1, 2]);

    assert.deepEqual(result, { checked: 2, changed: 1, removed: 0 });
    assert.deepEqual(calls, ['POST /s/textstats']);
    const text = client.getSnapshot().texts.get(1);
    assert.deepEqual(text.comment_in_list.map((c) => c.text_no), [99]);
    assert.equal(text.body, 'Body 1');

    // The store has the new stat too
    calls = [];
    const again = await newClient(store).getText(1);
    assert.deepEqual(again.comment_in_list.map((c) => c.text_no), [99]);
    assert.deepEqual(calls, []);
  });

  it('revalidateTexts() skips stats fetched more recently than maxAgeMs', async () => {
    const client = newClient(new MemoryTextStore());
    await client.getText(1);
    calls = [];
    const result = await client.revalidateTexts([1], 60_000);
    assert.deepEqual(result, { checked: 0, changed: 0, removed: 0 });
    assert.deepEqual(calls, []);
  });

  it('revalidateTexts() removes texts that no longer exist', async () => {
    const store = new MemoryTextStore();
    const client = newClient(store);
    await client.getText(1);

    server.delete(1);
    const result = await client.revalidateTexts([1]);
    assert.deepEqual(result, { checked: 1, changed: 0, removed: 1 });
    assert.equal(client.getSnapshot().texts.has(1), false);
    assert.equal(await newClient(store).loadStoredTexts([1]), 0);
  });

  it('revalidateTexts() asks for at most 100 texts per request', async () => {
    const nos = Array.from({ length: 150 }, (_, i) => 1000 + i);
    for (const no of nos) server.set(no, makeText(no));
    const client = newClient(new MemoryTextStore());
    for (const no of nos) await client.getText(no);

    const sent = [];
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).includes('/textstats')) sent.push(JSON.parse(init.body).text_nos.length);
      return fetchBefore(url, init);
    };
    await client.revalidateTexts(nos);
    assert.deepEqual(sent, [100, 50]);
  });

  it('verifyCache() reports what differs from the server, without changing anything', async () => {
    const client = newClient(new MemoryTextStore());
    await client.getText(1);
    await client.getText(2);
    server.set(1, makeText(1, [99]));
    server.delete(2);

    assert.deepEqual(await client.verifyCache(), [
      { textNo: 1, fields: ['comment_in_list'] },
      { textNo: 2, fields: ['deleted'] },
    ]);
    assert.deepEqual(client.getSnapshot().texts.get(1).comment_in_list, []);

    await client.revalidateTexts([1, 2]);
    assert.deepEqual(await client.verifyCache(), []);
  });

  it('logout clears the store', async () => {
    const store = new MemoryTextStore();
    const client = newClient(store);
    await client.getText(1);
    await client.logout();
    assert.equal(await newClient(store).loadStoredTexts([1]), 0);
  });

  it('MemoryTextStore keeps at most maxBodies bodies, dropping the least recently used', async () => {
    const store = new MemoryTextStore({ maxBodies: 2 });
    await store.putBody(1, { subject: 'a', body: 'a', content_type: 'text/plain' });
    await store.putBody(2, { subject: 'b', body: 'b', content_type: 'text/plain' });
    await store.getBodies([1]); // 1 used more recently than 2
    await store.putBody(3, { subject: 'c', body: 'c', content_type: 'text/plain' });
    assert.deepEqual([...(await store.getBodies([1, 2, 3])).keys()].sort(), [1, 3]);
  });
});
