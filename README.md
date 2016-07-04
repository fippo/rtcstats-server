# rtcstats-server
server for https://github.com/opentok/rtcstats

# dealing with dynamodb and redshift

## importing data
The current schema is in features.sql. It will create a table features_import. Use this SQL query to populate it:
```
copy features_import from 'dynamodb://snoop-table-name' credentials 'aws_access_key_id=key;aws_secret_access_key=secret' readratio 98;
```

It is advisable to increase the dynamodb read capacity for the duration of the import.

## renaming the table after import
```
alter table features_import rename to features_old
```

## Load errors
```
select starttime, colname, col_length, type, err_reason from stl_load_errors;
```

## views on recent data
```
create or replace view recent as select * from features_new where date >= 1466553600000 order by date desc limit 100000;
```
