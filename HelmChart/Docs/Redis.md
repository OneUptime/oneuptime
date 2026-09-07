### Redis (Valkey) Ops

The in-cluster container runs the Valkey image, but the release's object and
secret names still use `redis`.

Get Redis Password

```bash
echo $(kubectl get secret --namespace "default" oneuptime-redis -o jsonpath="{.data.redis-password}" | base64 -d)
```

Please ignore % in the end of the password output.
