# Kubernetes Cheatsheet

### Cleanup

Delete Evited, Error or ContainerStatusUnknown, OOMKilled Pods

```bash
kubectl get pods --field-selector=status.phase=Failed | grep Evicted | awk '{print $1}' | xargs kubectl delete pod
kubectl get pods --field-selector=status.phase=Failed | grep Error | awk '{print $1}' | xargs kubectl delete pod
kubectl get pods --field-selector=status.phase=Failed | grep ContainerStatusUnknown | awk '{print $1}' | xargs kubectl delete pod
kubectl get pods --field-selector=status.phase=Failed | grep OOMKilled | awk '{print $1}' | xargs kubectl delete pod
```


## View Logs

```bash
kubectl logs -l app=oneuptime-app --all-containers=true -f --max-log-requests=100 > logs.txt
```
