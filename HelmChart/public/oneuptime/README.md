# OneUptime

OneUptime is one complete Observability platform. 

OneUptime lets you do: 

**Monitoring:** Monitors your website, web apps, APIs, servers and more and give you detailed metrics of things that might be wrong with your infrastructure. 

**Status Page:** OneUptime gives you a beautiful and customizable status page for your online business which helps improve transparency with your customers and cuts support costs.

**Tests:** Write automated tests for your website, API's and more and know instantly when they start failing. 

**On-Call and Incident Management:** On-Call Management lets you alert the right team at the right time saving you critical time during downtime.

**Performance Monitoring:** Monitor the performance of your apps, servers, APIs, and more and alert your team when any of your performance metrics degrades.

**Website:** https://oneuptime.com

## TL;DR;

```console
helm repo add oneuptime https://oneuptime.com/chart
helm repo update
helm install oneuptime oneuptime/OneUptime
```

Note: `oneuptime` is your release name. 

## Introduction

This chart bootstraps a [OneUptime](https://oneuptime.com) deployment on a [Kubernetes](http://kubernetes.io) cluster using the [Helm](https://helm.sh) package manager.

## Prerequisites

- Kubernetes 1.12+
- Helm 2.11+ or Helm 3.0-beta3+
- PV provisioner support in the underlying infrastructure
- ReadWriteMany volumes for deployment scaling

## Setup SMTP Server (Optional)

By default, oneuptime will ship with it's own default credential configuration for smtp server.

### Setup Private Key

```
# generate private key
openssl genrsa -out private 2048

# Encode it to base64 and export it
export DKIM_PRIVATE_KEY=$(cat private | base64)

```

> If you already have a private key, you can point the export command to it, and export as base64 encoded

### Setup DKIM on DNS TXT Record

```

# This is the private key created in the above step.
chmod 0400 private

openssl rsa -in private -out public -pubout

# value of DKIM DNS record should be...
echo "v=DKIM1;p=$(grep -v '^-' public | tr -d '\n')"

```

> When setting up the DKIM dns txt record (recommended), the selector should be `oneuptime._domainkey` then the value should be the output of the echo command

### Setup DMARC and SPF DNS TXT Record (Optional)

To setup dmarc for the smtp server, you need to create a new dns record with the following values

| Type                 | Name                                     | Content                                                 |
|----------------------|------------------------------------------|---------------------------------------------------------|
| TXT            | _dmarc | v=DMARC1; p=reject; adkim=s; aspf=r; rua=mailto:youremail; ruf=mailto:youremail; pct=100 |

> For SPF dns record, you need to setup with appropriate values, if the ip of the smtp mail server is static, you can add that to the spf ip list

### Setup tls Keys

```
# Unix machine


# generate tls_cert.pem and tls_key.pem
# this command will open a prompt for you to fill in your details

openssl req -x509 -nodes -days 2190 -newkey rsa:2048 -keyout tls_key.pem -out tls_cert.pem

# Encode your tls to base64 and export it

export TLS_KEY=$(cat tls_key.pem | base64)
export TLS_CERT=$(cat tls_cert.pem | base64)

# DOMAIN should equal your domain

export DOMAIN=$DOMAIN

```

> If you already have tls_key and tls_cert for your domain, you can point the export command to the tls files to generate base64 encoded value

## Installing the Chart

To install the chart with the release name `oneuptime`:

```console
helm repo add oneuptime https://oneuptime.com/chart
helm repo update
helm install oneuptime --set encryptionKey=ThisEncryptionKeyLengthIs32Size. oneuptime/OneUptime
```

The command deploys OneUptime on the Kubernetes cluster in the default configuration. The [Parameters](#parameters) section lists the parameters that can be configured during installation.

Please Note: Encyption Key should be 32 lenth in size. Please change it to any random string you like. you need to keep the encryption key safe, ideally in an encrypted vault.

## Uninstalling the Chart

To uninstall/delete the `oneuptime` deployment:

```console
helm uninstall oneuptime
```

The command removes all the Kubernetes components associated with the chart and deletes the release.

## Parameters

The following table lists the configurable parameters of the OneUptime chart and their default values per section/component:


### OneUptime parameters (optional)

You can add multiple hosts for the oneuptime service. It's in this format: 

```
oneuptime:
  hosts:
    host1: 
      host: 
      tls:
        enabled: false
        crt: 
        key: 
```

| Parameter                 | Description                                     | Default                                                 |
|---------------------------|-------------------------------------------------|---------------------------------------------------------|
| `oneuptime.host`            | Hostname where you want to run oneuptime on | `*`                                                   |
| `oneuptime.tls.enabled`        | Enable HTTPS  | `false`                                                   |
| `oneuptime.tls.crt`        | Certificale in Base64 format  | `nil`                                                   |
| `oneuptime.tls.key`        | Key in Base64 format  | `nil`                                                   |


### Status Page parameters (optional)

You can add multiple hosts for the status page. It's in this format: 

```
statusPage:
  hosts:
    host1: 
      host: 
      tls:
        enabled: false
        crt: 
        key: 
```

**Important:** If you want to run status pages on your subdomain (like status.yourcompany.com). You need to provide OneUptime Host (Yes, `oneuptime.hosts.host1.host` param, NOT `statusPage.hosts.host1.host`). If you specify `statusPage.hosts.host1.host`. Status page will work for that particular host and not for multiple hosts. 

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

Enable this if you want IP based rate limitting for OneUptime API.

| Parameter                 | Description                                     | Default                                                 |
|---------------------------|-------------------------------------------------|---------------------------------------------------------|
| `rateLimitter.enabled`            | Enable API rate limitter | `false`                                                   |
| `rateLimitter.requestLimit`        | Limit of requests in a particular time window (see below)  | `5000`                                                   |
| `rateLimitterrequestLimitTimePeriodInMS`        |  Rate Limitter window in MS  | `216000`                                                   |

## OneUptime Images [advanced] (optional)

OneUptime Images are loaded from DockerHub by default. Images are public and by default `latest` images are downloaded. We recommend following this tag. OneUptime will handle all the data migration and changes.

```
image:
  registry: docker.io # Docker Registry where to pull images from.
  repository: oneuptime # OneUptime docker repository.
  tag: latest # We recommend `latest` tag.
  pullPolicy: Always # We recommend Always
  restartPolicy: Always # We recommend Always
```

## Replicas

OneUptime by default will start all containers as `1` repicas. To increase replicaCount set

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
  mongodbUsername: oneuptime
  mongodbPassword: password
  mongodbDatabase: oneuptimedb
  replicaSet:
    enabled: true
    name: rs0
    useHostnames: true
    key: mongodboneuptime
    secondary: 1
    arbiter: 1
  persistence:
    enabled: true
    mountPath: /bitnami/mongodb
    size: 20Gi
  useStatefulSet: true
```

If you want to expose MongoDB out to the internet, run `install` or `upgrade` with --set mongodb.ingress.enabled=true. You'll see an ingress service for mongodb created with which you can access mongodb data on your cluster.

## Microk8s

If you want to install OneUptime on a VM. Add these lines to `sudo crontab -e`

```
# Run this on Reboot. 
@reboot sudo curl https://oneuptime.com/chart/install.sh | sudo bash

# Run this once every 24 hours. 
0 0 * * * sudo curl https://oneuptime.com/chart/install.sh | sudo bash
```

Reboot the machine and wait for 15 mins.


## Modifying default params

Specify each parameter using the `--set key=value[,key=value]` argument to `helm install`. For example,

```console
helm install oneuptime \
  --set global.imageRegistry=docker.io \
    oneuptime
```

## Configuration and installation details

### [Rolling VS Immutable tags]

It is strongly recommended to use images tagged with `latest`. OneUptime automatically takes care of data migration if image with tag `latest` updates. 

## Persistence

Bitnami MongoDB, Redis charts are used as dependencies which takes care of persistence across cloud platforms. 

Persistent Volume Claims are used to keep the data across deployments. This is known to work in GCE, AWS, Azure, and minikube. 

## Update

To update cluster with new version of OneUptime. Please run: 

```
VERSION=$(curl https://oneuptime.com/api/version | jq '.server' | tr -d '"')
kubectl delete job oneuptime-InitScript || echo "InitScript already deleted"
helm upgrade --reuse-values oneuptime oneuptime/OneUptime \
        --set image.tag=$VERSION
```

OneUptime automatically takes care of data migration. 

## Things to note

 - If you do not specify TLS config, we will self-sign a certificate for you.
You can also use Cloudflare Universal SSL and run OneUptime service on Port 80 (when you're evaluating. NOT recommended for production)

## Support

If you need any help with deployments, please reach out to our engineering support team at support@oneuptime.com and we'll get back to you in less than 1 business day. 

## License

The project will be deployed on Evaluation License by default. For a commercial license, please reach out to sales@oneuptime.com. 

If you already have a commercial license. Please enter the license key on your dashboard (after you log in to OneUptime)

