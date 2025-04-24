### Postgres Ops

To access postgres use port forwarding in kubernetes

```
kubectl port-forward --address 0.0.0.0 service/oneuptime-postgresql 5432:5432
```

then you should be able to access from the localhost and port 5432

You also need to read postgres password which is stored in kubenretes secrets. You can decode the password by using this command: 


```
# Username for Postgres user is `postgres`
echo $(kubectl get secret --namespace "default" oneuptime-postgresql -o jsonpath="{.data.postgres-password}" | base64 -d)
```

Important: Please ignore % in the end of the password output. 


```
# Username for Postgres user is `oneuptime`
echo $(kubectl get secret --namespace "default" oneuptime-postgresql -o jsonpath="{.data.password}" | base64 -d)
```

Important: Please ignore % in the end of the password output. 


This will make the database accessible from the localhost:5432.


### Postgres Backup

Please fill the values in config.env file and run the following command to take the backup of the database.

```
bash ./backup.sh
```

### Postgres Restore

Please fill the values in config.env file and run the following command to restore the database.

```
bash ./restore.sh
```

### Create Read Only User in Postgres (This can be used for reporting purpose like Metabase)

```
CREATE ROLE readonlyuser WITH LOGIN PASSWORD '<password>'
GRANT pg_read_all_data TO readonlyuser;
```


### Increasing max_connections for postgres. 

To see the current number of max_connections. You need to run the following command in psql.

```
SHOW max_connections;
```

To increase the max_connections, you need to run this sql command in psql.


```
ALTER SYSTEM SET max_connections = 200;
```

Then you need to restart the postgres pod. 

