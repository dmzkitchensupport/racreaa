/**
 * DMZ Audit — Express Server para Railway
 * Migración desde Netlify Functions
 */
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Importar handlers
const authLogin       = require('./netlify/functions/auth-login_impl');
const authRefresh     = require('./netlify/functions/auth-refresh_impl');
const authLogout      = require('./netlify/functions/auth-logout_impl');
const authSetPassword = require('./netlify/functions/auth-set-password_impl');
const audits          = require('./netlify/functions/audits_impl');
const submitAudit     = require('./netlify/functions/submit-audit_impl');
const telemetry       = require('./netlify/functions/telemetry_impl');
const monitor         = require('./netlify/functions/monitor_impl');
const health          = require('./netlify/functions/health_impl');
const tenantBranding  = require('./netlify/functions/tenant-branding_impl');

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware que adapta Express req/res al formato que usan los _impl.js
function wrap(handler) {
  return async (req, res) => {
    // Adaptar req al formato esperado por los handlers
    req.body = req.body || {};
    req.query = req.query || {};
    req.socket = { remoteAddress: req.ip || req.connection?.remoteAddress || '' };
    await handler(req, res);
  };
}

// Rutas
app.all('/api/health',           wrap(health));
app.all('/api/auth-login',       wrap(authLogin));
app.all('/api/auth-refresh',     wrap(authRefresh));
app.all('/api/auth-logout',      wrap(authLogout));
app.all('/api/auth-set-password',wrap(authSetPassword));
app.all('/api/audits',           wrap(audits));
app.all('/api/submit-audit',     wrap(submitAudit));
app.all('/api/telemetry',        wrap(telemetry));
app.all('/api/monitor',          wrap(monitor));
app.all('/api/tenant-branding',  wrap(tenantBranding));

// Health check raíz para Railway
app.get('/', (req, res) => res.json({ status: 'DMZ Audit API', version: '1.0', timestamp: new Date().toISOString() }));

app.listen(PORT, () => console.log(`DMZ Audit API corriendo en puerto ${PORT}`));
