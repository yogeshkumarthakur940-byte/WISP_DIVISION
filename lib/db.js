// Tiny file-based database: each collection is a JSON file in /data (atomic, debounced writes).
// Swap this module for SQLite / MongoDB later – the rest of the app only uses load() and save().
const fs = require('fs'), path = require('path');
const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DIR, { recursive: true });
const cache = {}, timers = {};
const file = n => path.join(DIR, n + '.json');
function load(n, def) { if (cache[n]) return cache[n]; try { cache[n] = JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { cache[n] = def; } return cache[n]; }
function save(n) { clearTimeout(timers[n]); timers[n] = setTimeout(() => { const f = file(n); fs.writeFile(f + '.tmp', JSON.stringify(cache[n], null, 1), e => { if (!e) fs.rename(f + '.tmp', f, () => {}); }); }, 150); }
function flush() { for (const n in cache) fs.writeFileSync(file(n), JSON.stringify(cache[n], null, 1)); }
module.exports = { load, save, flush };
