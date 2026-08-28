// js/auth.js
const ADMIN_USERS = {
    "moni": { pass: "moni", role: "ADMIN_GENERAL" },
    "rrhh": { pass: "rrhh", role: "RRHH" },
    "lauracolque": { pass: "lauracolque", role: "LIDER_PROYECTO" }
};

const SESSION_KEY = 'one_admin_session';

const Auth = {
    loginAdmin: function(u, p) {
        const user = ADMIN_USERS[u.toLowerCase()];
        if (user && user.pass === p) {
            localStorage.setItem(SESSION_KEY, 'true');
            localStorage.setItem('admin_role', user.role);
            localStorage.setItem('admin_user', u.toLowerCase());
            return true;
        }
        return false;
    },
    isLoggedIn: function() {
        return localStorage.getItem(SESSION_KEY) === 'true';
    },
    requireAdmin: function() {
        if (!this.isLoggedIn()) {
            window.location.href = 'index.html';
        }
    },
    logout: function() {
        // borrar SOLO las claves de sesión propias (no todo el localStorage,
        // que puede guardar datos de otras partes de la app)
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem('admin_role');
        localStorage.removeItem('admin_user');
        window.location.href = 'index.html';
    }
};