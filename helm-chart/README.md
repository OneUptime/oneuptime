# Important helm commands.

Please run these commands from `root`

### Lint chart

```
helm lint ./helm-chart/public/fyipe 
```

### Uninstall and Install the chart
```
helm uninstall fi
sleep 30s
helm install fi ./helm-chart/public/fyipe 
```

### Docker build and push to docker repo
```
chmod +x ./kubernetes/ci/docker-build.sh
sudo ./kubernetes/ci/docker-build.sh
```