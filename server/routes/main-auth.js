const { verifyPassword } = require('../utils/password-auth');

const registerMainAuthRoutes = (app, deps) => {
    const {
        mainLoginLimiter,
        signMainSession,
        verifyMainSession,
        parseCookies,
        MAIN_SESSION_COOKIE,
        MAIN_SESSION_TTL_MS,
        getCookieOptions,
        getClearCookieOptions
    } = deps;

    app.post('/api/main/login', mainLoginLimiter, (req, res) => {
        const { password } = req.body || {};
        const MAIN_PASSWORD = process.env.MAIN_PASSWORD;
        const MAIN_PASSWORD_HASH = process.env.MAIN_PASSWORD_HASH;
        if (!MAIN_PASSWORD && !MAIN_PASSWORD_HASH) {
            return res.status(500).json({ error: 'Main site auth not configured.' });
        }
        const valid = verifyPassword({
            candidate: password,
            plainSecret: MAIN_PASSWORD,
            hashedSecret: MAIN_PASSWORD_HASH
        });
        if (!valid) {
            return res.status(401).send('Wrong password');
        }
        const token = signMainSession({ sub: 'main' });
        res.cookie(MAIN_SESSION_COOKIE, token, getCookieOptions(MAIN_SESSION_TTL_MS));
        return res.json({ success: true });
    });

    app.get('/api/main/session', (req, res) => {
        const cookies = parseCookies(req.headers.cookie);
        const token = cookies[MAIN_SESSION_COOKIE];
        const session = verifyMainSession(token);
        if (!session || session.sub !== 'main') {
            return res.status(401).send('Unauthorized');
        }
        return res.json({ success: true });
    });

    app.post('/api/main/logout', (req, res) => {
        res.clearCookie(MAIN_SESSION_COOKIE, getClearCookieOptions());
        return res.json({ success: true });
    });
};

module.exports = {
    registerMainAuthRoutes
};
