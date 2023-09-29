### Installation

Test Install: 

```
helm install oneuptime ./HelmChart/Public/oneuptime -f ./HelmChart/Public/oneuptime/values.yaml -f ./HelmChart/Values/test.values.yaml
```

Prod Install: 

```
helm install oneuptime ./HelmChart/Public/oneuptime -f ./HelmChart/Public/oneuptime/values.yaml -f ./HelmChart/Values/prod.values.yaml
```

### Upgrade

Test Upgrade: 

```
helm upgrade oneuptime ./HelmChart/Public/oneuptime -f ./HelmChart/Public/oneuptime/values.yaml  -f ./HelmChart/Values/test.values.yaml
```

Prod Upgrade: 

```
helm upgrade oneuptime ./HelmChart/Public/oneuptime -f ./HelmChart/Public/oneuptime/values.yaml -f ./HelmChart/Values/prod.values.yaml
```

### Remove

```
helm uninstall oneuptime 
```

### Lint 

```
helm lint ./HelmChart/Public/oneuptime
```


### Run tests

```
helm test oneuptime
```