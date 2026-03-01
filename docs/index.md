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

End-to-end tests run against a real LysKOM server via Docker Compose:

```sh
npm run test:e2e
```

This starts lyskom-server, seeds fixture data, starts httpkom, runs the tests, and tears everything down.
