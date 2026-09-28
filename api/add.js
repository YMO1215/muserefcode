// POST /api/add {code} — add a referral code to the pool.
const { store } = require('../lib/store');
const { normalizeCode, clientIp, send, readBody, wrap } = require('../lib/http');

module.exports = wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const code = normalizeCode((await readBody(req)).code);
  if (!code) return send(res, 400, { error: 'Codes are 5–12 letters or digits.' });
  if (!(await store.rateLimit(`add:${clientIp(req)}`, 3, 86400))) {
    return send(res, 429, { error: 'You have already added codes today. Thanks!' });
  }
  if (!(await store.add(code))) return send(res, 409, { error: 'That code is already in the pool.' });
  send(res, 201, { ok: true, code });
});
