# Text cache: problem and ideas

Status: design notes, nothing implemented yet.

## The problem

jskom2 keeps the reading history (the buffer) as a list of text numbers in
localStorage, per person and server. That list survives a page reload, but
the texts themselves only live in libjskom's in-memory cache
(`LRUMap`, 500 texts), which is gone after a reload. So on startup the app
knows *which* texts to show, but has to fetch every one from httpkom before
anything is shown.

When those requests fail or hang, the stream stays empty. That happened on
iPhone after a night: httpkom's connection to the LysKOM server had died
silently, every request timed out after 30 seconds, and the app showed empty
lists and an empty stream. The same goes for memberships: the sidebar is empty
until they have been fetched.

Nothing retries the failed startup requests either: the unread poll only
updates counts on memberships already loaded. (Separate fix: refetch what
failed when the connection comes back, see below.)

Keeping only text numbers in the buffer is good: it's small and always
accurate. The texts need caching.

## What can change

- **Text body** (subject, body, content type): can't be changed once the
  text is created. Can be cached forever.
- **Text stat** (the metadata): can change.
  - `comment_in_list`: grows when someone comments on or adds a footnote to
    the text
  - recipients: added or removed (add-recipient, sub-recipient)
  - aux items: added or deleted
  - number of marks
  - the text can be deleted

A cached text stat can go stale, so it needs a freshness strategy. The goal is
a cache that can't stay stale.

## What httpkom offers

- `GET /texts/{no}`: stat and body together (what libjskom uses today)
- `GET /textstats/{no}`: stat only
- `POST /textstats` with `{"text_nos": [...]}`: many stats in one request
- `GET /texts/{no}/body`: body only
- `/websocket`: experimental, forwards raw protocol A requests. It does
  **not** push async messages to the client (yet). pylyskom's `AioClient`
  can receive async messages (`set_async_handler`), so the piece missing is
  in httpkom.

## How the elisp client does it

From reading `lyskom-elisp-client` (`src/cache.el`, `async.el`,
`prefetch.el`, `startup.el`) and the Protocol A spec and server code in
`lyskom-server` (`doc/Protocol-A.texi`, `src/server/text.c`):

- **A cache that lives only as long as the session.** Text stats and bodies
  are kept in plain lists per session, with no size limit or expiry. The whole
  cache is cleared on every login, including reconnects. Bodies are dropped
  once a text has been shown; the body cache mostly holds prefetched texts.
- **Invalidate, don't patch.** When an async message or the client's own
  action touches a text, the cached stat is deleted and fetched again when
  next needed:
  - `async-new-text` (15): the new text's stat is cached; the stats of the
    texts it comments on or is a footnote to are deleted (they got a new
    `comment_in`).
  - `async-deleted-text` (14): the linked texts' stats are deleted, and the
    text is removed from the cache and the reading lists.
  - `async-new-recipient` (16): the stat is deleted and fetched again at once.
  - `async-sub-recipient` (17): the stat is deleted.
  - `async-text-aux-changed` (22): the only case patched in place.
- **No write-through.** Posting a comment updates nothing locally; the
  commented text's stat is fixed only when the client's own `async-new-text`
  arrives and deletes it. Before its own mark, add-comment and similar calls,
  the client deletes the affected stats itself.
- **Reviewing can bypass the cache** (`kom-review-uses-cache`), since texts
  "may have changed since they were cached".
- **No revalidation, and no resync after reconnecting:** after a new login
  everything is fetched from scratch.
- It accepts async messages 5, 7–9, 11–22 right after connecting.

What the server does (verified in lyskomd):

- `async-new-text` is sent immediately when the text is created, with the new
  text's full stat, to logged-in sessions that accepted it, have read
  access, and are **active** members of a recipient (or of a recipient of a
  text it comments on). **Passive memberships get nothing.**
- `async-new-recipient` and `async-sub-recipient` carry only the text, the
  conference and the type, no stat.
- **No async message at all** for `add-comment`, `sub-comment` and
  `add-footnote` (linking existing texts), or for marks. A cached stat's
  `comment_in_list` and number of marks can therefore go stale without any
  message.
- The spec says nothing about ordering, loss or re-delivery.

What that means here:

- The elisp client can trust its cache only because the cache dies with the
  session. A cache that survives reloads and nights can't: messages are lost
  while offline, some changes never send messages, and passive memberships
  get none. **Revalidation (idea 3) is required, not just a safety net.**
- Invalidate-and-refetch (the elisp way) is the simplest correct reaction to
  an async message; patching (e.g. adding to the parent's `comment_in_list`)
  saves a request but must match the server exactly. Could start with
  invalidating, and patch only where it's clearly safe.
- Bodies can be kept: they never change, and a deleted text is removed as a
  whole.

## Ideas: three sources of freshness

### 1. Own actions: write-through, optimistic

When the user posts a text (e.g. a comment):

- It shows up in the stream at once, marked as pending.
- The texts it comments on are known from its `comment_to_list` at posting
  time, so their cached stats get the new text added to `comment_in_list`
  without refetching.
- When httpkom answers with the new text number, the pending entry becomes the
  real text. If posting fails, the entry shows the error and the draft is
  kept.

Mark/unmark and read markings already update local state this way
(`#markTextAsReadLocally`).

Don't rely on async messages for the user's own texts: if the push connection is
down they would never show up. Use httpkom's reply to the post, and make
merging idempotent (add to `comment_in_list` only if not already there), so an
async message for the same text is harmless.

### 2. Other people's actions: async messages

lyskomd sends async messages to sessions that have accepted them, right when
things happen:

- `async-new-text` (with the text stat) when a text is created: update the
  cached stats of the texts it comments on, and unread counts, at once. This
  would also make new texts show up live instead of with the 2-minute unread
  poll.
- `async-deleted-text`, `async-new-recipient`, `async-sub-recipient`,
  `async-text-aux-changed`: update or drop the cached stat.

Needs:

- httpkom: accept async messages on the LysKOM connection and push them to
  the client (see [Transport](#transport-for-async-messages); proposal: SSE).
- libjskom: a client for that stream, with reconnection (and falling back to
  polling when it's down).

lyskomd sends `async-new-text` immediately; see
[How the elisp client does it](#how-the-elisp-client-does-it) for who gets
which messages, and the changes that send none.

### 3. Bulk revalidation

Async messages are lost while the app is closed, asleep or offline, some
changes never send any, and passive memberships get none. So refresh the
cached stats of the texts in the buffer with one `POST /textstats`:

- on startup (after a reload)
- after the connection comes back (`reconnecting` → `connected`)
- when the app comes back to the foreground after a while

At worst a stat is stale until the next revalidation, never permanently.

## Storage

- IndexedDB (localStorage is limited to about 5 MB; a thousand texts can be
  more than that).
- Per person and server: what a person may read differs.
- Capped, e.g. the last few hundred texts (least recently used out).
- **Cleared on logout** (texts are stored on the device, not just in memory;
  matters on a shared computer). jskom2 already clears the buffer on login.
- **Two stores**, for bodies and for stats (two object stores in the same
  IndexedDB database), because they behave differently:

  | | Bodies (subject, body, content type) | Stats |
  | --- | --- | --- |
  | Changes | never | comments, recipients, aux items, marks, deletion |
  | Freshness | stored once, never revalidated | fetched-at time per stat, revalidated when too old |
  | Fetched with | `GET /texts/{no}` | `POST /textstats`, many at once |
  | Size | large | small |
  | Limit | e.g. 1000 (as the buffer), least recently used out | can be much larger |

  Revalidation only touches stats; and stats are needed for more texts than
  bodies are (the stream shows "↳ #19 by …" for comments not read yet, which
  needs their stat but not their body). The elisp client also keeps them
  apart (`lyskom-text-cache` and `lyskom-text-mass-cache`).
  `snapshot.texts` still gives apps complete texts (stat and body).

libjskom would get a small storage interface (get/put/delete/clear), so the
library isn't tied to IndexedDB; jskom2 provides the IndexedDB implementation.

Memberships could be cached the same way, so the sidebar shows at once on
startup (possibly slightly stale until the first refresh).

## Rendering

jskom2 keeps rendering from `snapshot.texts`; with the cache, it's filled
from storage before any request. The connection indicator (done: "Offline" /
"Connecting…" in the header) tells the user when what's shown may be stale.

## Related: recover after reconnecting

Independent of the cache: when the connection comes back (`reconnecting` →
`connected`) or the app returns to the foreground, refetch whatever failed
(memberships, marks, texts). Today the app stays empty until a reload.

## Transport for async messages

What's needed is push from server to client; requests go over normal HTTP as
now. Options:

- **Server-Sent Events (SSE)**: a long-lived HTTP response that the server
  writes events to; the browser's `EventSource` reads it.
  - One-way (server to client), which is all this needs.
  - Plain HTTP, so it passes through Caddy (and Vite's dev proxy) like other
    requests; Quart can stream responses.
  - `EventSource` reconnects by itself. lyskomd can't replay missed
    messages, so after a reconnect the client revalidates (idea 3) instead.
  - `EventSource` can't set headers, so the session id has to go in the
    query string or a cookie. The query string ends up in Caddy's access log;
    the log filter would have to remove it.
  - Browsers allow only 6 HTTP/1.1 connections per site, and a stream holds
    one. Fly serves browsers over HTTP/2, where that limit doesn't apply.
- **WebSocket**: two-way. httpkom already has an (experimental) endpoint that
  could be extended. More to build: reconnection and keepalive are up to us,
  and it's a separate protocol through proxies.
- **Long polling**: the client asks "anything new?" and the server answers
  when there is. Works everywhere, but more requests and slightly more delay.

Proposal: SSE. It fits one-way push, is the simplest to run through the
existing setup, and reconnects by itself.

Whatever the transport: a suspended PWA (iPhone) loses the connection, so
reconnecting must always be followed by revalidation.

## Testing

Cache bugs are hard to find because they show up as something slightly wrong
later (a missing comment, an old recipient), not as an error. So the tests
should compare the cache against the server, not just check that things
render.

### A consistency check: the cache against the server

A function in libjskom (e.g. `verifyCache()`) that fetches fresh stats for
everything cached (one `POST /textstats`) and reports every difference. Use it:

- at the end of e2e tests: after any sequence of actions, the cache must
  equal the server
- in the debug panel ("Verify cache"), to check a real device
- counted in production: how often revalidation finds a difference. If that
  happens often, the async handling has a bug.

### Unit tests (fast, no server)

The merge logic as plain functions, with an in-memory implementation of the
storage interface:

- idempotency: the post reply and `async-new-text` for the same text add one
  entry to `comment_in_list`, in either order
- revalidation overwrites a stale stat; the body is never refetched
- deleted texts, recipients added and removed, aux items
- logout clears everything; another person's cache isn't touched

### Randomized tests against a model

Generate random sequences of operations (fetch, own post, someone else's
post, async message delivered or lost, revalidation, reload, logout) and
apply them both to the cache and to a simple model of the server. After each
sequence plus a revalidation, the cache must match the model. A library like
fast-check can generate the sequences and shrink a failure to the shortest
sequence that reproduces it, which is what makes this kind of bug findable.

### e2e tests (real lyskomd and httpkom, as the existing e2e tests)

- **Two clients:** client B comments on a text in client A's cache; A sees
  the comment via async messages, or after revalidation.
- **Missed messages:** A is cut off (Toxiproxy) while B comments; after A
  reconnects, revalidation picks the comment up. `verifyCache()` passes.
- **Reload:** a new client with the same storage shows the texts before any
  request, even with httpkom unreachable.
- **Own post:** pending, then done, with the parent's `comment_in_list`
  updated without refetching; and a failed post (httpkom answers an error).
- **Logout** clears the storage.

### In the app (Playwright in jskom2)

- Reload with httpkom blocked: the stream shows the cached texts, and the
  header says "Connecting…".
- Posting a comment: the pending indicator, then the real text.
- Logout: IndexedDB is empty.
- `page.clock` to simulate the app being suspended overnight.

### Observability

Log cache events to the debug log (hits, misses, revalidation and what it
changed, async messages received), so a real device's cache behaviour can be
looked at with the debug panel's Copy.

## Suggested order

1. Persistent cache (bodies and stats), filled from storage on startup, with
   bulk revalidation on startup and reconnect. Fixes "empty after the night".
2. Write-through for posted texts (pending → done).
3. Async messages pushed from httpkom (SSE, in httpkom and libjskom).
   Largest step; also gives live updates.

## Open questions

- Stored stats: proposed to show them at once and revalidate in the
  background (the connection indicator tells when the connection doesn't
  work), rather than treat them as stale until revalidated. The elisp client
  never has to decide this, since its cache dies with the session.
- Cache size: proposed 1000 bodies (as the buffer); stats can be kept much
  longer.
- Deleted texts: remove from the cache, or keep a "deleted" marker so the
  buffer can show it?
- Should the texts' authors and recipients (persons, conferences) be cached
  too? Their names are needed to render a text.
