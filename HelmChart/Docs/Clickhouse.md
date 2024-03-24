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