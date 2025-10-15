# Kubernetes Cheatsheet

### Cleanup

Delete Evited, Error or ContainerStatusUnknown Pods

```bash
kubectl get pods --field-selector=status.phase=Failed | grep Evicted | awk '{print $1}' | xargs kubectl delete pod
kubectl get pods --field-selector=status.phase=Failed | grep Error | awk '{print $1}' | xargs kubectl delete pod
kubectl get pods --field-selector=status.phase=Failed | grep ContainerStatusUnknown | awk '{print $1}' | xargs kubectl delete pod
```