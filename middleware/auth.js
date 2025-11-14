const User = require('../models/User');

// Middleware to check if user is authenticated and verified
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }

  // Check if user exists and is verified
  User.findById(req.session.userId)
    .then(user => {
      if (!user || !user.isVerified) {
        req.session.destroy();
        return res.redirect('/login');
      }
      req.user = user;
      next();
    })
    .catch(err => {
      console.error(err);
      res.status(500).render('error', { message: 'Authentication error' });
    });
};

module.exports = { requireAuth };
