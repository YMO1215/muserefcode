// Storage layer: Upstash Redis REST (Vercel Marketplace env vars) with an
// in-memory fallback for local development.

const MAX_USES = 25; // typical referral cap is 20-30 uses
const DEAD_REPORTS = 2; // "used up" reports needed to retire a code
const RECENT_LEN = 12;
const ADDED_KEEP = 200; // size cap of the "recently added" index

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
// The Redis database is shared with other projects, so namespace every key.
const KEY_PREFIX = 'museref:';

// Every command used here takes exactly one key, at argument position 1.
async function redis(cmds) {
  const prefixed = cmds.map(([op, key, ...args]) => [op, KEY_PREFIX + key, ...args]);
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(prefixed),
  });
  if (!res.ok) throw new Error(`redis ${res.status}: ${await res.text()}`);
  const out = await res.json();
  return out.map((r) => {
    if (r.error) throw new Error(`redis: ${r.error}`);
    return r.result;
  });
}

// ---- in-memory fallback -------------------------------------------------
const mem = { pool: new Map(), codes: new Map(), recent: [], confirmed: 0, rl: new Map() };

const memStore = {
  async rateLimit(key, limit, windowSec) {
    const now = Date.now();
    const e = mem.rl.get(key);
    if (!e || e.reset < now) {
      mem.rl.set(key, { n: 1, reset: now + windowSec * 1000 });
      return true;
    }
    e.n += 1;
    return e.n <= limit;
  },
  async exists(code) {
    return mem.codes.has(code);
  },
  async add(code) {
    if (mem.codes.has(code)) return false;
    mem.codes.set(code, { added: Date.now(), served: 0, worked: 0, dead: 0 });
    mem.pool.set(code, 0);
    return true;
  },
  async recentlyAdded() {
    return [...mem.codes.entries()]
      .sort((a, b) => b[1].added - a[1].added)
      .slice(0, RECENT_LEN)
      .map(([code, c]) => ({ code, t: c.added }));
  },
  // Oldest-registered first, so earlier codes are used up before later ones.
  async candidates(n) {
    return [...mem.pool.keys()]
      .sort((a, b) => mem.codes.get(a).added - mem.codes.get(b).added)
      .slice(0, n);
  },
  async markServed(code) {
    const c = mem.codes.get(code);
    c.served += 1;
    mem.recent.unshift({ code, t: Date.now() });
    mem.recent.length = Math.min(mem.recent.length, RECENT_LEN);
    return { ...c };
  },
  async info(code) {
    const c = mem.codes.get(code);
    return c ? { ...c } : null;
  },
  async incr(code, field) {
    const c = mem.codes.get(code);
    if (!c) return null;
    c[field] += 1;
    if (field === 'worked') mem.confirmed += 1;
    return { ...c };
  },
  async retire(code) {
    mem.pool.delete(code);
  },
  async stats() {
    return { inPool: mem.pool.size, confirmed: mem.confirmed, recent: mem.recent.slice() };
  },
};

// ---- redis store --------------------------------------------------------
const toObj = (arr) => {
  if (!arr || !arr.length) return null;
  const o = {};
  for (let i = 0; i < arr.length; i += 2) o[arr[i]] = Number(arr[i + 1]);
  return { added: o.added || 0, served: o.served || 0, worked: o.worked || 0, dead: o.dead || 0 };
};

const redisStore = {
  async rateLimit(key, limit, windowSec) {
    const [n] = await redis([['INCR', `rl:${key}`], ['EXPIRE', `rl:${key}`, windowSec, 'NX']]);
    return n <= limit;
  },
  async exists(code) {
    const [n] = await redis([['EXISTS', `code:${code}`]]);
    return n === 1;
  },
  async add(code) {
    const [ok] = await redis([['HSETNX', `code:${code}`, 'added', Date.now()]]);
    if (!ok) return false;
    await redis([
      ['HSET', `code:${code}`, 'served', 0, 'worked', 0, 'dead', 0],
      ['ZADD', 'pool', 0, code],
      ['ZADD', 'queue', Date.now(), code],
      ['ZADD', 'added', Date.now(), code],
      ['ZREMRANGEBYRANK', 'added', 0, -(ADDED_KEEP + 1)],
    ]);
    return true;
  },
  async recentlyAdded() {
    let [list] = await redis([['ZREVRANGE', 'added', 0, RECENT_LEN - 1, 'WITHSCORES']]);
    if (!list || !list.length) {
      // Backfill codes registered before the "added" index existed.
      const [pool] = await redis([['ZRANGE', 'pool', 0, ADDED_KEEP - 1]]);
      if (!pool || !pool.length) return [];
      const times = await redis(pool.map((c) => ['HGET', `code:${c}`, 'added']));
      await redis(pool.map((c, i) => ['ZADD', 'added', Number(times[i]) || Date.now(), c]));
      [list] = await redis([['ZREVRANGE', 'added', 0, RECENT_LEN - 1, 'WITHSCORES']]);
    }
    const out = [];
    for (let i = 0; i < list.length; i += 2) out.push({ code: list[i], t: Number(list[i + 1]) });
    return out;
  },
  // "queue" mirrors "pool" but is scored by registration time, so the
  // oldest-registered code is handed out first until it is used up.
  async candidates(n) {
    let [list] = await redis([['ZRANGE', 'queue', 0, n - 1]]);
    if (!list || !list.length) {
      // Backfill codes registered before the queue existed.
      const [pool] = await redis([['ZRANGE', 'pool', 0, -1]]);
      if (!pool || !pool.length) return [];
      const times = await redis(pool.map((c) => ['HGET', `code:${c}`, 'added']));
      await redis(pool.map((c, i) => ['ZADD', 'queue', 'NX', Number(times[i]) || Date.now(), c]));
      [list] = await redis([['ZRANGE', 'queue', 0, n - 1]]);
    }
    return list || [];
  },
  async markServed(code) {
    const now = Date.now();
    const res = await redis([
      ['HINCRBY', `code:${code}`, 'served', 1],
      ['LPUSH', 'recent', JSON.stringify({ code, t: now })],
      ['LTRIM', 'recent', 0, RECENT_LEN - 1],
      ['HGETALL', `code:${code}`],
    ]);
    return toObj(res[3]);
  },
  async info(code) {
    const [h] = await redis([['HGETALL', `code:${code}`]]);
    return toObj(h);
  },
  async incr(code, field) {
    if (!(await this.exists(code))) return null;
    const cmds = [['HINCRBY', `code:${code}`, field, 1]];
    if (field === 'worked') cmds.push(['INCR', 'confirmed']);
    cmds.push(['HGETALL', `code:${code}`]);
    const res = await redis(cmds);
    return toObj(res[res.length - 1]);
  },
  async retire(code) {
    await redis([['ZREM', 'pool', code], ['ZREM', 'queue', code]]);
  },
  async stats() {
    const [inPool, confirmed, recent] = await redis([
      ['ZCARD', 'pool'],
      ['GET', 'confirmed'],
      ['LRANGE', 'recent', 0, RECENT_LEN - 1],
    ]);
    return {
      inPool,
      confirmed: Number(confirmed) || 0,
      recent: (recent || []).map((s) => JSON.parse(s)),
    };
  },
};

const store = url && token ? redisStore : memStore;

function remaining(c) {
  return Math.max(0, MAX_USES - c.served);
}

module.exports = { store, remaining, MAX_USES, DEAD_REPORTS, persistent: Boolean(url && token) };
