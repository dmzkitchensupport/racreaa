module.exports = function handler(req, res) {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    node: process.version,
    env: {
      has_db:     !!process.env.DATABASE_URL,
      has_jwt:    !!process.env.JWT_SECRET,
      has_resend: !!process.env.RESEND_API_KEY,
      resend_key: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.slice(0,8)+'...' : 'MISSING',
    }
  });
};
