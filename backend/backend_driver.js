import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { pool } from './db.js';
import { authenticateToken } from './auth_middleware.js';

const app = express();
const PORT = 8080;

app.use(cors());
app.use(bodyParser.json());

// 1️⃣ Update driver status
app.put('/driver/status', authenticateToken, async (req, res) => {
    const id = req.user.userid;
    const { status } = req.body;
    const validStatuses = ['available', 'not_available', 'offline'];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status provided." });
    }

    try {
        const check = await pool.query('SELECT * FROM drivers WHERE userid = $1', [id]);
        if (check.rows.length === 0) {
            const autoName = `AutoDriver_${id}`;
            const insert = await pool.query(
                'INSERT INTO drivers (driver_name, vehicle_id, status, userid) VALUES ($1, $2, $3, $4) RETURNING *',
                [autoName, null, status, id]
            );
            return res.status(201).json({
                success: true,
                message: `Driver profile created and set to ${status}.`,
                driver: insert.rows[0]
            });
        }

        await pool.query('UPDATE drivers SET status = $1 WHERE userid = $2', [status, id]);
        console.log(`✅ Driver ${id} updated to ${status}`);
        res.json({ success: true, message: `Status set to ${status}` });
    } catch (e) {
        console.error('❌ Status update error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// 2️⃣ Register driver profile manually
app.post('/drivers/register', authenticateToken, async (req, res) => {
    const id = req.user.userid;
    const { driver_name, vehicle_id } = req.body;

    if (!driver_name || !vehicle_id) {
        return res.status(400).json({ error: 'Missing driver_name or vehicle_id' });
    }

    try {
        const existing = await pool.query('SELECT * FROM drivers WHERE userid = $1', [id]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Driver profile already exists' });
        }

        const result = await pool.query(
            'INSERT INTO drivers (driver_name, vehicle_id, status, userid) VALUES ($1, $2, $3, $4) RETURNING *',
            [driver_name, vehicle_id, 'offline', id]
        );

        res.status(201).json({
            success: true,
            message: 'Driver profile created successfully',
            driver: result.rows[0]
        });
    } catch (e) {
        console.error('❌ Driver register error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => console.log(`🚘 Driver backend listening on port ${PORT}`));
