### Clickhouse Ops

To access clickhouse use port forwarding in kubernetes

```
kubectl port-forward --address 0.0.0.0 service/oneuptime-oneuptime 8123:8123
```

then you should be able to access from the localhost and port 8123

```
# Username for Postgres user is `oneuptime`
kubectl get secret/oneuptime-clickhouse -o go-template='{{(index .data "admin-password") | base64decode}}'
```

Important: Please ignore % in the end of the password output. 


### Basic Ops Queries
 

#### Check Size of Tables in Clickhouse

```sql
SELECT
    database,
    table,
    formatReadableSize(sum(data_compressed_bytes) AS size) AS compressed,
    formatReadableSize(sum(data_uncompressed_bytes) AS usize) AS uncompressed,
    round(usize / size, 2) AS compr_rate,
    sum(rows) AS rows,
    count() AS part_count
FROM system.parts
WHERE (active = 1) AND (database LIKE '%') AND (table LIKE '%')
GROUP BY
    database,
    table
ORDER BY size DESC;
```