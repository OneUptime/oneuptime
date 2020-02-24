# Setup Production Server

###  Run the production.yml file. 

run the file specific to the project with their specific names.
`kubectl create -f production.yml`

# Known Issues

### Issue 1

Sometimes you'll see this error

```
$ kubectl create -f staging.yaml        
error: SchemaError(io.k8s.api.apps.v1beta2.DeploymentCondition): invalid object doesn't have additional properties
```

**Solution:** 

Run the kubectl command with validate false

```
$ kubectl create -f staging.yaml --validate=false
```





