# Helm Chart for OneUptime

## Introduction

This chart bootstraps a [OneUptime](https://oneuptime.com) deployment on a [Kubernetes](http://kubernetes.io) cluster using the [Helm](https://helm.sh) package manager.

## Prerequisites

- Kubernetes 1.12+
- Helm 3.0+

## Installing the Chart

To install the chart with the release name `oneuptime-release`:

```bash
$ helm repo add oneuptime https://oneuptime.com/helm-charts
$ helm install oneuptime-release oneuptime/oneuptime
```

These commands deploy OneUptime on the Kubernetes cluster in the default configuration. The [Parameters](#parameters) section lists the parameters that can be configured during installation.

> **Tip**: List all releases using `helm list`

## Uninstalling the Chart

To uninstall/delete the `oneuptime-release` deployment:

```bash
$ helm delete oneuptime-release
```

The command removes all the Kubernetes components associated with the chart and deletes the release.

## Parameters

The following table lists the configurable parameters of the OneUptime chart and their default values.

| Parameter | Description | Default |
| --------- | ----------- | ------- |
| `image.repository` | OneUptime image repository | `oneuptime/oneuptime` |
| `image.tag` | OneUptime image tag | `latest` |
| `image.pullPolicy` | OneUptime image pull policy | `IfNotPresent` |
| `imagePullSecrets` | Specify image pull secrets | `[]` |
| `nameOverride` | String to partially override oneuptime.fullname template with a string (will prepend the release name) | `""` |
| `fullnameOverride` | String to fully override oneuptime.fullname template with a string | `""` |
| `serviceAccount.create` | Specifies whether a ServiceAccount should be created | `true` |
| `serviceAccount.annotations` | Annotations to add to the ServiceAccount | `{}` |
| `serviceAccount.name` | The name of the ServiceAccount to use. If not set and create is true, a name is generated using the fullname template | `""` |
| `podAnnotations` | Annotations to add to the OneUptime pod | `{}` |
| `podSecurityContext` | OneUptime pod [security context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) | `{}` |
| `securityContext` | OneUptime containers [security context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) | `{}` |
| `service.type` | Kubernetes Service type | `ClusterIP` |
| `service.port` | OneUptime service port | `80` |
| `service.annotations` | Annotations for OneUptime service | `{}` |
| `ingress.enabled` | Enable ingress controller resource | `false` |
| `ingress.annotations` | Ingress annotations | `{}` |
| `ingress.hosts` | Ingress hostnames | `[]` |
| `ingress.tls` | Ingress TLS configuration | `[]` |
| `resources` | CPU/Memory resource requests/limits | `{}` |
| `nodeSelector` | Node labels for pod assignment | `{}` |
| `tolerations` | Toleration labels for pod assignment | `[]` |
| `affinity` | Affinity settings for pod assignment | `{}` |
| `env` | Environment variables for OneUptime container | `[]` |
| `envFrom` | Environment variables from secrets or configmaps | `[]` |
| `config` | OneUptime configuration | `{}` |
| `configSecret` | Name of the secret containing OneUptime configuration | `""` |
| `configSecretMountPath` | Mount path of the secret containing OneUptime configuration | `"/etc/oneuptime/config"` |
| `configSecretSubPath` | Sub path of the secret containing OneUptime configuration | `""` |



Specify each parameter using the `--set key=value[,key=value]` argument to `helm install`. For example,

```bash
$ helm install oneuptime-release \
  --set service.type=LoadBalancer \
    oneuptime/oneuptime
```

The above command sets the OneUptime service type to `LoadBalancer`.

Alternatively, a YAML file that specifies the values for the above parameters can be provided while installing the chart. For example,

```bash
$ helm install oneuptime-release -f values.yaml oneuptime/oneuptime
```

> **Tip**: You can use the default [values.yaml](values.yaml)

## Configuration and installation details

### Configuration

The following table lists the configurable parameters of the OneUptime chart and their default values.

| Parameter | Description | Default |
| --------- | ----------- | ------- |
| `config` | OneUptime configuration | `{}` |
| `configSecret` | Name of the secret containing OneUptime configuration | `""` |
| `configSecretMountPath` | Mount path of the secret containing OneUptime configuration | `"/etc/oneuptime/config"` |
| `configSecretSubPath` | Sub path of the secret containing OneUptime configuration | `""` |


### Installation

#### Using Helm repository

```bash

$ helm repo add oneuptime https://oneuptime.github.io/helm-charts
$ helm install oneuptime-release oneuptime/oneuptime
```

#### Using source code

```bash
$ git clone https://github.com/OneUptime/oneuptime
$ cd HelmChart/public/oneuptime
$ helm install oneuptime-release .
```

## Persistence

The [OneUptime](https://oneuptime.com) image stores the OneUptime data and configurations at the `/etc/oneuptime` path of the container.

By default a PersistentVolumeClaim is created and mounted into that directory. In order to disable this functionality you can change the values.yaml to disable persistence.

```bash
$ helm install oneuptime-release \
  --set persistence.enabled=false \
    oneuptime/oneuptime
```


## Contributing

We'd love to have you contribute! Feel free to [submit issues](https://github.com/oneuptime/oneuptime/issues) or pull requests on Github.