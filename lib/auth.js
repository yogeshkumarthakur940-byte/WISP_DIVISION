// Authentication helpers: scrypt password hashing, random session tokens, HttpOnly cookie sessions.
const crypto = require('crypto');
const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const verify = (pw, h) => { const [s, k] = String(h).split(':'); if (!s || !k) return false; return crypto.timingSafeEqual(crypto.scryptSync(pw, s, 32), Buffer.from(k, 'hex')); };
const sessions = new Map();
const make = uid => { const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, { uid, exp: Date.now() + 7 * 864e5 }); return t; };
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]));
const who = req => { const s = sessions.get(cookies(req).sid); return s && s.exp > Date.now() ? s.uid : null; };
const rid = () => crypto.randomBytes(5).toString('hex');
module.exports = { hash, verify, make, who, cookies, sessions, rid };
