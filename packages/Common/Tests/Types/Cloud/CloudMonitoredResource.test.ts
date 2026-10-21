import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AWS_JSON_INSTANCE_ID_ATTRIBUTE,
  CLOUD_MONITORED_RESOURCE_MAX_VALUE_LENGTH,
  CLOUD_RESOURCE_NAME_MAX_LENGTH,
  CloudMonitoredResource,
  CloudMonitoringSource,
  ParsedAzureResourceId,
  buildCloudMonitoredResourceIdentifier,
  findAwsCloudWatchRule,
  getCloudMonitoredResourceNameCandidates,
  getCloudMonitoringSource,
  getRegionFromGcpLocation,
  parseAzureResourceId,
  resolveCloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { describe, expect, test } from "@jest/globals";

/*
 * Fixtures are STORED metric rows, the shape ingest writes and the resolver
 * reads: datapoint keys bare, resource keys `resource.`-prefixed, a kvlist
 * flattened to `<key>.<nested key>`, names lowercased. Each receiver's
 * shape is the one its source writes:
 *
 *   - azure_monitor: the ARM id, name, type, resource group and location
 *     on the datapoint, the subscription and tenant on the resource
 *     (azuremonitorreceiver's scraper and metadata builder);
 *   - CloudWatch, OpenTelemetry 1.0 (Metric Streams through awsfirehose,
 *     and the aws_cloudwatch receiver): `Namespace`, `MetricName` and the
 *     `Dimensions` kvlist on the datapoint, the account, region and stream
 *     ARN on the resource, the metric named amazonaws.com/<ns>/<metric>;
 *   - CloudWatch, JSON stream: the namespace split into service.namespace
 *     and service.name on the resource, dimensions as datapoint attributes
 *     with InstanceId written as service.instance.id
 *     (awscloudwatchmetricstreams_encoding's json_unmarshaler);
 *   - googlecloudmonitoring: gcp.resource_type and the monitored resource's
 *     labels on the resource, plus its metadata labels - the system ones
 *     through protobuf's Value.String(), `string_value:"..."`.
 */

const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";

const AZURE_RESOURCE: Record<string, string> = {
  "resource.azuremonitor.subscription_id": SUBSCRIPTION,
  "resource.azuremonitor.tenant_id": "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
};

function azureDatapoint(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    ...AZURE_RESOURCE,
    "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01`,
    name: "vm-prod-01",
    type: "Microsoft.Compute/virtualMachines",
    resource_group: "rg-prod",
    location: "westeurope",
    timegrain: "PT1M",
    ...overrides,
  };
}

const CLOUDWATCH_OTEL_RESOURCE: Record<string, string> = {
  "resource.cloud.provider": "aws",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "us-east-1",
  "resource.aws.exporter.arn":
    "arn:aws:cloudwatch:us-east-1:123456789012:metric-stream/oneuptime",
};

function cloudWatchDatapoint(
  namespace: string,
  metricName: string,
  dimensions: Record<string, string>,
  resource: Record<string, string> = CLOUDWATCH_OTEL_RESOURCE,
): { metricName: string; attributes: Record<string, string> } {
  const attributes: Record<string, string> = {
    ...resource,
    Namespace: namespace,
    MetricName: metricName,
  };
  for (const [key, value] of Object.entries(dimensions)) {
    attributes[`Dimensions.${key}`] = value;
  }
  return {
    metricName: `amazonaws.com/${namespace}/${metricName}`.toLowerCase(),
    attributes,
  };
}

function cloudWatchJsonDatapoint(
  service: string,
  metricName: string,
  dimensions: Record<string, string>,
): { metricName: string; attributes: Record<string, string> } {
  const attributes: Record<string, string> = {
    "resource.cloud.provider": "aws",
    "resource.cloud.account.id": "123456789012",
    "resource.cloud.region": "us-east-1",
    "resource.service.namespace": "AWS",
    "resource.service.name": service,
    "resource.aws.cloudwatch.metric_stream_name": "oneuptime",
  };
  for (const [key, value] of Object.entries(dimensions)) {
    attributes[key === "InstanceId" ? AWS_JSON_INSTANCE_ID_ATTRIBUTE : key] =
      value;
  }
  return { metricName: metricName.toLowerCase(), attributes };
}

function gcpDatapoint(
  resourceType: string,
  labels: Record<string, string>,
): { metricName: string; attributes: Record<string, string> } {
  const attributes: Record<string, string> = {
    "resource.gcp.resource_type": resourceType,
  };
  for (const [key, value] of Object.entries(labels)) {
    attributes[`resource.${key}`] = value;
  }
  return {
    metricName: "compute.googleapis.com/instance/cpu/utilization",
    attributes,
  };
}

function resolve(data: {
  metricName: string;
  attributes: Record<string, unknown>;
}): CloudMonitoredResource {
  const resource: CloudMonitoredResource | null =
    resolveCloudMonitoredResource(data);
  if (!resource) {
    throw new Error(`Expected a resource for ${JSON.stringify(data)}`);
  }
  return resource;
}

describe("getCloudMonitoringSource", () => {
  test("recognises each receiver's shape", () => {
    expect(
      getCloudMonitoringSource(
        "azure_percentage_cpu_average",
        azureDatapoint(),
      ),
    ).toBe(CloudMonitoringSource.AzureMonitor);

    const otel: { metricName: string; attributes: Record<string, string> } =
      cloudWatchDatapoint("AWS/EC2", "CPUUtilization", {
        InstanceId: "i-0abc",
      });
    expect(getCloudMonitoringSource(otel.metricName, otel.attributes)).toBe(
      CloudMonitoringSource.AwsCloudWatch,
    );

    const json: { metricName: string; attributes: Record<string, string> } =
      cloudWatchJsonDatapoint("EC2", "CPUUtilization", {
        InstanceId: "i-0abc",
      });
    expect(getCloudMonitoringSource(json.metricName, json.attributes)).toBe(
      CloudMonitoringSource.AwsCloudWatchJson,
    );

    const gcp: { metricName: string; attributes: Record<string, string> } =
      gcpDatapoint("gce_instance", {
        project_id: "acme",
        zone: "us-central1-a",
        instance_id: "123",
      });
    expect(getCloudMonitoringSource(gcp.metricName, gcp.attributes)).toBe(
      CloudMonitoringSource.GoogleCloudMonitoring,
    );
  });

  test("an application's or a host agent's datapoint is no cloud resource", () => {
    expect(
      getCloudMonitoringSource("http.server.request.duration", {
        "resource.service.name": "checkout",
        "http.route": "/orders",
      }),
    ).toBeNull();
    expect(
      getCloudMonitoringSource("system.cpu.utilization", {
        "resource.host.name": "web-01",
        "resource.cloud.provider": "aws",
        "resource.cloud.platform": "aws_ec2",
        state: "user",
      }),
    ).toBeNull();
  });

  test("a `Namespace` attribute alone is not CloudWatch: the metric name must say so", () => {
    expect(
      getCloudMonitoringSource("app.jobs.processed", {
        Namespace: "AWS/EC2",
        "Dimensions.InstanceId": "i-0abc",
      }),
    ).toBeNull();
    expect(
      getCloudMonitoringSource("aws.amazon.com/AWS/EC2/CPUUtilization", {
        Namespace: "AWS/EC2",
      }),
    ).toBeNull();
    expect(
      getCloudMonitoringSource("AMAZONAWS.COM/AWS/EC2/CPUUtilization", {
        Namespace: "AWS/EC2",
      }),
    ).toBe(CloudMonitoringSource.AwsCloudWatch);
  });

  test("blank identity attributes are absent ones", () => {
    expect(
      getCloudMonitoringSource("azure_x", {
        "azuremonitor.resource_id": "   ",
      }),
    ).toBeNull();
    expect(
      getCloudMonitoringSource("x", { "resource.gcp.resource_type": "" }),
    ).toBeNull();
  });

  test("never throws on any input shape", () => {
    const inputs: Array<unknown> = [
      null,
      undefined,
      0,
      "attributes",
      [],
      [["azuremonitor.resource_id", "/subscriptions/x"]],
      { "azuremonitor.resource_id": { nested: true } },
      { "azuremonitor.resource_id": ["/subscriptions/a"] },
      Object.create(null),
    ];
    for (const input of inputs) {
      expect(() => {
        return getCloudMonitoringSource("azure_x", input);
      }).not.toThrow();
      expect(() => {
        return resolveCloudMonitoredResource({
          metricName: 42,
          attributes: input,
        });
      }).not.toThrow();
    }
  });
});

describe("parseAzureResourceId", () => {
  test("a top-level resource", () => {
    const parsed: ParsedAzureResourceId | null = parseAzureResourceId(
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Storage/storageAccounts/stprod01`,
    );
    expect(parsed).toEqual({
      subscriptionId: SUBSCRIPTION,
      resourceGroup: "rg-prod",
      type: "Microsoft.Storage/storageAccounts",
      name: "stprod01",
    });
  });

  test("a child resource carries every level of its type and name", () => {
    expect(
      parseAzureResourceId(
        `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql-prod/databases/orders`,
      ),
    ).toEqual({
      subscriptionId: SUBSCRIPTION,
      resourceGroup: "rg-data",
      type: "Microsoft.Sql/servers/databases",
      name: "sql-prod/orders",
    });
  });

  test("matches segment names without regard to case, as ARM does", () => {
    expect(
      parseAzureResourceId(
        `/SUBSCRIPTIONS/${SUBSCRIPTION}/RESOURCEGROUPS/RG-PROD/PROVIDERS/MICROSOFT.COMPUTE/VIRTUALMACHINES/VM1`,
      ),
    ).toEqual({
      subscriptionId: SUBSCRIPTION,
      resourceGroup: "RG-PROD",
      type: "MICROSOFT.COMPUTE/VIRTUALMACHINES",
      name: "VM1",
    });
  });

  test("an extension resource is read from its own provider", () => {
    expect(
      parseAzureResourceId(
        `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Web/sites/app/providers/Microsoft.Insights/components/app-insights`,
      ),
    ).toEqual({
      subscriptionId: SUBSCRIPTION,
      resourceGroup: "rg",
      type: "Microsoft.Insights/components",
      name: "app-insights",
    });
  });

  test("a subscription-level resource has no resource group", () => {
    expect(
      parseAzureResourceId(
        `/subscriptions/${SUBSCRIPTION}/providers/Microsoft.Network/dnszones/example.com`,
      ),
    ).toEqual({
      subscriptionId: SUBSCRIPTION,
      resourceGroup: "",
      type: "Microsoft.Network/dnszones",
      name: "example.com",
    });
  });

  test("anything that is not a resource id is refused", () => {
    for (const value of [
      "",
      "/",
      "vm-prod-01",
      `/subscriptions/${SUBSCRIPTION}`,
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg`,
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers`,
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute`,
      // A type without its name.
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines`,
      `/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1`,
      "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc",
    ]) {
      expect(parseAzureResourceId(value)).toBeNull();
    }
  });
});

describe("Azure Monitor", () => {
  test("a virtual machine", () => {
    const resource: CloudMonitoredResource = resolve({
      metricName: "azure_percentage_cpu_average",
      attributes: azureDatapoint(),
    });

    expect(resource).toEqual({
      provider: CloudProvider.Azure,
      source: CloudMonitoringSource.AzureMonitor,
      resourceType: "Microsoft.Compute/virtualMachines",
      name: "vm-prod-01",
      providerResourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01`,
      accountId: SUBSCRIPTION,
      region: "westeurope",
      resourceGroup: "rg-prod",
      identityKey: `azure|/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.compute/virtualmachines/vm-prod-01`,
      telemetryAttributes: {
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01`,
      },
    });
  });

  test("the telemetry filter keeps the id exactly as it was stored", () => {
    const id: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/RG-Prod/providers/Microsoft.Compute/virtualMachines/VM-Prod-01`;
    const resource: CloudMonitoredResource = resolve({
      metricName: "azure_percentage_cpu_average",
      attributes: azureDatapoint({ "azuremonitor.resource_id": id }),
    });
    expect(resource.telemetryAttributes).toEqual({
      "azuremonitor.resource_id": id,
    });
    expect(resource.providerResourceId).toBe(id);
  });

  test("an id reported in another case is the same resource", () => {
    const upper: CloudMonitoredResource = resolve({
      metricName: "azure_percentage_cpu_average",
      attributes: azureDatapoint({
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION.toUpperCase()}/resourceGroups/RG-PROD/providers/Microsoft.Compute/virtualMachines/VM-PROD-01`,
      }),
    });
    const lower: CloudMonitoredResource = resolve({
      metricName: "azure_percentage_cpu_average",
      attributes: azureDatapoint(),
    });
    expect(upper.identityKey).toBe(lower.identityKey);
    expect(buildCloudMonitoredResourceIdentifier(upper)).toBe(
      buildCloudMonitoredResourceIdentifier(lower),
    );
  });

  test("the type is stored the way the catalog spells it, whatever Azure Monitor sends", () => {
    for (const reported of [
      "Microsoft.ServiceBus/Namespaces",
      "Microsoft.ServiceBus/namespaces",
      "microsoft.servicebus/namespaces",
    ]) {
      const resource: CloudMonitoredResource = resolve({
        metricName: "azure_activemessages_average",
        attributes: azureDatapoint({
          "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/${reported.split("/")[0]}/${reported.split("/")[1]}/orders-prod`,
          type: reported,
          name: "orders-prod",
          metadata_EntityName: "orders",
        }),
      });
      expect(resource.resourceType).toBe("Microsoft.ServiceBus/namespaces");
    }
  });

  test("a Service Bus queue's series are its namespace's: one resource per namespace", () => {
    const orders: CloudMonitoredResource = resolve({
      metricName: "azure_activemessages_average",
      attributes: azureDatapoint({
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.ServiceBus/namespaces/orders-prod`,
        type: "Microsoft.ServiceBus/Namespaces",
        name: "orders-prod",
        metadata_entityname: "orders",
      }),
    });
    const billing: CloudMonitoredResource = resolve({
      metricName: "azure_activemessages_average",
      attributes: azureDatapoint({
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.ServiceBus/namespaces/orders-prod`,
        type: "Microsoft.ServiceBus/Namespaces",
        name: "orders-prod",
        metadata_entityname: "billing",
      }),
    });
    expect(orders.identityKey).toBe(billing.identityKey);
    expect(orders.name).toBe("orders-prod");
  });

  test("a child resource: a SQL database", () => {
    const resource: CloudMonitoredResource = resolve({
      metricName: "azure_dtu_consumption_percent_average",
      attributes: azureDatapoint({
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql-prod/databases/orders`,
        type: "Microsoft.Sql/servers/databases",
        name: "sql-prod/orders",
        resource_group: "rg-data",
      }),
    });
    expect(resource.resourceType).toBe("Microsoft.Sql/servers/databases");
    expect(resource.name).toBe("sql-prod/orders");
    expect(resource.resourceGroup).toBe("rg-data");
  });

  test("a type the catalog does not list is still a resource, under its own type", () => {
    const resource: CloudMonitoredResource = resolve({
      metricName: "azure_something_total",
      attributes: azureDatapoint({
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Fabric/capacities/fabric01`,
        type: "Microsoft.Fabric/capacities",
        name: "fabric01",
      }),
    });
    expect(resource.resourceType).toBe("Microsoft.Fabric/capacities");
    expect(resource.name).toBe("fabric01");
  });

  test("without the receiver's own name and resource group, both come from the id", () => {
    const attributes: Record<string, string> = azureDatapoint();
    delete attributes["name"];
    delete attributes["resource_group"];
    const resource: CloudMonitoredResource = resolve({
      metricName: "azure_percentage_cpu_average",
      attributes,
    });
    expect(resource.name).toBe("vm-prod-01");
    expect(resource.resourceGroup).toBe("rg-prod");
  });

  test("the subscription falls back to the receiver's resource attribute", () => {
    const resource: CloudMonitoredResource = resolve({
      metricName: "azure_x",
      attributes: azureDatapoint(),
    });
    expect(resource.accountId).toBe(SUBSCRIPTION);
  });

  test("no location reported leaves the region empty", () => {
    const attributes: Record<string, string> = azureDatapoint();
    delete attributes["location"];
    expect(
      resolve({ metricName: "azure_x", attributes: attributes }).region,
    ).toBe("");
  });

  test("an id that is not a resource id, or an outsized one, names no resource", () => {
    expect(
      resolveCloudMonitoredResource({
        metricName: "azure_x",
        attributes: azureDatapoint({
          "azuremonitor.resource_id": "not-an-arm-id",
        }),
      }),
    ).toBeNull();
    expect(
      resolveCloudMonitoredResource({
        metricName: "azure_x",
        attributes: azureDatapoint({
          "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/${"v".repeat(
            CLOUD_MONITORED_RESOURCE_MAX_VALUE_LENGTH,
          )}`,
        }),
      }),
    ).toBeNull();
  });
});

describe("CloudWatch, OpenTelemetry 1.0 shape", () => {
  test("an EC2 instance, with its ARN", () => {
    const resource: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/EC2", "CPUUtilization", {
        InstanceId: "i-0abc123def",
      }),
    );
    expect(resource).toEqual({
      provider: CloudProvider.AWS,
      source: CloudMonitoringSource.AwsCloudWatch,
      resourceType: "AWS::EC2::Instance",
      name: "i-0abc123def",
      providerResourceId:
        "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123def",
      accountId: "123456789012",
      region: "us-east-1",
      resourceGroup: "",
      identityKey:
        "aws|123456789012|us-east-1|aws::ec2::instance|instanceid=i-0abc123def",
      telemetryAttributes: {
        Namespace: "AWS/EC2",
        "Dimensions.InstanceId": "i-0abc123def",
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "us-east-1",
      },
    });
  });

  test("a series aggregated over a non-identifying dimension names no resource", () => {
    for (const dimensions of [
      { InstanceType: "m5.large" },
      { ImageId: "ami-0123" },
      {},
    ]) {
      expect(
        resolveCloudMonitoredResource(
          cloudWatchDatapoint("AWS/EC2", "CPUUtilization", dimensions),
        ),
      ).toBeNull();
    }
  });

  test("EC2's per-group aggregate is the Auto Scaling group's, the same one AWS/AutoScaling names", () => {
    const fromEc2: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/EC2", "CPUUtilization", {
        AutoScalingGroupName: "web-asg",
      }),
    );
    const fromAutoScaling: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/AutoScaling", "GroupInServiceInstances", {
        AutoScalingGroupName: "web-asg",
      }),
    );
    expect(fromEc2.resourceType).toBe("AWS::AutoScaling::AutoScalingGroup");
    expect(fromEc2.identityKey).toBe(fromAutoScaling.identityKey);
    // No ARN: an Auto Scaling group's carries a UUID no metric reports.
    expect(fromEc2.providerResourceId).toBe(
      "AWS/EC2 AutoScalingGroupName=web-asg",
    );
  });

  test("a load balancer's per-target-group and per-zone series are the load balancer's", () => {
    const whole: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/ApplicationELB", "RequestCount", {
        LoadBalancer: "app/checkout/50dc6c495c0c9188",
      }),
    );
    const perTarget: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", {
        LoadBalancer: "app/checkout/50dc6c495c0c9188",
        TargetGroup: "targetgroup/checkout-tg/73e2d6bc24d8a067",
        AvailabilityZone: "us-east-1a",
      }),
    );
    expect(perTarget.identityKey).toBe(whole.identityKey);
    expect(whole.name).toBe("checkout");
    expect(whole.resourceType).toBe(
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
    );
    expect(whole.providerResourceId).toBe(
      "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/checkout/50dc6c495c0c9188",
    );
    // Only the identity dimension filters: every series of the LB matches.
    expect(perTarget.telemetryAttributes["Dimensions.TargetGroup"]).toBe(
      undefined,
    );
  });

  test("network and classic load balancers", () => {
    expect(
      resolve(
        cloudWatchDatapoint("AWS/NetworkELB", "ActiveFlowCount", {
          LoadBalancer: "net/edge/0123456789abcdef",
        }),
      ).name,
    ).toBe("edge");
    const classic: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/ELB", "RequestCount", {
        LoadBalancerName: "legacy-lb",
      }),
    );
    expect(classic.resourceType).toBe(
      "AWS::ElasticLoadBalancing::LoadBalancer",
    );
    expect(classic.providerResourceId).toBe(
      "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/legacy-lb",
    );
  });

  test("RDS: an instance, a cluster, and an aggregate that is neither", () => {
    expect(
      resolve(
        cloudWatchDatapoint("AWS/RDS", "CPUUtilization", {
          DBInstanceIdentifier: "orders-db",
        }),
      ),
    ).toMatchObject({
      resourceType: "AWS::RDS::DBInstance",
      providerResourceId: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
    });
    expect(
      resolve(
        cloudWatchDatapoint("AWS/RDS", "VolumeBytesUsed", {
          DBClusterIdentifier: "orders-aurora",
          Role: "WRITER",
        }),
      ),
    ).toMatchObject({
      resourceType: "AWS::RDS::DBCluster",
      providerResourceId:
        "arn:aws:rds:us-east-1:123456789012:cluster:orders-aurora",
    });
    expect(
      resolveCloudMonitoredResource(
        cloudWatchDatapoint("AWS/RDS", "CPUUtilization", {
          DatabaseClass: "db.r6g.large",
        }),
      ),
    ).toBeNull();
    // An instance's series that also names its cluster is the instance's.
    expect(
      resolve(
        cloudWatchDatapoint("AWS/RDS", "CPUUtilization", {
          DBInstanceIdentifier: "orders-aurora-1",
          DBClusterIdentifier: "orders-aurora",
        }),
      ).resourceType,
    ).toBe("AWS::RDS::DBInstance");
  });

  test("an S3 bucket's ARN needs no account or region", () => {
    const resource: CloudMonitoredResource = resolve(
      cloudWatchDatapoint(
        "AWS/S3",
        "BucketSizeBytes",
        { BucketName: "acme-assets", StorageType: "StandardStorage" },
        { "resource.cloud.provider": "aws" },
      ),
    );
    expect(resource.providerResourceId).toBe("arn:aws:s3:::acme-assets");
    expect(resource.accountId).toBe("");
    expect(resource.region).toBe("");
  });

  test("a Lambda function's per-version series are the function's", () => {
    const plain: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/Lambda", "Invocations", {
        FunctionName: "resize-image",
      }),
    );
    const versioned: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/Lambda", "Invocations", {
        FunctionName: "resize-image",
        Resource: "resize-image:prod",
        ExecutedVersion: "7",
      }),
    );
    expect(versioned.identityKey).toBe(plain.identityKey);
    expect(plain.providerResourceId).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:resize-image",
    );
    // Account-level Lambda totals carry no function.
    expect(
      resolveCloudMonitoredResource(
        cloudWatchDatapoint("AWS/Lambda", "ConcurrentExecutions", {}),
      ),
    ).toBeNull();
  });

  test("ECS: a service, and its cluster", () => {
    const service: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/ECS", "CPUUtilization", {
        ClusterName: "prod",
        ServiceName: "checkout",
      }),
    );
    expect(service).toMatchObject({
      resourceType: "AWS::ECS::Service",
      name: "checkout (prod)",
      providerResourceId:
        "arn:aws:ecs:us-east-1:123456789012:service/prod/checkout",
    });
    expect(
      resolve(
        cloudWatchDatapoint("AWS/ECS", "CPUReservation", {
          ClusterName: "prod",
        }),
      ).resourceType,
    ).toBe("AWS::ECS::Cluster");
  });

  test("ElastiCache: node-based, replication group and serverless caches", () => {
    expect(
      resolve(
        cloudWatchDatapoint("AWS/ElastiCache", "CPUUtilization", {
          CacheClusterId: "sessions-001",
          CacheNodeId: "0001",
        }),
      ).resourceType,
    ).toBe("AWS::ElastiCache::CacheCluster");
    expect(
      resolve(
        cloudWatchDatapoint(
          "AWS/ElastiCache",
          "GlobalDatastoreReplicationLag",
          {
            ReplicationGroupId: "sessions",
          },
        ),
      ).resourceType,
    ).toBe("AWS::ElastiCache::ReplicationGroup");
    expect(
      resolve(
        cloudWatchDatapoint("AWS/ElastiCache", "ElastiCacheProcessingUnits", {
          clusterId: "carts",
        }),
      ),
    ).toMatchObject({
      resourceType: "AWS::ElastiCache::ServerlessCache",
      providerResourceId:
        "arn:aws:elasticache:us-east-1:123456789012:serverlesscache:carts",
    });
  });

  test("API Gateway: a REST API by name, an HTTP API by id with a regional ARN", () => {
    const rest: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/ApiGateway", "5XXError", {
        ApiName: "orders-api",
        Stage: "prod",
      }),
    );
    expect(rest.resourceType).toBe("AWS::ApiGateway::RestApi");
    expect(rest.providerResourceId).toBe("AWS/ApiGateway ApiName=orders-api");

    const http: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/ApiGateway", "5xx", {
        ApiId: "a1b2c3d4e5",
        Stage: "$default",
      }),
    );
    expect(http.resourceType).toBe("AWS::ApiGatewayV2::Api");
    expect(http.providerResourceId).toBe(
      "arn:aws:apigateway:us-east-1::/apis/a1b2c3d4e5",
    );
  });

  test("a dimension that already is the ARN names the resource by its tail", () => {
    const stateMachine: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/States", "ExecutionsFailed", {
        StateMachineArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:OrderFulfilment",
      }),
    );
    expect(stateMachine.name).toBe("OrderFulfilment");
    expect(stateMachine.providerResourceId).toBe(
      "arn:aws:states:us-east-1:123456789012:stateMachine:OrderFulfilment",
    );

    const certificate: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/CertificateManager", "DaysToExpiry", {
        CertificateArn:
          "arn:aws:acm:us-east-1:123456789012:certificate/0f5d2d7b-1a2b-4c3d-9e8f-123456789abc",
      }),
    );
    expect(certificate.name).toBe("0f5d2d7b-1a2b-4c3d-9e8f-123456789abc");
  });

  test("CloudFront's ARN has an account and no region", () => {
    expect(
      resolve(
        cloudWatchDatapoint("AWS/CloudFront", "5xxErrorRate", {
          DistributionId: "E1A2B3C4D5E6F7",
          Region: "Global",
        }),
      ).providerResourceId,
    ).toBe("arn:aws:cloudfront::123456789012:distribution/E1A2B3C4D5E6F7");
  });

  test("an MSK cluster: a dimension name with a space", () => {
    const resource: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/Kafka", "ActiveControllerCount", {
        "Cluster Name": "events",
      }),
    );
    expect(resource.resourceType).toBe("AWS::MSK::Cluster");
    expect(resource.telemetryAttributes["Dimensions.Cluster Name"]).toBe(
      "events",
    );
  });

  test("an EventBridge rule on a custom bus", () => {
    expect(
      resolve(
        cloudWatchDatapoint("AWS/Events", "FailedInvocations", {
          RuleName: "nightly",
          EventBusName: "ops",
        }),
      ).providerResourceId,
    ).toBe("arn:aws:events:us-east-1:123456789012:rule/ops/nightly");
    expect(
      resolve(
        cloudWatchDatapoint("AWS/Events", "FailedInvocations", {
          RuleName: "nightly",
        }),
      ).providerResourceId,
    ).toBe("arn:aws:events:us-east-1:123456789012:rule/nightly");
  });

  test("China and GovCloud regions build ARNs in their own partition", () => {
    expect(
      resolve(
        cloudWatchDatapoint(
          "AWS/EC2",
          "CPUUtilization",
          { InstanceId: "i-0abc" },
          {
            "resource.cloud.account.id": "123456789012",
            "resource.cloud.region": "cn-north-1",
          },
        ),
      ).providerResourceId,
    ).toBe("arn:aws-cn:ec2:cn-north-1:123456789012:instance/i-0abc");
    expect(
      resolve(
        cloudWatchDatapoint(
          "AWS/EC2",
          "CPUUtilization",
          { InstanceId: "i-0abc" },
          {
            "resource.cloud.account.id": "123456789012",
            "resource.cloud.region": "us-gov-west-1",
          },
        ),
      ).providerResourceId,
    ).toBe("arn:aws-us-gov:ec2:us-gov-west-1:123456789012:instance/i-0abc");
  });

  test("without the account id (the pull receiver may not call STS) there is no account-scoped ARN", () => {
    const resource: CloudMonitoredResource = resolve(
      cloudWatchDatapoint(
        "AWS/EC2",
        "CPUUtilization",
        { InstanceId: "i-0abc" },
        {
          "resource.cloud.provider": "aws",
          "resource.cloud.region": "eu-west-1",
        },
      ),
    );
    expect(resource.providerResourceId).toBe("AWS/EC2 InstanceId=i-0abc");
    expect(resource.accountId).toBe("");
    expect(resource.telemetryAttributes).toEqual({
      Namespace: "AWS/EC2",
      "Dimensions.InstanceId": "i-0abc",
      "resource.cloud.region": "eu-west-1",
    });
  });

  test("a namespace without a rule, or a series without its resource, names no resource", () => {
    expect(
      resolveCloudMonitoredResource(
        cloudWatchDatapoint("MyApp/Checkout", "Orders", { Shop: "eu" }),
      ),
    ).toBeNull();
    expect(
      resolveCloudMonitoredResource(
        cloudWatchDatapoint("AWS/Usage", "ResourceCount", {
          Service: "EC2",
          Type: "Resource",
        }),
      ),
    ).toBeNull();
    // SNS mobile push: account-level, by application and platform.
    expect(
      resolveCloudMonitoredResource(
        cloudWatchDatapoint("AWS/SNS", "NumberOfNotificationsDelivered", {
          Application: "app",
          Platform: "APNS",
        }),
      ),
    ).toBeNull();
    // DynamoDB account-level totals carry no table.
    expect(
      resolveCloudMonitoredResource(
        cloudWatchDatapoint(
          "AWS/DynamoDB",
          "AccountProvisionedReadCapacityUtilization",
          {},
        ),
      ),
    ).toBeNull();
  });

  test("an outsized dimension value names no resource", () => {
    expect(
      resolveCloudMonitoredResource(
        cloudWatchDatapoint("AWS/SQS", "NumberOfMessagesSent", {
          QueueName: "q".repeat(CLOUD_MONITORED_RESOURCE_MAX_VALUE_LENGTH + 1),
        }),
      ),
    ).toBeNull();
  });

  test("the pull receiver's per-statistic gauges are the same resource", () => {
    const summary: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/SQS", "ApproximateNumberOfMessagesVisible", {
        QueueName: "orders",
      }),
    );
    const gauge: { metricName: string; attributes: Record<string, string> } =
      cloudWatchDatapoint("AWS/SQS", "ApproximateNumberOfMessagesVisible", {
        QueueName: "orders",
      });
    gauge.attributes["stat"] = "Maximum";
    expect(resolve(gauge).identityKey).toBe(summary.identityKey);
  });
});

describe("CloudWatch, JSON stream shape", () => {
  test("an EC2 instance, its InstanceId written as service.instance.id", () => {
    const resource: CloudMonitoredResource = resolve(
      cloudWatchJsonDatapoint("EC2", "CPUUtilization", {
        InstanceId: "i-0abc123def",
      }),
    );
    expect(resource).toMatchObject({
      provider: CloudProvider.AWS,
      source: CloudMonitoringSource.AwsCloudWatchJson,
      resourceType: "AWS::EC2::Instance",
      name: "i-0abc123def",
      providerResourceId:
        "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123def",
    });
    expect(resource.telemetryAttributes).toEqual({
      "resource.service.name": "EC2",
      "resource.service.namespace": "AWS",
      "service.instance.id": "i-0abc123def",
      "resource.cloud.account.id": "123456789012",
      "resource.cloud.region": "us-east-1",
    });
  });

  test("is the same resource the OpenTelemetry 1.0 shape names", () => {
    const pairs: Array<
      [
        { metricName: string; attributes: Record<string, string> },
        { metricName: string; attributes: Record<string, string> },
      ]
    > = [
      [
        cloudWatchDatapoint("AWS/EC2", "CPUUtilization", {
          InstanceId: "i-0abc",
        }),
        cloudWatchJsonDatapoint("EC2", "CPUUtilization", {
          InstanceId: "i-0abc",
        }),
      ],
      [
        cloudWatchDatapoint("AWS/SQS", "NumberOfMessagesSent", {
          QueueName: "orders",
        }),
        cloudWatchJsonDatapoint("SQS", "NumberOfMessagesSent", {
          QueueName: "orders",
        }),
      ],
      [
        cloudWatchDatapoint("AWS/ApplicationELB", "RequestCount", {
          LoadBalancer: "app/checkout/50dc6c495c0c9188",
          AvailabilityZone: "us-east-1a",
        }),
        cloudWatchJsonDatapoint("ApplicationELB", "RequestCount", {
          LoadBalancer: "app/checkout/50dc6c495c0c9188",
        }),
      ],
    ];
    for (const [otel, json] of pairs) {
      const fromOtel: CloudMonitoredResource = resolve(otel);
      const fromJson: CloudMonitoredResource = resolve(json);
      expect(fromJson.identityKey).toBe(fromOtel.identityKey);
      expect(fromJson.providerResourceId).toBe(fromOtel.providerResourceId);
      expect(fromJson.name).toBe(fromOtel.name);
    }
  });

  test("a namespace outside AWS/ (written whole into service.name) names no resource", () => {
    const datapoint: {
      metricName: string;
      attributes: Record<string, string>;
    } = cloudWatchJsonDatapoint("MyApp", "Orders", { Shop: "eu" });
    delete datapoint.attributes["resource.service.namespace"];
    expect(resolveCloudMonitoredResource(datapoint)).toBeNull();
  });

  test("resource and scope keys are never read as dimensions", () => {
    const datapoint: {
      metricName: string;
      attributes: Record<string, string>;
    } = cloudWatchJsonDatapoint("EC2", "CPUUtilization", {});
    datapoint.attributes["resource.InstanceId"] = "i-from-resource";
    datapoint.attributes["scope.InstanceId"] = "i-from-scope";
    expect(resolveCloudMonitoredResource(datapoint)).toBeNull();
  });
});

describe("Google Cloud Monitoring", () => {
  test("a Compute Engine instance named by its metadata, wrapped by Value.String()", () => {
    const resource: CloudMonitoredResource = resolve(
      gcpDatapoint("gce_instance", {
        project_id: "acme-prod",
        zone: "us-central1-a",
        instance_id: "4529012345678901234",
        name: 'string_value:"web-1"',
        machine_type: 'string_value:"e2-standard-4"',
      }),
    );
    expect(resource).toEqual({
      provider: CloudProvider.GCP,
      source: CloudMonitoringSource.GoogleCloudMonitoring,
      resourceType: "gce_instance",
      name: "web-1",
      providerResourceId:
        "//compute.googleapis.com/projects/acme-prod/zones/us-central1-a/instances/web-1",
      accountId: "acme-prod",
      region: "us-central1",
      resourceGroup: "",
      identityKey:
        "gcp|gce_instance|project_id=acme-prod|zone=us-central1-a|instance_id=4529012345678901234",
      telemetryAttributes: {
        "resource.gcp.resource_type": "gce_instance",
        "resource.project_id": "acme-prod",
        "resource.zone": "us-central1-a",
        "resource.instance_id": "4529012345678901234",
      },
    });
  });

  test("metadata labels never split a resource", () => {
    const bare: CloudMonitoredResource = resolve(
      gcpDatapoint("gce_instance", {
        project_id: "acme-prod",
        zone: "us-central1-a",
        instance_id: "123",
      }),
    );
    const labelled: CloudMonitoredResource = resolve(
      gcpDatapoint("gce_instance", {
        project_id: "acme-prod",
        zone: "us-central1-a",
        instance_id: "123",
        team: "payments",
        name: 'string_value:"web-1"',
      }),
    );
    expect(labelled.identityKey).toBe(bare.identityKey);
    expect(bare.name).toBe("123");
  });

  test("a Cloud SQL instance from its project:instance database id", () => {
    expect(
      resolve(
        gcpDatapoint("cloudsql_database", {
          project_id: "acme-prod",
          database_id: "acme-prod:orders-pg",
          region: "europe-west1",
        }),
      ),
    ).toMatchObject({
      resourceType: "cloudsql_database",
      name: "orders-pg",
      region: "europe-west1",
      providerResourceId:
        "//cloudsql.googleapis.com/projects/acme-prod/instances/orders-pg",
    });
  });

  test("a load balancer is its URL map, whichever forwarding rule a series is on", () => {
    const first: CloudMonitoredResource = resolve(
      gcpDatapoint("https_lb_rule", {
        project_id: "acme-prod",
        url_map_name: "storefront",
        forwarding_rule_name: "storefront-https",
        backend_name: "web",
        region: "global",
      }),
    );
    const second: CloudMonitoredResource = resolve(
      gcpDatapoint("https_lb_rule", {
        project_id: "acme-prod",
        url_map_name: "storefront",
        forwarding_rule_name: "storefront-http",
        backend_name: "api",
        region: "global",
      }),
    );
    expect(second.identityKey).toBe(first.identityKey);
    expect(first.providerResourceId).toBe(
      "//compute.googleapis.com/projects/acme-prod/global/urlMaps/storefront",
    );
  });

  test("a Memorystore instance from its full instance path", () => {
    expect(
      resolve(
        gcpDatapoint("redis_instance", {
          project_id: "acme-prod",
          region: "us-east1",
          instance_id:
            "projects/acme-prod/locations/us-east1/instances/sessions",
        }),
      ),
    ).toMatchObject({
      name: "sessions",
      providerResourceId:
        "//redis.googleapis.com/projects/acme-prod/locations/us-east1/instances/sessions",
    });
  });

  test("a Cloud Run service, whichever revision a series is on", () => {
    const blue: CloudMonitoredResource = resolve(
      gcpDatapoint("cloud_run_revision", {
        project_id: "acme-prod",
        location: "us-central1",
        service_name: "checkout",
        revision_name: "checkout-00041-abc",
        configuration_name: "checkout",
      }),
    );
    const green: CloudMonitoredResource = resolve(
      gcpDatapoint("cloud_run_revision", {
        project_id: "acme-prod",
        location: "us-central1",
        service_name: "checkout",
        revision_name: "checkout-00042-def",
        configuration_name: "checkout",
      }),
    );
    expect(green.identityKey).toBe(blue.identityKey);
  });

  test("a project container is read as its project", () => {
    expect(
      resolve(
        gcpDatapoint("aiplatform.googleapis.com/Endpoint", {
          resource_container: "projects/987654321",
          location: "us-central1",
          endpoint_id: "1234",
        }),
      ),
    ).toMatchObject({
      accountId: "987654321",
      providerResourceId:
        "//aiplatform.googleapis.com/projects/987654321/locations/us-central1/endpoints/1234",
    });
  });

  test("a type without a rule, a Kubernetes type, or a missing identity label names no resource", () => {
    expect(
      resolveCloudMonitoredResource(
        gcpDatapoint("k8s_container", {
          project_id: "acme-prod",
          location: "us-central1",
          cluster_name: "prod",
          namespace_name: "default",
          pod_name: "web-1",
          container_name: "web",
        }),
      ),
    ).toBeNull();
    expect(
      resolveCloudMonitoredResource(
        gcpDatapoint("global", { project_id: "acme-prod" }),
      ),
    ).toBeNull();
    expect(
      resolveCloudMonitoredResource(
        gcpDatapoint("gce_instance", {
          project_id: "acme-prod",
          instance_id: "123",
        }),
      ),
    ).toBeNull();
  });

  test("a type is matched without regard to case", () => {
    expect(
      resolve(
        gcpDatapoint("GCS_BUCKET", {
          project_id: "acme-prod",
          bucket_name: "acme-assets",
          location: "US",
        }),
      ).resourceType,
    ).toBe("gcs_bucket");
  });
});

describe("getRegionFromGcpLocation", () => {
  test("a zone is stored as its region; regions and multi-regions as they are", () => {
    expect(getRegionFromGcpLocation("us-central1-a")).toBe("us-central1");
    expect(getRegionFromGcpLocation("europe-west4-c")).toBe("europe-west4");
    expect(getRegionFromGcpLocation("us-central1")).toBe("us-central1");
    expect(getRegionFromGcpLocation("US")).toBe("US");
    expect(getRegionFromGcpLocation("global")).toBe("global");
    expect(getRegionFromGcpLocation("")).toBe("");
  });
});

describe("findAwsCloudWatchRule", () => {
  test("is matched on the namespace without regard to case", () => {
    expect(findAwsCloudWatchRule("aws/ec2", { InstanceId: "i-1" })?.type).toBe(
      "AWS::EC2::Instance",
    );
  });

  test("a blank identity dimension is a missing one", () => {
    expect(findAwsCloudWatchRule("AWS/EC2", { InstanceId: "" })).toBeNull();
  });
});

describe("buildCloudMonitoredResourceIdentifier", () => {
  const vm: CloudMonitoredResource = resolve({
    metricName: "azure_percentage_cpu_average",
    attributes: azureDatapoint(),
  });

  test("is the provider and a hash of the identity, inside the column", () => {
    const identifier: string = buildCloudMonitoredResourceIdentifier(vm);
    expect(identifier).toMatch(/^azure:[0-9a-f]{40}$/);
    expect(identifier.length).toBeLessThanOrEqual(100);
  });

  test("is stable, and differs between resources", () => {
    expect(buildCloudMonitoredResourceIdentifier(vm)).toBe(
      buildCloudMonitoredResourceIdentifier({ ...vm }),
    );
    const other: CloudMonitoredResource = resolve({
      metricName: "azure_percentage_cpu_average",
      attributes: azureDatapoint({
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-02`,
      }),
    });
    expect(buildCloudMonitoredResourceIdentifier(other)).not.toBe(
      buildCloudMonitoredResourceIdentifier(vm),
    );
  });

  test("can never be mistaken for an environment key", () => {
    const identifiers: Array<string> = [
      buildCloudMonitoredResourceIdentifier(vm),
      buildCloudMonitoredResourceIdentifier(
        resolve(
          cloudWatchDatapoint("AWS/EC2", "CPUUtilization", {
            InstanceId: "i-0abc",
          }),
        ),
      ),
      buildCloudMonitoredResourceIdentifier(
        resolve(
          gcpDatapoint("gcs_bucket", {
            project_id: "acme",
            bucket_name: "assets",
          }),
        ),
      ),
    ];
    for (const identifier of identifiers) {
      expect(identifier).not.toContain("|");
    }
  });
});

describe("getCloudMonitoredResourceNameCandidates", () => {
  test("the provider's name first, then ever more qualified, then a hash", () => {
    const vm: CloudMonitoredResource = resolve({
      metricName: "azure_percentage_cpu_average",
      attributes: azureDatapoint(),
    });
    const candidates: Array<string> =
      getCloudMonitoredResourceNameCandidates(vm);
    expect(candidates.slice(0, 4)).toEqual([
      "vm-prod-01",
      "vm-prod-01 (Virtual Machine)",
      "vm-prod-01 (Virtual Machine, rg-prod)",
      `vm-prod-01 (Virtual Machine, rg-prod, ${SUBSCRIPTION})`,
    ]);
    expect(candidates[4]).toMatch(/^vm-prod-01 \([0-9a-f]{8}\)$/);
    expect(candidates).toHaveLength(5);
  });

  test("an AWS resource is placed by its region", () => {
    const queue: CloudMonitoredResource = resolve(
      cloudWatchDatapoint("AWS/SQS", "NumberOfMessagesSent", {
        QueueName: "orders",
      }),
    );
    expect(getCloudMonitoredResourceNameCandidates(queue)[2]).toBe(
      "orders (SQS Queue, us-east-1)",
    );
  });

  test("missing qualifiers are skipped, never shown as blanks", () => {
    const bucket: CloudMonitoredResource = resolve(
      cloudWatchDatapoint(
        "AWS/S3",
        "BucketSizeBytes",
        { BucketName: "assets" },
        { "resource.cloud.provider": "aws" },
      ),
    );
    const candidates: Array<string> =
      getCloudMonitoredResourceNameCandidates(bucket);
    for (const candidate of candidates) {
      expect(candidate).not.toMatch(/, \)|\(, |\(\)|, ,/);
    }
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  test("every candidate fits the name column, and is unique", () => {
    const long: CloudMonitoredResource = resolve({
      metricName: "azure_x",
      attributes: azureDatapoint({
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/${"g".repeat(
          90,
        )}/providers/Microsoft.Compute/virtualMachines/${"v".repeat(150)}`,
        name: "v".repeat(150),
        resource_group: "g".repeat(90),
      }),
    });
    const candidates: Array<string> =
      getCloudMonitoredResourceNameCandidates(long);
    expect(candidates.length).toBeGreaterThan(1);
    for (const candidate of candidates) {
      expect(candidate.length).toBeLessThanOrEqual(
        CLOUD_RESOURCE_NAME_MAX_LENGTH,
      );
    }
    expect(candidates[0]!.endsWith("…")).toBe(true);
    expect(candidates[candidates.length - 1]).toMatch(/\([0-9a-f]{8}\)$/);
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
