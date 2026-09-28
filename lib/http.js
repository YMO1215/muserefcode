const CODE_RE = /^[A-Z0-9]{5,12}$/;

function normalizeCode(v) {
  if (typeof v !== 'string') return null;
  const c = v.trim().toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(c) ? c : null;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0] : req.socket?.remoteAddress || 'unknown').trim();
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) break;
  }
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      send(res, 500, { error: 'Server error. Try again in a moment.' });
    }
  };
}

module.exports = { normalizeCode, clientIp, send, readBody, wrap };
