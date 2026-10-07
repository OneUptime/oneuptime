# Cloud Resources (IaaS & PaaS)

## Overview

**Cloud Resources** (_Cloud → All Resources_ in the dashboard) lists the IaaS and PaaS resources in your AWS, Azure and Google Cloud accounts — virtual machines, disks, load balancers, buckets, managed databases, caches, queues, API gateways and the rest — each with a page of its own: its type, region and account, the provider's own id for it, every metric the provider publishes about it, owners, labels and archiving, like every other resource in OneUptime.

They are discovered from the metrics each provider's monitoring service already publishes — **Azure Monitor**, **Amazon CloudWatch** and **Google Cloud Monitoring**. An OpenTelemetry Collector you run, with read-only access to that service, reads the metrics and exports them to OneUptime; OneUptime tells from each datapoint which resource it is about, and creates the Cloud Resource the first time it sees one. Nothing is installed on the resources themselves, and OneUptime never holds your cloud credentials: the collector does, in your environment.

| You run | Where it appears | How |
| --- | --- | --- |
| Containers on ECS, Cloud Run, Container Apps, App Service, … | **Cloud → All Environments** | Your workloads' own telemetry, by its `cloud.platform` — see [Cloud Environments](/docs/telemetry/cloud-environments) |
| Any IaaS or PaaS resource the provider monitors | **Cloud → All Resources** | The provider's monitoring API, read by a collector — this page |
| Virtual machines with an OpenTelemetry Collector on them | **Hosts** | The host's own metrics and logs — see [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) |
| Queues and topics your applications use | **Queues** | Spans, and the same cloud metrics — see [Queues](/docs/telemetry/queues) |

A resource can appear in more than one place: a VM with the collector installed is a **Host**, and its platform metrics (CPU credits, disk and network throughput as the hypervisor sees them) make it a **Cloud Resource** too; an SQS queue is a **Queue** and a **Cloud Resource**. Each view shows what its source knows.

## Before you start

- A **OneUptime Telemetry Ingestion Token** — create a **Server** key from _Project Settings → Telemetry & APM → Ingestion Keys_. The collectors below read it from the `ONEUPTIME_TOKEN` environment variable, never from their configuration file.
- Somewhere to run the **OpenTelemetry Collector** (the `otelcol-contrib` distribution, image `otel/opentelemetry-collector-contrib`) with outbound access to your cloud provider and to OneUptime: a small VM, a container, or your Kubernetes cluster. One collector can read several accounts and providers.
- Read access to the provider's monitoring API, created in the first step for each provider below.

The same steps are in the dashboard: **Cloud → All Resources** shows them, with your token filled in, until the first resource arrives, and every resource's **Documentation** tab opens on its own provider.

If you self-host OneUptime, replace `https://oneuptime.com/otlp` with `https://YOUR-ONEUPTIME-HOST/otlp`.

## Azure

The `azure_monitor` receiver lists the resources of a subscription and reads their platform metrics every minute. With no `services` list it reads **every** resource type, so every resource in the subscription becomes a Cloud Resource.

**1. Give the collector read access.** Create a service principal with the **Monitoring Reader** role — it reads metrics and lists resources, and cannot change anything:

```bash
az ad sp create-for-rbac \
  --name oneuptime-cloud-collector \
  --role "Monitoring Reader" \
  --scopes /subscriptions/<SUBSCRIPTION_ID>
```

It prints an `appId` (the client id), a `password` (the client secret) and the `tenant`. Give the same principal the role on more subscriptions to read them with the same collector.

**2. Configure the collector** — save this as `config.yaml`:

```yaml
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor:
    subscription_ids: ["${env:AZURE_SUBSCRIPTION_ID}"]
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    # No `services` list: every resource type in the subscription.
    # Series Azure returns per metric and resource (default 10).
    maximum_number_of_records_per_resource: 50

processors:
  batch: {}

exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}

service:
  extensions: [azure_auth]
  pipelines:
    metrics:
      receivers: [azure_monitor]
      processors: [batch]
      exporters: [otlphttp/oneuptime]
```

**3. Run the collector:**

```bash
docker run -d --name oneuptime-cloud-collector --restart unless-stopped \
  -e ONEUPTIME_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN \
  -e AZURE_TENANT_ID=<TENANT> \
  -e AZURE_CLIENT_ID=<APP_ID> \
  -e AZURE_CLIENT_SECRET=<PASSWORD> \
  -e AZURE_SUBSCRIPTION_ID=<SUBSCRIPTION_ID> \
  -v "$(pwd)/config.yaml:/etc/otelcol-contrib/config.yaml" \
  otel/opentelemetry-collector-contrib:latest
```

Resources appear at **Cloud → All Resources** within a few minutes.

**Options.**

- `resource_groups`, `services` and `resource_tags` narrow what is read: a list of resource groups, of Resource Manager types (`Microsoft.Compute/virtualMachines`), or of tags a resource must carry.
- `metrics` limits each resource type to the metrics and aggregations you list. Once a type is listed, only its listed metrics are read.
- `discover_subscriptions: true` reads every subscription the principal can see, instead of `subscription_ids`.
- `maximum_number_of_records_per_resource` is how many series Azure returns per metric and resource (10 by default); raise it when a metric splits by a dimension with many values.
- **Large subscriptions.** The receiver makes one Resource Manager call per resource and batch of 20 metrics, and Resource Manager allows about 12,000 reads an hour. For hundreds of resources, set `use_batch_api: true`: it reads up to 50 resources per call from the Azure Monitor data plane, whose limit is far higher.
- The receiver lists resources once a day by default (`cache_resources`, in seconds), so a resource created after the collector started can take up to a day to appear. Restart the collector to list them at once.

## AWS

CloudWatch metrics reach OneUptime in one of two ways. **Polling** — the collector's `aws_cloudwatch` receiver — needs nothing on the AWS side but credentials. **Metric Streams** push metrics as CloudWatch publishes them, through Amazon Data Firehose, to the collector's `awsfirehose` receiver: they suit large accounts, but the collector has to be reachable from AWS over HTTPS.

### Polling with the aws_cloudwatch receiver

**1. Give the collector read access** — attach this policy to the role the collector runs as (an EC2 instance profile, an ECS task role, an EKS service account) or to an IAM user whose access keys you give it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:ListMetrics",
        "cloudwatch:GetMetricData",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

`sts:GetCallerIdentity` lets the receiver report the account id, which each resource's ARN needs.

**2. Configure the collector** — one receiver reads one namespace in one region, so add one for each namespace and region you want. This example reads the common ones:

```yaml
receivers:
  aws_cloudwatch/ec2:
    region: ${env:AWS_REGION}
    metrics:
      collection_interval: 5m
      period: 5m
      delay: 10m
      discovery:
        filters:
          namespace: AWS/EC2
        # Metrics read per scrape, at most. Each costs 4 GetMetricData queries.
        limit: 1000
  aws_cloudwatch/ebs:
    region: ${env:AWS_REGION}
    metrics:
      collection_interval: 5m
      period: 5m
      delay: 10m
      discovery:
        filters:
          namespace: AWS/EBS
        # Metrics read per scrape, at most. Each costs 4 GetMetricData queries.
        limit: 1000
  aws_cloudwatch/applicationelb:
    region: ${env:AWS_REGION}
    metrics:
      collection_interval: 5m
      period: 5m
      delay: 10m
      discovery:
        filters:
          namespace: AWS/ApplicationELB
        # Metrics read per scrape, at most. Each costs 4 GetMetricData queries.
        limit: 1000
  aws_cloudwatch/rds:
    region: ${env:AWS_REGION}
    metrics:
      collection_interval: 5m
      period: 5m
      delay: 10m
      discovery:
        filters:
          namespace: AWS/RDS
        # Metrics read per scrape, at most. Each costs 4 GetMetricData queries.
        limit: 1000
  aws_cloudwatch/lambda:
    region: ${env:AWS_REGION}
    metrics:
      collection_interval: 5m
      period: 5m
      delay: 10m
      discovery:
        filters:
          namespace: AWS/Lambda
        # Metrics read per scrape, at most. Each costs 4 GetMetricData queries.
        limit: 1000
  aws_cloudwatch/dynamodb:
    region: ${env:AWS_REGION}
    metrics:
      collection_interval: 5m
      period: 5m
      delay: 10m
      discovery:
        filters:
          namespace: AWS/DynamoDB
        # Metrics read per scrape, at most. Each costs 4 GetMetricData queries.
        limit: 1000

processors:
  batch: {}

exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}

service:
  pipelines:
    metrics:
      receivers: [aws_cloudwatch/ec2, aws_cloudwatch/ebs, aws_cloudwatch/applicationelb, aws_cloudwatch/rds, aws_cloudwatch/lambda, aws_cloudwatch/dynamodb]
      processors: [batch]
      exporters: [otlphttp/oneuptime]
```

**3. Run the collector:**

```bash
docker run -d --name oneuptime-cloud-collector --restart unless-stopped \
  -e ONEUPTIME_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN \
  -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=<ACCESS_KEY_ID> \
  -e AWS_SECRET_ACCESS_KEY=<SECRET_ACCESS_KEY> \
  -v "$(pwd)/config.yaml:/etc/otelcol-contrib/config.yaml" \
  otel/opentelemetry-collector-contrib:latest
```

On an EC2 instance, ECS task or EKS pod that has the role, leave out the two key variables.

- **Leave `stats` unset.** Each metric is then read as one summary per period — four statistics, four `GetMetricData` queries — and AWS bills `GetMetricData` per metric requested. `discovery.limit` caps the metrics a receiver reads per scrape (it must be set; the receiver's own default is 100), and a longer `collection_interval` reads them less often.
- `delay` waits for CloudWatch to publish a period, so datapoints arrive 10 to 20 minutes after the time they measure. Resources appear within about twenty minutes.

### Streaming with CloudWatch Metric Streams

**1. Configure the collector**, with a certificate for its address — Firehose only delivers to `https://` on port 443:

```yaml
extensions:
  awscloudwatchmetricstreams_encoding:
    format: opentelemetry1.0

receivers:
  awsfirehose:
    # Firehose delivers to HTTPS on port 443 only: expose this port as
    # 443, for example behind a load balancer.
    endpoint: 0.0.0.0:4433
    encoding: awscloudwatchmetricstreams_encoding
    access_key: ${env:FIREHOSE_ACCESS_KEY}
    tls:
      cert_file: /etc/otelcol-contrib/tls/server.crt
      key_file: /etc/otelcol-contrib/tls/server.key

processors:
  batch: {}

exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}

service:
  extensions: [awscloudwatchmetricstreams_encoding]
  pipelines:
    metrics:
      receivers: [awsfirehose]
      processors: [batch]
      exporters: [otlphttp/oneuptime]
```

**2. Run it** with `-e FIREHOSE_ACCESS_KEY=<A_LONG_RANDOM_SECRET>`, the certificate mounted at `/etc/otelcol-contrib/tls/`, and port 4433 published behind something that answers on 443 (a load balancer, for example).

**3. Create the streams.**

1. **Amazon Data Firehose → Create Firehose stream**: source **Direct PUT**, destination **HTTP Endpoint**. The endpoint URL is the collector's `https://` address; the access key is `FIREHOSE_ACCESS_KEY`. Pick or create an S3 bucket for failed deliveries.
2. **CloudWatch → Metrics → Streams → Create metric stream**: the namespaces to include (or all), the Firehose stream, and the output format **OpenTelemetry 1.0**.
3. Repeat in each region: a metric stream carries its own region's metrics.

AWS bills a metric stream per metric update it delivers, plus Firehose's data charges; include only the namespaces you want. A stream in the **JSON** format (`format: json` on the encoding extension) names the same resources, but also writes each namespace into `service.name`, so every namespace shows up in **Services** as well — prefer **OpenTelemetry 1.0**.

## Google Cloud

The `googlecloudmonitoring` receiver reads the metric types its `metrics_list` names, for one project.

**1. Give the collector read access** — a service account with **Monitoring Viewer**:

```bash
gcloud iam service-accounts create oneuptime-cloud-collector \
  --project <PROJECT_ID>

gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member "serviceAccount:oneuptime-cloud-collector@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role roles/monitoring.viewer

gcloud iam service-accounts keys create key.json \
  --iam-account oneuptime-cloud-collector@<PROJECT_ID>.iam.gserviceaccount.com
```

On Google Cloud itself, run the collector as this service account instead of creating a key.

**2. Configure the collector.** Each filter reads every metric type of one service:

```yaml
receivers:
  googlecloudmonitoring:
    project_id: ${env:GCP_PROJECT_ID}
    collection_interval: 2m
    # Only the metric types these filters list are read.
    metrics_list:
      - metric_descriptor_filter: 'metric.type = starts_with("compute.googleapis.com/")'
      - metric_descriptor_filter: 'metric.type = starts_with("cloudsql.googleapis.com/")'
      - metric_descriptor_filter: 'metric.type = starts_with("loadbalancing.googleapis.com/")'
      - metric_descriptor_filter: 'metric.type = starts_with("storage.googleapis.com/")'
      - metric_descriptor_filter: 'metric.type = starts_with("redis.googleapis.com/")'
      - metric_descriptor_filter: 'metric.type = starts_with("run.googleapis.com/")'

processors:
  batch: {}

exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}

service:
  pipelines:
    metrics:
      receivers: [googlecloudmonitoring]
      processors: [batch]
      exporters: [otlphttp/oneuptime]
```

**3. Run the collector:**

```bash
docker run -d --name oneuptime-cloud-collector --restart unless-stopped \
  -e ONEUPTIME_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN \
  -e GCP_PROJECT_ID=<PROJECT_ID> \
  -e GOOGLE_APPLICATION_CREDENTIALS=/etc/otelcol-contrib/key.json \
  -v "$(pwd)/key.json:/etc/otelcol-contrib/key.json:ro" \
  -v "$(pwd)/config.yaml:/etc/otelcol-contrib/config.yaml" \
  otel/opentelemetry-collector-contrib:latest
```

- The list is read when the collector starts: restart it after a change. `metric_name: compute.googleapis.com/instance/cpu/utilization` reads one type instead of a service's every type.
- One receiver reads one project: add one per project.
- Each metric type is one Cloud Monitoring API read per collection interval. Reading Google Cloud's own metrics is free within the API's monthly allowance; a longer `collection_interval` keeps a large project inside it and inside the per-minute quota.

## Keep the pipeline free of resource detection

Do not add the `resourcedetection` processor to the pipeline that reads cloud monitoring. It stamps the collector machine's own `host.name` and `os.type` on every datapoint, and OneUptime then files your cloud's metrics under that machine in **Hosts** as well. A collector that also monitors its own host should do that in a pipeline of its own.

## How a resource is identified

Every datapoint from these receivers names one resource, and OneUptime keys the Cloud Resource on that resource's identity — never on its name, which you can change. The identity is compared without regard to case, so a resource reported in two spellings is one resource.

### Azure

Every datapoint carries its resource's Azure resource id (`azuremonitor.resource_id`), so **every** resource the receiver reads becomes a Cloud Resource — the types below under a friendly name, any other under its Resource Manager type. The resource id, region, subscription and resource group are all shown on the resource.

| Resource type | Shown as | Model |
| --- | --- | --- |
| `Microsoft.Compute/virtualMachines` | Virtual Machine | IaaS |
| `Microsoft.Compute/virtualMachineScaleSets` | Virtual Machine Scale Set | IaaS |
| `Microsoft.Compute/disks` | Managed Disk | IaaS |
| `Microsoft.Network/loadBalancers` | Load Balancer | IaaS |
| `Microsoft.Network/applicationGateways` | Application Gateway | IaaS |
| `Microsoft.Network/publicIPAddresses` | Public IP Address | IaaS |
| `Microsoft.Network/natGateways` | NAT Gateway | IaaS |
| `Microsoft.Network/virtualNetworkGateways` | Virtual Network Gateway | IaaS |
| `Microsoft.Network/expressRouteCircuits` | ExpressRoute Circuit | IaaS |
| `Microsoft.Network/azureFirewalls` | Azure Firewall | IaaS |
| `Microsoft.Network/frontdoors` | Front Door (classic) | IaaS |
| `Microsoft.Cdn/profiles` | Front Door and CDN Profile | IaaS |
| `Microsoft.Network/trafficmanagerprofiles` | Traffic Manager Profile | IaaS |
| `Microsoft.Network/networkInterfaces` | Network Interface | IaaS |
| `Microsoft.Network/virtualNetworks` | Virtual Network | IaaS |
| `Microsoft.Network/privateEndpoints` | Private Endpoint | IaaS |
| `Microsoft.Network/dnszones` | DNS Zone | IaaS |
| `Microsoft.Network/bastionHosts` | Bastion | IaaS |
| `Microsoft.Storage/storageAccounts` | Storage Account | IaaS |
| `Microsoft.RecoveryServices/vaults` | Recovery Services Vault | PaaS |
| `Microsoft.Web/sites` | App Service or Function App | PaaS |
| `Microsoft.Web/serverfarms` | App Service Plan | PaaS |
| `Microsoft.Web/staticSites` | Static Web App | PaaS |
| `Microsoft.App/containerApps` | Container App | PaaS |
| `Microsoft.App/managedEnvironments` | Container Apps Environment | PaaS |
| `Microsoft.ContainerInstance/containerGroups` | Container Instance | PaaS |
| `Microsoft.ContainerService/managedClusters` | AKS Cluster | PaaS |
| `Microsoft.ContainerRegistry/registries` | Container Registry | PaaS |
| `Microsoft.SignalRService/SignalR` | SignalR Service | PaaS |
| `Microsoft.Sql/servers/databases` | SQL Database | PaaS |
| `Microsoft.Sql/servers/elasticpools` | SQL Elastic Pool | PaaS |
| `Microsoft.Sql/managedInstances` | SQL Managed Instance | PaaS |
| `Microsoft.DBforPostgreSQL/flexibleServers` | PostgreSQL Flexible Server | PaaS |
| `Microsoft.DBforMySQL/flexibleServers` | MySQL Flexible Server | PaaS |
| `Microsoft.DocumentDB/databaseAccounts` | Cosmos DB Account | PaaS |
| `Microsoft.Cache/redis` | Azure Cache for Redis | PaaS |
| `Microsoft.Cache/redisEnterprise` | Azure Managed Redis | PaaS |
| `Microsoft.ServiceBus/namespaces` | Service Bus Namespace | PaaS |
| `Microsoft.EventHub/namespaces` | Event Hubs Namespace | PaaS |
| `Microsoft.EventGrid/topics` | Event Grid Topic | PaaS |
| `Microsoft.EventGrid/systemTopics` | Event Grid System Topic | PaaS |
| `Microsoft.EventGrid/namespaces` | Event Grid Namespace | PaaS |
| `Microsoft.ApiManagement/service` | API Management | PaaS |
| `Microsoft.Logic/workflows` | Logic App | PaaS |
| `Microsoft.DataFactory/factories` | Data Factory | PaaS |
| `Microsoft.Synapse/workspaces` | Synapse Workspace | PaaS |
| `Microsoft.Kusto/clusters` | Data Explorer Cluster | PaaS |
| `Microsoft.StreamAnalytics/streamingjobs` | Stream Analytics Job | PaaS |
| `Microsoft.CognitiveServices/accounts` | Azure AI Services or OpenAI | PaaS |
| `Microsoft.Search/searchServices` | AI Search Service | PaaS |
| `Microsoft.MachineLearningServices/workspaces` | Machine Learning Workspace | PaaS |
| `Microsoft.KeyVault/vaults` | Key Vault | PaaS |
| `Microsoft.Insights/components` | Application Insights | PaaS |
| `Microsoft.OperationalInsights/workspaces` | Log Analytics Workspace | PaaS |
| `Microsoft.Automation/automationAccounts` | Automation Account | PaaS |
| `Microsoft.Devices/IotHubs` | IoT Hub | PaaS |

### AWS

A CloudWatch metric names its resource in a dimension that depends on the namespace. A datapoint that carries the dimensions in **Identified by** is that resource's, together with its account and region; extra dimensions narrow the series, not the resource (an Application Load Balancer's per-target-group series are the load balancer's). A datapoint aggregated over something else — `InstanceType`, `DatabaseClass`, an account-wide total — names no resource and is not discovered. Neither is a namespace that is not listed: its metrics still reach **Metrics**.

Each resource is shown with its ARN where its metrics name it completely; where they do not (an Auto Scaling group's ARN carries a UUID no metric reports), with its namespace and dimensions.

| Namespace | Identified by | Shown as | Resource type | Model |
| --- | --- | --- | --- | --- |
| `AWS/EC2` | `InstanceId` | EC2 Instance | `AWS::EC2::Instance` | IaaS |
| `AWS/EC2` | `AutoScalingGroupName` (without `InstanceId`) | Auto Scaling Group | `AWS::AutoScaling::AutoScalingGroup` | IaaS |
| `AWS/AutoScaling` | `AutoScalingGroupName` | Auto Scaling Group | `AWS::AutoScaling::AutoScalingGroup` | IaaS |
| `AWS/EBS` | `VolumeId` | EBS Volume | `AWS::EC2::Volume` | IaaS |
| `AWS/ELB` | `LoadBalancerName` | Classic Load Balancer | `AWS::ElasticLoadBalancing::LoadBalancer` | IaaS |
| `AWS/ApplicationELB` | `LoadBalancer` | Elastic Load Balancer (ALB, NLB, GWLB) | `AWS::ElasticLoadBalancingV2::LoadBalancer` | IaaS |
| `AWS/NetworkELB` | `LoadBalancer` | Elastic Load Balancer (ALB, NLB, GWLB) | `AWS::ElasticLoadBalancingV2::LoadBalancer` | IaaS |
| `AWS/GatewayELB` | `LoadBalancer` | Elastic Load Balancer (ALB, NLB, GWLB) | `AWS::ElasticLoadBalancingV2::LoadBalancer` | IaaS |
| `AWS/NATGateway` | `NatGatewayId` | NAT Gateway | `AWS::EC2::NatGateway` | IaaS |
| `AWS/TransitGateway` | `TransitGateway` | Transit Gateway | `AWS::EC2::TransitGateway` | IaaS |
| `AWS/VPN` | `VpnId` | Site-to-Site VPN Connection | `AWS::EC2::VPNConnection` | IaaS |
| `AWS/DX` | `ConnectionId` | Direct Connect Connection | `AWS::DirectConnect::Connection` | IaaS |
| `AWS/CloudFront` | `DistributionId` | CloudFront Distribution | `AWS::CloudFront::Distribution` | IaaS |
| `AWS/GlobalAccelerator` | `Accelerator` (without `Listener`, `EndpointGroup`) | Global Accelerator | `AWS::GlobalAccelerator::Accelerator` | IaaS |
| `AWS/Route53` | `HealthCheckId` | Route 53 Health Check | `AWS::Route53::HealthCheck` | IaaS |
| `AWS/NetworkFirewall` | `FirewallName` | Network Firewall | `AWS::NetworkFirewall::Firewall` | IaaS |
| `AWS/WAFV2` | `WebACL` (without `Rule`, `RuleGroup`) | WAF Web ACL | `AWS::WAFv2::WebACL` | PaaS |
| `AWS/S3` | `BucketName` | S3 Bucket | `AWS::S3::Bucket` | IaaS |
| `AWS/EFS` | `FileSystemId` | EFS File System | `AWS::EFS::FileSystem` | IaaS |
| `AWS/FSx` | `FileSystemId` | FSx File System | `AWS::FSx::FileSystem` | IaaS |
| `AWS/ECS` | `ClusterName` + `ServiceName` | ECS Service | `AWS::ECS::Service` | PaaS |
| `AWS/ECS` | `ClusterName` (without `ServiceName`) | ECS Cluster | `AWS::ECS::Cluster` | PaaS |
| `AWS/AppRunner` | `ServiceName` | App Runner Service | `AWS::AppRunner::Service` | PaaS |
| `AWS/ElasticBeanstalk` | `EnvironmentName` | Elastic Beanstalk Environment | `AWS::ElasticBeanstalk::Environment` | PaaS |
| `AWS/Lambda` | `FunctionName` | Lambda Function | `AWS::Lambda::Function` | PaaS |
| `AWS/States` | `StateMachineArn` | Step Functions State Machine | `AWS::StepFunctions::StateMachine` | PaaS |
| `AWS/RDS` | `DBInstanceIdentifier` | RDS DB Instance | `AWS::RDS::DBInstance` | PaaS |
| `AWS/RDS` | `DBClusterIdentifier` (without `DBInstanceIdentifier`) | Aurora / RDS DB Cluster | `AWS::RDS::DBCluster` | PaaS |
| `AWS/DocDB` | `DBInstanceIdentifier` | DocumentDB Instance | `AWS::DocDB::DBInstance` | PaaS |
| `AWS/DocDB` | `DBClusterIdentifier` (without `DBInstanceIdentifier`) | DocumentDB Cluster | `AWS::DocDB::DBCluster` | PaaS |
| `AWS/Neptune` | `DBInstanceIdentifier` | Neptune Instance | `AWS::Neptune::DBInstance` | PaaS |
| `AWS/Neptune` | `DBClusterIdentifier` (without `DBInstanceIdentifier`) | Neptune Cluster | `AWS::Neptune::DBCluster` | PaaS |
| `AWS/DynamoDB` | `TableName` | DynamoDB Table | `AWS::DynamoDB::Table` | PaaS |
| `AWS/ElastiCache` | `CacheClusterId` | ElastiCache Cluster | `AWS::ElastiCache::CacheCluster` | PaaS |
| `AWS/ElastiCache` | `ReplicationGroupId` (without `CacheClusterId`) | ElastiCache Replication Group | `AWS::ElastiCache::ReplicationGroup` | PaaS |
| `AWS/ElastiCache` | `clusterId` (without `CacheClusterId`) | ElastiCache Serverless Cache | `AWS::ElastiCache::ServerlessCache` | PaaS |
| `AWS/MemoryDB` | `ClusterName` | MemoryDB Cluster | `AWS::MemoryDB::Cluster` | PaaS |
| `AWS/Redshift` | `ClusterIdentifier` | Redshift Cluster | `AWS::Redshift::Cluster` | PaaS |
| `AWS/ES` | `DomainName` | OpenSearch Domain | `AWS::OpenSearchService::Domain` | PaaS |
| `AWS/SQS` | `QueueName` | SQS Queue | `AWS::SQS::Queue` | PaaS |
| `AWS/SNS` | `TopicName` | SNS Topic | `AWS::SNS::Topic` | PaaS |
| `AWS/Kinesis` | `StreamName` | Kinesis Data Stream | `AWS::Kinesis::Stream` | PaaS |
| `AWS/Firehose` | `DeliveryStreamName` | Data Firehose Stream | `AWS::KinesisFirehose::DeliveryStream` | PaaS |
| `AWS/AmazonMQ` | `Broker` | Amazon MQ Broker | `AWS::AmazonMQ::Broker` | PaaS |
| `AWS/Kafka` | `Cluster Name` | MSK Cluster | `AWS::MSK::Cluster` | PaaS |
| `AWS/Events` | `RuleName` | EventBridge Rule | `AWS::Events::Rule` | PaaS |
| `AWS/ApiGateway` | `ApiName` | API Gateway REST API | `AWS::ApiGateway::RestApi` | PaaS |
| `AWS/ApiGateway` | `ApiId` (without `ApiName`) | API Gateway HTTP or WebSocket API | `AWS::ApiGatewayV2::Api` | PaaS |
| `AWS/AppSync` | `GraphQLAPIId` | AppSync GraphQL API | `AWS::AppSync::GraphQLApi` | PaaS |
| `AWS/CertificateManager` | `CertificateArn` | ACM Certificate | `AWS::CertificateManager::Certificate` | PaaS |
| `AWS/KMS` | `KeyId` | KMS Key | `AWS::KMS::Key` | PaaS |
| `AWS/Cognito` | `UserPool` | Cognito User Pool | `AWS::Cognito::UserPool` | PaaS |
| `AWS/SageMaker` | `EndpointName` | SageMaker Endpoint | `AWS::SageMaker::Endpoint` | PaaS |
| `AWS/Logs` | `LogGroupName` | CloudWatch Log Group | `AWS::Logs::LogGroup` | PaaS |

### Google Cloud

Cloud Monitoring names each metric's monitored resource with a type and labels. A datapoint of a type below is that resource's, identified by the labels listed — the resource's other labels, and its metadata labels, never split it. Kubernetes types (`k8s_container`, `k8s_pod`, …) are left to the [Kubernetes](/docs/telemetry/kubernetes-agent) product.

| Monitored resource type | Identified by | Shown as | Model |
| --- | --- | --- | --- |
| `gce_instance` | `project_id`, `zone`, `instance_id` | Compute Engine VM Instance | IaaS |
| `instance_group` | `project_id`, `location`, `instance_group_id` | Instance Group | IaaS |
| `gcs_bucket` | `project_id`, `bucket_name` | Cloud Storage Bucket | IaaS |
| `filestore_instance` | `project_id`, `location`, `instance_name` | Filestore Instance | IaaS |
| `https_lb_rule` | `project_id`, `url_map_name` | External Application Load Balancer | IaaS |
| `internal_http_lb_rule` | `project_id`, `region`, `url_map_name` | Internal Application Load Balancer | IaaS |
| `vpn_gateway` | `project_id`, `region`, `gateway_id` | Cloud VPN Gateway | IaaS |
| `nat_gateway` | `project_id`, `region`, `router_id`, `gateway_name` | Cloud NAT Gateway | IaaS |
| `gce_router` | `project_id`, `region`, `router_id` | Cloud Router | IaaS |
| `cloudsql_database` | `project_id`, `database_id` | Cloud SQL Instance | PaaS |
| `alloydb.googleapis.com/Instance` | `resource_container`, `location`, `cluster_id`, `instance_id` | AlloyDB Instance | PaaS |
| `redis_instance` | `project_id`, `region`, `instance_id` | Memorystore for Redis Instance | PaaS |
| `spanner_instance` | `project_id`, `instance_id` | Spanner Instance | PaaS |
| `bigtable_table` | `project_id`, `instance` | Bigtable Instance | PaaS |
| `bigquery_dataset` | `project_id`, `dataset_id` | BigQuery Dataset | PaaS |
| `cloud_function` | `project_id`, `region`, `function_name` | Cloud Run Function | PaaS |
| `cloud_run_revision` | `project_id`, `location`, `service_name` | Cloud Run Service | PaaS |
| `cloud_run_job` | `project_id`, `location`, `job_name` | Cloud Run Job | PaaS |
| `gae_app` | `project_id`, `module_id` | App Engine Service | PaaS |
| `pubsub_topic` | `project_id`, `topic_id` | Pub/Sub Topic | PaaS |
| `pubsub_subscription` | `project_id`, `subscription_id` | Pub/Sub Subscription | PaaS |
| `cloud_tasks_queue` | `project_id`, `location`, `queue_id` | Cloud Tasks Queue | PaaS |
| `cloud_composer_environment` | `project_id`, `location`, `environment_name` | Cloud Composer Environment | PaaS |
| `dataproc_cluster` | `project_id`, `region`, `cluster_name` | Dataproc Cluster | PaaS |
| `aiplatform.googleapis.com/Endpoint` | `resource_container`, `location`, `endpoint_id` | Vertex AI Endpoint | PaaS |

### Names

A resource is named after what its provider calls it (`vm-prod-01`, `checkout`, `orders`). Names are unique within a project, and the provider's are not — two subscriptions each have a `web-01`, an App Service plan and its app are both `checkout` — so a resource whose name is taken is named with its type, then its resource group or region, then its account: `web-01 (Virtual Machine, rg-prod)`. Rename any resource on its **Settings** tab: metrics are matched by its identity, not its name.

## Status, archiving and limits

- **Reporting** means the provider sent a metric about the resource within the last hour; after an hour without one it reads **Not reporting**. Some resources are quiet by nature — a Key Vault nobody called, a bucket whose storage metrics CloudWatch publishes once a day — and come back with their next datapoint.
- A resource that sends **no metric for 7 days** is archived automatically: an instance an Auto Scaling group replaced, a deleted volume, a bucket that is gone. It keeps its labels, owners and history under **Cloud → Advanced → Archived**, and is restored by itself the moment it reports again. A resource you archive yourself stays archived; one you restore while it is silent stays in the list until it reports.
- **Deleting** a resource the provider still reports does not stick: it is discovered again from its next metrics. Archive it instead.
- Discovery stops creating resources when a project holds **5,000** live (not archived) ones, and logs a warning; archived resources do not count.

Self-hosted installs can change these with environment variables on the app:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS` | `7` | Days without a metric before a resource is archived (at least 1) |
| `CLOUD_RESOURCE_AUTO_CREATE_BUDGET` | `5000` | Live resources a project may hold before discovery stops creating more (`0` turns discovery off) |

## Alerting on a resource

A resource's **Metrics** tab lists every metric its provider reports about it. Open one to chart it in the metrics explorer, already filtered to the resource, and choose **Create monitor from this view**: the monitor watches that metric for that resource.

Cloud monitoring publishes each number minutes after the time it measures — 10 to 20 minutes for CloudWatch polled as above, a few minutes for Azure Monitor and Cloud Monitoring — and it is stored under that time. Give a monitor over these metrics a window longer than that (30 minutes for CloudWatch, 15 for the others), or it sees no data and never fires.

## Inventory and rules

Cloud Resources are mirrored into the [Inventory](/docs/inventory/overview) as **Cloud Resource** items, with the provider's id as `cloud.resource.id` and the type as `cloud.resource.type`, and are listed by the AI agent's resource tools. **Cloud → Settings → Label Rules** and **Owner Rules** apply to them as they do to cloud environments.

## Troubleshooting

### No resources appear

1. Check the token: `curl -i https://oneuptime.com/otlp/v1/validate -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"` must answer `200` with `"valid": true`.
2. Read the collector's log (`docker logs oneuptime-cloud-collector`). An authorization error names the permission it is missing: `AuthorizationFailed` (Azure: **Monitoring Reader** on the subscription), `AccessDenied` on `cloudwatch:GetMetricData` (AWS: the policy above), `PermissionDenied` (Google Cloud: **Monitoring Viewer**).
3. Look in **Metrics** for the provider's metrics (`azure_…`, `amazonaws.com/aws/…`, `compute.googleapis.com/…`). If they are there but no resource is, the datapoints name none OneUptime recognises: an AWS namespace or Google Cloud type that is not listed above, or a datapoint aggregated over something other than a resource.
4. Wait for late data: CloudWatch polled as above is 10 to 20 minutes behind.

### A resource is missing

- **Azure:** the receiver lists resources once a day; restart the collector to list new ones now. A resource type with no platform metrics in Azure Monitor has nothing to report.
- **AWS:** each receiver reads one namespace in one region, and `discovery.limit` caps how many metrics it reads — raise it when an account has more.
- **Google Cloud:** `metrics_list` must name the resource's service.
- A project at the budget creates no new resources until some are archived (see [Status, archiving and limits](#status-archiving-and-limits)).

### The same resource appears twice

An AWS resource read once with its account id and once without (the polling receiver reports the account only when it may call `sts:GetCallerIdentity`) is two resources. Give every collector the permission, and archive the one without an account.

### My cloud's metrics appear under a host

The pipeline has a `resourcedetection` processor: see [Keep the pipeline free of resource detection](#keep-the-pipeline-free-of-resource-detection).

## Limitations

- Only metrics: the providers' monitoring APIs publish no logs or traces about a resource. Send those from your workloads with OpenTelemetry.
- Discovery follows the metrics: a resource the provider publishes no metrics about — or the collector does not read — is not discovered.
- A resource has no retention setting of its own: its metrics are kept as long as the rest of the metrics its collector sends.
- Polling the cloud APIs costs money and counts against their limits; see each provider's notes above.
