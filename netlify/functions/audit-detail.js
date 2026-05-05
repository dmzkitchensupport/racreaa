// v2 deploy 1778010095
const impl = require('./audit-detail_impl');
const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()),
  'https://dmzkitchensupport.github.io',
  'https://mariozumaran.github.io',
  'https://dmz-audit.netlify.app',
].filter(Boolean);

exports.handler = async (event, context) => {
  const origin = event.headers['origin'] || event.headers['Origin'] || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  if (event.httpMethod === 'OPTIONS') return {
    statusCode: 204,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
    }, body: ''
  };
  const req = {
    method: event.httpMethod, headers: event.headers || {},
    body: (() => { try { return JSON.parse(event.body||'{}'); } catch { return {}; } })(),
    query: event.queryStringParameters || {},
    socket: { remoteAddress: (event.headers['x-forwarded-for']||'').split(',')[0].trim() }
  };
  let statusCode = 200;
  const responseHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
  let responseBody = '';
  const res = {
    setHeader: (k,v) => { responseHeaders[k]=v; },
    status: (code) => { statusCode=code; return res; },
    json: (data) => { responseBody=JSON.stringify(data); return res; },
    end: (b) => { if(b) responseBody=b; return res; },
  };
  await impl(req, res);
  return { statusCode, headers: responseHeaders, body: responseBody };
};
