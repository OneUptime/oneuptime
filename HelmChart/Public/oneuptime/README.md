<!-- markdownlint-disable MD033 -->
<h1 align="center"><img alt="oneuptime logo" width=50% src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/public/img/OneUptimePNG/7.png"/></h1>
<!-- markdownlint-enable MD033 -->

# OneUptime Helm Chart

OneUptime is a comprehensive solution for monitoring and managing your online services. Whether you need to check the availability of your website, dashboard, API, or any other online resource, OneUptime can alert your team when downtime happens and keep your customers informed with a status page. OneUptime also helps you handle incidents, set up on-call rotations, run tests, secure your services, analyze logs, track performance, and debug errors.

[Overview of OneUptime](http://www.oneuptime.com)

## Install Helm Chart


#### Create values.yaml file.

Create a values.yaml file and change the host.

```yaml
host: <ip-address-or-domain-of-server>

# If hosted on non-ssl server then change this to http
httpProtocol: https 
```

#### Pick a Storage Class

Storage class are different for different cloud environemtns. Please pick the right one for your cloud environment.

To get a list of storage classes, run the following command:

```console
kubectl get storageclass
```

and add this to your values.yaml file

```yaml
global: 
  storageClass: "your-storage-class"
```


```console
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

## Uninstall Helm Chart

```console
helm uninstall my-release
```

## Configuration

The following table lists the configurable parameters of the OneUptime chart and their default values.

| Parameter | Description | Default | Change Required |
| --------- | ----------- | ------- | --------------- |
| `global.storageClass` | Storage class to be used for all persistent volumes | `nil` | 🚨 |
| `host` | Hostname for the ingress | `localhost` | 🚨 |
| `httpProtocol` | If the server is hosted with SSL/TLS cert then change this value to https | `http` | 🚨 |
| `global.clusterDomain` | Kubernetes Cluster Domain | `cluster.local` |  |
| `image.registry` | Docker image registry | `docker.io` |  |
| `image.repository` | Docker image repository | `oneuptime` | |
| `image.tag` | Docker image tag | `release` |
| `image.pullPolicy` | Docker image pull policy | `IfNotPresent` | |
| `image.restartPolicy` | Docker image restart policy | `Always` | |
| `autoScaling.enabled` | Enable autoscaling | `false` | |
| `autoScaling.minReplicas` | Minimum number of replicas | `1` | |
| `autoScaling.maxReplicas` | Maximum number of replicas | `100` | |
| `autoScaling.targetCPUUtilizationPercentage` | Target CPU utilization percentage | `80` | |
| `autoScaling.targetMemoryUtilizationPercentage` | Target memory utilization percentage | `80` | |
| `nodeEnvironment` | Node environment (please dont change this unless you're doing local development) | `production` | |
| `ingress.service.type` | Ingress service type | `LoadBalancer` | |
| `ingress.service.loadBalancerIP` | Ingress service load balancer IP | `nil` | |
| `deployment.replicaCount` | Number of replicas | `1` | |
| `probe.<key>.name` | Probe name | `<key>` | |
| `probe.<key>.description` | Probe description | `nil` | |
| `probe.<key>.monitoringWorkers` | Number of threads / parallel processes you need to monitor your resources | `3` | |
| `probe.<key>.monitorFetchLimit` | Number of resources to be monitored in parallel | `10` | |
| `statusPage.cnameRecord` | CNAME record for the status page | `nil` | |
| `internalSmtp.sendingDomain` | Domain to send emails from  | `nil` |  |
| `internalSmtp.dkimPrivateKey` | DKIM Private Key that is set for sending domain | `nil` |  |
| `internalSmtp.dkimPublicKey` | DKIM Public Key that is set for sending domain | `nil` |  |
| `internalSmtp.email` | Email address to send emails from | `nil` |  |
| `internalSmtp.name` | Name to send emails from | `nil` |  |
| `incidents.disableAutomaticCreation` | Disable incident creation (use this when your team is overloaded with incidents or in emergencies) | `false` |  |


### Security Context

The Security Context section allows you to configure security settings for the OneUptime chart.

| Parameter | Description | Default |
| --------- | ----------- | ------- |
| `securityContext.enabled` | Enable security context | `false` |
| `securityContext.runAsUser` | User ID to run as |  |
| `securityContext.runAsGroup` | Group ID to run as | |
| `securityContext.fsGroup` | Group ID that owns the pod's volumes |  |

## Adding a Custom Domain to your Status Page

**Step 1: Add a CNAME record to your DNS settings**

If you would like to add a custom domain to your status page (something like status.yourcompany.com), you can do so by adding a CNAME record to your DNS settings. 

```
DNS Record Type: CNAME
Host: status.yourcomapny.com
Value: <your-oneuptime-host>
```

Please make sure oneuptime is hosted on a server which is publicly accessible.

**Step 2: Add Custom Domain to your Project**

Please go to your project settings and add the custom domain to your project. You can find the project settings by clicking "More" in the nav bar and by clicking "Project Settings". Please go to "Custom Domain" page and add your custom domain there. You will need to verify the domain. You can find the verification code in the "Custom Domain" page in your project settings. 


**Step 3: Add custom domain to your status page.**

Please go to your status page settings and add the custom domain to your status page. You can find the status page settings by clicking on "View Status Page" in "Status Pages" page. You can add the custom domain in the "Custom Domain" page in your status page settings. 

Once you have added the custom domain, you can access your status page using the custom domain.

## Chart Dependencies

We use these charts as dependencies. You dont need to install them separately. Please read the readme for these individual charts to understand the configuration options.

| Chart | Description | Repository | 
| ----- | ----------- | ---------- | 
| `postgresql` | PostgreSQL database | https://charts.bitnami.com/bitnami |
| `redis` | Redis database | https://charts.bitnami.com/bitnami |
| `clickhouse` | Clickhouse database | https://charts.bitnami.com/bitnami |

## Contributing

We <3 contributions big and small. 
https://github.com/OneUptime/helm-chart is the read only release repository. Please direct your contributions here: https://github.com/OneUptime/oneuptime