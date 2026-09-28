// GET /api/code?exclude=AAA,BBB — hand out the oldest-registered code that
// isn't the caller's own, so earlier codes are used up first.
const { store, remaining, DEAD_REPORTS } = require('../lib/store');
const { normalizeCode, clientIp, send, wrap } = require('../lib/http');

const CANDIDATES = 20; // enough to skip past a caller's own codes

module.exports = wrap(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: '허용되지 않는 요청 방식입니다.' });
  if (!(await store.rateLimit(`get:${clientIp(req)}`, 20, 600))) {
    return send(res, 429, { error: '요청이 너무 많습니다. 몇 분 뒤 다시 시도해 주세요.' });
  }
  const q = new URL(req.url, 'http://x').searchParams.get('exclude') || '';
  const exclude = new Set(q.split(',').map(normalizeCode).filter(Boolean));

  let skippedOwn = false;
  for (const code of await store.candidates(CANDIDATES)) {
    if (exclude.has(code)) {
      skippedOwn = true;
      continue;
    }
    const info = await store.info(code);
    if (!info || remaining(info) <= 0 || info.dead >= DEAD_REPORTS) {
      await store.retire(code);
      continue;
    }
    const after = await store.markServed(code);
    return send(res, 200, { code, remaining: remaining(after), worked: after.worked });
  }
  send(res, 404, {
    error: skippedOwn
      ? '지금 풀에는 내가 등록한 코드만 있어요. 다른 사람이 코드를 등록하면 받을 수 있어요.'
      : '지금은 풀이 비어 있습니다. 첫 코드를 등록해 주세요!',
  });
});
