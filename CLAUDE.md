# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

Reverse proxy designed for Render's free tier. Routes incoming requests by **path prefix** (Render free plan does not support wildcard subdomains) to user-configured upstream targets, hiding origin IPs. A small admin UI (cookie-session protected) edits the routing table; rules are persisted in MySQL or fall back to in-memory if MySQL env vars are missing.

The README is in Chinese and contains operationally important details (deployment, MySQL setup, troubleshooting). Reference it when modifying deploy/config behavior.

## Commands

```bash
npm install
npm start          # runs server.js
npm run dev        # node --watch (auto-restart on file change)
```

There are no tests, lint, or build scripts. `node >= 18` is required.

## Architecture

`server.js` is the composition root. Boot order matters:

1. `db.createPool()` — only creates a pool if **all four** `MYSQL_HOST/USER/PASSWORD/DATABASE` env vars are present. Otherwise `db.isEnabled()` stays false and everything degrades to in-memory.
2. `db.init()` + `settings.init()` create `routes` and `settings` tables on demand.
3. `store.refresh()` loads routes into an in-process cache.
4. Express app mounts `/healthz`, `/__admin`, then a catch-all that delegates to `proxy.handleRequest`. WebSocket upgrades go through `proxy.handleUpgrade` on the raw HTTP server.
5. `keepalive.start()` self-pings `SELF_URL/healthz` every `KEEPALIVE_INTERVAL_MS` (default 10 min) to keep the Render free instance awake.

### Dual-mode storage (mysql vs memory)

`src/db.js`, `src/store.js`, and `src/settings.js` each branch on `db.isEnabled()`. The MySQL path uses the pool; the memory path uses module-level state (`cache` array, `mem` Map). **Both paths must stay behaviorally equivalent** — when adding a new persisted field or a new settings key, update both branches and the unique-constraint / coercion logic in `store.js`.

`store.js` keeps `cache` sorted by `path_prefix.length` descending so `findRoute()` matches the **longest prefix first**. `path_prefix === '/'` is the catch-all and short-circuits matching. Always call `sortCache()` (memory mode) or `refresh()` (mysql mode) after any mutation.

### Routing & proxy

`src/proxy.js` uses `http-proxy`. Key rules:

- `findRoute()` returns the longest enabled prefix that equals `pathname` or starts with `pathname + '/'` — exact-equality alone is insufficient, both checks are needed.
- If `route.strip_prefix`, `rewrite()` strips the prefix from `req.url` (preserving the query string via `splitQuery`). For `path_prefix === '/'` this is a no-op.
- `LEAKY_HEADERS` are scrubbed from upstream responses to hide origin server fingerprinting (`server`, `x-powered-by`, `via`, etc.). Add to this list if a new fingerprint header surfaces.
- `changeOrigin` is the inverse of `route.preserve_host` — preserve_host=true means forward the original Host header.
- WebSocket upgrades to `/__admin` or `/healthz` are explicitly destroyed in `server.js` to keep them admin-only.

### Auth

`src/auth.js` implements cookie-session auth (in-memory `sessions` Map, lost on restart by design). Password resolution priority — **runtime-changed (in `settings` table) > `ADMIN_PASSWORD` env > hardcoded `DEFAULT_PASSWORD`**. Don't reorder this without updating `currentSource()` and the README. Hashes are scrypt with format `scrypt$<salt-hex>$<derived-hex>`. Use `safeStrEq` / `crypto.timingSafeEqual` for any new credential comparisons.

The admin router (`src/admin.js`) is split into a public section (login page, static assets, `/api/login`, `/api/logout`) and a protected section behind `auth.requireAuth`. Static assets in `public/` are served unauthenticated — keep them free of secrets; the actual admin data lives behind `/__admin/api/*`.

### Reserved prefixes

`/__admin` and `/healthz` are reserved (enforced in `validateRoute()` in `src/admin.js`). When adding a new top-level system path, add it to `RESERVED_PREFIXES` to prevent users from creating a conflicting route.

## Notable conventions

- User-facing strings (validation errors, 404 page, log messages) are in Chinese to match the README. Keep that style for new error messages.
- The default password `rP3nL9Kx2mQwT7` is intentionally hardcoded as a last-resort fallback for fresh deploys; changing it requires a coordinated README update.
- `src/settings.js` is a generic key/value store — reuse it for new persistent settings instead of adding ad-hoc tables.
