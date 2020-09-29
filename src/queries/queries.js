/* eslint-disable */

'use strict';
/* typically used like this WHERE `ssh redshift` creates a tunnel to your redshift db
ssh -f redshift sleep 10
export CONNECTIONSTRING='postgres://...'
rm out.html; node queries.js > out.html && firefox out.html
*/

const pg = require('pg');
const fs = require('fs');

const connectionString = process.env.CONNECTIONSTRING;
const client = new pg.Client(connectionString);

const query = require('./lib/query')(client);
const graph = require('./lib/graph');

console.log('<html><head><meta charset="utf-8">' +
    '<title>snoop graphs</title>' +
    '<script src="https://code.jquery.com/jquery-2.1.3.min.js"></script>' +
    '<script src="https://code.highcharts.com/highcharts.js"></script>' +
    '</head><body><div id="container"></div></body>');
console.log('<script>Highcharts.setOptions({global: {useUTC: false}});</script>');

function records() {
    query("SELECT count(*), [day], usingicelite " +
        "FROM features " +
        "GROUP BY day, usingicelite " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'count-' + (row.usingicelite ? 'sfu' : 'p2p');
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'Number of records, per day'
        });
    });
}

function records_short() {
    query("SELECT count(*), [day], sessionduration < 120 * 1000 AS short " +
        "FROM features " +
        "WHERE sessionduration > 0 " +
        "GROUP BY day, short " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'count-' + row.short;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'Number of records < 120 seconds, per day'
        });
    });
}

function recordsWeekly() {
    query("SELECT count(*), [week], usingicelite " +
        "FROM features " +
        "GROUP BY week, usingicelite " +
        "ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'count-' + (row.usingicelite ? 'sfu' : 'p2p');
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'Number of records, per week'
        });
    });
}

function recordsWeekly_connected() {
    query("SELECT count(*), [week], sessionduration is not null AS connected " +
        "FROM features " +
        "GROUP BY week, connected " +
        "ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'count-' + (row.connected ? 'connected' : 'not connected');
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'Number of records, per week; connected vs not connected'
        });
    });
}

function videodays() {
    query("SELECT sum(sessionduration)/1000/60/60/24 AS videodays, [day], usingicelite " +
        "FROM features " +
        "GROUP BY day, usingicelite " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'days-' + (row.usingicelite ? 'sfu' : 'p2p');
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.videodays, 10)])
        });
        graph(series, {
            title: 'Videodays, per day'
        });
    });
}

function videodays_byBrowser() {
    query("SELECT sum(sessionduration)/1000/60/60/24 AS videodays, [day], browsername " +
        "FROM features " +
        "GROUP BY day, browsername " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            let key = row.browsername;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.videodays, 10)])
        });
        graph(series, {
            title: 'Videodays, by browser'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function videodays_byBrowserChrome50() {
    query("SELECT sum(sessionduration)/1000/60/60/24 AS videodays, [day], browsername, browsermajorversion " +
        "FROM features " +
        "WHERE browsername = 'Chrome' and browsermajorversion >= 50 and browsermajorversion <= 90" +
        "GROUP BY day, browsername, browsermajorversion " +
        "ORDER BY day ASC, browsermajorversion")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            let key = row.browsername + '-' + row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.videodays, 10)])
        });
        graph(series, {
            title: 'Videodays, by browser and version (Chrome)'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function videodays_osx() {
    query("SELECT sum(sessionduration)/1000/60/60/24 AS videodays, [week], browseros " +
        "FROM features " +
        "WHERE browseros like '%OS X %' " +
        "GROUP BY week, browseros " +
        "ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            let key = row.browseros;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.videodays, 10)])
        });
        graph(series, {
            title: 'Videodays, OSX'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function videodays_windows() {
    query("SELECT sum(sessionduration)/1000/60/60/24 AS videodays, [day], browseros " +
        "FROM features " +
        "WHERE browseros like '%Windows%' " +
        "GROUP BY day, browseros " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            let key = row.browseros;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.videodays, 10)])
        });
        graph(series, {
            title: 'Videodays, Windows'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function videodays_chromeos() {
    query("SELECT sum(sessionduration)/1000/60/60/24 AS videodays, [day] " +
        "FROM features " +
        "WHERE browseros like 'Chrome OS%' " +
        "GROUP BY day " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'days';
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.videodays, 10)])
        });
        graph(series, {
            title: 'Videodays, ChromeOS per day'
        });
    });
}

function videodays_byBrowserFirefox() {
    query("SELECT sum(sessionduration)/1000/60/60/24 AS videodays, [day], browsername, browsermajorversion " +
        "FROM features " +
        "WHERE browsername = 'Firefox' and browsermajorversion >= 48 " +
        "GROUP BY day, browsername, browsermajorversion " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            let key = row.browsername + '-' + row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.videodays, 10)])
        });
        graph(series, {
            title: 'Videodays, by browser and version (Firefox)'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function videodays_byBrowserEdge() {
    query("SELECT sum(sessionduration)/1000/60/60/24 AS videodays, [day], browsername, browsermajorversion " +
        "FROM features " +
        //"WHERE browsername = 'Microsoft Edge' " +
        "WHERE browsertype = 'edge' " +
        "GROUP BY day, browsername, browsermajorversion " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            let key = row.browsername + '-' + row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.videodays, 10)])
        });
        graph(series, {
            title: 'Minutes, by browser and version (Edge)'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function videodays_byBrowserSafari() {
    query("SELECT sum(sessionduration)/1000/60/60/24 AS videodays, [day], browsername, browsermajorversion " +
        "FROM features " +
        "WHERE browsername = 'Safari' " +
        "GROUP BY day, browsername, browsermajorversion " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            let key = row.browsername + '-' + row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.videodays, 10)])
        });
        graph(series, {
            title: 'Minutes, by browser and version (Safari)'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function videodays_byBrowserAndVersion() {
    query("SELECT sum(sessionduration)/1000/60/60/24 AS videodays, [day], browsername, browsermajorversion " +
        "FROM features " +
        "GROUP BY day, browsername, browsermajorversion " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            let key = row.browsername + '-' + row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.videodays, 10)])
        });
        graph(series, {
            title: 'Videodays, by browser and version'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function hourlyMinutes() {
    query("SELECT sum(sessionduration)/1000/60 AS minutes, [hour], usingicelite " +
        "FROM features " +
        "GROUP BY hour, usingicelite " +
        "ORDER BY hour ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'minutes-' + (row.usingicelite ? 'sfu' : 'p2p');
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.hour).getTime(), parseInt(row.minutes, 10)])
        });
        graph(series, {
            title: 'Videominutes, per hour'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function dailyMinutes() {
    query("SELECT sum(sessionduration)/1000/60 AS minutes, [day], usingicelite " +
        "FROM features " +
        "GROUP BY day, usingicelite " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'minutes-' + (row.usingicelite ? 'sfu' : 'p2p');
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.minutes, 10)])
        });
        graph(series, {
            title: 'Videominutes, per day'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function dailyMinutesScreensharing() {
    query("SELECT sum(sessionduration)/1000/60 AS minutes, [day], calledgetusermediarequestingscreen " +
        "FROM features " +
        "GROUP BY day, calledgetusermediarequestingscreen " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'minutes-' + row.calledgetusermediarequestingscreen;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.minutes, 10)])
        });
        graph(series, {
            title: 'Videominutes, per day, screensharing'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function dailyMinutesTotal() {
    query("SELECT sum(sessionduration)/1000/60 AS minutes, [day] " +
        "FROM features " +
        "GROUP BY day " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'minutes';
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.minutes, 10)])
        });
        graph(series, {
            title: 'Videominutes, per day'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function weeklyMinutes() {
    query("SELECT sum(sessionduration)/1000/60 AS minutes, [week], usingicelite " +
        "FROM features " +
        "GROUP BY week, usingicelite " +
        "ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'minutes-' + (row.usingicelite ? 'sfu' : 'p2p');
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.minutes, 10)])
        });
        graph(series, {
            title: 'Videominutes, per week'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function weeklyMinutesScreensharing() {
    query("SELECT sum(sessionduration)/1000/60 AS minutes, [week], calledgetusermediarequestingscreen " +
        "FROM features " +
        "GROUP BY week, calledgetusermediarequestingscreen " +
        "ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'minutes-' + row.calledgetusermediarequestingscreen;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.minutes, 10)])
        });
        graph(series, {
            title: 'Videominutes, per week, screensharing'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function weeklyMinutesTotal() {
    query("SELECT sum(sessionduration)/1000/60 AS minutes, [week] " +
        "FROM features " +
        "GROUP BY week " +
        "ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'minutes';
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.minutes, 10)])
        });
        graph(series, {
            title: 'Videominutes, per week'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function weeklyMinutesRolling30() {
    query("SELECT day, sum(minutes) over (ORDER BY day rows 30 preceding) AS minutes FROM " +
        "(SELECT sum(sessionduration)/1000/60 AS minutes, [day] " +
        "FROM features " +
        "GROUP BY day) " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'minutes';
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.minutes, 10)])
        });
        graph(series, {
            title: 'Videominutes in the last 30 days, rolling average'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function monthlyMinutes() {
    query("SELECT sum(sessionduration)/1000/60 AS minutes, [month], usingicelite " +
        "FROM features " +
        "GROUP BY month, usingicelite " +
        "ORDER BY month ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'minutes-' + (row.usingicelite ? 'sfu' : 'p2p');
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.month).getTime(), parseInt(row.minutes, 10)])
        });
        graph(series, {
            title: 'Videominutes, per month'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function monthlyMinutesTotal() {
    query("SELECT sum(sessionduration)/1000/60 AS minutes, [month] " +
        "FROM features " +
        "GROUP BY month " +
        "ORDER BY month ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'minutes';
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.month).getTime(), parseInt(row.minutes, 10)])
        });
        graph(series, {
            title: 'Videominutes, per month'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function getusermedia() {
    query("SELECT count(*), [day], browsertype, getusermediaerror " +
        "FROM features " +
        "GROUP BY day, browsertype, getusermediaerror " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsertype + '-' + row.getusermediaerror;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'getusermedia'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function getusermedia_weekly() {
    query("SELECT count(*), [week], browsertype, getusermediaerror " +
        "FROM features " +
        "GROUP BY week, browsertype, getusermediaerror " +
        "ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsertype + '-' + row.getusermediaerror;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'getusermedia'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function getusermedia_errsuccess() {
    query("SELECT count(*), [day], browsertype, getusermediaerror " +
        "FROM features " +
        "WHERE getusermediasuccess = 't' and getusermediaerror != '0' " +
        "GROUP BY day, browsertype, getusermediaerror " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsertype + '-' + row.getusermediaerror;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'getusermedia error with subsequent success'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function nocam() {
    query("SELECT count(*), [day], browsertype, firstvideotracklabel is not null AS hasvideo " +
        "FROM features " +
        "WHERE getusermediasuccess = 't' " +
        "GROUP BY day, browsertype, hasvideo " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsertype + '-' + row.hasvideo;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'getusermedia has camera?'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function receivingvideo() {
    query("SELECT count(*), [day], usingicelite, receivingvideo10spacketsreceived > 0 AS receivingvideo " +
        "FROM features " +
        "WHERE usingicelite = 't' " +
        "GROUP BY day, usingicelite, receivingvideo " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.receivingvideo;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'receiving video'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function receivingvideodelay() {
    query("SELECT count(*), [day], usingicelite, timeuntilreceivingvideo < 5000 AS receivingvideo " +
        "FROM features " +
        "WHERE iceconnectedorcompleted = 't' and timeuntilreceivingvideo is not null " +
        "GROUP BY day, usingicelite, receivingvideo " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = (row.receivingvideo ? 'video' : 'novіdeo') + '-' + (row.usingicelite ? 'sfu' : 'p2p');
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'receiving video in less than 5s'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function bucket() {
    query("SELECT [day], count(*), browsermajorversion FROM features WHERE bwegoogbucketdelaymax > 4000 and browsermajorversion > 50 and browsername = 'Chrome' GROUP BY day, browsermajorversion ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'count-' + row.browseros + '-' + row.browsermajorversion + '-' + row.browsername;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'number of sessions with max bucket delay > 5000'
        });
    });
}

function bucketiosandroid() {
    query("SELECT [day], count(*), case WHEN (firstremotestreamid = 'APPEAR') THEN 'isandroid' WHEN ((firstremotestreamid || 'a0') = firstremotestreamaudio) THEN 'isios' ELSE 'other' END AS peer FROM features WHERE firstremotestreamid is not null and bwegoogbucketdelaymax > 5000 and browsermajorversion >= 56 GROUP BY day, peer ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'count-' + row.peer;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'number of sessions with max bucket delay > 5000, by peer operating system guess'
        });
    });
}

function firstcandidatepairtype() {
    query("SELECT [day], count(*), firstcandidatepairtype FROM features WHERE iceconnectedorcompleted = 't' group by day, firstcandidatepairtype ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.firstcandidatepairtype;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'candidate pair types'
        });
    });
}

function firstcandidatepairtypeNULL() {
    query("SELECT [day], count(*), browsername, browserversion FROM features WHERE (browsername = 'Chrome') and browsermajorversion = 58 and iceconnectedorcompleted = 't' and firstcandidatepairtype is null and sessionduration > 10000 group by day, browsername, browserversion ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsername + '-' + row.browserversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'candidate pair type is NULL'
        });
    });
}

function firstcandidatepairlocaltypepreference() {
    query("SELECT [day], count(*), firstcandidatepairlocaltypepreference FROM features WHERE iceconnectedorcompleted = 't' and browsername = 'Chrome' group by day, firstcandidatepairlocaltypepreference ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.firstcandidatepairlocaltypepreference;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'local type preferences'
        });
    });
}

function firstcandidatepairlocalTURN() {
    query("SELECT [week], count(*), firstcandidatepairlocaltypepreference FROM features WHERE iceconnectedorcompleted = 't' and browsername = 'Chrome' group by week, firstcandidatepairlocaltypepreference ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.firstcandidatepairlocaltypepreference;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'local type preferences (TURN only), week'
        });
    });
}


function firstcandidatepairremotetypepreference() {
    query("SELECT [day], count(*), firstcandidatepairremotetypepreference FROM features WHERE iceconnectedorcompleted = 't' and browsername = 'Chrome' group by day, firstcandidatepairremotetypepreference ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.firstcandidatepairremotetypepreference;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'remote type preferences'
        });
    });
}

function connected() {
    query("SELECT [day], count(*), iceconnectedorcompleted FROM features WHERE iceconnectedorcompleted is not null group by day, iceconnectedorcompleted ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.iceconnectedorcompleted;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'ice connections vs failures'
        });
    });
}

function failed() {
    query("SELECT [day], count(*), icefailuresubsequent, browsertype FROM features WHERE icefailure = 't' group by day, icefailuresubsequent, browsertype ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.icefailuresubsequent + '-' + row.browsertype;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'ice failures by browser'
        });
    });
}

function failedSFU() {
    query("SELECT [day], count(*), icefailuresubsequent, calledgetusermediarequestingscreen, browsertype FROM features WHERE icefailure = 't' and usingicelite = 't' group by day, icefailuresubsequent, browsertype, calledgetusermediarequestingscreen ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.icefailuresubsequent + '-' + row.browsertype + '-' + row.calledgetusermediarequestingscreen;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'ice failures by browser (SFU)'
        });
    });
}

function restart() {
    query("SELECT [day], count(*), icerestart, browsertype FROM features WHERE  icerestart = 't' GROUP BY day, icerestart, browsertype ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.icerestart + '-' + row.browsertype;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'ice restarts by browser'
        });
    });
}

function failedFirefox() {
    query("SELECT [day], count(*), browsermajorversion FROM features WHERE icefailure = 't' and usingicelite = 'f' and icefailuresubsequent = 'f' and browsername = 'Firefox' and browsermajorversion >= 59 and browsermajorversion <= 69 group by day, browsermajorversion ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'p2p ice failures in Firefox, by version'
        });
    });
}

function failedFirefoxWeekly() {
    query("SELECT [week], count(*), browsermajorversion FROM features WHERE icefailure = 't' and usingicelite = 'f' and icefailuresubsequent = 'f' and browsername = 'Firefox' and browsermajorversion >= 59 and browsermajorversion <= 69 group by week, browsermajorversion ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'p2p ice failures in Firefox, by version'
        });
    });
}

function failedChrome() {
    query("SELECT [day], count(*), browsermajorversion FROM features WHERE icefailure = 't' and usingicelite = 'f' and icefailuresubsequent = 'f' and browsername = 'Chrome' and browsermajorversion >= 66 and browsermajorversion <= 69 group by day, browsermajorversion ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'p2p ice failures in chrome, by version'
        });
    });
}

function failedChromeWeekly() {
    query("SELECT [week], count(*), browsermajorversion FROM features WHERE icefailure = 't' and usingicelite = 'f' and icefailuresubsequent = 'f' and browsername = 'Chrome' and browsermajorversion >= 66 and browsermajorversion <= 69 group by week, browsermajorversion ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'p2p ice failures in chrome, by version'
        });
    });
}

function failedSFUWeekly() {
    query("SELECT [week], count(*), icefailure, browsertype FROM features WHERE usingicelite = 't' group by week, icefailure, browsertype ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsertype + '-' + row.icefailure;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'ice failures by browser (SFU)'
        });
    });
}

function failedHourly() {
    query("SELECT [hour], count(*), browsertype FROM features WHERE icefailure = 't' group by hour, browsertype ORDER BY hour ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsertype;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.hour).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'ice failures by browser (hourly)'
        });
    });
}

function SLDFailure() {
    query("SELECT [day], count(*) AS count, setlocaldescriptionfailure " +
          "FROM features " +
          "WHERE setlocaldescriptionfailure is not null " +
          "GROUP BY day, setlocaldescriptionfailure " +
          "HAVING count > 1 " +
          "ORDER by day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.setlocaldescriptionfailure;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'setLocalDescription failures by day'
        });
    });
}

function SRDFailure() {
    query("SELECT [day], count(*) AS count, setremotedescriptionfailure " +
          "FROM features " +
          "WHERE setremotedescriptionfailure is not null " +
          "GROUP BY day, setremotedescriptionfailure " +
          "HAVING count > 1 " +
          "ORDER by day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.setremotedescriptionfailure;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'setRemoteDescription failures by day'
        });
    });
}

function addIceCandidateFailure() {
    query("SELECT [day], count(*) as count, addicecandidatefailure " +
          "FROM features " +
          "WHERE addicecandidatefailure is not null " +
          "GROUP BY day, addicecandidatefailure " +
          "HAVING count > 1 " +
          "ORDER by day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.addicecandidatefailure;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'addIceCandidate failures by day'
        });
    });
}

function noRemoteCandidates() {
    query("SELECT [day], count(*) AS count, browsername, browsermajorversion " +
        "FROM features " +
        "WHERE numberofremoteicecandidates = 0 AND usingicelite = 'f' AND signalingstableatleastonce = 't' " +
        "GROUP BY day, browsername, browsermajorversion " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.browsername + '-' + row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'no remote candidates, by browsername and version'
        });
    });
}


function audiobug() {
    query("SELECT [day], count(*), browsermajorversion FROM features WHERE browsername = 'Chrome' and notsendingaudio = 't' and browsermajorversion >= 56 group by day, browsermajorversion ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.notsendingaudio + '-' + row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'audio bug'
        });
    })
}

function audiobug2() {
    query("SELECT [day], count(*), browsermajorversion FROM features WHERE browsername = 'Chrome' and notsendingaudio = 't' and sessionduration > 10000 and browsermajorversion >= 56 group by day, browsermajorversion ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.notsendingaudio + '-' + row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'audio bug (sessions > 10s)'
        });
    })
}

function audiobug_osx() {
    query("SELECT [day], count(*), browsermajorversion FROM features WHERE browsername = 'Chrome' and notsendingaudio = 't' and browsermajorversion >= 56 and browseros like '%OS X%' group by day, browsermajorversion ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.notsendingaudio + '-' + row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'audio bug (osx)'
        });
    })
}

function audiobug_windows() {
    query("SELECT [day], count(*), browsermajorversion FROM features WHERE browsername = 'Chrome' and notsendingaudio = 't' and browsermajorversion >= 56 and browseros like '%Win%' group by day, browsermajorversion ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.notsendingaudio + '-' + row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'audio bug (windows)'
        });
    })
}

function audiobug_chromeos() {
    query("SELECT [day], count(*), browsermajorversion FROM features WHERE browsername = 'Chrome' and notsendingaudio = 't' and browsermajorversion >= 56 and browseros like 'Chrome OS%' group by day, browsermajorversion ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.notsendingaudio + '-' + row.browsermajorversion;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'audio bug (chromeos)'
        });
    })
}

function incomingmean() {
    query("SELECT [day], MIN(medianmean) AS mean, browsermajorversion, usingicelite " +
        "FROM(" +
            "SELECT date, browsermajorversion, usingicelite, " +
            "MEDIAN(bweavailableincomingbitratemean) over (PARTITION BY date, browsermajorversion, usingicelite) AS medianmean " +
            "FROM features " +
            "WHERE bweavailableincomingbitratemean is not null and bweavailableincomingbitratemean > 0 and browsername = 'Chrome' and browsermajorversion >= 51 and browsermajorversion <= 90 " +
        ") " +
        "GROUP BY day, browsermajorversion, usingicelite " +
        "ORDER BY day DESC, browsermajorversion ASC")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            const key = row.browsermajorversion + '-' + row.usingicelite;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.mean, 10)]);
        });
        graph(series, {
            title: 'chrome mean incoming bitrate by version and sfu'
        });
    });
}

function incomingbitratesfu() {
    query("SELECT [day], MIN(medianmean) AS mean " +
        "FROM(" +
            "SELECT date, " +
            "MEDIAN(bweavailableincomingbitratemean) over (PARTITION BY date) AS medianmean " +
            "FROM features " +
            "WHERE bweavailableincomingbitratemean is not null and bweavailableincomingbitratemean > 0 and usingicelite = 't' and browsername = 'Chrome' and browsermajorversion >= 51 and browsermajorversion <= 90 " +
        ") " +
        "GROUP BY day " +
        "ORDER BY day DESC")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            const key = 'mean';
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.mean, 10)]);
        });
        graph(series, {
            title: 'SFU mean available incoming bitrate'
        });
    });
}

function videojitter() {
    // https://medium.com/the-making-of-appear-in/less-jitter-and-delay-in-chrome-52-cc61b86b49ba#.3nc9d41gy
    query("SELECT [day], MIN(medianmean) AS mean, MIN(medianmax) AS max, browsermajorversion " +
        "FROM(" +
            "SELECT date, browsermajorversion, " +
            "MEDIAN(videorecvgoogjitterbuffermsmean) over (PARTITION BY date, browsermajorversion) AS medianmean, " +
            "MEDIAN(videorecvgoogjitterbuffermsmax) OVER (PARTITION BY date, browsermajorversion) AS medianmax " +
            "FROM features " +
            "WHERE videorecvgoogjitterbuffermsmean > 0 and videorecvgoogjitterbuffermsmax > 0 and browsermajorversion >= 51 and browsermajorversion <= 90 " +
        ") t1 " +
        "GROUP BY day, browsermajorversion " +
        "ORDER BY day DESC, browsermajorversion")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            const key = row.browsermajorversion + '-';
            if (!series[key + 'mean']) series[key + 'mean'] = [];
            if (!series[key + 'max']) series[key + 'max'] = [];
            series[key + 'mean'].push([new Date(row.day).getTime(), parseInt(row.mean, 10)]);
            series[key + 'max'].push([new Date(row.day).getTime(), parseInt(row.max, 10)]);
        });
        graph(series, {
            title: 'chrome mean video jitter, per day'
        });
    });
}

function videojittervariance() {
    query("SELECT [day], sqrt(MIN(medianmean)) AS mean, browsermajorversion " +
        "FROM(" +
            "SELECT date, browsermajorversion, " +
            "MEDIAN(videorecvgoogjitterbuffermsvariance) over (PARTITION BY date, browsermajorversion) AS medianmean " +
            //"MEDIAN(videorecvgoogjitterbuffermsmax) OVER (PARTITION BY date, browsermajorversion) AS medianmax " +
            "FROM features " +
            "WHERE videorecvgoogjitterbuffermsvariance > 0 and browsermajorversion >= 51 and browsermajorversion <= 90 " +
        ") t1 " +
        "GROUP BY day, browsermajorversion " +
        "ORDER BY day DESC")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            const key = row.browsermajorversion + '-';
            if (!series[key + 'mean']) series[key + 'mean'] = [];
            //if (!series[key + 'max']) series[key + 'max'] = [];
            series[key + 'mean'].push([new Date(row.day).getTime(), parseInt(row.mean, 10)]);
            //series[key + 'max'].push([new Date(row.day).getTime(), parseInt(row.max, 10)]);
        });
        graph(series, {
            title: 'chrome video jitter variance, per day'
        });
    });
}

function videojittervarianceclasses() {
    query("SELECT count(*), [day], CASE WHEN sqrt(videorecvgoogjitterbuffermsvariance) < 50 THEN 'lt50' WHEN sqrt(videorecvgoogjitterbuffermsvariance) < 150 THEN 'lt150' WHEN sqrt(videorecvgoogjitterbuffermsvariance) < 300 THEN 'lt300' ELSE 'high' END AS jittervariance " +
        "FROM features " +
        "WHERE videorecvgoogjitterbuffermsvariance > 0 " +
        "GROUP BY DAY, jittervariance " +
        "ORDER BY day DESC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.jittervariance;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'video jitter varіance classes, by day'
        });
    });
}

function videosendrtt() {
    query("SELECT [day], MIN(medianmean) AS mean, MIN(medianmax) AS max, browsermajorversion " +
        "FROM(" +
            "SELECT date, browsermajorversion, " +
            "MEDIAN(videosendgoogrttmean) over (PARTITION BY date, browsermajorversion) AS medianmean, " +
            "MEDIAN(videosendgoogrttmax) OVER (PARTITION BY date, browsermajorversion) AS medianmax " +
            "FROM features " +
            "WHERE videosendgoogrttmean > 0 and browsermajorversion >= 51 and browsermajorversion <= 65 " +
        ") t1 " +
        "GROUP BY day, browsermajorversion " +
        "ORDER BY day DESC")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            const key = row.browsermajorversion + '-';
            if (!series[key + 'mean']) series[key + 'mean'] = [];
            if (!series[key + 'max']) series[key + 'max'] = [];
            series[key + 'mean'].push([new Date(row.day).getTime(), parseInt(row.mean, 10)]);
            series[key + 'max'].push([new Date(row.day).getTime(), parseInt(row.max, 10)]);
        });
        graph(series, {
            title: 'chrome video send rtt median, per day'
        });
    });
}

function videosendrttclasses() {
    // basically this is the e-model stuff
    query("SELECT count(*), [day], CASE WHEN videosendgoogrttmean < 200 THEN 'lt200' WHEN videosendgoogrttmean < 280 THEN 'lt280' WHEN videosendgoogrttmean < 390 THEN 'lt390' WHEN videosendgoogrttmean < 550 THEN 'lt550' ELSE 'high' END AS sendrtt " +
        "FROM features " +
        "WHERE videosendgoogrttmean > 0 " +
        "GROUP BY DAY, sendrtt " +
        "ORDER BY day DESC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.sendrtt;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'chrome video send rtt classes, by day'
        });
    });
}

function videosendrttcountry() {
    query("SELECT [day], MIN(medianmean) AS mean, locationcountry " +
        "FROM(" +
            "SELECT date, locationcountry, " +
            "MEDIAN(videosendgoogrttmean) over (PARTITION BY date, locationcountry) AS medianmean " +
            //"MEDIAN(videorecvgoogjitterbuffermsmax) OVER (PARTITION BY date, browsermajorversion) AS medianmax " +
            "FROM features " +
            "WHERE videosendgoogrttmean > 0 and browsermajorversion >= 51 and browsermajorversion <= 90 " +
            "and (locationcountry = 'Norway' or locationcountry = 'Germany' or locationcountry = 'Pakistan' or locationcountry = 'United States' or locationcountry = 'India' or locationcountry = 'Japan' or locationcountry = 'France' or locationcountry = 'Brazil') " +
        ") t1 " +
        "GROUP BY day, locationcountry " +
        "ORDER BY day DESC")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            const key = row.locationcountry + '-';
            if (!series[key + 'mean']) series[key + 'mean'] = [];
            series[key + 'mean'].push([new Date(row.day).getTime(), parseInt(row.mean, 10)]);
        });
        graph(series, {
            title: 'chrome video send rtt median, per day'
        });
    });
}

function videosendrttvariance() {
    query("SELECT [day], sqrt(MIN(medianmean)) AS mean, locationcountry " +
        "FROM(" +
            "SELECT date, locationcountry, " +
            "MEDIAN(videosendgoogrttvariance) over (PARTITION BY date, locationcountry) AS medianmean " +
            //"MEDIAN(videorecvgoogjitterbuffermsmax) OVER (PARTITION BY date, browsermajorversion) AS medianmax " +
            "FROM features " +
            "WHERE videosendgoogrttmean > 0 and browsermajorversion >= 51 and browsermajorversion <= 90 " +
            "and (locationcountry = 'Norway' or locationcountry = 'Germany' or locationcountry = 'Pakistan' or locationcountry = 'United States' or locationcountry = 'India' or locationcountry = 'Japan' or locationcountry = 'France' or locationcountry = 'Brazil') " +
        ") t1 " +
        "GROUP BY day, locationcountry " +
        "ORDER BY day DESC")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            const key = row.locationcountry + '-';
            if (!series[key + 'mean']) series[key + 'mean'] = [];
            //if (!series[key + 'max']) series[key + 'max'] = [];
            series[key + 'mean'].push([new Date(row.day).getTime(), parseInt(row.mean, 10)]);
            //series[key + 'max'].push([new Date(row.day).getTime(), parseInt(row.max, 10)]);
        });
        graph(series, {
            title: 'chrome video rtt variance, per day'
        });
    });
}

function videosendrttcountrysfu() {
    query("SELECT [day], MIN(medianmean) AS mean, locationcountry, usingicelite " +
        "FROM(" +
            "SELECT date, locationcountry, usingicelite, " +
            "MEDIAN(videosendgoogrttmean) over (PARTITION BY date, locationcountry, usingicelite) AS medianmean " +
            //"MEDIAN(videorecvgoogjitterbuffermsmax) OVER (PARTITION BY date, browsermajorversion) AS medianmax " +
            "FROM features " +
            "WHERE videosendgoogrttmean > 0 and browsermajorversion >= 51 and browsermajorversion <= 90 " +
            "and (locationcountry = 'Norway' or locationcountry = 'Germany' or locationcountry = 'Pakistan' or locationcountry = 'United States' or locationcountry = 'India' or locationcountry = 'Japan' or locationcountry = 'France' or locationcountry = 'Brazil') " +
        ") t1 " +
        "GROUP BY day, locationcountry, usingicelite " +
        "ORDER BY day DESC")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            const key = row.locationcountry + '-' + (row.usingicelite ? 'sfu' : 'p2p') + '-';
            if (!series[key + 'mean']) series[key + 'mean'] = [];
            series[key + 'mean'].push([new Date(row.day).getTime(), parseInt(row.mean, 10)]);
        });
        graph(series, {
            title: 'chrome video send rtt median, per day, p2p vs sfu'
        });
    });
}

function videosendrttsfu() {
    query("SELECT [day], MIN(medianmean) AS mean " +
        "FROM(" +
            "SELECT date, browsermajorversion, " +
            "MEDIAN(videosendgoogrttmean) over (PARTITION BY date) AS medianmean " +
            "FROM features " +
            "WHERE videosendgoogrttmean > 0 and usingicelite = 't' " +
        ") t1 " +
        "GROUP BY day " +
        "ORDER BY day DESC")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            const key = 'mean';
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.mean, 10)]);
        });
        graph(series, {
            title: 'chrome video send rtt median, per day'
        });
    });
}

function connectiontime() {
    query("SELECT [day], browsername, MIN(median) AS median, sqrt(MIN(stddev)) AS stddev " +
        "FROM (" +
            "SELECT date, browsername, browsermajorversion, " +
            "MEDIAN(connectiontime) OVER (PARTITION BY date, browsername) AS median, " +
            "STDDEV(connectiontime) OVER (PARTITION BY date, browsername) AS stddev " +
            "FROM features " +
            "WHERE connectiontime > 0 and (browsername = 'Chrome' or browsername = 'Firefox' " +
            ")" +
        ") t1 " +
        "GROUP BY day, browsername " +
        "ORDER BY day ASC, browsername")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            //const key = row.browsername + '-' + row.browsermajorversion + '-';
            const key = row.browsername;
            if (!series[key + 'median']) series[key + 'median'] = [];
            if (!series[key + 'stddev']) series[key + 'stddev'] = [];
            series[key + 'median'].push([new Date(row.day).getTime(), parseInt(row.median, 10)]);
            series[key + 'stddev'].push([new Date(row.day).getTime(), parseInt(row.stddev, 10)]);
        });
        graph(series, {
            title: 'connectiontime, per day'
        });
    });
}

function connectiontimeCountry() {
    query("SELECT [day], MIN(median) AS median, sqrt(MIN(stddev)) AS stddev, locationcountry " +
        "FROM (" +
            "SELECT date, locationcountry, " +
            "MEDIAN(connectiontime) OVER (PARTITION BY date, locationcountry) AS median, " +
            "STDDEV(connectiontime) OVER (PARTITION BY date, locationcountry) AS stddev " +
            "FROM features " +
            "WHERE connectiontime > 0 and browsername = 'Chrome' " + //or browsername = 'Firefox' " +
            "and (locationcountry = 'Norway' or locationcountry = 'Germany' or locationcountry = 'Pakistan' or locationcountry = 'United States' or locationcountry = 'India' or locationcountry = 'Japan' or locationcountry = 'France' or locationcountry = 'Brazil') " +
            "and browsermajorversion > 52 and browsermajorversion < 90" +
        ") t1 " +
        "GROUP BY day, locationcountry " +
        "ORDER BY day ASC, locationcountry")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            const key = row.locationcountry + '-';
            if (!series[key + 'median']) series[key + 'median'] = [];
            if (!series[key + 'stddev']) series[key + 'stddev'] = [];
            series[key + 'median'].push([new Date(row.day).getTime(), parseInt(row.median, 10)]);
            series[key + 'stddev'].push([new Date(row.day).getTime(), parseInt(row.stddev, 10)]);
        });
        graph(series, {
            title: 'connectiontime, per day, by country'
        });
    });
}

function connectiontimeSFU() {
    query("SELECT [day], MIN(median) AS median, sqrt(MIN(stddev)) AS stddev, usingicelite " +
        "FROM (" +
            "SELECT date, usingicelite, " +
            "MEDIAN(connectiontime) OVER (PARTITION BY date, usingicelite) AS median, " +
            "STDDEV(connectiontime) OVER (PARTITION BY date, usingicelite) AS stddev " +
            "FROM features " +
            "WHERE connectiontime > 0 and browsername = 'Chrome' " + //or browsername = 'Firefox' " +
            "and browsermajorversion > 52 and browsermajorversion < 90" +
        ") t1 " +
        "GROUP BY day, usingicelite " +
        "ORDER BY day ASC, usingicelite")
    .then(res => {
        const series = {};
        res.rows.forEach((row) => {
            const key = (row.usingicelite ? 'sfu' : 'p2p');
            if (!series[key + 'median']) series[key + 'median'] = [];
            //if (!series[key + 'stddev']) series[key + 'stddev'] = [];
            series[key + 'median'].push([new Date(row.day).getTime(), parseInt(row.median, 10)]);
            //series[key + 'stddev'].push([new Date(row.day).getTime(), parseInt(row.stddev, 10)]);
        });
        graph(series, {
            title: 'connectiontime, per day, by country and sfu'
        });
    });
}

function gatherandconnect() {
    query("SELECT MIN(mediangathering) AS gatheringtime, MIN(medianconnection) AS connectiontime, locationcountry FROM (SELECT locationcountry, MEDIAN(gatheringtimeturnudp) OVER (PARTITION BY locationcountry) AS mediangathering, MEDIAN(connectiontime) OVER (PARTITION BY locationcountry) AS medianconnection FROM features WHERE gatheringtimeturnudp < 5000 and connectiontime < 5000 and locationcountry is not null) group by locationcountry ORDER BY locationcountry ASC")
    .then(res => {
        console.log('country\tgatheringtime\tconnectiontime');
        res.rows.forEach((row) => {
            console.log(row.locationcountry + '\t' + row.gatheringtime + '\t' + row.connectiontime);
        });
    });
}

function averageDuration() {
    query("SELECT avg(sessionduration)/1000 AS seconds, [week], usingicelite " +
        "FROM features " +
        "WHERE sessionduration > 0 " +
        "GROUP BY week, usingicelite " +
        "ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'duration' + (row.usingicelite ? 'sfu' : 'p2p');
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.seconds, 10)])
        });
        graph(series, {
            title: 'average session duration'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function emptyid() {
    query("SELECT count(*), [day], usingicelite " +
        "FROM features " +
        "WHERE clientidentifier = '' or clientidentifier is null " +
        "GROUP BY day, usingicelite " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'empty-' + row.usingicelite;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'empty id, per day'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

function nohost_osx() {
    query("SELECT count(*), [week], gatheredstun, isinitiator " +
        "FROM features " +
        "WHERE browsername = 'Chrome' and gatheredhost = 'f' and iceconnectedorcompleted = 't' and browseros like '%OS X%' " +
        "GROUP BY week, gatheredstun, isinitiator " +
        "ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'osx-' + (row.gatheredstun ? 'stun' : 'nostun') + '-' + row.isinitiator;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'Chrome, no host candidates'
        });
    });
}

function nohost_windows() {
    query("SELECT count(*), [week], gatheredstun, isinitiator " +
        "FROM features " +
        "WHERE browsername = 'Chrome' and gatheredhost = 'f' and iceconnectedorcompleted = 't' and browseros like '%Windows%' " +
        "GROUP BY week, gatheredstun, isinitiator " +
        "ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'win-' + (row.gatheredstun ? 'stun' : 'nostun') + '-' + row.isinitiator;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'Chrome, no host candidates'
        });
    });
}

function ipv6() {
    query("SELECT [week], count(*), firstcandidatepairlocalipaddress LIKE '%:%' AS ipv6 FROM features WHERE firstcandidatepairlocalipaddress IS NOT NULL GROUP BY week, ipv6 ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.ipv6;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'ipv6 usage'
        });
    });
}

function roomnames() {
    query("SELECT [week], count(distinct conferenceidentifier), usingicelite FROM features WHERE conferenceidentifier is not null GROUP BY week, usingicelite ORDER BY week ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = row.usingicelite ? 'sfu' : 'p2p';
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.week).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'distinct room names'
        });
    });
}

function receivedwidthMax() {
    query("SELECT count(*) AS count, [day], videorecvgoogframewidthreceivedmax as width " +
        "FROM features " +
        "WHERE usingicelite = 't' AND (videorecvgoogframewidthreceivedmax = 1280 OR videorecvgoogframewidthreceivedmax = 640 OR videorecvgoogframewidthreceivedmax = 320) " +
        "GROUP BY day, width " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'count-' + row.width;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'max width received (main resolutions)'
        });
    });
}

function receivedwidthMode() {
    query("SELECT count(*) AS count, [day], videorecvgoogframewidthreceivedmode AS width " +
        "FROM features " +
        "WHERE usingicelite = 't' AND (videorecvgoogframewidthreceivedmode = 1280 OR videorecvgoogframewidthreceivedmode = 640 OR videorecvgoogframewidthreceivedmode = 320) " +
        "GROUP BY day, width " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'count-' + row.width;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'most common width received (main resolutions)'
        });
    });
}
function sentwidthMax() {
    query("SELECT count(*) AS count, [day], videosendgoogframewidthsentmax as width " +
        "FROM features " +
        "WHERE usingicelite = 't' AND (videosendgoogframewidthsentmax = 1280 OR videosendgoogframewidthsentmax = 640 OR videosendgoogframewidthsentmax = 320) " +
        "GROUP BY day, width " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'count-' + row.width;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'max width sent (main resolutions)'
        });
    });
}

function sentwidthMode() {
    query("SELECT count(*) AS count, [day], videosendgoogframewidthsentmode as width " +
        "FROM features " +
        "WHERE usingicelite = 't' AND (videosendgoogframewidthsentmode = 1280 OR videosendgoogframewidthsentmode = 640 OR videosendgoogframewidthsentmode = 320) " +
        "GROUP BY day, width " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'count-' + row.width;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'most common width sent (main resolutions)'
        });
    });
}

function sdpsemantics() {
    query("SELECT count(*) AS count, [day], sdpsemantics, usingicelite, browsername " +
        "FROM features " +
        "WHERE sdpsemantics IS NOT NULL AND browsername like 'Chrome%' " +
        "GROUP BY day, sdpsemantics, usingicelite, browsername " +
        "ORDER BY day ASC")
    .then(res => {
        const series = {}
        res.rows.forEach((row) => {
            const key = 'records-' + row.sdpsemantics + '-' + (row.usingicelite ? 'sfu' : 'p2p') + '-' + row.browsername;
            if (!series[key]) series[key] = [];
            series[key].push([new Date(row.day).getTime(), parseInt(row.count, 10)])
        });
        graph(series, {
            title: 'Unified Plan, number of records'
        });
    })
    .catch((err) => {
        console.error(err);
    });
}

client.connect(err => {
    if (err) {
        console.log(err);
        client.end();
        return;
    }
    // days, by browser versions.
    videodays();
    videodays_byBrowser();
    videodays_byBrowserAndVersion();
    videodays_byBrowserChrome50();
    videodays_byBrowserFirefox();
    videodays_byBrowserEdge();
    videodays_byBrowserSafari();
    videodays_chromeos();
    videodays_osx();
    videodays_windows();

    // minutes, in various time aggregates
    hourlyMinutes();
    dailyMinutes();
    dailyMinutesScreensharing();
    dailyMinutesTotal();
    weeklyMinutes();
    weeklyMinutesScreensharing();
    weeklyMinutesTotal();
    weeklyMinutesRolling30();
    monthlyMinutes();
    monthlyMinutesTotal();

    roomnames();
    records();
    records_short();
    recordsWeekly();
    recordsWeekly_connected();
    averageDuration();
    //emptyid();

    //firstcandidatepairlocalTURN();

    /*
    videosendrtt();
    videosendrttsfu();
    */
    incomingbitratesfu();
    connectiontimeSFU();
    /*
    failedSFUWeekly();
    */

    getusermedia();
    getusermedia_weekly();
    getusermedia_errsuccess();
    nocam();

    /*
    receivingvideo();
    receivingvideodelay();
    bucket();
    bucketiosandroid();
    */

    SLDFailure();
    SRDFailure();
    addIceCandidateFailure();
    noRemoteCandidates();

    ipv6();
    /*
    videojitter();
    videojittervarianceclasses();
    videojittervariance();
    videosendrtt();
    videosendrttclasses();
    */
    /*
    videosendrttcountry();
    videosendrttvariance();
    videosendrttcountrysfu();
    */
    connectiontime();
    /*
    connectiontimeCountry();

    gatherandconnect();

    */
    /*
    getusermedia_errsuccess_chrome();
    */

    firstcandidatepairtype();
    firstcandidatepairlocaltypepreference();
    firstcandidatepairremotetypepreference();
    connected();

    audiobug();
    audiobug2();
    audiobug_osx();
    audiobug_windows();
    audiobug_chromeos();

    failed();
    failedSFU();
    failedHourly();

    // SFU quality metrics
    receivedwidthMax();
    receivedwidthMode();
    sentwidthMax();
    sentwidthMode();

    // Unified Plan vs Plan-B
    sdpsemantics();
});
