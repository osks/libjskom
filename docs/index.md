# libjskom

A JavaScript client library for [LysKOM](https://www.lysator.liu.se/lyskom/) via [httpkom](https://github.com/osks/httpkom). Pure ES6 modules, no dependencies — uses the browser's built-in `fetch` API to communicate with a LysKOM server through httpkom's REST interface.

Handles sessions, login/logout, person management, conference memberships, and unread tracking.

## Quick start

```js
import { HttpkomClient } from './src/HttpkomClient.js';

const client = new HttpkomClient({
  lyskomServerId: 'default',
  httpkomServer: 'http://localhost:5001',
});

await client.connect();
await client.login({ name: 'Test User', passwd: 'test123' });

const memberships = await client.getMemberships();
console.log(memberships);

await client.logout();
await client.disconnect();
```

## Docs

```sh
npm install
npm run docs:serve
```

This generates API reference markdown from JSDoc and serves the docs locally.

## Tests

End-to-end tests run against a real LysKOM server and httpkom in Docker
containers (started by [testcontainers](https://testcontainers.com)):

```sh
npm run test:e2e
```

httpkom reaches lyskomd through [Toxiproxy](https://github.com/Shopify/toxiproxy),
so tests can break the connection between them: drop it
(`dropLyskomConnections()` in `e2e/helpers.ts`) or make it silently dead
(`blackholeLyskom()`). See `e2e/connection-loss.test.ts`.

The httpkom image installs pylyskom and httpkom from GitHub at commits pinned
in `e2e/httpkom/Dockerfile`. To test local, unreleased changes, point to your
checkouts:

```sh
PYLYSKOM_SRC=../pylyskom HTTPKOM_SRC=../httpkom npm run test:e2e
```
