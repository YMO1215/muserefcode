// POST /api/add {code} — add a referral code to the pool.
const { store } = require('../lib/store');
const { normalizeCode, clientIp, send, readBody, wrap } = require('../lib/http');

module.exports = wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: '허용되지 않는 요청 방식입니다.' });
  const code = normalizeCode((await readBody(req)).code);
  if (!code) return send(res, 400, { error: '코드는 영문·숫자 5–12자입니다.' });
  if (!(await store.rateLimit(`add:${clientIp(req)}`, 3, 86400))) {
    return send(res, 429, { error: '오늘은 이미 코드를 등록하셨어요. 감사합니다!' });
  }
  if (!(await store.add(code))) return send(res, 409, { error: '이미 풀에 있는 코드입니다.' });
  send(res, 201, { ok: true, code });
});
