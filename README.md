# libjskom

A JavaScript client library for [LysKOM](https://www.lysator.liu.se/lyskom/) via [httpkom](https://github.com/osks/httpkom). Pure ES6 modules, no dependencies — uses the browser's built-in `fetch` API to communicate with a LysKOM server through httpkom's REST interface.

Handles sessions, login/logout, person management, conference memberships, and unread tracking.

## Prerequisites

- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (for docs)
- Docker (for tests)

## Development

Install dependencies:

```sh
npm install
```

| Command | Description |
|---------|-------------|
| `npm run test:e2e` | Run e2e tests against a real LysKOM server via Docker Compose |
| `npm run docs:serve` | Serve API docs locally at `http://localhost:8000` |
| `npm run docs:build` | Build static docs HTML into `site/` |
| `npm run docs:api` | Regenerate `docs/api.md` from JSDoc annotations |
