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

Note: `fi` is your release name. 

## Introduction

This chart bootstraps a [Fyipe](https://fyipe.com) deployment on a [Kubernetes](http://kubernetes.io) cluster using the [Helm](https://helm.sh) package manager.

## Prerequisites

- Kubernetes 1.12+
- Helm 2.11+ or Helm 3.0-beta3+
- PV provisioner support in the underlying infrastructure
- ReadWriteMany volumes for deployment scaling

## Installing the Chart

To install the chart with the release name `fi`:

```console
helm repo add fyipe https://fyipe.com/charts
helm install fi fyipe
```

The command deploys Fyipe on the Kubernetes cluster in the default configuration. The [Parameters](#parameters) section lists the parameters that can be configured during installation.


## Uninstalling the Chart

To uninstall/delete the `fi` deployment:

```console
helm delete fi
```

The command removes all the Kubernetes components associated with the chart and deletes the release.

## Parameters

The following table lists the configurable parameters of the Fyipe chart and their default values per section/component:


### Fyipe parameters (optional)

| Parameter                 | Description                                     | Default                                                 |
|---------------------------|-------------------------------------------------|---------------------------------------------------------|
| `fyipe.host`            | Hostname where you want to run fyipe on | `*`                                                   |
| `fyipe.tls.enabled`        | Enable HTTPS  | `false`                                                   |
| `fyipe.tls.crt`        | Certificale in Base64 format  | `nil`                                                   |
| `fyipe.tls.key`        | Key in Base64 format  | `nil`                                                   |


### Status Page parameters (optional)

**Important:** If you want to run status pages on your subdomain (like status.yourcompany.com). You need to provide Fyipe Host (Yes, `fyipe.host` param, NOT `statusPage.host`). If you specify `statusPage.host`. Status page will work for that particular host and not for multiple hosts. 

| Parameter                 | Description                                     | Default                                                 |
|---------------------------|-------------------------------------------------|---------------------------------------------------------|
| `statusPage.enabled`            | Enable Status Page Ingress | `true`
| `statusPage.host`            | Hostname where you want to run your Status Page on, for multiple hosts / status page you leave this blank | `*`                                                   |
| `statusPage.tls.enabled`        | Enable HTTPS  | `false`                                                   |
| `statusPage.tls.crt`        | Certificale in Base64 format  | `nil`                                                   |
| `statusPage.tls.key`        | Key in Base64 format  | `nil`                                                   |


### Probe parameters [advanced] (optional)

**What are probes?**
Probes are agents / workers / cron-jobs that monitor your websites at every X interval (default: 1 min. You can change that in dashboard when you create a new website to montor). They not just monitor websites, but also other resources like IoT devices, API's and more. Anything that needs to be monitored by an agent will be monitored by probe. 

You can create any number of probes here. By default, we create two probes, but you can increase or decrease the count.

| Parameter                 | Description                                     | Default                                                 |
|---------------------------|-------------------------------------------------|---------------------------------------------------------|
| `probes.probe1.port`            | Port for probe 1 (specify any unused port) | `*`                                                   |
| `probes.probe1.name`        | Name of the Probe  | `Probe 1`                                                   |
| `probes.probe1.key`        | Any random key  | `sample-key`                                                   |
| `probes.probe1.servicePort`        | Port to make the probe ping from outside world  | `80`                                                   |

You can add any number of probe by specifying `probes.probe<N>.<port | name | key | servicePort>` to your values.yaml.

### Rate Limitter parameters [advanced] (optional)

Enable this if you want IP based rate limitting for Fyipe API.

| Parameter                 | Description                                     | Default                                                 |
|---------------------------|-------------------------------------------------|---------------------------------------------------------|
| `rateLimitter.enabled`            | Enable API rate limitter | `false`                                                   |
| `rateLimitter.requestLimit`        | Limit of requests in a particular time window (see below)  | `5000`                                                   |
| `rateLimitterrequestLimitTimePeriodInMS`        |  Rate Limitter window in MS  | `216000`                                                   |

## Fyipe Images [advanced] (optional)

Fyipe Images are loaded from DockerHub by default. Images are public and by default `latest` images are downloaded. We recommend following this tag. Fyipe will handle all the data migration and changes.

```
image:
  registry: docker.io # Docker Registry where to pull images from.
  repository: fyipeproject # Fyipe docker repository.
  tag: latest # We recommend `latest` tag.
  pullPolicy: Always # We recommend Always
  restartPolicy: Always # We recommend Always
```

## Replicas

Fyipe by default will start all containers as `1` repicas. To increase replicaCount set

`replicaCount: <number>`

## MongoDB Values

This is taken from Bitnami Helm Chart. Please refer to https://bitnami.com/stack/mongodb/helm

Here are default values: 

```
redis: 
  redisPort: 6379
  image:
    registry: docker.io
    repository: bitnami/redis
    tag: latest
    pullPolicy: Always
  usePassword: false
  persistence:
    enabled: true
    mountPath: /bitnami/mongodb
    size: 20Gi
```


## Redis Values

This is taken from Bitnami Helm Chart. Please refer to https://bitnami.com/stack/redis/helm

Here are default values: 

```
mongodb: 
  image:
    registry: docker.io
    repository: bitnami/mongodb
    tag: latest
    pullPolicy: Always
  mongodbRootPassword: root
  mongodbUsername: fyipe
  mongodbPassword: password
  mongodbDatabase: fyipedb
  replicaSet:
    enabled: true
    name: rs0
    useHostnames: true
    key: mongodbfyipe
    secondary: 1
    arbiter: 1
  persistence:
    enabled: true
    mountPath: /bitnami/mongodb
    size: 20Gi
  useStatefulSet: true
```

## Minikube

`service.type` 
For minikube, set this to NodePort, elsewhere use ClusterIP


## Modifying default params

Specify each parameter using the `--set key=value[,key=value]` argument to `helm install`. For example,

```console
helm install fi \
  --set global.imageRegistry=docker.io \
    fyipe
```

## Configuration and installation details

### [Rolling VS Immutable tags]

It is strongly recommended to use images tagged with `latest`. Fyipe automatically takes care of data migration if image with tag `latest` updates. 

## Persistence

Bitnami MongoDB, Redis charts are used as dependencies which takes care of persistence across cloud platforms. 

Persistent Volume Claims are used to keep the data across deployments. This is known to work in GCE, AWS, Azure, and minikube. 

## Things to note

 - If you do not specify TLS config, we will self-sign a certificate for you.
You can also use Cloudflare Universal SSL and run Fyipe service on Port 80 (when you're evaluating. NOT recommended for production)

## Support

If you need any help with deployments, please reach out to our engineering support team at support@fyipe.com and we'll get back to you in less than 1 business day. 

## License

For a commercial license, please reach out to sales@fyipe.com. 

