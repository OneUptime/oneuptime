### Cache (Valkey) Ops

The cache and queue tier runs [Valkey](https://valkey.io), the BSD-licensed fork
of Redis 7.2. Its objects were named `redis` until 12.0.36; a release upgraded
across that boundary keeps a `<release>-redis` Secret behind, holding a
now-unused copy of the same password. It is safe to delete once the upgrade has
stuck.

Get the cache password

```bash
echo $(kubectl get secret --namespace "default" oneuptime-valkey -o jsonpath="{.data.valkey-password}" | base64 -d)
```

Please ignore % in the end of the password output.

Open a shell against it

```bash
kubectl exec -it --namespace "default" oneuptime-valkey-0 -- valkey-cli -a "$(kubectl get secret --namespace "default" oneuptime-valkey -o jsonpath="{.data.valkey-password}" | base64 -d)"
```
