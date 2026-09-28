// GET /api/stats — pool size, confirmed redemptions, recent hand-outs and registrations.
const { store, remaining, persistent, DEAD_REPORTS } = require('../lib/store');
const { send, wrap } = require('../lib/http');

async function withInfo(entries) {
  return Promise.all(
    entries.map(async (r) => {
      const info = await store.info(r.code);
      const left = info ? remaining(info) : 0;
      return { code: r.code, t: r.t, remaining: left, retired: !info || left <= 0 || info.dead >= DEAD_REPORTS };
    }),
  );
}

module.exports = wrap(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: '허용되지 않는 요청 방식입니다.' });
  const s = await store.stats();
  const [recent, added] = await Promise.all([withInfo(s.recent), withInfo(await store.recentlyAdded())]);
  send(res, 200, {
    inPool: s.inPool,
    confirmed: s.confirmed,
    recent,
    added,
    storage: persistent ? 'redis' : 'memory',
  });
});
