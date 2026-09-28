// Smoke test of the API handlers against the in-memory store.
const assert = require('assert');
const { Readable } = require('stream');

delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

function call(handler, method, url, body, ip = '1.1.1.1') {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(req, { method, url, headers: { 'x-forwarded-for': ip } });
  return new Promise((resolve) => {
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { resolve({ status: this.statusCode, body: JSON.parse(s) }); },
    };
    handler(req, res);
  });
}

(async () => {
  const add = require('./api/add');
  const code = require('./api/code');
  const report = require('./api/report');
  const stats = require('./api/stats');

  assert.strictEqual((await call(code, 'GET', '/api/code')).status, 404);
  assert.strictEqual((await call(add, 'POST', '/api/add', { code: 'bad!' })).status, 400);
  assert.strictEqual((await call(add, 'POST', '/api/add', { code: 'k4m2qp' })).status, 201);
  assert.strictEqual((await call(add, 'POST', '/api/add', { code: 'K4M2QP' }, '2.2.2.2')).status, 409);
  assert.strictEqual((await call(add, 'POST', '/api/add', { code: 'ZZZ999' }, '2.2.2.2')).status, 201);

  const excluded = await call(code, 'GET', '/api/code?exclude=K4M2QP');
  assert.strictEqual(excluded.body.code, 'ZZZ999');
  const next = await call(code, 'GET', '/api/code');
  assert.strictEqual(next.body.code, 'K4M2QP'); // least recently served
  assert.strictEqual(next.body.remaining, 24);

  assert.strictEqual((await call(report, 'POST', '/api/report', { code: 'K4M2QP', result: 'worked' })).status, 200);
  assert.strictEqual((await call(report, 'POST', '/api/report', { code: 'K4M2QP', result: 'worked' })).status, 429);
  await call(report, 'POST', '/api/report', { code: 'ZZZ999', result: 'dead' }, '3.3.3.3');
  await call(report, 'POST', '/api/report', { code: 'ZZZ999', result: 'dead' }, '4.4.4.4');

  const s = (await call(stats, 'GET', '/api/stats')).body;
  assert.strictEqual(s.inPool, 1); // ZZZ999 retired
  assert.strictEqual(s.confirmed, 1);
  assert.strictEqual(s.recent.length, 2);
  console.log('all tests passed', s);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
