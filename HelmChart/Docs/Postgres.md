### Postgres Ops

To access postgres use port forwarding in kubernetes

```
kubectl port-forward --address 0.0.0.0 service/oneuptime-postgresql 5432:5432
```

then you should be able to access from the localhost and port 5432

You also need to read postgres password which is stored in kubenretes secrets. You can decode the password by using this command: 


```
# Username for Postgres user is `postgres`
kubectl get secret/oneuptime-postgresql -o go-template='{{(index .data "postgres-password") | base64decode}}'
```

Important: Please ignore % in the end of the password output. 


```
# Username for Postgres user is `oneuptime`
kubectl get secret/oneuptime-postgresql -o go-template='{{(index .data "password") | base64decode}}'
```

Important: Please ignore % in the end of the password output. 


This will make the database accessible from the localhost:5432.


### Postgres Backup

Please make sure you have `pg_dump` and `pg_restore` installed on your local machine.

To take a backup of the database, use the following command:

```
# Source Database. This will prompt for the password
pg_dump --host=<source_port> --port=<target_port> --username=<source_username> --password --dbname=oneuptimedb --file=oneuptime.sql
```


To restore the database, use the following command:

```
# Target Database. This will prompt for the password
pg_restore --host=localhost --port=5432 --username=<target_username> --dbname=oneuptimedb --password --file=oneuptime.sql
```
