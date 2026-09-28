// POST /api/report {code, result: "worked" | "dead"} — feedback after redeeming.
const { store, remaining, DEAD_REPORTS } = require('../lib/store');
const { normalizeCode, clientIp, send, readBody, wrap } = require('../lib/http');

const FIELDS = { worked: 'worked', dead: 'dead' };

module.exports = wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const body = await readBody(req);
  const code = normalizeCode(body.code);
  const field = FIELDS[body.result];
  if (!code || !field) return send(res, 400, { error: 'Invalid report.' });
  if (!(await store.rateLimit(`rep:${clientIp(req)}:${code}`, 1, 86400))) {
    return send(res, 429, { error: 'Already reported. Thanks!' });
  }
  const info = await store.incr(code, field);
  if (!info) return send(res, 404, { error: 'Unknown code.' });
  if (info.dead >= DEAD_REPORTS || remaining(info) <= 0) await store.retire(code);
  send(res, 200, { ok: true });
});
