const handler_module = require('./seed-operators_impl');

const CORS_ORIGINS = [
  'https://mariozumaran.github.io',
  'https://dmz-audit.netlify.app',
  'https://racreaa.vercel.app',
];

exports.handler = async (event, context) => {
  const origin = event.headers['origin'] || event.headers['Origin'] || '';
  const allowOrigin = CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: '',
    };
  }

  const req = {
    method: event.httpMethod,
    headers: event.headers || {},
    body: (() => { try { return JSON.parse(event.body || '{}'); } catch { return {}; } })(),
    query: event.queryStringParameters || {},
    socket: { remoteAddress: '' },
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
    setHeader: (k, v) => { responseHeaders[k] = v; },
    status: (code) => { statusCode = code; return res; },
    json: (data) => { responseBody = JSON.stringify(data); return res; },
    end: (body) => { if (body) responseBody = body; return res; },
  };

  await handler_module(req, res);
  return { statusCode, headers: responseHeaders, body: responseBody };
};
