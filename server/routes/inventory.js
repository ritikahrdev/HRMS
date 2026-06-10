const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');

const router = express.Router();

const VALID_CATEGORIES = ['electronics', 'furniture', 'equipment', 'network', 'stationery', 'software', 'access', 'other'];
const VALID_CONDITIONS = ['good', 'fair', 'damaged'];

// GET all inventory items (admin only)
router.get('/', requirePerm('settings:manage'), async (req, res) => {
  try {
    const { category } = req.query;
    const rows = category && VALID_CATEGORIES.includes(category)
      ? await db.prepare(`SELECT i.*, e.name AS assigned_name FROM inventory i LEFT JOIN employees e ON e.id = i.assigned_to WHERE i.category = ? ORDER BY i.category, i.name`).all(category)
      : await db.prepare(`SELECT i.*, e.name AS assigned_name FROM inventory i LEFT JOIN employees e ON e.id = i.assigned_to ORDER BY i.category, i.name`).all();
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET summary stats (admin only)
router.get('/stats', requirePerm('settings:manage'), async (req, res) => {
  try {
    const stats = await db.prepare(`
      SELECT category,
             COUNT(*) AS total_items,
             SUM(quantity) AS total_qty,
             SUM(available) AS available_qty,
             SUM(quantity - available) AS assigned_qty,
             SUM(purchase_price * quantity) AS total_value
      FROM inventory
      GROUP BY category
      ORDER BY category
    `).all();
    const totals = await db.prepare(`
      SELECT COUNT(*) AS total_items, SUM(quantity) AS total_qty,
             SUM(available) AS available_qty, SUM(purchase_price * quantity) AS total_value
      FROM inventory
    `).get();
    res.json({ stats, totals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST create new item (admin only)
router.post('/', requirePerm('settings:manage'), (req, res) => {
  const { name, category, quantity, condition, serial_number, purchase_date, purchase_price, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (!category || !VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category.' });
  const qty = parseInt(quantity) || 1;
  const cond = VALID_CONDITIONS.includes(condition) ? condition : 'good';
  const r = db.prepare(`
    INSERT INTO inventory (name, category, quantity, available, condition, serial_number, purchase_date, purchase_price, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, category, qty, qty, cond, serial_number || null, purchase_date || null, parseFloat(purchase_price) || 0, notes || null);
  res.json({ id: r.lastInsertRowid });
});

// PUT update item (admin only)
router.put('/:id', requirePerm('settings:manage'), async (req, res) => {
  try {
    const item = await db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });

    const name = req.body.name || item.name;
    const category = VALID_CATEGORIES.includes(req.body.category) ? req.body.category : item.category;
    const quantity = req.body.quantity != null ? parseInt(req.body.quantity) : item.quantity;
    const available = req.body.available != null ? parseInt(req.body.available) : item.available;
    const assigned_to = req.body.assigned_to != null ? (req.body.assigned_to || null) : item.assigned_to;
    const condition = VALID_CONDITIONS.includes(req.body.condition) ? req.body.condition : item.condition;
    const serial_number = req.body.serial_number !== undefined ? req.body.serial_number : item.serial_number;
    const purchase_date = req.body.purchase_date !== undefined ? req.body.purchase_date : item.purchase_date;
    const purchase_price = req.body.purchase_price != null ? parseFloat(req.body.purchase_price) : item.purchase_price;
    const notes = req.body.notes !== undefined ? req.body.notes : item.notes;

    await db.prepare(`
      UPDATE inventory SET name=?, category=?, quantity=?, available=?, assigned_to=?,
      condition=?, serial_number=?, purchase_date=?, purchase_price=?, notes=?,
      updated_at=datetime('now') WHERE id=?
    `).run(name, category, quantity, available, assigned_to, condition, serial_number, purchase_date, purchase_price, notes, item.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE item (admin only)
router.delete('/:id', requirePerm('settings:manage'), async (req, res) => {
  try {
    const item = await db.prepare('SELECT id FROM inventory WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    await db.prepare('DELETE FROM inventory WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
