import jwt from 'jsonwebtoken';
const JWT_SECRET = 'uberfriends_secret_key';

export const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'No token provided' });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });

        req.user = decoded; // contains { userid, email, role }
        next();
    });
};
