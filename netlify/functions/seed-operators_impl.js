/**
 * seed-operators.js — TEMPORAL — eliminar después de usar
 * Crea operadores admin en el tenant DMZ
 */
const { Pool }  = require('pg');
const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 3,
});

const SEED_SECRET = 'run-once-dmz-2026';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Requiere secret para ejecutar
  const { secret } = req.body || {};
  if (!SEED_SECRET || secret !== SEED_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const client = await pool.connect();
  try {
    // Obtener tenant DMZ
    const tRes = await client.query(
      "SELECT id FROM racreaa.tenants WHERE slug = 'dmz' LIMIT 1"
    );
    if (!tRes.rows.length) {
      return res.status(404).json({ error: 'Tenant dmz not found' });
    }
    const tenantId = tRes.rows[0].id;

    const operators = [
      { email: 'mario@delamorazumaran.com', name: 'Mario Zumaran',  pass: 'DMZRacreaa2026!', role: 'admin' },
      { email: 'blanca@delamorazumaran.com', name: 'Blanca De La Mora', pass: 'DMZRacreaa2026!', role: 'admin' },
    ];

    const results = [];
    for (const op of operators) {
      // Check if already exists
      const exists = await client.query(
        "SELECT id FROM racreaa.operators WHERE email = $1", [op.email]
      );
      if (exists.rows.length) {
        // Update password
        const hash = await bcrypt.hash(op.pass, 12);
        await client.query(
          "UPDATE racreaa.operators SET password_hash=$1, role=$2, is_active=true WHERE email=$3",
          [hash, op.role, op.email]
        );
        results.push({ email: op.email, action: 'updated', id: exists.rows[0].id });
      } else {
        const hash = await bcrypt.hash(op.pass, 12);
        const ins = await client.query(
          `INSERT INTO racreaa.operators (tenant_id, email, full_name, password_hash, role)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [tenantId, op.email, op.name, hash, op.role]
        );
        results.push({ email: op.email, action: 'created', id: ins.rows[0].id });
      }
    }

    return res.status(200).json({ success: true, results });
  } catch(err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};
