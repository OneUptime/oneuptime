### Redis Ops

Get Redis Password

```bash
echo $(kubectl get secret --namespace "default" oneuptime-redis -o jsonpath="{.data.redis-password}" | base64 -d)
```

Please ignore % in the end of the password output.

