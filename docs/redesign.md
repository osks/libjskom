# libjskom redesign

## Background: how the LysKOM elisp client reads texts

The Emacs client (lyskom-elisp-client) is the canonical LysKOM client and the reading
model that users expect. Understanding it informs what libjskom needs to support.

### Two-list architecture

The elisp client's reading is driven by two lists:

- **to-do-list** — conferences with unread texts, sorted by membership priority
  (0-255, higher = more important). This is the "what to read next" queue at the
  conference level. Built from memberships on login.
- **reading-list** — what's being read right now. A stack of "read-info" entries.
  When you read a text and it has comments, those comments get pushed onto the
  reading-list. When the reading-list empties, the next entry from to-do-list
  takes over.

Each read-info entry has a type:

| Type | Meaning |
|---|---|
| CONF | Unread texts in a conference (from to-do-list) |
| COMM-IN | Comments to a text you just read |
| FOOTN-IN | Footnotes to a text you just read |
| REVIEW | Review a specific list of texts (user-initiated) |
| REVIEW-TREE | Recursively review a comment tree |
| REVIEW-MARK | Review marked/bookmarked texts |

### Reading flow

1. User presses space. The client looks at the top of reading-list.
2. If reading-list is empty, pop the next conference from to-do-list, enter it,
   and create a CONF entry on reading-list.
3. Take the next text_no from the current read-info entry.
4. Fetch and display the text (appended to the Emacs buffer, not replacing).
5. After displaying, scan the text's `comment_in_list` and `footnote_in_list`.
6. If there are unread footnotes, push a FOOTN-IN entry (priority +1).
7. If there are unread comments, push a COMM-IN entry.
8. Go to step 1.

This creates depth-first reading through comment trees. Footnotes always come before
comments because of the +1 priority. When a comment branch is exhausted, the client
returns to the next sibling branch.

### Example

```
Text #100 (root, in conf "Programmering")
  Footnote #101 (footnote to #100)
  Comment #102 (comment to #100)
    Comment #104 (comment to #102)
  Comment #103 (comment to #100)

Reading order: #100, #101, #102, #104, #103
```

After reading #100:
- reading-list gets FOOTN-IN [#101] (priority +1)
- reading-list gets COMM-IN [#102, #103]

After reading #101 (footnote, no children):
- FOOTN-IN entry exhausted, popped

After reading #102:
- COMM-IN [#104] pushed on top of existing COMM-IN [#103]

After reading #104 (no children):
- Entry exhausted, popped. Back to COMM-IN [#103]

After reading #103:
- Entry exhausted. Reading-list empty → next conference from to-do-list.

### Comment following rules

Not all comments are followed:

- Only unread comments are added (already-read ones are skipped)
- `kom-follow-comments-outside-membership` controls whether comments posted to
  conferences the user isn't a member of are followed. Default: follow them.
- Cross-posted texts (multiple recipients) may appear in several conferences'
  unread lists. When encountered the second time, the text is already read and
  gets skipped.

### Review system

Beyond normal reading, users can issue review commands:

- **Review tree** — show the entire comment tree for a text, read or unread
- **Review by author** — all texts by a specific person
- **Review marked** — all bookmarked texts
- **Review comments** — just the comments to a specific text

These create REVIEW entries on the reading-list. They can be suspended and resumed,
and cleared with a single command (review-clear).

### Prefetching

The elisp client aggressively prefetches to keep the UI responsive:

- Text stats and bodies for upcoming texts in the reading-list
- Author and conference info for texts about to be displayed
- Comment trees are prefetched recursively
- A concurrent request limit prevents flooding the server
- Prefetch is inhibited during critical operations

### Buffer model

Texts are appended to a single Emacs buffer. The buffer has a configurable max size
(`kom-max-buffer-size`) — when exceeded, the oldest text at the top is trimmed. This
means the user can scroll back to see recently read texts but the buffer doesn't grow
unbounded.

### Key takeaways for libjskom

- The two-list model (to-do-list + reading-list stack) is the core abstraction. The
  reading-list is a stack of differently-typed entries, not just a flat queue.
- Footnotes are prioritized over comments — they're addenda by the author.
- Comment following is the default behavior but is configurable and filtered.
- The review system is powerful — users expect to be able to say "show me all
  comments to this text" or "show me everything by this author."
- Prefetching is essential for perceived performance.
- Cross-posted texts and duplicate encounters are handled gracefully.

## What libjskom is

libjskom is not an API client — it's the client foundation for building LysKOM applications.
A thin httpkom wrapper would be ~20 functions. libjskom handles the hard parts:

- Session lifecycle (connect, reconnect on 403, login/logout state)
- Membership tracking (fetch, paginate, merge unread/read memberships)
- Unread state management (polling, marking read/unread, count updates)
- Text caching (LysKOM texts are immutable — fetch once, keep forever)
- Reading order (DFS thread traversal through comment trees)
- Optimistic updates (mark as read locally before server confirms)

The UI layer (jskom2) should be thin — render state, call methods. libjskom owns the
domain logic and state.

## Problem with current design

libjskom was built for AngularJS: mutable state objects, event broadcasts, controllers
that manually sync UI. React works differently — state lives in `useState`, UI re-renders
when state changes via `setState`. Bridging these models requires glue code for every event.

The goal is to keep libjskom as the heavy, stateful client foundation, but change how it
exposes state so any UI framework can consume it naturally — without framework-specific
adapters or event-to-setState bridges.

## Core pattern: subscribe + getSnapshot

The library holds state internally and exposes two things:

```js
client.subscribe(listener)   // calls listener when state changes, returns unsubscribe fn
client.getSnapshot()         // returns current state (immutable object)
```

State is never mutated. Every change produces a new snapshot. Unchanged parts keep the
same object references (structural sharing).

React consumes this with one built-in hook:

```tsx
function useClient<T>(client: LyskomClient, selector: (s: Snapshot) => T): T {
  return useSyncExternalStore(
    client.subscribe,
    () => selector(client.getSnapshot())
  );
}
```

The selector picks a slice of state. React compares with `===` — same reference means
skip re-render. So `useClient(client, s => s.currentText)` only re-renders when
`currentText` actually changes.

## State shape

```ts
interface Snapshot {
  // Connection
  connectionStatus: 'disconnected' | 'connected' | 'reconnecting';
  isLoggedIn: boolean;
  persNo: number | null;
  personName: string | null;

  // Servers
  servers: Record<string, LyskomServer>;

  // Memberships
  memberships: Membership[];     // sorted by priority, unread first
  // (each membership has .unread_texts: number[])

  // Texts
  texts: Map<number, KomText>;   // cached fetched texts (LRU, max ~500)

  // Reader
  reader: ReaderState | null;    // null = no conference entered
}

interface ReaderState {
  confNo: number;
  queue: number[];      // text_nos in DFS reading order
  position: number;     // index into queue (-1 = not started)
  building: boolean;    // true while DFS traversal is still discovering texts
}
```

This is a single object, but consumers select slices. Updating `memberships` doesn't
re-render a component that only selects `texts`.

## How state updates work

Internal method replaces the snapshot, keeping unchanged parts as same references:

```js
class LyskomClient {
  #state = { /* initial */ };
  #listeners = new Set();

  getSnapshot() {
    return this.#state;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    this.#listeners.forEach(fn => fn());
  }

  #setState(update) {
    this.#state = { ...this.#state, ...update };
    this.#emit();
  }
}
```

Concrete example — marking a text as read:

```js
async markAsRead(textNo) {
  const text = this.#state.texts.get(textNo);
  const confNos = text.recipient_list.map(r => r.recpt.conf_no);

  // optimistic update
  this.#setState({
    memberships: this.#state.memberships.map(m =>
      confNos.includes(m.conference.conf_no)
        ? { ...m, unread_texts: m.unread_texts.filter(t => t !== textNo) }
        : m  // same reference — selectors skip re-render
    )
  });

  // fire-and-forget HTTP
  await this.#http('PUT', `/texts/${textNo}/read-marking`);
}
```

What happens in React:
- Component selecting `memberships` re-renders (new array)
- Component selecting `texts` does not (same Map reference)
- Component selecting `session` does not (same object reference)

## Examples of operations

### Connect + login

```js
async connect(serverId) {
  const session = await this.#http('POST', '/sessions/', { ... });
  this.#setState({
    session,
    isConnected: true,
  });
}

async login(name, passwd) {
  const person = await this.#http('POST', '/sessions/current/login', { ... });
  this.#setState({
    isLoggedIn: true,
    persNo: person.pers_no,
    personName: person.pers_name,
  });
  // trigger membership fetch
  this.#fetchMemberships();
}
```

### Fetch text

```js
#inFlight = new Map<number, Promise<KomText>>();  // dedup concurrent requests

async getText(textNo) {
  // return from cache if available
  const cached = this.#state.texts.get(textNo);
  if (cached) return cached;

  // dedup: if already fetching this text, return the same promise
  const existing = this.#inFlight.get(textNo);
  if (existing) return existing;

  const promise = this.#fetchText(textNo);
  this.#inFlight.set(textNo, promise);
  try {
    return await promise;
  } finally {
    this.#inFlight.delete(textNo);
  }
}

async #fetchText(textNo) {
  const text = await this.#http('GET', `/texts/${textNo}`);

  // new Map with the added entry — old entries keep same references
  const texts = new Map(this.#state.texts);
  texts.set(textNo, text);
  this.#setState({ texts });

  return text;
}
```

This matters because prefetching + the reader + UI components may all call
`getText(42)` around the same time. Without dedup, that's 3 identical HTTP requests.

### Invalidate cached text

For when we know a text's metadata has changed (e.g. new comment added, detected
via polling or future async messages):

```js
invalidateText(textNo) {
  if (!this.#state.texts.has(textNo)) return;
  const texts = new Map(this.#state.texts);
  texts.delete(textNo);
  this.#setState({ texts });
  // next getText(textNo) will re-fetch from server
}
```

### Membership polling

```js
#startPolling() {
  this.#pollTimer = setInterval(() => this.#refreshUnreads(), 2 * 60 * 1000);
}

async #refreshUnreads() {
  const unreads = await this.#http('GET', `/persons/${this.#state.persNo}/memberships/unread/`);
  // merge new unread info into existing memberships
  this.#setState({
    memberships: this.#state.memberships.map(m => {
      const updated = unreads.find(u => u.conf_no === m.conference.conf_no);
      return updated
        ? { ...m, no_of_unread: updated.no_of_unread, unread_texts: updated.unread_texts }
        : m;
    })
  });
}
```

### Create text (comment)

```js
async createText({ subject, body, recipientList, commentToList }) {
  const result = await this.#http('POST', '/texts/', {
    subject, body,
    content_type: 'text/plain',
    recipient_list: recipientList,
    comment_to_list: commentToList,
  });

  // the new text is now unread in recipient conferences
  const confNos = recipientList.map(r => r.recpt.conf_no);
  this.#setState({
    memberships: this.#state.memberships.map(m =>
      confNos.includes(m.conference.conf_no)
        ? { ...m, unread_texts: [...m.unread_texts, result.text_no] }
        : m
    )
  });

  return result;
}
```

## Reading: primitives and built-in reader

The library provides two layers:

1. **Primitives** — the foundation for any reading model. These are always available
   regardless of whether the built-in reader is used.
2. **Built-in reader** — a convenience layer implementing the classic LysKOM DFS
   reading order. Optional — the app can ignore it and build its own reader using
   the primitives.

### Primitives

Everything needed to build a custom reader:

- `getText(textNo)` — fetch + cache a text
- `markAsRead(textNo)` — optimistic unread update
- `invalidateText(textNo)` — force re-fetch
- `snapshot.memberships[].unread_texts` — per-conference unread text lists
- `snapshot.texts` — the text cache (check if a text is already fetched)
- Fetched texts have `comment_to_list` and `comment_in_list` for traversing
  the comment tree in any order

With these, the app can implement any reading strategy: DFS, chronological, threaded
view, single-text-at-a-time, infinite scroll, etc. The library handles caching,
dedup, unread tracking, and optimistic updates regardless.

### Built-in reader

A convenience layer implementing classic LysKOM DFS reading order. The app can use
it as-is, or as a starting point. If the reading model in jskom2 evolves away from
the classic model, the built-in reader can be ignored without losing anything — the
primitives underneath remain the same.

The built-in reader maintains state in `snapshot.reader` (see State shape above).

### How the reader works internally

```js
async enterConference(confNo) {
  const membership = this.#state.memberships.find(
    m => m.conference.conf_no === confNo
  );
  const unreadTexts = membership?.unread_texts ?? [];

  this.#setState({
    reader: {
      confNo,
      queue: [...unreadTexts],  // initial order — will be rearranged by DFS
      position: -1,             // not yet started
      prefetching: false,
    }
  });

  // start building the DFS reading order + prefetch
  this.#buildReadingOrder(confNo, unreadTexts);
}
```

### DFS thread traversal

The algorithm: take the next unread text, fetch it, look at its `comment_in_list`,
find unread comments, insert them right after the current text in the queue (DFS).

```js
async #buildReadingOrder(confNo, unreadTexts) {
  const unreadSet = new Set(unreadTexts);
  const ordered = [];
  const remaining = [...unreadTexts];

  while (remaining.length > 0) {
    const textNo = remaining.shift();
    if (!unreadSet.has(textNo)) continue;  // already placed
    unreadSet.delete(textNo);
    ordered.push(textNo);

    // fetch to discover comment tree
    const text = await this.getText(textNo);

    // find unread comments — insert them next (DFS: push in reverse so first comes first)
    const unreadComments = (text.comment_in_list ?? [])
      .filter(c => c.type === 'comment' && unreadSet.has(c.text_no))
      .map(c => c.text_no);

    remaining.unshift(...unreadComments);
  }

  this.#setState({
    reader: { ...this.#state.reader, queue: ordered }
  });
}
```

### Advance (space key)

```js
advance() {
  const reader = this.#state.reader;
  if (!reader) return null;

  const next = reader.position + 1;
  if (next >= reader.queue.length) return null;  // end of conference

  const textNo = reader.queue[next];
  this.#setState({
    reader: { ...reader, position: next }
  });

  // mark as read (optimistic)
  const text = this.#state.texts.get(textNo);
  if (text) this.markAsRead(textNo);

  // prefetch ahead
  this.#prefetch(next);

  return textNo;
}
```

### Prefetching

Old jskom prefetched 5 texts ahead. Same idea — when the user advances, start
fetching the next few texts so they're in cache when needed.

```js
async #prefetch(fromPosition) {
  const reader = this.#state.reader;
  const AHEAD = 5;

  for (let i = fromPosition + 1; i < Math.min(fromPosition + AHEAD, reader.queue.length); i++) {
    const textNo = reader.queue[i];
    if (!this.#state.texts.has(textNo)) {
      this.getText(textNo);  // fire-and-forget — updates text cache in snapshot
    }
  }
}
```

### Conference switching (space at end of conference)

When the reader runs out of texts in a conference, the UI calls:

```js
nextUnreadConference() {
  // find first membership with unread texts (by priority order)
  const next = this.#state.memberships.find(
    m => m.no_of_unread > 0 && m.conference.conf_no !== this.#state.reader?.confNo
  );
  if (next) {
    this.enterConference(next.conference.conf_no);
    return next.conference.conf_no;
  }
  return null;  // nothing unread anywhere
}
```

### Skip conference (H key — hoppa)

Skip remaining unread texts in current conference. Marks them as read on the server
so they don't come back.

```js
async skipConference() {
  const reader = this.#state.reader;
  if (!reader) return;

  // remaining unread in this conference
  const remaining = reader.queue.slice(reader.position + 1);
  const confNo = reader.confNo;

  // tell server to set unread count to 0
  await this.#http('POST', `/persons/current/memberships/${confNo}/unread`, {
    no_of_unread: 0
  });

  // update local state
  this.#setState({
    reader: null,
    memberships: this.#state.memberships.map(m =>
      m.conference.conf_no === confNo
        ? { ...m, no_of_unread: 0, unread_texts: [] }
        : m
    )
  });
}
```

### Incremental reading order

The DFS traversal fetches texts to discover comment trees. This takes time for large
conferences. The reader should be usable immediately — update the queue incrementally
as texts are fetched, not just at the end:

```js
async #buildReadingOrder(confNo, unreadTexts) {
  const unreadSet = new Set(unreadTexts);
  const ordered: number[] = [];
  const remaining = [...unreadTexts];

  while (remaining.length > 0) {
    const textNo = remaining.shift()!;
    if (!unreadSet.has(textNo)) continue;
    unreadSet.delete(textNo);
    ordered.push(textNo);

    const text = await this.getText(textNo);

    const unreadComments = (text.comment_in_list ?? [])
      .filter(c => c.type === 'comment' && unreadSet.has(c.text_no))
      .map(c => c.text_no);

    remaining.unshift(...unreadComments);

    // update queue incrementally — UI can start showing texts immediately
    if (this.#state.reader?.confNo === confNo) {
      this.#setState({
        reader: { ...this.#state.reader, queue: [...ordered, ...remaining] }
      });
    }
  }
}
```

## Persistence

### What gets saved to localStorage

```js
toObject() {
  return {
    id: this.id,
    lyskomServerId: this.lyskomServerId,
    httpkomId: this.httpkomId,
    session: this.#state.session,
  };
}
```

Same as today — just enough to reconnect. Memberships and texts are re-fetched on
reload. The text cache is in-memory only (could use IndexedDB later if needed, but
texts are small and fetch is fast).

### Restoring from localStorage

```js
static fromObject(obj) {
  const client = new LyskomClient({
    id: obj.id,
    lyskomServerId: obj.lyskomServerId,
    httpkomId: obj.httpkomId,
    session: obj.session,
  });
  // session exists → try to resume
  if (obj.session) {
    client.#setState({
      session: obj.session,
      isConnected: true,
      isLoggedIn: Boolean(obj.session.person),
      persNo: obj.session.person?.pers_no ?? null,
      personName: obj.session.person?.pers_name ?? null,
    });
    // kick off membership fetch in background
    if (obj.session.person) {
      client.#fetchMemberships();
      client.#startPolling();
    }
  }
  return client;
}
```

## Initialization flow

Cold start (no saved session):

```
new LyskomClient()
  → snapshot: { isConnected: false, isLoggedIn: false, memberships: [], texts: new Map(), ... }

client.fetchServers()
  → snapshot: { ..., servers: { lyskom: {...}, testkom: {...} } }

client.connect('lyskom')
  → HTTP POST /sessions/
  → snapshot: { ..., isConnected: true, connectionStatus: 'connected' }

client.login('oskar', 'secret')
  → HTTP POST /sessions/current/login
  → snapshot: { ..., isLoggedIn: true, persNo: 6, personName: 'oskar' }
  → internally starts #fetchMemberships() and #startPolling()
  → snapshot updates as memberships arrive: { ..., memberships: [...] }
```

Warm start (saved session):

```
LyskomClient.fromObject(savedObj)
  → snapshot: { isConnected: true, isLoggedIn: true, persNo: 6, ... }
  → immediately usable — UI shows logged-in state
  → memberships arrive in background → snapshot updates
  → if session is stale (403), auto-reconnects transparently
```

## Logout and cleanup

Logout resets all state back to "connected but not logged in":

```js
async logout() {
  this.#stopPolling();
  await this.#http('POST', '/sessions/current/logout');
  this.#setState({
    isLoggedIn: false,
    persNo: null,
    personName: null,
    memberships: [],
    texts: new Map(),
    reader: null,
  });
  // session and connection remain — user can log in again without reconnecting
}
```

Full teardown when the client instance is no longer needed:

```js
destroy() {
  this.#stopPolling();
  this.#pendingRequests.forEach(r => r.controller.abort());
  this.#pendingRequests.clear();
  this.#listeners.clear();
}
```

## What stays from current libjskom

- HTTP layer with session headers, reconnect-on-403, pending request tracking
- Session lifecycle (connect, disconnect, login, logout)
- `toObject()` / `fromObject()` for localStorage persistence
- Membership polling and merging logic (currently in MembershipListHandler)
- Person creation (createPerson)

## What changes

| Before | After |
|---|---|
| Mutable `MembershipList` object | Immutable `memberships` array in snapshot |
| `broadcast()` + `on()` events | `#setState()` + `subscribe()` |
| `MembershipListHandler` class | Private methods on `LyskomClient` |
| Separate `EventBus` module | No event bus — just `#listeners` Set |
| Mixins (`TextsMixin`, etc.) | Could keep mixins or just methods — internal detail |
| Consumers call methods, listen to events | Consumers call methods, select state slices |
| Text cache as separate concern | `texts` Map in snapshot |
| No reading order | Reader with DFS queue built in |
| Caller does `new Map()` cache externally | Library owns text cache |

## React usage

The `useClient` hook is the only bridge between libjskom and React. Everything else
is plain method calls.

```tsx
// The hook — ~5 lines, lives in the app
function useClient<T>(client: LyskomClient, selector: (s: Snapshot) => T): T {
  return useSyncExternalStore(
    client.subscribe,
    () => selector(client.getSnapshot())
  );
}
```

### Login gate

```tsx
function App() {
  const isLoggedIn = useClient(client, s => s.isLoggedIn);
  if (!isLoggedIn) return <LoginScreen client={client} />;
  return <Main client={client} />;
}
```

### Sidebar

```tsx
function Sidebar({ client }) {
  const memberships = useClient(client, s => s.memberships);
  return (
    <ul>
      {memberships.map(m => (
        <li key={m.conference.conf_no}>
          {m.conference.name}
          {m.no_of_unread > 0 && <span> ({m.no_of_unread})</span>}
        </li>
      ))}
    </ul>
  );
}
```

### Reading texts

```tsx
function Reader({ client }) {
  const reader = useClient(client, s => s.reader);
  const texts = useClient(client, s => s.texts);

  if (!reader) return null;

  // render all texts up to current position
  const visible = reader.queue.slice(0, reader.position + 1);

  return (
    <div>
      {visible.map(textNo => {
        const text = texts.get(textNo);
        if (!text) return <div key={textNo}>Loading #{textNo}...</div>;
        return <TextDisplay key={textNo} text={text} />;
      })}
    </div>
  );
}
```

### Space key handler

```tsx
function useKeyboard(client) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === ' ') {
        e.preventDefault();
        const next = client.advance();
        if (next === null) {
          // end of conference — try next
          client.nextUnreadConference();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [client]);
}
```

### Connection status banner

```tsx
function ConnectionBanner({ client }) {
  const status = useClient(client, s => s.connectionStatus);
  if (status === 'connected') return null;
  if (status === 'reconnecting') return <Banner>Reconnecting...</Banner>;
  return <Banner>Disconnected</Banner>;
}
```

### Composing a text

```tsx
function ComposeComment({ client, parentText }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  async function send() {
    setSending(true);
    setError(null);
    try {
      await client.createText({
        subject: parentText.subject,
        body,
        recipientList: parentText.recipient_list,
        commentToList: [{ type: 'comment', text_no: parentText.text_no }],
      });
      setBody('');
    } catch (err) {
      setError(err.message);  // operation error — handled locally
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); send(); }}>
      <textarea value={body} onChange={e => setBody(e.target.value)} />
      {error && <div className="error">{error}</div>}
      <button disabled={sending}>Skicka</button>
    </form>
  );
}
```

## Error handling

Two kinds of errors, surfaced differently:

### Operation errors — thrown from methods

When the caller explicitly does something and it fails, the method throws. The UI
handles it locally (show message, retry, etc.).

```js
// login with wrong password
try {
  await client.login('oskar', 'wrong');
} catch (err) {
  // err has status, message — caller shows it in the login form
  setError(err.message);
}

// text doesn't exist
try {
  await client.getText(99999);
} catch (err) {
  // caller decides what to do — show "text not found", skip it, etc.
}

// createText permission denied
try {
  await client.createText({ ... });
} catch (err) {
  // show error in compose UI
}
```

These are normal promise rejections. The library doesn't put them in the snapshot —
they belong to the specific call site.

### Session/connection errors — state in snapshot

Background problems that aren't tied to a user action. The session expires, httpkom goes
down, polling fails repeatedly. These are ambient state the UI needs to reflect.

```ts
interface Snapshot {
  // ...existing fields...

  // Connection health
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
}
```

The library handles reconnection internally (as it does today with the 403 retry logic).
The snapshot reflects the current state so the UI can show a banner or redirect to login.

```tsx
function ConnectionBanner({ client }) {
  const status = useClient(client, s => s.connectionStatus);
  if (status === 'connected') return null;
  if (status === 'reconnecting') return <div>Reconnecting...</div>;
  return <div>Disconnected</div>;
}
```

### How specific cases map

| Situation | How surfaced |
|---|---|
| Login wrong password | `login()` throws |
| getText not found | `getText()` throws |
| createText permission denied | `createText()` throws |
| Session expired (403) | Library auto-reconnects; `connectionStatus` → `'reconnecting'` → `'connected'` |
| Reconnect fails | `connectionStatus` → `'disconnected'`, `isLoggedIn` → `false` |
| Polling failure | Silent retry with backoff; if persistent, `connectionStatus` changes |
| httpkom unreachable | `connectionStatus` → `'disconnected'` |
| Logged out by server (401) | `isLoggedIn` → `false`, `persNo` → `null` |

### What the library does not do

- No toast/notification system — that's UI
- No retry logic for user-initiated operations — if `createText` fails, the caller
  decides whether to retry
- No error state in the snapshot for operation errors — they're thrown, not stored

## Batching state updates

Multiple rapid `#setState` calls (e.g. fetching 20 memberships in sequence) each
notify all listeners individually. This is usually fine — React batches re-renders
within the same microtask. But if it becomes a problem, `#setState` can queue updates
and flush on microtask:

```js
#pendingUpdate: Partial<Snapshot> | null = null;

#setState(update) {
  if (!this.#pendingUpdate) {
    this.#pendingUpdate = update;
    queueMicrotask(() => {
      this.#state = { ...this.#state, ...this.#pendingUpdate };
      this.#pendingUpdate = null;
      this.#emit();
    });
  } else {
    Object.assign(this.#pendingUpdate, update);
  }
}
```

Start simple (immediate emit). Add batching only if profiling shows it's needed.

## Testing

The library is framework-agnostic, so tests don't need React. Test against the
public API: call methods, assert snapshot state.

```ts
// unit test — no httpkom needed
test('markAsRead removes text from unread list', async () => {
  const client = createMockClient({
    memberships: [
      { conference: { conf_no: 1 }, unread_texts: [10, 11, 12] }
    ],
    texts: new Map([[10, { text_no: 10, recipient_list: [{ recpt: { conf_no: 1 } }] }]])
  });

  await client.markAsRead(10);

  const snap = client.getSnapshot();
  expect(snap.memberships[0].unread_texts).toEqual([11, 12]);
});
```

```ts
// integration test — against real httpkom
test('getText fetches and caches', async () => {
  const client = new LyskomClient();
  await client.connect('lyskom');
  await client.login('test', 'test');

  const text = await client.getText(1);
  expect(text.text_no).toBe(1);

  // second call returns cached — no HTTP
  const cached = await client.getText(1);
  expect(cached).toBe(text);  // same reference
});
```

The subscribe/getSnapshot contract also makes it easy to test that UI-relevant state
changes happen: subscribe, call a method, assert the listener was called and the
snapshot changed as expected.

## Derived state — selectors, not snapshot fields

Things like "unread memberships" or "total unread count" are derived from the memberships
array. These don't need to live in the snapshot — they're computed by selectors on the
React side:

```tsx
// in a component
const unreadMemberships = useClient(client, s =>
  s.memberships.filter(m => m.no_of_unread > 0)
);

const totalUnread = useClient(client, s =>
  s.memberships.reduce((sum, m) => sum + m.no_of_unread, 0)
);
```

Caveat: the selector runs on every notification, and `filter()` returns a new array
each time (even if contents are identical), which triggers a re-render. Two options:

1. **Memoize in the component** — `useMemo` on the selector result
2. **Custom equality** — pass a shallow-compare function to `useSyncExternalStore`

For most cases this is fine — membership arrays are small. Only optimize if it's
actually a problem.

## Decisions

- **Text cache lives in the library.** Texts are immutable in LysKOM, so the cache only
  grows. Having it in the library means the cache survives component unmounts and doesn't
  need to be re-fetched when navigating back.
- **Operation errors are thrown, session errors are state.** Methods reject on failure,
  connection/session health lives in the snapshot.
- **Reading has two layers: primitives + optional built-in reader.** The primitives
  (getText, markAsRead, unread_texts, comment tree data) support any reading model.
  The built-in DFS reader is a convenience, not a requirement.
- **Derived state is computed by selectors.** The snapshot stores normalized data; filtering
  and aggregation happen on the consumer side.
- **No event bus.** The broadcast/on pattern is replaced entirely by subscribe/getSnapshot.

## Additional operations

Features from old jskom that need library support. Grouped by how much they affect
the design.

### Stateless methods — just add them

These are simple request-response methods. No snapshot state, no state updates.
They return data and the caller uses it however it wants.

```ts
// conference lookup — for "go to conference" dialog
lookupConferences(name: string, wantConfs?: boolean, wantPersons?: boolean):
  Promise<Array<{ conf_no: number; name: string }>>

// conference details — for conference info display
getConference(confNo: number): Promise<Conference>

// change password
setPassword(persNo: number, oldPasswd: string, newPasswd: string): Promise<void>

// set/change presentation text
setPresentation(persNo: number, textNo: number): Promise<void>
```

No design implications — these are just more HTTP wrappers.

### Marks (bookmarks)

Marks need snapshot state. A user can mark texts with a type (0-255) for later
retrieval. Fetched on login, updated optimistically.

```ts
interface Snapshot {
  // ...existing fields...
  marks: Map<number, number>;  // text_no → mark type
}
```

```ts
// methods
getMarks(): Promise<void>             // fetches all, updates snapshot.marks
createMark(textNo: number, type: number): Promise<void>  // optimistic update
deleteMark(textNo: number): Promise<void>                // optimistic update
```

On login, `getMarks()` is called alongside `#fetchMemberships()`. The marks Map
is small (typically tens of entries) so fetching all at once is fine.

### Set unread count (E key — "endast")

Lets the user set how many texts are unread in a conference. This resets the
`unread_texts` list server-side and needs a local state update.

```ts
async setUnreadCount(confNo: number, count: number): Promise<void>
```

After the server confirms, the library needs to re-fetch the membership unread
for that conference to get the new `unread_texts` list:

```js
async setUnreadCount(confNo, count) {
  await this.#http('POST', `/persons/current/memberships/${confNo}/unread`, {
    no_of_unread: count
  });
  // re-fetch to get the actual unread_texts list from server
  const unread = await this.#http('GET', `/persons/${this.#state.persNo}/memberships/${confNo}/unread`);
  this.#setState({
    memberships: this.#state.memberships.map(m =>
      m.conference.conf_no === confNo
        ? { ...m, no_of_unread: unread.no_of_unread, unread_texts: unread.unread_texts }
        : m
    )
  });
  // if currently reading this conference, rebuild reading order
  if (this.#state.reader?.confNo === confNo) {
    this.enterConference(confNo);
  }
}
```

### Reader: show commented text (comma key)

Old jskom had a "pending" queue for manually requested texts — separate from the
DFS unread queue. When the user presses comma, the parent text gets pushed to
pending, and the reader shows it next.

This changes the reader state:

```ts
interface ReaderState {
  confNo: number;
  queue: number[];       // DFS reading order (unread texts)
  position: number;
  building: boolean;
  pending: number[];     // manually requested texts — shown before continuing queue
}
```

```js
// push a text to be shown next (comma key, clicking a text link)
showText(textNo) {
  const reader = this.#state.reader;
  if (!reader) return;

  // fetch if not cached
  if (!this.#state.texts.has(textNo)) {
    this.getText(textNo);
  }

  this.#setState({
    reader: { ...reader, pending: [...reader.pending, textNo] }
  });
}

// advance() checks pending first
advance() {
  const reader = this.#state.reader;
  if (!reader) return null;

  // pending texts take priority
  if (reader.pending.length > 0) {
    const [textNo, ...rest] = reader.pending;
    this.#setState({
      reader: { ...reader, pending: rest }
    });
    return textNo;
  }

  // then continue DFS queue
  const next = reader.position + 1;
  if (next >= reader.queue.length) return null;

  const textNo = reader.queue[next];
  this.#setState({
    reader: { ...reader, position: next }
  });

  const text = this.#state.texts.get(textNo);
  if (text) this.markAsRead(textNo);
  this.#prefetch(next);

  return textNo;
}
```

Note: pending texts are NOT marked as read automatically — they might be from
other conferences or already-read texts the user just wants to see again.

### Multiple sessions

Old jskom supported multiple simultaneous connections to different servers (or same
server, different user). The UI had a session switcher (Shift+N).

This does NOT require multi-session support inside a single `LyskomClient`.
Each session is a separate `LyskomClient` instance. The app layer manages the list:

```tsx
// in the app, not in libjskom
const [clients, setClients] = useState<LyskomClient[]>([loadedClient]);
const [activeIndex, setActiveIndex] = useState(0);
const client = clients[activeIndex];
```

The library stays simple — one client, one session, one connection. The app creates
multiple instances if needed. Each has its own snapshot and subscribers.

### Features that are pure UI (no library impact)

These are handled entirely in the rendering layer:

- **Fast replies** — just reading `aux_items` from already-fetched `KomText` objects
- **Content-type rendering** — text/html/image detection and display
- **Text body link parsing** — `<text 1234>`, URLs, `<möte ...>` syntax
- **rot13** — trivial string transform on the body
- **Keyboard shortcuts** — UI event handlers calling library methods

## TypeScript

The rewrite will be in TypeScript. Current libjskom is plain JS with a hand-maintained
`.d.ts` file in jskom2 — fragile and duplicated. TypeScript means:

- Snapshot interface is the source of truth, used by both library and consumers
- No separate type declarations to keep in sync
- Catches internal bugs at compile time
- jskom2 gets full types via `import { LyskomClient } from 'libjskom'`

## Open questions

- Should the library expose `changeConference()` (httpkom endpoint that updates
  last-time-read on server) as part of `enterConference()`, or as a separate call?
- Text cache eviction — LRU with a max size (e.g. 500). When full, evict least recently
  accessed text. Texts in the current reader queue should be pinned (don't evict what's
  about to be shown). A miss just means a re-fetch — texts are immutable so there's no
  staleness concern, only latency.
- Marks (bookmarks) — `KomMark` with types 0-255. Where do these live? Probably
  a `marks: Map<number, number>` in the snapshot, fetched on login.
- Async messages — LysKOM Protocol A has async messages that notify about new texts,
  deleted texts, new recipients, etc. When someone comments text #100, the server sends
  `AsyncNewText` (msg 15) with the new comment's `comment_to_list` pointing at #100 —
  so we'd know #100's `comment_in_list` is stale and needs re-fetch. pylyskom already
  parses all 23 async message types and has cache invalidation handlers. **However,
  httpkom currently does not forward async messages to browser clients.** The websocket
  implementation only does request-response. Extending httpkom to push async messages
  would replace polling for unread updates AND solve cache invalidation. Not needed for
  initial version, but the text cache should support invalidation (re-fetch a text_no)
  so this can be wired in later. SSE (Server-Sent Events) might be simpler than
  websockets for this — async messages are one-directional (server → client), which is
  exactly what SSE does. Regular HTTP handles requests, SSE handles push notifications.
  httpkom is Quart (async Flask) which supports SSE natively via streaming responses.
