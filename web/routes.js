var passport = require('passport');
var GitHubStrategy = require('passport-github').Strategy;
var User = require('./model').User;

const GITHUB_CLIENT_ID = 'c2ac848b3cfc250c56f3';
const GITHUB_CLIENT_SECRET = '124b5616a6608731936f5050f8874e3321c0b1ee';

passport.use(new GitHubStrategy({
    clientID: GITHUB_CLIENT_ID,
    clientSecret: GITHUB_CLIENT_SECRET,
    callbackURL: "http://127.0.0.1:3000/auth/github/callback"
  },
  function(accessToken, refreshToken, profile, cb) {
    User.findOrCreate({ githubId: profile.id }, function (err, user) {
      // SESSION
      return cb(err, user);
    });
  }
));

module.exports = function(server) {
    // Defining all the routes
    server.get('/', function(req, res) {
      res.render('index', { title: 'The index page!' });
    });

    server.get('/auth/github', passport.authenticate('github'));

    server.get('/auth/github/callback',
      passport.authenticate('github', { failureRedirect: '/' }),
      function(req, res) {
        res.redirect('/');
      }
    );
};
