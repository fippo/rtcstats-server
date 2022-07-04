'use strict';
// make sure to set CONNECTIONSTRING to connect to your redshift/postgres instance
// Also make sure to use a read-only user.

const http = require('http');
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const connectionString = process.env.CONNECTIONSTRING;

const query = require('./lib/query');

async function runQuery(q, response) {
    const client = new pg.Client(connectionString);
    client.connect(err => {
        if (err) {
            console.log(err);
            client.end();
            return;
        }
        query(client)(q.trim()).then(result => {
            const res = {rows: []}
            result.rows.forEach((row) => {
                res.rows.push(row);
            });
            response.end(JSON.stringify(res));
        }, (err) => {
            response.end(JSON.stringify({error: err.toString()}));
        });
    });
}

http.createServer((request, response) => {
    const body = [];
    switch (request.url) {
    case '/':
        response.writeHead(200, {'Content-Type': 'text/html'});
        fs.readFile(path.resolve(__dirname, 'interactive.html'), (err, data) => {
            if (err) {
                throw err;
            }
            response.end(data);
        });
        break;
    case '/q': 
        request.on('data', (c) => body.push(c));
        request.on('end', () => {
            runQuery(Buffer.concat(body).toString('utf-8'), response);
        });
        break;
    default:
        console.log('unhandled', request.url);
        response.writeHead(404, {'Content-Type': 'text/html'});
        response.end();
        break;
    }

}).listen(8080);
