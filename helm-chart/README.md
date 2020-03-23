# Important helm commands.

Please run these commands from `root`

### Lint chart

```
helm lint ./helm-chart/public/fyipe 
```

### Uninstall and Install the chart
```
helm uninstall fi
```

### Install as an Enterprise Cluster with default values
```
helm install fi ./helm-chart/public/fyipe 
```

### Install on staging
```
helm install -f ./kubernetes/values-saas-staging.yaml fi ./helm-chart/public/fyipe 
```

### Install on production
```
helm install -f ./kubernetes/values-saas-production.yaml fi ./helm-chart/public/fyipe 
```

### Docker build and push to docker repo with `:test` tag
```
chmod +x ./kubernetes/ci/docker-build.sh
sudo ./kubernetes/ci/docker-build.sh
```