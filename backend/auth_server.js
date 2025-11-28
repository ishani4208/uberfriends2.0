import express from 'express';
import bodyParser from 'body-parser';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import cors from 'cors'; 

const app = express();
app.use(bodyParser.json());
app.use(cors());

const PORT = 7001;
const JWT_SECRET = 'uberfriends_secret_key'; 

// 🧍 SIGNUP
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password, role, vehicle_id, contact_number, location } = req.body;
        const roleToAssign = role === 'driver' ? 'driver' : 'user';

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        if (roleToAssign === 'driver' && (!vehicle_id || !location || !contact_number)) {
             return res.status(400).json({ error: 'Vehicle ID, location, and contact number are required for driver signup.' });
        }

        // Check if user exists
        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // 1. Insert user: FIX: Use 'user_id' in RETURNING clause
        const newUser = await pool.query(
            `INSERT INTO users (name, email, password, role)
             VALUES ($1, $2, $3, $4) 
             RETURNING user_id, name, email, role`, // <--- FIXED: Now returns user_id
            [name, email, hashedPassword, roleToAssign]
        );

        const createdUser = newUser.rows[0]; // createdUser.user_id now holds the correct PK

        // 2. Auto-create driver profile if driver
        if (roleToAssign === 'driver') {
            await pool.query(
                // Uses the correct FK name 'userid'
                `INSERT INTO drivers (driver_name, vehicle_id, contact_number, location, status, role, user_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    name, 
                    vehicle_id, 
                    contact_number, 
                    location, 
                    'not_available',
                    'driver', 
                    createdUser.user_id // <--- Correctly uses createdUser.user_id
                ]
            );
            console.log(`✅ Driver profile created for user ID: ${createdUser.user_id}`);
        }

        res.status(201).json({
            message: `Signup successful as ${roleToAssign}!`,
            user: {
                user_id: createdUser.user_id, // Returns user_id
                name: createdUser.name,
                email: createdUser.email,
                role: createdUser.role
            }
        });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Server error during signup.', details: err.message });
    }
});

// 🔑 LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        // ... (input validation) ...

        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0)
            return res.status(400).json({ error: 'Invalid credentials' });

        const user = userRes.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword)
            return res.status(400).json({ error: 'Invalid credentials' });

        // Generate token - uses 'user_id' consistently
        const token = jwt.sign(
            { user_id: user.user_id, email: user.email, role: user.role }, // Payload uses user_id
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.json({
            message: 'Login successful!',
            token,
            user: {
                user_id: user.user_id,
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