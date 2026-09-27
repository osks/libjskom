# LyskomClient

`LyskomClient` (`src/LyskomClient.ts`) is the client that apps use: it keeps
all state in one snapshot and notifies subscribers when it changes. The design
behind it is described in [redesign.md](redesign.md). (The generated
[API reference](api.md) covers the older `HttpkomClient`.)

```ts
import { LyskomClient } from 'libjskom';

const client = new LyskomClient({ httpkomServer: '/httpkom' });
client.subscribe(() => render(client.getSnapshot()));

await client.connect('lyskom');
await client.login({ name: 'Oskar Nyström', passwd: 'secret' });
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `httpkomServer` | `'/httpkom'` | Base URL of httpkom |
| `lyskomServerId` | `''` | Server id in httpkom's config; can also be given to `connect()` |
| `clientName`, `clientVersion` | `'libjskom'`, `'0.2'` | Reported to the LysKOM server |
| `requestTimeoutMs` | `30000` | Abort requests that get no response within this time |
| `httpkomConnectionHeader` | `'Httpkom-Connection'` | Header carrying the session id |
| `cacheVersion`, `cacheVersionKey` | `0`, `'_v'` | Query parameter added to requests, for cache busting |
| `id`, `httpkomId`, `session` | | For restoring a saved client; use `LyskomClient.fromObject()` |

## Snapshot

`getSnapshot()` returns the current state. It is replaced (not mutated) on
every change, so comparing snapshots by identity tells you whether anything
changed.

| Field | Description |
| --- | --- |
| `connectionStatus` | See below |
| `isLoggedIn`, `persNo`, `personName` | The logged-in person |
| `serverId`, `servers` | Current LysKOM server, and all servers httpkom knows |
| `memberships` | Memberships with unread counts (`no_of_unread`, `unread_texts`), kept up to date by polling every 2 minutes |
| `texts` | Cached texts, by text number |
| `marks` | The person's marked texts |
| `reader` | The built-in reader's state, see below; `null` when not logged in |

### Connection status

| Value | Meaning |
| --- | --- |
| `disconnected` | No httpkom session (not connected yet, or the session was lost: httpkom answered 403) |
| `connected` | Requests get answers from httpkom |
| `reconnecting` | Logged in, but requests are failing: they time out (`requestTimeoutMs`), fail at the network level, or get 502–504 from a proxy. Goes back to `connected` on the next answer from httpkom |

A request that times out fails with an error with `timedOut: true`.

When the session is lost (httpkom answers 403, for example after its
connection to the LysKOM server died), the client resets: `isLoggedIn` becomes
`false` and `connectionStatus` `disconnected`. An app should then show its
login page.

### Reader

| Field | Description |
| --- | --- |
| `currentConfNo` | The conference being read, or `null` before entering one |
| `readingList` | What `advance()` will read, in order. Can still hold texts that have since been read; `advance()` skips those |
| `hasPendingText` | Whether `advance()` will show a text before moving to another conference. Use this rather than `readingList`, which may only hold already-read texts |
| `nextConfNo` | The conference `advance()` moves to when no text is pending, or `null` if there is none (everything read) |
| `allRead` | `readingList` is empty |
| `advancing` | An `advance()` is in progress |

So what the next `advance()` will do is:

- `hasPendingText`: show a text in the reading list
- otherwise `nextConfNo !== null`: move to that conference
- otherwise: nothing (everything is read)

The reader snapshot is recomputed whenever memberships change (polling,
set-unread, join, leave), not only on reader actions.
