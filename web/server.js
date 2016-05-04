var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var passport = require('passport');
var routes = require('./routes');

function Server() {
    var app = express();

    // Remove x-powered-by header (doesn't let clients know we are using Express)
    app.disable('x-powered-by');

    app.set('view engine', 'jade');

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(cookieParser());

    app.use(session({ secret: 'rtcstatssessionpwd' }));
    app.use(passport.initialize());
    app.use(passport.session());

    routes(app);

    return app;
}

module.exports = function() {
    return new Server();
};
