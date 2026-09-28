// GET /api/code?exclude=AAA,BBB — hand out the least-recently-served code.
const { store, remaining, DEAD_REPORTS } = require('../lib/store');
const { normalizeCode, clientIp, send, wrap } = require('../lib/http');

const CANDIDATES = 10;

module.exports = wrap(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  if (!(await store.rateLimit(`get:${clientIp(req)}`, 20, 600))) {
    return send(res, 429, { error: 'Too many requests. Wait a few minutes.' });
  }
  const q = new URL(req.url, 'http://x').searchParams.get('exclude') || '';
  const exclude = new Set(q.split(',').map(normalizeCode).filter(Boolean));

  for (const code of await store.candidates(CANDIDATES)) {
    if (exclude.has(code)) continue;
    const info = await store.info(code);
    if (!info || remaining(info) <= 0 || info.dead >= DEAD_REPORTS) {
      await store.retire(code);
      continue;
    }
    const after = await store.markServed(code);
    return send(res, 200, { code, remaining: remaining(after), worked: after.worked });
  }
  send(res, 404, { error: 'The pool is empty right now. Add your code to get it started!' });
});
