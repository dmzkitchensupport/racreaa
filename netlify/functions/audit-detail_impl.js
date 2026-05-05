/**
 * audit-detail_impl.js
 * GET /api/audit-detail?id=AUD-XXX
 * Devuelve la auditoría completa: header + items + evidence
 */
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized:true }, max:3 });

const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()),
  'https://dmzkitchensupport.github.io',
  'https://mariozumaran.github.io',
  'https://dmz-audit.netlify.app',
].filter(Boolean);

function verifyToken(h) {
  if (!h?.startsWith('Bearer ')) throw new Error('AUTH_MISSING');
  try { return jwt.verify(h.slice(7), process.env.JWT_SECRET); }
  catch { throw new Error('AUTH_INVALID'); }
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  let claims;
  try { claims = verifyToken(req.headers.authorization); }
  catch { return res.status(401).json({ success: false, message: 'No autorizado.' }); }

  const auditId   = req.query.id;
  const tenantId  = claims.tenant_id;

  if (!auditId) return res.status(400).json({ success: false, message: 'ID requerido.' });

  const client = await pool.connect();
  try {
    // Header de auditoría
    const { rows: [audit] } = await client.query(`
      SELECT a.*, o.full_name as operator_full_name, o.email as operator_email
      FROM racreaa.audits a
      LEFT JOIN racreaa.operators o ON o.id::text = a.operator_id
      WHERE a.id = $1 AND a.tenant_id = $2::uuid
    `, [auditId, tenantId]);

    if (!audit) return res.status(404).json({ success: false, message: 'Auditoría no encontrada.' });

    // Items con criterios
    const { rows: items } = await client.query(`
      SELECT i.*,
        CASE WHEN i.timer_start IS NOT NULL AND i.timer_end IS NOT NULL
          THEN EXTRACT(EPOCH FROM (i.timer_end - i.timer_start))::int
          ELSE NULL END as timer_seconds
      FROM racreaa.audit_items i
      WHERE i.audit_id = $1
      ORDER BY i.item_num
    `, [auditId]);

    // Evidencia fotográfica por item
    const { rows: evidence } = await client.query(`
      SELECT id, audit_item_id, image_data, mime_type, size_bytes,
             gps_lat, gps_lng, gps_verified, captured_at_client,
             server_timestamp, integrity_hash,
             CASE WHEN blob_url = 'admin_uploaded' THEN true ELSE false END as admin_uploaded
      FROM racreaa.audit_evidence
      WHERE audit_id = $1
      ORDER BY server_timestamp
    `, [auditId]);

    // Agrupar evidencia por item
    const evidenceByItem = {};
    for (const ev of evidence) {
      const key = ev.audit_item_id || 'general';
      if (!evidenceByItem[key]) evidenceByItem[key] = [];
      evidenceByItem[key].push(ev);
    }

    // Enriquecer items con su evidencia
    const itemsWithEvidence = items.map(item => ({
      ...item,
      evidence: evidenceByItem[item.id] || [],
    }));

    return res.status(200).json({
      success: true,
      audit: {
        ...audit,
        items: itemsWithEvidence,
        total_fotos: evidence.length,
      }
    });

  } catch(err) {
    console.error('[audit-detail]', err.message);
    return res.status(500).json({ success: false, message: 'Error interno.' });
  } finally {
    client.release();
  }
};
