// js/auth.js
const ADMIN_USER = 'moni';
const ADMIN_PASS = 'moni';
const SESSION_KEY = 'one_admin_session';

const Auth = {
  isAdmin:      () => sessionStorage.getItem(SESSION_KEY)==='true',
  loginAdmin(u,p){ if(u===ADMIN_USER&&p===ADMIN_PASS){ sessionStorage.setItem(SESSION_KEY,'true'); return true; } return false; },
  logout()       { sessionStorage.removeItem(SESSION_KEY); },
  requireAdmin() { if(!Auth.isAdmin()) window.location.href='index.html'; },
};
