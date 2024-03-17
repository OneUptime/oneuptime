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
# Source Database
pg_dump -h localhost -p 5432 -U <source_username> -d oneuptimedb -f oneuptime.sql
```