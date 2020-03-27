# Important helm commands.

Please run these commands from `root`

### Lint chart

```
helm lint ./helm-chart/public/fyipe 
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

### Uninstall and Install the chart
```
helm uninstall fi
```

### Docker build and push to docker repo with `:test` tag
```
chmod +x ./ci/scripts/docker-build.sh
sudo ./ci/scripts/docker-build.sh
```

### Package and deploy helm chart
```
helm repo index ./helm-chart/public/fyipe
helm package ./helm-chart/public/fyipe
helm repo index ./helm-chart/public
```

### Docker Images
Docker Images are hosted at: https://hub.docker.com/orgs/fyipeproject/repositories and are public.