### Redis Ops

Get Redis Password

```bash
kubectl get secret/oneuptime-redis -o go-template='{{(index .data "redis-password") | base64decode}}'
```

Please ignore % in the end of the password output.

