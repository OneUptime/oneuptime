# Some basic commands for Clickhouse

## Show tables in the database
    
```sql  
show tables from oneuptime
```

## Show table structure

```sql
DESCRIBE TABLE oneuptime.Span
```

## Show table data

```sql
select * from table_name
```

## Delete table data

```sql
truncate table_name
```

## Delete table

```sql
drop table oneuptime.table_name 
```

## Insert for nested data

```sql
INSERT INTO opentelemetry_spans (trace_id, span_id, attributes.key, attributes.value) VALUES 
('trace1', 'span1', ['key1', 'key2'], ['value1', 'value2']),
('trace2', 'span2', ['keyA', 'keyB'], ['valueA', 'valueB']);
```



