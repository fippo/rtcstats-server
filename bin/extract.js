#!/usr/bin/env node

// this small command line utility can be used like this
// aws s3 cp s3://rtcstats-server-bucket/023e3641-6e68-46c0-8c79-5b436b0e41bc.gz - | gunzip | ./bin/extract.js /dev/stdin
const { EOL } = require('os');

const FeatureExtractor = require('../src/features/FeatureExtractor');

const dumpMeta = {
    dumpPath: process.argv[2]
};

new FeatureExtractor(dumpMeta).extract()
    .then(results => process.stdout.write(`${JSON.stringify(results)}${EOL}`));
