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
