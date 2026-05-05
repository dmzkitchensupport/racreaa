/**
 * upload-evidence_impl.js
 * POST /api/upload-evidence
 * Sube fotos retroactivas a una auditoría existente (admin only)
 */
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  let claims;
  try { claims = verifyToken(req.headers.authorization); }
  catch { return res.status(401).json({ success: false, message: 'No autorizado.' }); }

  // Solo admin puede subir fotos retroactivas
  if (claims.role !== 'admin' && claims.role !== 'supervisor') {
    return res.status(403).json({ success: false, message: 'Solo administradores pueden subir fotos retroactivas.' });
  }

  const { audit_id, item_id, photos } = req.body;
  if (!audit_id || !photos?.length) {
    return res.status(400).json({ success: false, message: 'audit_id y photos[] son requeridos.' });
  }

  const tenantId   = claims.tenant_id;
  const operatorId = claims.sub;
  const serverTs   = new Date().toISOString();
  const client     = await pool.connect();

  try {
    // Verificar que la auditoría pertenece al tenant
    const { rows: [audit] } = await client.query(
      `SELECT id FROM racreaa.audits WHERE id=$1 AND tenant_id=$2::uuid`,
      [audit_id, tenantId]
    );
    if (!audit) return res.status(404).json({ success: false, message: 'Auditoría no encontrada.' });

    await client.query('BEGIN');

    let count = 0;
    for (const photo of photos.slice(0, 20)) {
      if (!photo.base64) continue;
      count++;
      const evId   = `${audit_id}-ADMIN-${Date.now()}-${count}`;
      const hash   = crypto.createHash('sha256').update(photo.base64.slice(0, 100) + evId).digest('hex');

      await client.query(`
        INSERT INTO racreaa.audit_evidence
          (id, audit_id, audit_item_id, tenant_id, operator_id,
           blob_url, image_data, mime_type, size_bytes,
           gps_verified, server_timestamp, integrity_hash)
        VALUES ($1,$2,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12)
      `, [
        evId, audit_id,
        item_id || null,
        tenantId, operatorId,
        'admin_uploaded',
        photo.base64,
        photo.mimeType || 'image/jpeg',
        photo.sizeBytes || 0,
        false,
        serverTs,
        hash,
      ]);
    }

    // Log inmutable
    await client.query(`
      INSERT INTO racreaa.audit_logs
        (id,tenant_id,operator_id,audit_id,action,entity_type,entity_id,
         client_ip,user_agent,request_id,payload_hash,occurred_at)
      VALUES (gen_random_uuid(),$1,$2,$3,'EVIDENCE_UPLOADED_ADMIN','audit_evidence',$3,$4,$5,$6,$7,NOW())
    `, [tenantId, operatorId, audit_id, 'admin', 'dashboard', crypto.randomUUID(),
        crypto.createHash('sha256').update(`${audit_id}${count}${serverTs}`).digest('hex')]);

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      uploaded: count,
      message: `${count} foto${count !== 1 ? 's' : ''} agregada${count !== 1 ? 's' : ''} correctamente.`
    });

  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[upload-evidence]', err.message, err.stack?.slice(0,200));
    return res.status(500).json({ success: false, message: 'Error al guardar fotos.', detail: err.message });
  } finally {
    client.release();
  }
};
