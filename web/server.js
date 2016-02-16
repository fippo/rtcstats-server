var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var routes = require('./routes');

function Server() {
    var app = express();

    // Remove x-powered-by header (doesn't let clients know we are using Express)
    app.disable('x-powered-by');

    app.set('view engine', 'ejs');


    // Returns middleware that parses both json and urlencoded.
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({
        extended: true
    }));

    // Returns middleware that parses cookies
    app.use(cookieParser());

    routes(app);

    return app;
}

module.exports = function() {
    return new Server();
};
