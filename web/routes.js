var passport = require('passport');
var GitHubStrategy = require('passport-github').Strategy;
var User = require('./model').User;
var Project = require('./model').Project;
var Summary = require('./model').Summary;

const GITHUB_CLIENT_ID = '';
const GITHUB_CLIENT_SECRET = '';
const CALLBACK_URL = "https://rtcstats.tokbox.com/auth/github/callback";
//const GITHUB_CLIENT_ID = 'c2ac848b3cfc250c56f3';
//const GITHUB_CLIENT_SECRET = '124b5616a6608731936f5050f8874e3321c0b1ee';
//const CALLBACK_URL = "http://127.0.0.1:3000/auth/github/callback";

passport.use(new GitHubStrategy({
    clientID: GITHUB_CLIENT_ID,
    clientSecret: GITHUB_CLIENT_SECRET,
    callbackURL: CALLBACK_URL
  },
  function(accessToken, refreshToken, profile, cb) {
    User.findOrCreate({
      githubId: profile.id,
      username: profile.username,
      name: profile.displayName,
      email: profile.emails ? profile.emails[0].value : ''
    }, function (err, user) {
      return cb(err, user);
    });
  }
));

passport.serializeUser(function(user, done) {
  done(null, JSON.stringify(user));
});

passport.deserializeUser(function(user, done) {
  done(null, JSON.parse(user));
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }

  // denied. redirect to login
  res.redirect('/')
}

module.exports = function(server) {
    server.get('/', function(req, res) {
      res.render('index', { user: req.user });
    });

    server.get('/dashboard', requireAuth, function(req, res) {
      Summary.find('', function(err, summary) {
        res.render('dashboard', { user: req.user, summary: summary });
      });
    });

    server.get('/project/:id', requireAuth, function(req, res) {
      Summary.find('', function(err, summary) {
        res.render('project', { summary: summary });
      });
    });

    server.get('/project/:projectId/connection/:id', requireAuth, function(req, res) {
      var connection = Features.findById(req.id, req.projectId);

      res.render('connection', { connection: connection });
    });

    server.get('/project/:projectId/connection/:id/raw', requireAuth, function(req, res) {
      var connection = Features.findById(req.id, req.projectId);

      // S3.return(connection.path);

      res.render('connection', { connection: connection });
    });

    server.get('/logout', function(req, res) {
      req.logout();
      res.redirect('/');
    });

    server.get('/auth/github', passport.authenticate('github'));

    server.get('/auth/github/callback',
      passport.authenticate('github', { failureRedirect: '/' }),
      function(req, res) {
        res.redirect('/dashboard');
      }
    );
};
