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


### Postgres Ops

To access postgres use port forwarding in kubenrtes

```
kubectl port-forward --address 0.0.0.0 service/oneuptime-postgresql 5432:5432
```

then you should be able to access from the server IP and port 5432

You also need to read postgres password which is stored in kubenretes secrets. You can decode the password by using this command: 

```
kubectl get secret/oneuptime-postgresql -o go-template='{{.data.password|base64decode}}'
```