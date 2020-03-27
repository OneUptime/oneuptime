# Fyipe

Fyipe is one complete DevOps and IT Ops platform. 

Fyipe lets you do: 

**Monitoring:** Monitors your website, web apps, APIs, servers and more and give you detailed metrics of things that might be wrong with your infrastructure. 

**Status Page:** Fyipe gives you a beautiful and customizable status page for your online business which helps improve transparency with your customers and cuts support costs.

**Tests:** Write automated tests for your website, API's and more and know instantly when they start failing. 

**On-Call and Incident Management:** On-Call Management lets you alert the right team at the right time saving you critical time during downtime.

**Performance Monitoring:** Monitor the performance of your apps, servers, APIs, and more and alert your team when any of your performance metrics degrades.

**Website:** https://fyipe.com

## TL;DR;

```console
helm repo add bitnami https://charts.fyipe.com/fyipe
helm install fi fyipe
```

## Introduction

This chart bootstraps a [Fyipe](https://fyipe.com) deployment on a [Kubernetes](http://kubernetes.io) cluster using the [Helm](https://helm.sh) package manager.

## Prerequisites

- Kubernetes 1.12+
- Helm 2.11+ or Helm 3.0-beta3+
- PV provisioner support in the underlying infrastructure
- ReadWriteMany volumes for deployment scaling

## Installing the Chart

To install the chart with the release name `fyipe-app`:

```console
helm repo add bitnami https://charts.fyipe.com/fyipe
helm install fyipe-app fyipe
```

The command deploys Fyipe on the Kubernetes cluster in the default configuration. The [Parameters](#parameters) section lists the parameters that can be configured during installation.


## Uninstalling the Chart

To uninstall/delete the `fyipe-app` deployment:

```console
helm delete fyipe-app
```

The command removes all the Kubernetes components associated with the chart and deletes the release.

## Parameters

The following table lists the configurable parameters of the Fyipe chart and their default values per section/component:

### Global parameters

| Parameter                 | Description                                     | Default                                                 |
|---------------------------|-------------------------------------------------|---------------------------------------------------------|
| `global.imageRegistry`    | Global Docker image registry                    | `nil`                                                   |
| `global.storageClass`     | Global storage class for dynamic provisioning   | `nil`                                                   |


### Common parameters

| Parameter                 | Description                                     | Default                                                 |
|---------------------------|-------------------------------------------------|---------------------------------------------------------|
| `nameOverride`            | String to partially override fyipe.fullname | `nil`                                                   |
| `fullnameOverride`        | String to fully override fyipe.fullname     | `nil`                                                   |
| `clusterDomain`           | Default Kubernetes cluster domain               | `cluster.local`                                         |



Specify each parameter using the `--set key=value[,key=value]` argument to `helm install`. For example,

```console
helm install fyipe-app \
  --set global.imageRegistry=docker.io \
    fyipe
```

## Configuration and installation details

### [Rolling VS Immutable tags]

It is strongly recommended to use images tagged with `latest`. Fyipe automatically takes care of data migration if image with tag `latest` changes. 

## Persistence

Persistent Volume Claims are used to keep the data across deployments. This is known to work in GCE, AWS, Azure, and minikube.
See the [Parameters](#parameters) section to configure the PVC or to disable persistence.

## Support

If you need any help with deployments, please reach out to our engineering support team at support@fyipe.com and we'll get back to you in less than 1 business day. 

