/* eslint-disable */

let pending = 0;

/**
 *
 * @param {*} q
 */
function query(q) {
    // eslint-disable-next-line consistent-this
    const client = this;

    return new Promise((resolve, reject) => {
        pending++;
        q = q.replace('[time]', 'timestamp \'epoch\' + datetime / 1000 * interval \'1 second\' AS time');
        q = q.replace('[day]', 'timestamp \'epoch\' + date / 1000 * interval \'1 second\' AS day');
        q = q.replace('[hour]', 'date_trunc(\'hour\', timestamp \'epoch\' + datetime / 1000 * interval \'1 second\') AS hour');
        q = q.replace('[week]', 'date_trunc(\'week\', timestamp \'epoch\' + datetime / 1000 * interval \'1 second\') AS week');
        q = q.replace('[month]', 'date_trunc(\'month\', timestamp \'epoch\' + datetime / 1000 * interval \'1 second\') AS month');
        q = q.replace('[browseros]', 'case browseros '
            + 'WHEN \'Windows 10 64-bit\' THEN \'Windows\' '
            + 'WHEN \'Windows 10\' THEN \'Windows\' '
            + 'WHEN \'Windows 7 / Server 2008 R2 64-bit\' THEN \'Windows\' '
            + 'WHEN \'Windows 7 / Server 2008 R2\' THEN \'Windows\' '
            + 'WHEN \'Windows 8.1 64-bit\' THEN \'Windows\' '
            + 'WHEN \'Windows 8 64-bit\' THEN \'Windows\' '
            + 'WHEN \'Windows XP\' THEN \'Windows\' '

            //
            + 'WHEN \'OS X 10.11.6\' THEN \'OSX\' '
            + 'WHEN \'OS X 10.11.5\' THEN \'OSX\' '
            + 'WHEN \'OS X 10.11.4\' THEN \'OSX\' '
            + 'WHEN \'OS X 10.11.3\' THEN \'OSX\' '
            + 'WHEN \'OS X 10.10.5\' THEN \'OSX\' '
            + 'WHEN \'OS X 10.11\' THEN \'OSX\' '
            + 'WHEN \'OS X 10.9.5\' THEN \'OSX\' '
            + 'WHEN \'OS X 10.11.2\' THEN \'OSX\' '
            + 'WHEN \'OS X 10.11.1\' THEN \'OSX\' '
            + 'WHEN \'OS X 10.10\' THEN \'OSX\' '
            + 'WHEN \'OSX\' THEN \'OSX\' '

            //
            + 'WHEN \'Linux 64-bit\' THEN \'Linux\' '
            + 'WHEN \'Ubuntu Chromium 64-bit\' THEN \'Linux\' '
            + 'WHEN \'Ubuntu 64-bit\' THEN \'Linux\' '
            + 'WHEN \'Linux i686\' THEN \'Linux\' '
            + 'WHEN \'Fedora 64-bit\' THEN \'Linux\' '
            + 'WHEN \'Ubuntu\' THEN \'Linux\' '
            + 'WHEN \'Ubuntu Chromium\' THEN \'Linux\' '
            + 'WHEN \'Chrome OS 64-bit\' THEN \'Chrome OS\' '
            + 'WHEN \'Chrome OS armv7l\' THEN \'Chrome OS\' '
            + 'WHEN \'Chrome OS i686\' THEN \'Chrome OS\' '
            + 'ELSE \'unknown\' '
            + 'END '
            + 'AS browseros');

        // console.error(q);
        client.query(q, (err, res) => {
            pending--;
            if (err) {
                console.error(err);

                return reject(err);
            }
            resolve(res);
            if (pending === 0) {
                client.end();
            }
        });
    });
}
module.exports = function(client) {
    return query.bind(client);
};
