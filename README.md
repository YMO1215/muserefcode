# MuseRef — Muse referral codes, shared fairly

A rotating community pool of Meta Muse referral codes. Take a code, leave one behind.

- `index.html` — single-page UI (get / copy / report / add / recent / FAQ)
- `api/code.js` — hands out the least-recently-served code (skips your own)
- `api/add.js` — add a code (3 per IP per day, dedup)
- `api/report.js` — "worked" / "used up" feedback; 2 "used up" reports or 25 hand-outs retire a code
- `api/stats.js` — pool size, confirmed count, last 12 hand-outs

Storage is Upstash Redis via REST (`KV_REST_API_URL` / `KV_REST_API_TOKEN` or
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). Without them it falls back to
in-memory storage (local dev only — data is lost between serverless invocations).

## Local

```
npm run dev   # http://localhost:3000
npm test
```

## Deploy

1. Push to GitHub, then Vercel → Add New Project → import the repo (Framework: Other). Project name `muserefcode` → `muserefcode.vercel.app`.
2. Project → Storage → Create / connect **Upstash for Redis** (free tier). It injects the `KV_REST_API_*` env vars.
3. Redeploy.
