# libjskom

A JavaScript client library for [LysKOM](https://www.lysator.liu.se/lyskom/) via [httpkom](https://github.com/osks/httpkom). Pure ES6 modules, no dependencies — uses the browser's built-in `fetch` API to communicate with a LysKOM server through httpkom's REST interface.

Handles sessions, login/logout, person management, conference memberships, and unread tracking.

## Documentation

The docs are built with [MkDocs](https://www.mkdocs.org/) and [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/). API reference is auto-generated from JSDoc annotations in the source files.

The docs are automatically deployed to GitHub Pages on push to main via GitHub Actions (see `.github/workflows/docs.yml`).


## Prerequisites

- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (for docs, used via `uvx`)
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


## Authors

Oskar Skoog <oskar@osd.se>


## Copyright and license

Copyright (c) 2025-2026 Oskar Skoog. libjskom is provided under the
MIT license. See the included LICENSE.txt file for specifics.
