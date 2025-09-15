This repository is no longer maintained. See [here](https://github.com/rtcstats/rtcstats)
for the current version.

# rtcstats-server
server for https://github.com/opentok/rtcstats

## Load errors
```
select starttime, colname, col_length, type, err_reason
    from stl_load_errors
    order by starttime desc;
```

## views on recent data
```
create or replace view recent as select * from features_new order by date desc limit 100000;
```

## Sample queries

The `queries` directory contains nodejs script that will connect to redshift, run a large
number of queries and output a HTML file to stdout.

## Extracting features from a local dump file

1. Move the dump file to the temp folder
2. Run `node extract name-of-the-file`
