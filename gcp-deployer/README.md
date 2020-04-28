# Deploy the deployer to Google Cloud docker Registry (GCR)

Run:

```
gcloud auth configure-docker #to auth GCR registry and then,
bash gcp-deployer/deploy.sh #from `app` (root) directory.
```

```
kubectl apply -f "https://raw.githubusercontent.com/GoogleCloudPlatform/marketplace-k8s-app-tools/master/crd/app-crd.yaml"

mpdev install \
  --deployer=gcr.io/fyipe-public/fyipe/deployer@sha256:86c9451396e7fce86ad381e08adc43c9d34477e0e95bd063e9460e316f904cae \
  --parameters='{"name": "fyipe", "namespace": "default"}'

mpdev verify \
  --deployer=gcr.io/fyipe-public/fyipe/deployer:3.0
```

```
kubectl delete all --all
```