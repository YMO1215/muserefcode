// POST /api/report {code, result: "worked" | "dead"} — feedback after redeeming.
const { store, remaining, DEAD_REPORTS } = require('../lib/store');
const { normalizeCode, clientIp, send, readBody, wrap } = require('../lib/http');

const FIELDS = { worked: 'worked', dead: 'dead' };

module.exports = wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: '허용되지 않는 요청 방식입니다.' });
  const body = await readBody(req);
  const code = normalizeCode(body.code);
  const field = FIELDS[body.result];
  if (!code || !field) return send(res, 400, { error: '잘못된 요청입니다.' });
  if (!(await store.rateLimit(`rep:${clientIp(req)}:${code}`, 1, 86400))) {
    return send(res, 429, { error: '이미 알려 주셨어요. 감사합니다!' });
  }
  const info = await store.incr(code, field);
  if (!info) return send(res, 404, { error: '풀에 없는 코드입니다.' });
  if (info.dead >= DEAD_REPORTS || remaining(info) <= 0) await store.retire(code);
  send(res, 200, { ok: true });
});
