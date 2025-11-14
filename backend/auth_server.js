import express from 'express';
import bodyParser from 'body-parser';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const app = express();
app.use(bodyParser.json());

const PORT = 7000;
const JWT_SECRET = 'uberfriends_secret_key'; // change in production

// 🧍 SIGNUP
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password, role, vehicle_id, contact_number, location } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if user exists
        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const roleToAssign = role === 'driver' ? 'driver' : 'customer';

        // Insert user
        const newUser = await pool.query(
            `INSERT INTO users (name, email, password, role)
             VALUES ($1, $2, $3, $4)
             RETURNING user_id, name, email, role`,
            [name, email, hashedPassword, roleToAssign]
        );

        const createdUser = newUser.rows[0];

        // Auto-create driver profile if driver
        if (roleToAssign === 'driver') {
            await pool.query(
                `INSERT INTO drivers (driver_name, vehicle_id, contact_number, location, status, userid)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [name, vehicle_id || null, contact_number || null, location || null, 'offline', createdUser.user_id]
            );
            console.log(`✅ Driver profile created for user ID: ${createdUser.user_id}`);
        }

        res.status(201).json({
            message: `Signup successful as ${roleToAssign}!`,
            user: {
                userid: createdUser.user_id,
                name: createdUser.name,
                email: createdUser.email,
                role: createdUser.role
            }
        });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Server error during signup.' });
    }
});

// 🔑 LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password)
            return res.status(400).json({ error: 'Email and password required' });

        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0)
            return res.status(400).json({ error: 'Invalid credentials' });

        const user = userRes.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword)
            return res.status(400).json({ error: 'Invalid credentials' });

        const token = jwt.sign(
            { userid: user.user_id, email: user.email, role: user.role }, // ✅ unified key
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.json({
            message: 'Login successful!',
            token,
            user: {
                userid: user.user_id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error during login.' });
    }
});

app.listen(PORT, () => console.log(`🔐 Auth server running on port ${PORT}`));
