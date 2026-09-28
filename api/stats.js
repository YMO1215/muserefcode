// GET /api/stats — pool size, confirmed redemptions, recently handed out codes.
const { store, remaining, persistent } = require('../lib/store');
const { send, wrap } = require('../lib/http');

module.exports = wrap(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: '허용되지 않는 요청 방식입니다.' });
  const s = await store.stats();
  const recent = await Promise.all(
    s.recent.map(async (r) => {
      const info = await store.info(r.code);
      return { code: r.code, t: r.t, remaining: info ? remaining(info) : 0 };
    }),
  );
  send(res, 200, { inPool: s.inPool, confirmed: s.confirmed, recent, storage: persistent ? 'redis' : 'memory' });
});
