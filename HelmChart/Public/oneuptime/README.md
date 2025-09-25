<!-- markdownlint-disable MD033 -->
<h1 align="center"><img alt="oneuptime logo" width=50% src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/></h1>
<!-- markdownlint-enable MD033 -->

# OneUptime Helm Chart

OneUptime is a comprehensive solution for monitoring and managing your online services. Whether you need to check the availability of your website, dashboard, API, or any other online resource, OneUptime can alert your team when downtime happens and keep your customers informed with a status page. OneUptime also helps you handle incidents, set up on-call rotations, run tests, secure your services, analyze logs, track performance, and debug errors.

[Overview of OneUptime](http://www.oneuptime.com)


## Yotube Tutorial

https://youtu.be/Ho5WyPHExTU

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


## Upgrade Helm Chart

```console

# Update the chart repo 
helm repo update

# Upgrade the helm chart
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

## Uninstall OneUptime 

To uninstall/delete the `my-oneuptime` deployment:

```console
helm uninstall my-oneuptime
```

## Configuration

The following table lists the configurable parameters of the OneUptime chart and their default values.

| Parameter                                         | Description                                                                                                                                                                            | Default         | Change Required |
|---------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------|-----------------|
| `global.storageClass`                             | Storage class to be used for all persistent volumes                                                                                                                                    | `nil`           | 🚨              |
| `host`                                            | Hostname for the ingress                                                                                                                                                               | `localhost`     | 🚨              |
| `httpProtocol`                                    | If the server is hosted with SSL/TLS cert then change this value to https                                                                                                              | `http`          | 🚨              |
| `oneuptimeSecret`                                 | Value used to define ONEUPTIME_SECRET                                                                                                                                                  | `nil`           |                 |
| `encryptionSecret`                                | Value used to define ENCRYPTION_SECRET                                                                                                                                                 | `nil`           |                 |
| `global.clusterDomain`                            | Kubernetes Cluster Domain                                                                                                                                                              | `cluster.local` |                 |
| `image.registry`                                  | Docker image registry                                                                                                                                                                  | `docker.io`     |                 |
| `image.repository`                                | Docker image repository                                                                                                                                                                | `oneuptime`     |                 |
| `image.tag`                                       | Docker image tag                                                                                                                                                                       | `release`       |
| `image.pullPolicy`                                | Docker image pull policy                                                                                                                                                               | `IfNotPresent`  |                 |
| `image.restartPolicy`                             | Docker image restart policy                                                                                                                                                            | `Always`        |                 |
| `autoscaling.enabled`                             | Enable autoscaling                                                                                                                                                                     | `false`         |                 |
| `autoscaling.minReplicas`                         | Minimum number of replicas                                                                                                                                                             | `1`             |                 |
| `autoscaling.maxReplicas`                         | Maximum number of replicas                                                                                                                                                             | `100`           |                 |
| `autoscaling.targetCPUUtilizationPercentage`      | Target CPU utilization percentage                                                                                                                                                      | `80`            |                 |
| `autoscaling.targetMemoryUtilizationPercentage`   | Target memory utilization percentage                                                                                                                                                   | `80`            |                 |
| `nodeEnvironment`                                 | Node environment (please dont change this unless you're doing local development)                                                                                                       | `production`    |                 |
| `nginx.service.type`                              | nginx service type                                                                                                                                                                     | `LoadBalancer`  |                 |
| `nginx.service.loadBalancerIP`                    | nginx service load balancer IP                                                                                                                                                         | `nil`           |                 |
| `deployment.replicaCount`                         | Number of replicas                                                                                                                                                                     | `1`             |                 |
| `probes.<key>.name`                               | Probe name                                                                                                                                                                             | `<key>`         |                 |
| `probes.<key>.description`                        | Probe description                                                                                                                                                                      | `nil`           |                 |
| `probes.<key>.key`                                | Probe key. Please set this to long random string to secure your probes.                                                                                                                | `nil`           |                 |
| `probes.<key>.monitoringWorkers`                  | Number of threads / parallel processes you need to monitor your resources                                                                                                              | `3`             |                 |
| `probes.<key>.monitorFetchLimit`                  | Number of resources to be monitored in parallel                                                                                                                                        | `10`            |                 |
| `probes.<key>.syntheticMonitorScriptTimeoutInMs`  | Timeout for synthetic monitor script                                                                                                                                                   | `60000`         |                 |
| `probes.<key>.customCodeMonitorScriptTimeoutInMs` | Timeout for custom code monitor script                                                                                                                                                 | `60000`         |                 |
| `probes.<key>.proxy.httpProxyUrl`                | HTTP proxy URL for HTTP requests made by the probe (optional)                                                                                                                          | `nil`           |                 |
| `probes.<key>.proxy.httpsProxyUrl`               | HTTPS proxy URL for HTTPS requests made by the probe (optional)                                                                                                                        | `nil`           |                 |
| `probes.<key>.additionalContainers`               | Additional containers to add to the probe pod                                                                                                                                          | `nil`           |                 |
| `probes.<key>.resources`                          | Pod resources (limits, requests)                                                                                                                                                       | `nil`           |                 |
| `statusPage.cnameRecord`                          | CNAME record for the status page                                                                                                                                                       | `nil`           |                 |
| `logLevel`                                        | Can be one of the following - INFO, WARN, ERROR, DEBUG                                                                                                                                 | `INFO`          |                 |
| `incidents.disableAutomaticCreation`              | Disable incident creation (use this when your team is overloaded with incidents or in emergencies)                                                                                     | `false`         |                 |
| `alerts.disableAutomaticCreation`                 | Disable alert creation (use this when your team is overloaded with alerts or in emergencies)                                                                                           | `false`         |                 |
| `podSecurityContext`                              | Pod Security Context. Please refer to Kubernetes docuemntation to set these. This chart depends on other bitnami charts. You will have to set security context for those as well       | `{}`            |                 |
| `containerSecurityContext`                        | Container Security Context. Please refer to kubernetes documentation to set these. This chart depends on other bitnami charts. You will have to set security context for those as well | `{}`            |                 |
| `nodeSelector`                                    | Node Selector. Please refer to Kubernetes documentation on how to use them.                                                                                                            | `{}`            |                 |
| `tolerations`                                     | Tolerations. Please refer to Kubernetes documentation on how to use them.                                                                                                              | `[]`            |                 |
| `affinity`                                        | Affinity. Please refer to Kubernetes documentation on how to use them.                                                                                                                 | `{}`            |                 |
| `extraTemplates`                                  | Extra templates to be added to the deployment                                                                                                                                          | `[]`            |                 |
| `oneuptimeIngress.enabled`                        | Enable ingress                                                                                                                                                                         | `true`          |                 |
| `oneuptimeIngress.annotations`                    | Ingress annotations                                                                                                                                                                    | `{}`            |                 |
| `oneuptimeIngress.hosts`                          | Ingress hosts                                                                                                                                                                          | `[]`            |                 |
| `oneuptimeIngress.tls`                            | Ingress TLS. Please refer to values.yaml to set these                                                                                                                                  | `[]`            |                 |
| `oneuptimeIngress.className`                      | Ingress class name. Change this to your cloud providers ingress class                                                                                                                  | `nginx`         |                 |
| `script.workflowScriptTimeoutInMs`                | Timeout for workflow script                                                                                                                                                            | `5000`          |                 |
| `cert-manager.enabled`                            | Enable Cert-Manager for automatic SSL certificate management                                                                                                                          | `false`         |                 |
| `certManagerLetsEncrypt.enabled`                 | Enable Let's Encrypt integration with Cert-Manager                                                                                                                                      | `false`         |                 |
| `certManagerLetsEncrypt.email`                   | Email address for Let's Encrypt notifications                                                                                                                                          | `""`            | 🚨 (if enabled) |
| `certManagerLetsEncrypt.server`                  | Let's Encrypt ACME server URL                                                                                                                                                          | `https://acme-v02.api.letsencrypt.org/directory` |                 |


## LetsEncrypt Cert-Manager Integration

OneUptime integrates with [Cert-Manager](https://cert-manager.io/) to automatically provision and manage TLS/SSL certificates using Let's Encrypt. This provides automatic certificate renewal and secure HTTPS access to your OneUptime installation.

To enable this, please set the following in your values.yaml file. 

```
cert-manager:
  enabled: true
  installCRDs: true
```

Deploy helm to enable and install CRD's and then, add these to values.yaml

```
# Let's Encrypt configuration for Cert-Manager
certManagerLetsEncrypt:
  enabled: true
  email: "test@oneuptime.com"  # Set your email for Let's Encrypt notifications
  server: "https://acme-v02.api.letsencrypt.org/directory"  # Use "https://acme-staging-v02.api.letsencrypt.org/directory" for staging

oneuptimeIngress:
  enabled: true
  tls:
    enabled: true
    hosts:
     - host: "test.oneuptime.com" # Host 1
     # Please do not provide secretName as it'll be automatically generated. 
  className: nginx
  hosts:
    - test.oneuptime.com
```

Deploy the chart again and certificates should be provisioned. 

### Prerequisites

- Cert-Manager must be installed in your cluster (enabled via `cert-manager.enabled: true`)
- A publicly accessible domain name pointing to your ingress
- An ingress controller (like NGINX Ingress Controller) installed and configured

### Configuration

To enable automatic certificate management with Let's Encrypt:

1. **Enable Cert-Manager** in your `values.yaml`:
   ```yaml
   cert-manager:
     enabled: true
     installCRDs: true  # Installs required CRDs
   ```

2. **Configure Let's Encrypt integration**:
   ```yaml
   certManagerLetsEncrypt:
     enabled: true  # Enable Let's Encrypt certificate management
     email: "your-email@example.com"  # Required for Let's Encrypt notifications
     server: "https://acme-v02.api.letsencrypt.org/directory"  # Production server
     # For testing, use: "https://acme-staging-v02.api.letsencrypt.org/directory"
   ```

3. **Configure your ingress** with TLS:
   ```yaml
   oneuptimeIngress:
     enabled: true
     className: "nginx"  # Your ingress class name
     hosts:
       - "your-domain.com"
     tls:
       enabled: true
       hosts:
         - host: "your-domain.com"
           secretName: "oneuptime-tls"  # Cert-Manager will create and manage this secret
   ```

4. **Set HTTPS protocol**:
   ```yaml
   httpProtocol: https
   host: "your-domain.com"
   ```

### How It Works

When `certManagerLetsEncrypt.enabled` is set to `true`, the Helm chart will:

1. **Create a ClusterIssuer**: A Kubernetes resource that defines how to issue certificates from Let's Encrypt
2. **Annotate the Ingress**: Adds the `cert-manager.io/cluster-issuer` annotation to automatically request certificates
3. **Automatic Certificate Management**: Cert-Manager will:
   - Request certificates from Let's Encrypt using HTTP-01 challenges
   - Store certificates in Kubernetes secrets
   - Automatically renew certificates before expiration
   - Handle certificate lifecycle management

### Certificate Validation

Cert-Manager uses HTTP-01 challenges, which require:
- Your domain must be publicly accessible
- HTTP traffic on port 80 must reach your ingress controller
- The ingress must be configured with the correct host routing

### Troubleshooting

**Certificate not issued**:
- Check Cert-Manager pod logs: `kubectl logs -n cert-manager deployment/cert-manager`
- Verify domain DNS resolution and ingress configuration
- Ensure the ingress class matches your controller

**Certificate stuck in pending**:
- Check challenge status: `kubectl describe challenge`
- Verify HTTP-01 challenge accessibility from external sources

**Certificate renewal issues**:
- Cert-Manager handles renewal automatically 30 days before expiration
- Check ClusterIssuer status: `kubectl describe clusterissuer`

### Alternative: Manual Certificate Management

If you prefer to manage certificates manually or use a different CA:

1. Disable Cert-Manager integration:
   ```yaml
   certManagerLetsEncrypt:
     enabled: false
   ```

2. Use a reverse proxy (Nginx, Caddy, etc.) to terminate SSL/TLS
3. Configure the reverse proxy with your certificates
4. Point the reverse proxy to your OneUptime ingress
5. Set `httpProtocol: https` and update the `host` accordingly

## Using External Databases

### PostgreSQL

OneUptime includes a built-in PostgreSQL deployment using the official PostgreSQL Docker image. PostgreSQL is used for storing application data, user data, and configuration.

#### Built-in PostgreSQL Configuration

The default configuration provides a standalone PostgreSQL instance with authentication enabled:

```yaml
postgresql:
  enabled: true
  image:
    repository: postgres
    tag: "latest"
    pullPolicy: IfNotPresent
  auth:
    username: oneuptime
    database: oneuptimedb
    # Will be auto-generated if not provided
    password: 
  architecture: standalone
  primary:
    service:
      type: ClusterIP
      ports:
        postgresql: "5432"
    terminationGracePeriodSeconds: 0
    persistence:
      enabled: true
      size: 25Gi
      storageClass: ""
  nodeSelector: {}
  tolerations: []
  affinity: {}
  resources: {}
  # Optional PostgreSQL configuration
  # configuration: |-
  #   max_connections = 100
  #   shared_buffers = 128MB
  #   effective_cache_size = 4GB
```

#### External PostgreSQL Configuration

If you would like to use an external PostgreSQL database, please add these env vars to your values.yaml file:

```yaml
postgresql:
  # Set Internal PostgreSQL enabled to false, so we dont install PostgreSQL in your cluster
  enabled: false 

# External PostgreSQL Configuration
# You need to set postgresql.enabled to false if you're using an external postgresql database.
externalPostgres: 
  host: 
  port: 
  username: 
  password: 
  # If you're using an existing secret for the password, please use this instead of password. 
  existingSecret:
    name: 
    # This is the key in the secret where the password is stored.
    passwordKey: 
  database:
  ssl:
    enabled: false
    # If this is enabled, please set either "ca"
    ca: 

    # Optional
    cert: 
    key:
```

### Redis

OneUptime includes a built-in Redis deployment using the official Redis Docker image. Redis is used for caching and session management.

#### Built-in Redis Configuration

The default configuration provides a standalone Redis instance with authentication enabled:

```yaml
redis:
  enabled: true
  auth:
    # Will be auto-generated if not provided
    password: "your-redis-password"
  image:
    repository: redis
    tag: latest
    pullPolicy: IfNotPresent
  master:
    service:
      type: ClusterIP
      ports:
        redis: "6379"
    persistence:
      enabled: false 
      size: 8Gi
      storageClass: ""
    nodeSelector: {}
    tolerations: []
    affinity: {}
    resources: {}
  commonConfiguration: |-
   appendonly no
   save ""
```

#### External Redis Configuration

If you would like to use an external Redis database, please add these env vars to your values.yaml file:

```yaml
redis:
  # Set Internal Redis enabled to false, so we dont install Redis in your cluster
  enabled: false

externalRedis: 
  host: 
  port: 
  password: 
  # If you're using an existing secret for the password, please use this instead of password. 
  existingSecret:
    name: 
    # This is the key in the secret where the password is stored.
    passwordKey: 
  database: 
  tls:
    enabled: false
    # If this is enabled, please set "ca" certificate.
    ca:

    # (optional)
    cert: 
    key:

```

### Clickhouse 

OneUptime includes a built-in ClickHouse deployment using the official ClickHouse Docker image. ClickHouse is used for analytics, logs, and time-series data storage.

#### Built-in ClickHouse Configuration

The default configuration provides a standalone ClickHouse instance with authentication enabled:

```yaml
clickhouse:
  enabled: true
  auth:
    username: oneuptime
    # Will be auto-generated if not provided  
    password:
  image:
    repository: clickhouse/clickhouse-server
    tag: latest
    pullPolicy: IfNotPresent
  service:
    type: LoadBalancer
    ports:
      http: "8123"
      tcp: "9000"
      mysql: "9004"
      postgresql: "9005"
      interserver: "9009"
  persistence:
    enabled: true
    size: 25Gi
    storageClass: ""
  nodeSelector: {}
  tolerations: []
  affinity: {}
  resources: {}
```

#### External ClickHouse Configuration

If you would like to use an external clickhouse database, please add these env vars to your values.yaml file. 

```yaml
clickhouse: 
  # Set Internal Clickhouse enabled to false, so we dont install the clickhouse database in your cluster
  enabled: false

externalClickhouse:
  host: 
  # if you host is https then set this to true
  isHostHttps: 
  port: 
  username: 
  password: 
  # If you're using an existing secret for the password, please use this instead of password. 
  existingSecret:
    name: 
    # This is the key in the secret where the password is stored.
    passwordKey: 
  database:
  tls:
    enabled: false
    # If this is enabled, please set either "ca"
    ca: 

    # Optional
    cert: 
    key:
```


## If you would like to use a custom domain for your status page, please add these env vars 


| Parameter | Description | Default | Change Required |
| --------- | ----------- | ------- | --------------- |
| `letsEncrypt.accountKey` | Generate a private key via openssl, encode it to base64 | `` | 🚨 |
| `letsEncrypt.email` | Email address to register with letsencrypt for notifications | `` | 🚨 |


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

## Production Readiness Checklist

Please go through the following checklist to make sure your OneUptime installation is production ready.

- [ ] Please pin OneUptime version to a specific version. This will prevent any breaking changes from affecting your installation.

When you install, you can check the latest version from the github releases page https://github.com/OneUptime/oneuptime/releases. You can pin the version in your values.yaml file.

```
image:
  tag: <specific-version>
```

- [ ] Please pin OneUptime, PostgreSQL,Redis, and ClickHouse versions to a specific version. This will prevent any breaking changes from affecting your installation.

When you install, you can check the version installed by describing the pods. 

```
kubectl describe pod <pod-name>
```

For example: 

```
kubectl describe pod my-oneuptime-postgresql-0
```

Once you have the version, you can pin the version in your values.yaml file.

```
postgresql:
  image:
    tag: <specific-version>
redis:
  image:
    tag: <specific-version>
clickhouse:
  image:
    tag: <specific-version>
```

- [ ] Please make sure you have backups enabled for your PVCs. This is outside the scope of this chart. Please refer to your cloud provider's documentation on how to enable backups for PVCs.
- [ ] Please make sure you have static passwords for your database passwords (for Redis, ClickHouse and PostgreSQL).
- [ ] Please set `oneuptimeSecret` and `encryptionSecret` (or setup in `externalSecrets` section) to a long random string. You can use a password generator to generate these strings.
- [ ] Please set `probes.<key>.key` to a long random string. This is used to secure your probes.
- [ ] Please regularly update OneUptime. We release updates every day. We recommend you to update the software at least once a week if you're running OneUptime production. 

## Releases 

We release frequently, sometimes multiple times a day. It's usually safe to upgrade to the latest version. Any breaking changes will be documented in the release notes. Please make sure you read the release notes before upgrading.

## Chart Dependencies

We use these charts as dependencies for some components. You dont need to install them separately. Please read the readme for these individual charts to understand the configuration options.

| Chart | Description | Repository | 
| ----- | ----------- | ---------- | 
| `keda` | Kubernetes Event-driven Autoscaling | https://kedacore.github.io/charts |
| `cert-manager` | Certificate management for Kubernetes | https://charts.jetstack.io |


## Uninstalling OneUptime

To uninstall/delete the `my-oneuptime` deployment:

```console
helm uninstall my-oneuptime
```

## Contributing

We <3 contributions big and small. 
https://github.com/OneUptime/helm-chart is the read only release repository. Please direct your contributions here: https://github.com/OneUptime/oneuptime
