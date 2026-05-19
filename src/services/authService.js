function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

function loadUser(req, res, next) {
  res.locals.user = req.user || null;
  next();
}

module.exports = { ensureAuth, loadUser };
