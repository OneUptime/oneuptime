import { describe, expect, test } from "@jest/globals";
import { AwsCredentials } from "../../../../Server/Utils/CloudConnection/Aws/AwsApi";
import AwsLiveRead, {
  toAwsFilterPattern,
} from "../../../../Server/Utils/CloudConnection/LiveRead/AwsLiveRead";
import {
  CloudLiveReadError,
  CloudLiveReadInventoryRow,
} from "../../../../Server/Utils/CloudConnection/LiveRead/CloudLiveReadTypes";
import AwsSecurityHubClient, {
  AwsSigV4SignResult,
} from "../../../../Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import { JSONObject } from "../../../../Types/JSON";
import {
  AwsLiveCall,
  AwsLiveHandler,
  FakeAwsLive,
  LIVE_ACCOUNT,
  LIVE_NOW,
  awsJson,
  awsJsonError,
  awsXml,
  awsXmlError,
  createFakeAwsLive,
  ec2Error,
  ec2Xml,
  headerOf,
  inventoryRow,
  liveContext,
  liveTarget,
} from "./CloudLiveReadFakes";
import { FakeResponse } from "../LlmObservability/FakeProviderApi";

/*
 * The live reads of an AWS account against a fake AWS: for every read and
 * every kind it reads, the request each call makes (host, Region, the
 * action, the body or query, a Signature Version 4 signature) and the
 * text the read makes of the answers - and never a function's or a task's
 * environment, a queue's policy or a CloudTrail event's request.
 */

const CREDENTIALS: AwsCredentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const ECS_ARN: string = `arn:aws:ecs:us-east-1:${LIVE_ACCOUNT}:service/prod/web`;
const TASK_DEFINITION: string = `arn:aws:ecs:us-east-1:${LIVE_ACCOUNT}:task-definition/web:42`;
const EC2_ARN: string = `arn:aws:ec2:us-east-1:${LIVE_ACCOUNT}:instance/i-0123456789abcdef0`;
const RDS_ARN: string = `arn:aws:rds:us-east-1:${LIVE_ACCOUNT}:db:orders`;
const AURORA_ARN: string = `arn:aws:rds:us-east-1:${LIVE_ACCOUNT}:cluster:orders-cluster`;
const ASG_ARN: string = `arn:aws:autoscaling:us-east-1:${LIVE_ACCOUNT}:autoScalingGroup:6d4f0c5e-1a2b-4c3d-9e8f-0a1b2c3d4e5f:autoScalingGroupName/web-asg`;
const LAMBDA_ARN: string = `arn:aws:lambda:us-east-1:${LIVE_ACCOUNT}:function:checkout`;
const ALIAS_ARN: string = `${LAMBDA_ARN}:live`;
const VERSION_ARN: string = `${LAMBDA_ARN}:7`;
const SQS_ARN: string = `arn:aws:sqs:us-east-1:${LIVE_ACCOUNT}:orders`;
const TG_ARN: string = `arn:aws:elasticloadbalancing:us-east-1:${LIVE_ACCOUNT}:targetgroup/web-tg/0123456789abcdef`;
const TG2_ARN: string = `arn:aws:elasticloadbalancing:us-east-1:${LIVE_ACCOUNT}:targetgroup/api-tg/fedcba9876543210`;
const LB_ARN: string = `arn:aws:elasticloadbalancing:us-east-1:${LIVE_ACCOUNT}:loadbalancer/app/web-lb/0123456789abcdef`;
const BUCKET_ARN: string = "arn:aws:s3:::orders-bucket";
const LOG_GROUP_ARN: string = `arn:aws:logs:us-east-1:${LIVE_ACCOUNT}:log-group:/custom/app`;

// Epoch seconds, as AWS's JSON protocols write times.
function seconds(iso: string): number {
  return Date.parse(iso) / 1000;
}

async function read(
  command: string,
  handlers: Record<string, AwsLiveHandler>,
  options: {
    inventory?: CloudLiveReadInventoryRow | null;
    maxRequests?: number;
  } = {},
): Promise<{ text: string; fake: FakeAwsLive }> {
  const fake: FakeAwsLive = createFakeAwsLive(handlers);
  const text: string = await AwsLiveRead.read({
    target: liveTarget("aws", command, {
      accountId: LIVE_ACCOUNT,
      inventory: options.inventory,
    }),
    context: liveContext(fake, { maxRequests: options.maxRequests }),
    credentials: CREDENTIALS,
  });

  return { text, fake };
}

async function readError(
  command: string,
  handlers: Record<string, AwsLiveHandler>,
  options: { inventory?: CloudLiveReadInventoryRow | null } = {},
): Promise<unknown> {
  try {
    await read(command, handlers, options);
  } catch (error) {
    return error;
  }

  throw new Error("The read did not fail.");
}

function lines(text: string): Array<string> {
  return text.split("\n");
}

// Every AWS call is signed for its own service and Region, with the read's clock.
function expectSigned(call: AwsLiveCall): void {
  expect(headerOf(call.request, "Authorization")).toContain(
    `AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261027/${call.region}/${call.service}/aws4_request`,
  );
  expect(headerOf(call.request, "X-Amz-Date")).toBe("20261027T100000Z");
}

// ---- ECS ------------------------------------------------------------------------

function ecsService(overrides: JSONObject = {}): JSONObject {
  return {
    serviceArn: ECS_ARN,
    serviceName: "web",
    status: "ACTIVE",
    desiredCount: 4,
    runningCount: 3,
    pendingCount: 1,
    launchType: "FARGATE",
    platformVersion: "1.4.0",
    taskDefinition: TASK_DEFINITION,
    schedulingStrategy: "REPLICA",
    deploymentConfiguration: {
      deploymentCircuitBreaker: { enable: true, rollback: true },
    },
    healthCheckGracePeriodSeconds: 60,
    loadBalancers: [
      { targetGroupArn: TG_ARN, containerName: "web", containerPort: 8080 },
    ],
    deployments: [
      {
        id: "ecs-svc/2",
        status: "PRIMARY",
        taskDefinition: TASK_DEFINITION,
        desiredCount: 4,
        runningCount: 3,
        pendingCount: 1,
        failedTasks: 2,
        rolloutState: "IN_PROGRESS",
        rolloutStateReason: "ECS deployment ecs-svc/2 in progress.",
        createdAt: seconds("2026-10-27T09:50:00Z"),
        updatedAt: seconds("2026-10-27T09:58:00Z"),
      },
      {
        id: "ecs-svc/1",
        status: "ACTIVE",
        taskDefinition: `arn:aws:ecs:us-east-1:${LIVE_ACCOUNT}:task-definition/web:41`,
        desiredCount: 0,
        runningCount: 1,
        pendingCount: 0,
        rolloutState: "COMPLETED",
        createdAt: seconds("2026-10-20T08:00:00Z"),
      },
    ],
    // Not in order: the read sorts them, newest first.
    events: [
      {
        createdAt: seconds("2026-10-27T09:40:00Z"),
        message: "(service web) event 40",
      },
      {
        createdAt: seconds("2026-10-27T09:59:00Z"),
        message: "(service web) has started 1 tasks: (task abc).",
      },
      {
        createdAt: seconds("2026-10-27T09:30:00Z"),
        message: "(service web) event 30",
      },
      {
        createdAt: seconds("2026-10-27T09:20:00Z"),
        message: "(service web) event 20",
      },
      {
        createdAt: seconds("2026-10-27T09:10:00Z"),
        message: "(service web) event 10",
      },
      {
        createdAt: seconds("2026-10-27T09:00:00Z"),
        message: "(service web) event 00",
      },
      {
        createdAt: seconds("2026-10-27T02:00:00Z"),
        message: "(service web) eight hours ago",
      },
    ],
    ...overrides,
  };
}

function describeServices(service: JSONObject = ecsService()): AwsLiveHandler {
  return (): FakeResponse => {
    return awsJson({ services: [service], failures: [] });
  };
}

describe("AWS describe: an ECS service", () => {
  test("asks ECS DescribeServices for the service in its cluster and shows its counts, deployments and newest events", async () => {
    const { text, fake } = await read(`cloud describe ${ECS_ARN}`, {
      "ecs:DescribeServices": describeServices(),
    });

    expect(fake.calls).toHaveLength(1);
    const call: AwsLiveCall = fake.calls[0]!;
    expect(call.request.url).toBe("https://ecs.us-east-1.amazonaws.com/");
    expect(call.target).toBe(
      "AmazonEC2ContainerServiceV20141113.DescribeServices",
    );
    expect(headerOf(call.request, "Content-Type")).toBe(
      "application/x-amz-json-1.1",
    );
    expect(call.json).toEqual({ cluster: "prod", services: ["web"] });
    expectSigned(call);

    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (ECS DescribeServices): ECS service ${ECS_ARN}`,
      "status: ACTIVE",
      "tasks: desired 4, running 3, pending 1",
      `task definition: ${TASK_DEFINITION}`,
      "launch type: FARGATE",
      "platform version: 1.4.0",
      "scheduling: REPLICA",
      "deployment circuit breaker: on, rolls back a failed deployment",
      "health check grace period: 60s",
      "load balancers (1):",
      `- ${TG_ARN} to container web:8080`,
      "deployments (2):",
      "- PRIMARY ecs-svc/2: task definition web:42, desired 4, running 3, pending 1, failed tasks 2, rollout IN_PROGRESS (ECS deployment ecs-svc/2 in progress.), created 2026-10-27T09:50:00Z, updated 2026-10-27T09:58:00Z",
      "- ACTIVE ecs-svc/1: task definition web:41, desired 0, running 1, pending 0, rollout COMPLETED, created 2026-10-20T08:00:00Z",
      "newest events (5 of 7):",
      "- 2026-10-27T09:59:00Z (service web) has started 1 tasks: (task abc).",
      "- 2026-10-27T09:40:00Z (service web) event 40",
      "- 2026-10-27T09:30:00Z (service web) event 30",
      "- 2026-10-27T09:20:00Z (service web) event 20",
      "- 2026-10-27T09:10:00Z (service web) event 10",
    ]);
  });

  test("the Cloud AI agent's own service: its ingestion key, in its task definition's environment, is never read, redacted or otherwise", async () => {
    const agentArn: string = `arn:aws:ecs:us-east-1:${LIVE_ACCOUNT}:service/oneuptime/oneuptime-cloud-ai-agent`;
    const { text, fake } = await read(`cloud describe ${agentArn}`, {
      "ecs:DescribeServices": (): FakeResponse => {
        return awsJson({
          services: [
            ecsService({
              serviceArn: agentArn,
              serviceName: "oneuptime-cloud-ai-agent",
              // Not a field DescribeServices has: here to show nothing beyond the named fields is read.
              taskDefinitionDetails: {
                containerDefinitions: [
                  {
                    environment: [
                      {
                        name: "ONEUPTIME_TELEMETRY_INGESTION_KEY",
                        value: "agent-ingestion-key-0123456789",
                      },
                    ],
                  },
                ],
              },
            }),
          ],
        });
      },
    });

    // One call: the service. Its task definition (and so its environment) is never asked for.
    expect(
      fake.calls.map((call: AwsLiveCall): string => {
        return `${call.service}:${call.action}`;
      }),
    ).toEqual(["ecs:DescribeServices"]);
    expect(text).toContain(`task definition: ${TASK_DEFINITION}`);
    expect(text).not.toContain("agent-ingestion-key");
    expect(text).not.toContain("ONEUPTIME_TELEMETRY_INGESTION_KEY");
    expect(text).not.toContain("[REDACTED]");
    expect(text).not.toContain("[redacted");
  });

  test("a service ECS no longer has is said to be missing, with ECS's reason", async () => {
    const error: unknown = await readError(`cloud describe ${ECS_ARN}`, {
      "ecs:DescribeServices": (): FakeResponse => {
        return awsJson({
          services: [],
          failures: [{ arn: ECS_ARN, reason: "MISSING" }],
        });
      },
    });

    expect(error).toBeInstanceOf(CloudLiveReadError);
    expect((error as CloudLiveReadError).reason).toBe("not-found");
    expect((error as CloudLiveReadError).message).toBe(
      "AWS has no ECS service web in cluster prod (us-east-1) (MISSING): it may have been deleted or renamed since OneUptime listed it.",
    );
  });

  test("a cluster that is not there is said to be missing", async () => {
    const error: unknown = await readError(`cloud describe ${ECS_ARN}`, {
      "ecs:DescribeServices": (): FakeResponse => {
        return awsJsonError(
          400,
          "ClusterNotFoundException",
          "Cluster not found.",
        );
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("not-found");
    expect((error as CloudLiveReadError).message).toContain(
      "AWS has no ECS cluster prod in us-east-1 (ClusterNotFoundException)",
    );
  });

  test("a refused call names the permission it needs", async () => {
    const error: unknown = await readError(`cloud describe ${ECS_ARN}`, {
      "ecs:DescribeServices": (): FakeResponse => {
        return awsJsonError(
          400,
          "AccessDeniedException",
          "User: arn:aws:sts::123456789012:assumed-role/OneUptimeReadOnly/x is not authorized to perform: ecs:DescribeServices",
        );
      },
    });

    expect(error).toBeInstanceOf(CloudLiveReadError);
    expect((error as CloudLiveReadError).reason).toBe("permission");
    expect((error as CloudLiveReadError).permission).toBe(
      "ecs:DescribeServices",
    );
  });
});

// ---- EC2 ------------------------------------------------------------------------

const EC2_INSTANCE_XML: string = `<reservationSet><item><reservationId>r-1</reservationId><instancesSet><item>
<instanceId>i-0123456789abcdef0</instanceId><imageId>ami-0abc</imageId>
<instanceState><code>16</code><name>running</name></instanceState>
<reason></reason>
<keyName>prod-key</keyName>
<instanceType>t3.large</instanceType>
<launchTime>2026-10-20T08:00:00.000Z</launchTime>
<placement><availabilityZone>us-east-1a</availabilityZone><tenancy>default</tenancy></placement>
<monitoring><state>disabled</state></monitoring>
<subnetId>subnet-1</subnetId><vpcId>vpc-1</vpcId>
<privateIpAddress>10.0.0.12</privateIpAddress>
<architecture>x86_64</architecture>
<platformDetails>Linux/UNIX</platformDetails>
<tagSet><item><key>Name</key><value>web-1 &amp; co</value></item><item><key>env</key><value>prod</value></item></tagSet>
</item></instancesSet></item></reservationSet>`;

const EC2_STATUS_XML: string = `<instanceStatusSet><item><instanceId>i-0123456789abcdef0</instanceId><availabilityZone>us-east-1a</availabilityZone>
<instanceState><code>16</code><name>running</name></instanceState>
<systemStatus><status>ok</status><details><item><name>reachability</name><status>passed</status></item></details></systemStatus>
<instanceStatus><status>impaired</status><details><item><name>reachability</name><status>failed</status><impairedSince>2026-10-27T09:45:00.000Z</impairedSince></item></details></instanceStatus>
<eventsSet><item><code>system-reboot</code><description>scheduled reboot</description><notBefore>2026-10-29T00:00:00.000Z</notBefore></item></eventsSet>
</item></instanceStatusSet>`;

describe("AWS describe: an EC2 instance", () => {
  test("asks DescribeInstances and DescribeInstanceStatus (Query protocol) and shows its state and status checks", async () => {
    const { text, fake } = await read(`cloud describe ${EC2_ARN}`, {
      "ec2:DescribeInstances": (): FakeResponse => {
        return ec2Xml("DescribeInstances", EC2_INSTANCE_XML);
      },
      "ec2:DescribeInstanceStatus": (): FakeResponse => {
        return ec2Xml("DescribeInstanceStatus", EC2_STATUS_XML);
      },
    });

    expect(
      fake.calls.map((call: AwsLiveCall): string => {
        return call.action;
      }),
    ).toEqual(["DescribeInstances", "DescribeInstanceStatus"]);

    const instances: AwsLiveCall = fake.calls[0]!;
    expect(instances.request.url).toBe("https://ec2.us-east-1.amazonaws.com/");
    expect(Object.fromEntries(instances.form.entries())).toEqual({
      Action: "DescribeInstances",
      Version: "2016-11-15",
      "InstanceId.1": "i-0123456789abcdef0",
    });
    expectSigned(instances);
    expect(Object.fromEntries(fake.calls[1]!.form.entries())).toEqual({
      Action: "DescribeInstanceStatus",
      Version: "2016-11-15",
      "InstanceId.1": "i-0123456789abcdef0",
      IncludeAllInstances: "true",
    });

    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (EC2 DescribeInstances, DescribeInstanceStatus): EC2 instance ${EC2_ARN}`,
      "name: web-1 & co",
      "state: running",
      "instance type: t3.large",
      "availability zone: us-east-1a",
      "launched: 2026-10-20T08:00:00Z",
      "private IP: 10.0.0.12",
      "image: ami-0abc",
      "platform: Linux/UNIX",
      "architecture: x86_64",
      "VPC: vpc-1",
      "subnet: subnet-1",
      "detailed monitoring: disabled",
      "status checks: system ok, instance impaired (reachability failed since 2026-10-27T09:45:00Z)",
      "scheduled events (1):",
      "- system-reboot: scheduled reboot, not before 2026-10-29T00:00:00Z",
      "tags (2):",
      "- Name: web-1 & co",
      "- env: prod",
    ]);
    // The key pair's name is not part of the answer.
    expect(text).not.toContain("prod-key");
  });

  test("status checks the role may not read are left out, with a note naming the permission", async () => {
    const { text } = await read(`cloud describe ${EC2_ARN}`, {
      "ec2:DescribeInstances": (): FakeResponse => {
        return ec2Xml("DescribeInstances", EC2_INSTANCE_XML);
      },
      "ec2:DescribeInstanceStatus": (): FakeResponse => {
        return ec2Error(
          403,
          "UnauthorizedOperation",
          "You are not authorized to perform this operation.",
        );
      },
    });

    expect(text).toContain("(EC2 DescribeInstances): EC2 instance");
    expect(text).toContain("state: running");
    expect(text).not.toContain("status checks:");
    expect(lines(text).pop()).toBe(
      "note: Status checks not read: the connection may not call ec2:DescribeInstanceStatus. Run the AWS connection's setup command again: it adds the read permissions OneUptime AI's live reads use.",
    );
  });

  test("an instance EC2 does not know is said to be missing", async () => {
    const error: unknown = await readError(`cloud describe ${EC2_ARN}`, {
      "ec2:DescribeInstances": (): FakeResponse => {
        return ec2Error(
          400,
          "InvalidInstanceID.NotFound",
          "The instance ID 'i-0123456789abcdef0' does not exist",
        );
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("not-found");
    expect((error as CloudLiveReadError).message).toBe(
      "AWS has no EC2 instance i-0123456789abcdef0 in us-east-1 (InvalidInstanceID.NotFound): it may have been deleted or renamed since OneUptime listed it.",
    );
  });

  test("an empty answer is a terminated instance", async () => {
    const error: unknown = await readError(`cloud describe ${EC2_ARN}`, {
      "ec2:DescribeInstances": (): FakeResponse => {
        return ec2Xml("DescribeInstances", "<reservationSet/>");
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("not-found");
  });
});

// ---- RDS --------------------------------------------------------------------------

describe("AWS describe: RDS", () => {
  test("an instance: DescribeDBInstances, with its status details and pending changes, never its master user", async () => {
    const { text, fake } = await read(`cloud describe ${RDS_ARN}`, {
      "rds:DescribeDBInstances": (): FakeResponse => {
        return awsXml(
          "DescribeDBInstances",
          `<DBInstances><DBInstance><DBInstanceIdentifier>orders</DBInstanceIdentifier><DBInstanceClass>db.r6g.large</DBInstanceClass><Engine>postgres</Engine><EngineVersion>15.4</EngineVersion><DBInstanceStatus>storage-full</DBInstanceStatus><MultiAZ>true</MultiAZ><AvailabilityZone>us-east-1a</AvailabilityZone><SecondaryAvailabilityZone>us-east-1b</SecondaryAvailabilityZone><Endpoint><Address>orders.abc.us-east-1.rds.amazonaws.com</Address><Port>5432</Port></Endpoint><AllocatedStorage>100</AllocatedStorage><StorageType>gp3</StorageType><Iops>3000</Iops><MasterUsername>orders_admin</MasterUsername><StatusInfos><DBInstanceStatusInfo><StatusType>read replication</StatusType><Normal>false</Normal><Status>error</Status><Message>replication stopped</Message></DBInstanceStatusInfo></StatusInfos><PendingModifiedValues><DBInstanceClass>db.r6g.xlarge</DBInstanceClass></PendingModifiedValues><ReadReplicaDBInstanceIdentifiers><ReadReplicaDBInstanceIdentifier>orders-replica</ReadReplicaDBInstanceIdentifier></ReadReplicaDBInstanceIdentifiers><InstanceCreateTime>2025-01-01T00:00:00.000Z</InstanceCreateTime><PreferredMaintenanceWindow>sun:05:00-sun:06:00</PreferredMaintenanceWindow><DeletionProtection>true</DeletionProtection></DBInstance></DBInstances>`,
        );
      },
    });

    expect(fake.calls[0]!.request.url).toBe(
      "https://rds.us-east-1.amazonaws.com/",
    );
    expect(Object.fromEntries(fake.calls[0]!.form.entries())).toEqual({
      Action: "DescribeDBInstances",
      Version: "2014-10-31",
      DBInstanceIdentifier: "orders",
    });
    expectSigned(fake.calls[0]!);
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (RDS DescribeDBInstances): RDS instance ${RDS_ARN}`,
      "status: storage-full",
      "class: db.r6g.large",
      "engine: postgres 15.4",
      "Multi-AZ: true",
      "availability zone: us-east-1a",
      "standby availability zone: us-east-1b",
      "endpoint: orders.abc.us-east-1.rds.amazonaws.com:5432",
      "storage: gp3 100 GiB, 3000 IOPS",
      "read replicas (1):",
      "- orders-replica",
      "status details (1):",
      "- read replication: error (not normal) - replication stopped",
      "pending changes (1):",
      "- DBInstanceClass: db.r6g.xlarge",
      "created: 2025-01-01T00:00:00Z",
      "maintenance window: sun:05:00-sun:06:00",
      "deletion protection: true",
    ]);
    expect(text).not.toContain("orders_admin");
  });

  test("an instance RDS does not have is said to be missing", async () => {
    const error: unknown = await readError(`cloud describe ${RDS_ARN}`, {
      "rds:DescribeDBInstances": (): FakeResponse => {
        return awsXmlError(
          404,
          "DBInstanceNotFound",
          "DBInstance orders not found.",
        );
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("not-found");
    expect((error as CloudLiveReadError).message).toContain(
      "AWS has no RDS instance orders in us-east-1 (DBInstanceNotFound)",
    );
  });

  test("an Aurora cluster: DescribeDBClusters, with its writer and readers", async () => {
    const { text, fake } = await read(`cloud describe ${AURORA_ARN}`, {
      "rds:DescribeDBClusters": (): FakeResponse => {
        return awsXml(
          "DescribeDBClusters",
          `<DBClusters><DBCluster><DBClusterIdentifier>orders-cluster</DBClusterIdentifier><Status>failing-over</Status><Engine>aurora-postgresql</Engine><EngineVersion>15.4</EngineVersion><EngineMode>provisioned</EngineMode><MultiAZ>true</MultiAZ><Endpoint>orders-cluster.cluster-abc.us-east-1.rds.amazonaws.com</Endpoint><ReaderEndpoint>orders-cluster.cluster-ro-abc.us-east-1.rds.amazonaws.com</ReaderEndpoint><Port>5432</Port><DBClusterMembers><DBClusterMember><DBInstanceIdentifier>orders-a</DBInstanceIdentifier><IsClusterWriter>true</IsClusterWriter><PromotionTier>1</PromotionTier></DBClusterMember><DBClusterMember><DBInstanceIdentifier>orders-b</DBInstanceIdentifier><IsClusterWriter>false</IsClusterWriter><PromotionTier>2</PromotionTier></DBClusterMember></DBClusterMembers><AvailabilityZones><AvailabilityZone>us-east-1a</AvailabilityZone><AvailabilityZone>us-east-1b</AvailabilityZone></AvailabilityZones><ServerlessV2ScalingConfiguration><MinCapacity>0.5</MinCapacity><MaxCapacity>8</MaxCapacity></ServerlessV2ScalingConfiguration><ClusterCreateTime>2025-02-01T00:00:00.000Z</ClusterCreateTime></DBCluster></DBClusters>`,
        );
      },
    });

    expect(Object.fromEntries(fake.calls[0]!.form.entries())).toEqual({
      Action: "DescribeDBClusters",
      Version: "2014-10-31",
      DBClusterIdentifier: "orders-cluster",
    });
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (RDS DescribeDBClusters): Aurora cluster ${AURORA_ARN}`,
      "status: failing-over",
      "engine: aurora-postgresql 15.4 (provisioned)",
      "Multi-AZ: true",
      "writer endpoint: orders-cluster.cluster-abc.us-east-1.rds.amazonaws.com",
      "reader endpoint: orders-cluster.cluster-ro-abc.us-east-1.rds.amazonaws.com",
      "port: 5432",
      "members (2):",
      "- orders-a: writer, promotion tier 1",
      "- orders-b: reader, promotion tier 2",
      "Serverless v2 capacity: 0.5 to 8 ACUs",
      "availability zones (2):",
      "- us-east-1a",
      "- us-east-1b",
      "pending changes: none",
      "created: 2025-02-01T00:00:00Z",
    ]);
  });
});

// ---- Auto Scaling ----------------------------------------------------------------

describe("AWS describe: an Auto Scaling group", () => {
  test("DescribeAutoScalingGroups: its sizes, instances with lifecycle and health, and suspended processes", async () => {
    const { text, fake } = await read(`cloud describe ${ASG_ARN}`, {
      "autoscaling:DescribeAutoScalingGroups": (): FakeResponse => {
        return awsXml(
          "DescribeAutoScalingGroups",
          `<AutoScalingGroups><member><AutoScalingGroupName>web-asg</AutoScalingGroupName><MinSize>2</MinSize><MaxSize>10</MaxSize><DesiredCapacity>4</DesiredCapacity><HealthCheckType>ELB</HealthCheckType><HealthCheckGracePeriod>300</HealthCheckGracePeriod><LaunchTemplate><LaunchTemplateName>web-lt</LaunchTemplateName><Version>7</Version></LaunchTemplate><AvailabilityZones><member>us-east-1a</member><member>us-east-1b</member></AvailabilityZones><TargetGroupARNs><member>${TG_ARN}</member></TargetGroupARNs><Instances><member><InstanceId>i-0aaa</InstanceId><AvailabilityZone>us-east-1a</AvailabilityZone><LifecycleState>InService</LifecycleState><HealthStatus>Healthy</HealthStatus><ProtectedFromScaleIn>false</ProtectedFromScaleIn></member><member><InstanceId>i-0bbb</InstanceId><AvailabilityZone>us-east-1b</AvailabilityZone><LifecycleState>Terminating</LifecycleState><HealthStatus>Unhealthy</HealthStatus><ProtectedFromScaleIn>true</ProtectedFromScaleIn></member></Instances><SuspendedProcesses><member><ProcessName>Launch</ProcessName><SuspensionReason>User suspended at 2026-10-27T09:00:00Z</SuspensionReason></member></SuspendedProcesses><CreatedTime>2025-03-01T00:00:00.000Z</CreatedTime></member></AutoScalingGroups>`,
        );
      },
    });

    expect(fake.calls[0]!.request.url).toBe(
      "https://autoscaling.us-east-1.amazonaws.com/",
    );
    expect(Object.fromEntries(fake.calls[0]!.form.entries())).toEqual({
      Action: "DescribeAutoScalingGroups",
      Version: "2011-01-01",
      "AutoScalingGroupNames.member.1": "web-asg",
    });
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (Auto Scaling DescribeAutoScalingGroups): Auto Scaling group ${ASG_ARN}`,
      "capacity: desired 4, minimum 2, maximum 10",
      "health check: ELB, grace period 300s",
      "launch template: web-lt version 7",
      "availability zones (2):",
      "- us-east-1a",
      "- us-east-1b",
      "target groups (1):",
      `- ${TG_ARN}`,
      "instances (2):",
      "- i-0aaa (us-east-1a): InService, Healthy",
      "- i-0bbb (us-east-1b): Terminating, Unhealthy, protected from scale-in",
      "suspended processes (1):",
      "- Launch (User suspended at 2026-10-27T09:00:00Z)",
      "created: 2025-03-01T00:00:00Z",
    ]);
  });

  test("a group Auto Scaling does not list is said to be missing", async () => {
    const error: unknown = await readError(`cloud describe ${ASG_ARN}`, {
      "autoscaling:DescribeAutoScalingGroups": (): FakeResponse => {
        return awsXml("DescribeAutoScalingGroups", "<AutoScalingGroups/>");
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("not-found");
  });
});

// ---- Lambda ------------------------------------------------------------------------

function lambdaConfiguration(overrides: JSONObject = {}): JSONObject {
  return {
    FunctionName: "checkout",
    FunctionArn: LAMBDA_ARN,
    Runtime: "nodejs20.x",
    Handler: "index.handler",
    MemorySize: 512,
    Timeout: 30,
    Version: "$LATEST",
    LastModified: "2026-10-27T09:30:00.000+0000",
    CodeSize: 123456,
    State: "Active",
    LastUpdateStatus: "Failed",
    LastUpdateStatusReason: "The function could not be updated.",
    Architectures: ["arm64"],
    EphemeralStorage: { Size: 512 },
    Layers: [{ Arn: "arn:aws:lambda:us-east-1:123456789012:layer:x:1" }],
    LoggingConfig: { LogFormat: "JSON", LogGroup: "/aws/lambda/checkout" },
    TracingConfig: { Mode: "Active" },
    Environment: { Variables: { DB_PASSWORD: "hunter2-secret" } },
    ...overrides,
  };
}

describe("AWS describe: Lambda (REST, signed GETs)", () => {
  test("a function: GetFunctionConfiguration and GetFunctionConcurrency, never its environment", async () => {
    const { text, fake } = await read(`cloud describe ${LAMBDA_ARN}`, {
      "lambda:GetFunctionConfiguration": (): FakeResponse => {
        return awsJson(lambdaConfiguration());
      },
      "lambda:GetFunctionConcurrency": (): FakeResponse => {
        return awsJson({ ReservedConcurrentExecutions: 25 });
      },
    });

    const configuration: AwsLiveCall = fake.calls[0]!;
    expect(configuration.method).toBe("GET");
    expect(configuration.request.url).toBe(
      "https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/checkout/configuration",
    );
    expect(configuration.request.body).toBeUndefined();
    expect(fake.calls[1]!.request.url).toBe(
      "https://lambda.us-east-1.amazonaws.com/2019-09-30/functions/checkout/concurrency",
    );

    // Signed exactly as AWS checks a GET: the path, no query, an empty body.
    const expected: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
      method: "GET",
      host: "lambda.us-east-1.amazonaws.com",
      path: "/2015-03-31/functions/checkout/configuration",
      query: {},
      headers: { Accept: "application/json" },
      body: "",
      accessKeyId: CREDENTIALS.accessKeyId,
      secretAccessKey: CREDENTIALS.secretAccessKey,
      region: "us-east-1",
      service: "lambda",
      date: LIVE_NOW,
    });
    expect(headerOf(configuration.request, "Authorization")).toBe(
      expected.headers["Authorization"],
    );
    expectSigned(configuration);

    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (Lambda GetFunctionConfiguration, GetFunctionConcurrency): Lambda function ${LAMBDA_ARN}`,
      "state: Active",
      "last update: Failed (The function could not be updated.)",
      "runtime: nodejs20.x",
      "handler: index.handler",
      "version: $LATEST",
      "last modified: 2026-10-27T09:30:00Z",
      "memory: 512 MB",
      "timeout: 30s",
      "ephemeral storage: 512 MB",
      "architectures: arm64",
      "code size: 123456 bytes",
      "layers: 1",
      "log group: /aws/lambda/checkout (JSON)",
      "tracing: Active",
      "reserved concurrency: 25",
    ]);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("DB_PASSWORD");
  });

  test("an alias: the configuration of the version it points to (Qualifier, signed), GetAlias with its routing", async () => {
    const { text, fake } = await read(`cloud describe ${ALIAS_ARN}`, {
      "lambda:GetFunctionConfiguration": (): FakeResponse => {
        return awsJson(lambdaConfiguration({ Version: "6" }));
      },
      "lambda:GetAlias": (): FakeResponse => {
        return awsJson({
          Name: "live",
          FunctionVersion: "6",
          Description: "production traffic",
          RoutingConfig: { AdditionalVersionWeights: { "7": 0.1 } },
        });
      },
      "lambda:GetFunctionConcurrency": (): FakeResponse => {
        return awsJson({});
      },
    });

    const configuration: AwsLiveCall = fake.callsTo(
      "lambda:GetFunctionConfiguration",
    )[0]!;
    expect(configuration.request.url).toBe(
      "https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/checkout/configuration?Qualifier=live",
    );
    expect(headerOf(configuration.request, "Authorization")).toBe(
      AwsSecurityHubClient.signRequest({
        method: "GET",
        host: "lambda.us-east-1.amazonaws.com",
        path: "/2015-03-31/functions/checkout/configuration",
        query: { Qualifier: "live" },
        headers: { Accept: "application/json" },
        body: "",
        accessKeyId: CREDENTIALS.accessKeyId,
        secretAccessKey: CREDENTIALS.secretAccessKey,
        region: "us-east-1",
        service: "lambda",
        date: LIVE_NOW,
      }).headers["Authorization"],
    );
    expect(fake.callsTo("lambda:GetAlias")[0]!.request.url).toBe(
      "https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/checkout/aliases/live",
    );
    expect(text).toContain(
      "(Lambda GetFunctionConfiguration, GetAlias, GetFunctionConcurrency): Lambda alias",
    );
    expect(text).toContain("alias points to version: 6");
    expect(text).toContain("alias also routes: 10% to version 7");
    expect(text).toContain("alias description: production traffic");
    expect(text).toContain(
      "reserved concurrency: none (it runs on the account's unreserved concurrency)",
    );
  });

  test("a version ARN is read as its function, at that version", async () => {
    const { fake } = await read(`cloud describe ${VERSION_ARN}`, {
      "lambda:GetFunctionConfiguration": (): FakeResponse => {
        return awsJson(lambdaConfiguration({ Version: "7" }));
      },
      "lambda:GetFunctionConcurrency": (): FakeResponse => {
        return awsJson({});
      },
    });

    expect(fake.calls[0]!.request.url).toBe(
      "https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/checkout/configuration?Qualifier=7",
    );
  });

  test("reserved concurrency the role may not read is a note; the configuration it may not read names the permission", async () => {
    const { text } = await read(`cloud describe ${LAMBDA_ARN}`, {
      "lambda:GetFunctionConfiguration": (): FakeResponse => {
        return awsJson(lambdaConfiguration());
      },
      "lambda:GetFunctionConcurrency": (): FakeResponse => {
        return {
          status: 403,
          body: JSON.stringify({ Type: "User", message: "not authorized" }),
        };
      },
    });

    expect(text).toContain(
      "note: Reserved concurrency not read: the connection may not call lambda:GetFunctionConcurrency.",
    );

    const error: unknown = await readError(`cloud describe ${LAMBDA_ARN}`, {
      "lambda:GetFunctionConfiguration": (): FakeResponse => {
        return {
          status: 403,
          body: JSON.stringify({ Type: "User", message: "not authorized" }),
        };
      },
    });

    expect((error as CloudLiveReadError).permission).toBe(
      "lambda:GetFunctionConfiguration",
    );
  });

  test("a function Lambda does not have is said to be missing", async () => {
    const error: unknown = await readError(`cloud describe ${LAMBDA_ARN}`, {
      "lambda:GetFunctionConfiguration": (): FakeResponse => {
        return {
          status: 404,
          body: JSON.stringify({ Type: "User", Message: "Function not found" }),
        };
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("not-found");
    expect((error as CloudLiveReadError).message).toContain(
      "AWS has no Lambda function checkout in us-east-1",
    );
  });
});

// ---- SQS, ELB ---------------------------------------------------------------------

describe("AWS describe: an SQS queue, a target group and a load balancer", () => {
  test("a queue: GetQueueAttributes All over AWS JSON 1.0, its depth and dead-letter queue, never its policy", async () => {
    const { text, fake } = await read(`cloud describe ${SQS_ARN}`, {
      "sqs:GetQueueAttributes": (): FakeResponse => {
        return awsJson({
          Attributes: {
            ApproximateNumberOfMessages: "1520",
            ApproximateNumberOfMessagesNotVisible: "12",
            ApproximateNumberOfMessagesDelayed: "0",
            VisibilityTimeout: "30",
            MessageRetentionPeriod: "345600",
            DelaySeconds: "0",
            ReceiveMessageWaitTimeSeconds: "20",
            MaximumMessageSize: "262144",
            RedrivePolicy: `{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:${LIVE_ACCOUNT}:orders-dlq","maxReceiveCount":5}`,
            SqsManagedSseEnabled: "true",
            CreatedTimestamp: String(seconds("2025-01-01T00:00:00Z")),
            LastModifiedTimestamp: String(seconds("2026-10-27T09:00:00Z")),
            Policy: '{"Statement":[{"Sid":"secret-statement"}]}',
          },
        });
      },
    });

    const call: AwsLiveCall = fake.calls[0]!;
    expect(call.request.url).toBe("https://sqs.us-east-1.amazonaws.com/");
    expect(call.target).toBe("AmazonSQS.GetQueueAttributes");
    expect(headerOf(call.request, "Content-Type")).toBe(
      "application/x-amz-json-1.0",
    );
    expect(call.json).toEqual({
      QueueUrl: `https://sqs.us-east-1.amazonaws.com/${LIVE_ACCOUNT}/orders`,
      AttributeNames: ["All"],
    });
    expectSigned(call);
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (SQS GetQueueAttributes): SQS queue ${SQS_ARN}`,
      "messages: visible 1520, in flight 12, delayed 0",
      "visibility timeout: 30s",
      "retention: 345600s",
      "delivery delay: 0s",
      "receive wait: 20s",
      "largest message: 262144 bytes",
      `dead-letter queue: arn:aws:sqs:us-east-1:${LIVE_ACCOUNT}:orders-dlq after 5 receives`,
      "encryption: SQS-managed",
      "created: 2025-01-01T00:00:00Z",
      "last changed: 2026-10-27T09:00:00Z",
    ]);
    expect(text).not.toContain("secret-statement");
  });

  test("a queue SQS does not have is said to be missing", async () => {
    const error: unknown = await readError(`cloud describe ${SQS_ARN}`, {
      "sqs:GetQueueAttributes": (): FakeResponse => {
        return awsJsonError(
          400,
          "QueueDoesNotExist",
          "The specified queue does not exist.",
        );
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("not-found");
  });

  test("a target group: DescribeTargetGroups by its ARN, with its health check", async () => {
    const { text, fake } = await read(`cloud describe ${TG_ARN}`, {
      "elasticloadbalancing:DescribeTargetGroups": (): FakeResponse => {
        return awsXml(
          "DescribeTargetGroups",
          `<TargetGroups><member><TargetGroupArn>${TG_ARN}</TargetGroupArn><TargetGroupName>web-tg</TargetGroupName><Protocol>HTTP</Protocol><Port>80</Port><ProtocolVersion>HTTP1</ProtocolVersion><VpcId>vpc-1</VpcId><HealthCheckEnabled>true</HealthCheckEnabled><HealthCheckProtocol>HTTP</HealthCheckProtocol><HealthCheckPort>traffic-port</HealthCheckPort><HealthCheckPath>/healthz</HealthCheckPath><HealthCheckIntervalSeconds>30</HealthCheckIntervalSeconds><HealthCheckTimeoutSeconds>5</HealthCheckTimeoutSeconds><HealthyThresholdCount>5</HealthyThresholdCount><UnhealthyThresholdCount>2</UnhealthyThresholdCount><Matcher><HttpCode>200-299</HttpCode></Matcher><LoadBalancerArns><member>${LB_ARN}</member></LoadBalancerArns><TargetType>instance</TargetType></member></TargetGroups>`,
        );
      },
    });

    expect(fake.calls[0]!.request.url).toBe(
      "https://elasticloadbalancing.us-east-1.amazonaws.com/",
    );
    expect(Object.fromEntries(fake.calls[0]!.form.entries())).toEqual({
      Action: "DescribeTargetGroups",
      Version: "2015-12-01",
      "TargetGroupArns.member.1": TG_ARN,
    });
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (ELB DescribeTargetGroups): target group ${TG_ARN}`,
      "name: web-tg",
      "protocol: HTTP 80 (HTTP1)",
      "target type: instance",
      "VPC: vpc-1",
      "health check: HTTP port traffic-port /healthz every 30s, timeout 5s, healthy after 5, unhealthy after 2, expects 200-299",
      "load balancers (1):",
      `- ${LB_ARN}`,
    ]);
  });

  test("a load balancer: DescribeLoadBalancers by its ARN, with its state", async () => {
    const { text, fake } = await read(`cloud describe ${LB_ARN}`, {
      "elasticloadbalancing:DescribeLoadBalancers": (): FakeResponse => {
        return awsXml(
          "DescribeLoadBalancers",
          `<LoadBalancers><member><LoadBalancerArn>${LB_ARN}</LoadBalancerArn><LoadBalancerName>web-lb</LoadBalancerName><Type>application</Type><Scheme>internet-facing</Scheme><State><Code>active_impaired</Code><Reason>one zone has no healthy target</Reason></State><DNSName>web-lb-1.us-east-1.elb.amazonaws.com</DNSName><VpcId>vpc-1</VpcId><IpAddressType>ipv4</IpAddressType><AvailabilityZones><member><ZoneName>us-east-1a</ZoneName><SubnetId>subnet-1</SubnetId></member></AvailabilityZones><CreatedTime>2025-04-01T00:00:00.000Z</CreatedTime></member></LoadBalancers>`,
        );
      },
    });

    expect(Object.fromEntries(fake.calls[0]!.form.entries())).toEqual({
      Action: "DescribeLoadBalancers",
      Version: "2015-12-01",
      "LoadBalancerArns.member.1": LB_ARN,
    });
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (ELB DescribeLoadBalancers): load balancer ${LB_ARN}`,
      "name: web-lb",
      "type: application",
      "scheme: internet-facing",
      "state: active_impaired (one zone has no healthy target)",
      "DNS name: web-lb-1.us-east-1.elb.amazonaws.com",
      "VPC: vpc-1",
      "IP address type: ipv4",
      "availability zones (1):",
      "- us-east-1a (subnet-1)",
      "created: 2025-04-01T00:00:00Z",
    ]);
  });
});

describe("AWS describe: any other resource", () => {
  test("is OneUptime's stored copy, said to be NOT LIVE, with the time it was listed", async () => {
    const { text, fake } = await read(
      `cloud describe ${BUCKET_ARN}`,
      {},
      {
        inventory: inventoryRow({
          name: "orders-bucket",
          resourceType: "AWS::S3::Bucket",
          region: "us-east-1",
          properties: {
            BucketName: "orders-bucket",
            "Versioning.Status": "Enabled",
          },
          tags: { team: "orders" },
        }),
      },
    );

    expect(fake.calls).toHaveLength(0);
    expect(lines(text)).toEqual([
      `NOT LIVE: OneUptime's stored copy of ${BUCKET_ARN} (AWS::S3::Bucket), as the account's inventory listed it at 2026-10-27T09:51:00Z. cloud describe reads only ECS services, EC2 instances, RDS instances and Aurora clusters, Auto Scaling groups, Lambda functions and aliases, SQS queues, target groups and load balancers live on AWS.`,
      "name: orders-bucket",
      "region: us-east-1",
      "properties (2):",
      "- BucketName: orders-bucket",
      "- Versioning.Status: Enabled",
      "tags (1):",
      "- team: orders",
    ]);
  });

  test("without a stored copy, it is refused", async () => {
    const error: unknown = await readError(`cloud describe ${BUCKET_ARN}`, {});

    expect((error as CloudLiveReadError).reason).toBe("refused");
    expect((error as CloudLiveReadError).message).toContain(
      "OneUptime holds no stored copy of arn:aws:s3:::orders-bucket either",
    );
  });

  test("a task definition is never read live: the inventory lists none, so it is refused before any call", async () => {
    // No handler: any call would end in another error than this refusal.
    const error: unknown = await readError(
      `cloud describe arn:aws:ecs:us-east-1:${LIVE_ACCOUNT}:task-definition/oneuptime-cloud-ai-agent:3`,
      {},
    );

    expect((error as CloudLiveReadError).reason).toBe("refused");
    expect((error as CloudLiveReadError).message).toContain(
      "OneUptime holds no stored copy of",
    );
  });

  test("a stored copy leaves out every property path that names an environment, a secret or a key", async () => {
    const { text } = await read(
      `cloud describe arn:aws:ecs:us-east-1:${LIVE_ACCOUNT}:task-definition/oneuptime-cloud-ai-agent:3`,
      {},
      {
        inventory: inventoryRow({
          resourceType: "AWS::ECS::TaskDefinition",
          properties: {
            Family: "oneuptime-cloud-ai-agent",
            "ContainerDefinitions.Environment":
              "ONEUPTIME_TELEMETRY_INGESTION_KEY=agent-ingestion-key-0123456789",
            "ContainerDefinitions.Secrets": "arn:aws:secretsmanager:x",
            ApiKey: "stored-api-key",
          },
        }),
      },
    );

    expect(text).toContain("- Family: oneuptime-cloud-ai-agent");
    expect(text).toContain("properties (1):");
    expect(text).not.toContain("agent-ingestion-key");
    expect(text).not.toContain("ONEUPTIME_TELEMETRY_INGESTION_KEY");
    expect(text).not.toContain("secretsmanager");
    expect(text).not.toContain("stored-api-key");
  });
});

// ---- recent-events -------------------------------------------------------------

describe("AWS recent-events", () => {
  test("an ECS service: its events in the window, newest first, at most --limit, with its deployments", async () => {
    const { text, fake } = await read(
      `cloud recent-events ${ECS_ARN} --hours 6 --limit 3`,
      { "ecs:DescribeServices": describeServices() },
    );

    expect(fake.calls).toHaveLength(1);
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (ECS DescribeServices): what ECS did to ECS service ${ECS_ARN} in the last 6 hours, newest first`,
      "events (3 of 6):",
      "- 2026-10-27T09:59:00Z (service web) has started 1 tasks: (task abc).",
      "- 2026-10-27T09:40:00Z (service web) event 40",
      "- 2026-10-27T09:30:00Z (service web) event 30",
      "deployments now (2):",
      "- PRIMARY ecs-svc/2: task definition web:42, desired 4, running 3, pending 1, failed tasks 2, rollout IN_PROGRESS (ECS deployment ecs-svc/2 in progress.), created 2026-10-27T09:50:00Z, updated 2026-10-27T09:58:00Z",
      "- ACTIVE ecs-svc/1: task definition web:41, desired 0, running 1, pending 0, rollout COMPLETED, created 2026-10-20T08:00:00Z",
    ]);
  });

  test("an RDS instance: DescribeEvents over --hours, every page, newest first", async () => {
    const { text, fake } = await read(
      `cloud recent-events ${RDS_ARN} --hours 2 --limit 3`,
      {
        "rds:DescribeEvents": (call: AwsLiveCall): FakeResponse => {
          return call.form.get("Marker")
            ? awsXml(
                "DescribeEvents",
                `<Events><Event><SourceIdentifier>orders</SourceIdentifier><SourceType>db-instance</SourceType><Message>Finished DB Instance backup</Message><EventCategories><EventCategory>backup</EventCategory></EventCategories><Date>2026-10-27T09:55:00.000Z</Date></Event></Events>`,
              )
            : awsXml(
                "DescribeEvents",
                `<Events><Event><Message>DB instance restarted</Message><EventCategories><EventCategory>availability</EventCategory></EventCategories><Date>2026-10-27T08:30:00.000Z</Date></Event><Event><Message>Multi-AZ instance failover started</Message><EventCategories><EventCategory>failover</EventCategory><EventCategory>availability</EventCategory></EventCategories><Date>2026-10-27T09:00:00.000Z</Date></Event></Events><Marker>page-2</Marker>`,
              );
        },
      },
    );

    const calls: Array<AwsLiveCall> = fake.callsTo("rds:DescribeEvents");
    expect(calls).toHaveLength(2);
    expect(Object.fromEntries(calls[0]!.form.entries())).toEqual({
      Action: "DescribeEvents",
      Version: "2014-10-31",
      SourceIdentifier: "orders",
      SourceType: "db-instance",
      StartTime: "2026-10-27T08:00:00.000Z",
      EndTime: "2026-10-27T10:00:00.000Z",
      MaxRecords: "100",
    });
    expect(calls[1]!.form.get("Marker")).toBe("page-2");
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (RDS DescribeEvents): RDS events of RDS instance ${RDS_ARN} in the last 2 hours, newest first`,
      "events (3):",
      "- 2026-10-27T09:55:00Z [backup] Finished DB Instance backup",
      "- 2026-10-27T09:00:00Z [failover, availability] Multi-AZ instance failover started",
      "- 2026-10-27T08:30:00Z [availability] DB instance restarted",
    ]);
  });

  test("an Aurora cluster asks for the cluster's own events", async () => {
    const { text, fake } = await read(`cloud recent-events ${AURORA_ARN}`, {
      "rds:DescribeEvents": (): FakeResponse => {
        return awsXml("DescribeEvents", "<Events/>");
      },
    });

    expect(fake.calls[0]!.form.get("SourceType")).toBe("db-cluster");
    expect(fake.calls[0]!.form.get("SourceIdentifier")).toBe("orders-cluster");
    expect(text).toContain("events: none in the last 6 hours");
  });

  test("an Auto Scaling group: DescribeScalingActivities, up to the start of the window", async () => {
    const { text, fake } = await read(
      `cloud recent-events ${ASG_ARN} --hours 1`,
      {
        "autoscaling:DescribeScalingActivities": (): FakeResponse => {
          return awsXml(
            "DescribeScalingActivities",
            `<Activities><member><Description>Launching a new EC2 instance: i-0ccc</Description><Cause>At 2026-10-27T09:50:00Z an alarm changed the desired capacity from 3 to 4.</Cause><StartTime>2026-10-27T09:50:05.000Z</StartTime><StatusCode>Failed</StatusCode><StatusMessage>We currently do not have sufficient capacity</StatusMessage></member><member><Description>Terminating EC2 instance: i-0ddd</Description><StartTime>2026-10-27T08:00:00.000Z</StartTime><StatusCode>Successful</StatusCode></member></Activities><NextToken>more</NextToken>`,
          );
        },
      },
    );

    // The second activity is before the window: no second page is asked for.
    expect(fake.calls).toHaveLength(1);
    expect(Object.fromEntries(fake.calls[0]!.form.entries())).toEqual({
      Action: "DescribeScalingActivities",
      Version: "2011-01-01",
      AutoScalingGroupName: "web-asg",
      MaxRecords: "50",
    });
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (Auto Scaling DescribeScalingActivities): scaling activities of Auto Scaling group ${ASG_ARN} in the last 1 hour, newest first`,
      "activities (1):",
      "- 2026-10-27T09:50:05Z Failed: Launching a new EC2 instance: i-0ccc (We currently do not have sufficient capacity). Cause: At 2026-10-27T09:50:00Z an alarm changed the desired capacity from 3 to 4.",
    ]);
  });

  test("anything else: CloudTrail LookupEvents of its ARN, then its name; reads and machinery are left out, a request never shown", async () => {
    const { text, fake } = await read(
      `cloud recent-events ${EC2_ARN} --hours 3`,
      {
        "cloudtrail:LookupEvents": (call: AwsLiveCall): FakeResponse => {
          const attribute: JSONObject = (
            call.json["LookupAttributes"] as Array<JSONObject>
          )[0]!;

          if (attribute["AttributeValue"] === EC2_ARN) {
            return awsJson({ Events: [] });
          }

          return awsJson({
            Events: [
              {
                EventId: "e1",
                EventName: "StopInstances",
                EventSource: "ec2.amazonaws.com",
                EventTime: seconds("2026-10-27T09:58:00Z"),
                Username: "alice",
                CloudTrailEvent: JSON.stringify({
                  readOnly: false,
                  errorCode: "Client.UnauthorizedOperation",
                  requestParameters: { userData: "SECRET-USER-DATA" },
                }),
              },
              {
                EventId: "e2",
                EventName: "DescribeInstances",
                EventSource: "ec2.amazonaws.com",
                EventTime: seconds("2026-10-27T09:57:00Z"),
                CloudTrailEvent: JSON.stringify({ readOnly: true }),
              },
              {
                EventId: "e3",
                EventName: "CreateTags",
                EventSource: "ec2.amazonaws.com",
                EventTime: seconds("2026-10-27T09:56:00Z"),
                CloudTrailEvent: JSON.stringify({ readOnly: false }),
              },
              {
                EventId: "e4",
                EventName: "ModifyInstanceAttribute",
                EventSource: "ec2.amazonaws.com",
                EventTime: seconds("2026-10-27T09:30:00Z"),
                Username: "deploy-bot",
                CloudTrailEvent: JSON.stringify({ readOnly: false }),
              },
            ],
          });
        },
      },
    );

    const calls: Array<AwsLiveCall> = fake.callsTo("cloudtrail:LookupEvents");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.request.url).toBe(
      "https://cloudtrail.us-east-1.amazonaws.com/",
    );
    expect(calls[0]!.target).toBe(
      "com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.LookupEvents",
    );
    expect(calls[0]!.json).toEqual({
      LookupAttributes: [
        { AttributeKey: "ResourceName", AttributeValue: EC2_ARN },
      ],
      StartTime: seconds("2026-10-27T07:00:00Z"),
      EndTime: seconds("2026-10-27T10:00:00Z"),
      MaxResults: 50,
    });
    expect(
      (calls[1]!.json["LookupAttributes"] as Array<JSONObject>)[0]![
        "AttributeValue"
      ],
    ).toBe("i-0123456789abcdef0");
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (CloudTrail LookupEvents): what was done to ${EC2_ARN} in the last 3 hours (CloudTrail management events naming i-0123456789abcdef0), newest first`,
      "events (2):",
      "- 2026-10-27T09:58:00Z ec2:StopInstances by alice, failed: Client.UnauthorizedOperation",
      "- 2026-10-27T09:30:00Z ec2:ModifyInstanceAttribute by deploy-bot",
    ]);
    expect(text).not.toContain("SECRET-USER-DATA");
  });

  test("a global resource's events are looked up in us-east-1", async () => {
    const { fake } = await read(`cloud recent-events ${BUCKET_ARN}`, {
      "cloudtrail:LookupEvents": (): FakeResponse => {
        return awsJson({ Events: [] });
      },
    });

    expect(fake.calls[0]!.region).toBe("us-east-1");
    // Its ARN, then its name.
    expect(
      fake.calls.map((call: AwsLiveCall): unknown => {
        return (call.json["LookupAttributes"] as Array<JSONObject>)[0]![
          "AttributeValue"
        ];
      }),
    ).toEqual([BUCKET_ARN, "orders-bucket"]);
  });

  test("RDS events the role may not read name rds:DescribeEvents", async () => {
    const error: unknown = await readError(`cloud recent-events ${RDS_ARN}`, {
      "rds:DescribeEvents": (): FakeResponse => {
        return awsXmlError(
          403,
          "AccessDenied",
          "not authorized to perform: rds:DescribeEvents",
        );
      },
    });

    expect((error as CloudLiveReadError).permission).toBe("rds:DescribeEvents");
  });
});

// ---- target-health ---------------------------------------------------------------

function targetHealthXml(): string {
  return `<TargetHealthDescriptions><member><Target><Id>i-0aaa</Id><Port>80</Port><AvailabilityZone>us-east-1a</AvailabilityZone></Target><TargetHealth><State>healthy</State></TargetHealth></member><member><Target><Id>i-0bbb</Id><Port>80</Port></Target><TargetHealth><State>unhealthy</State><Reason>Target.ResponseCodeMismatch</Reason><Description>Health checks failed with these codes: [502]</Description></TargetHealth></member><member><Target><Id>10.0.0.9</Id><Port>8080</Port></Target><TargetHealth><State>unhealthy</State><Reason>Target.Timeout</Reason><Description>Request timed out</Description></TargetHealth></member></TargetHealthDescriptions>`;
}

describe("AWS target-health", () => {
  test("a target group: DescribeTargetHealth, a summary by state, and why each one that is not healthy is not", async () => {
    const { text, fake } = await read(`cloud target-health ${TG_ARN}`, {
      "elasticloadbalancing:DescribeTargetHealth": (): FakeResponse => {
        return awsXml("DescribeTargetHealth", targetHealthXml());
      },
    });

    expect(Object.fromEntries(fake.calls[0]!.form.entries())).toEqual({
      Action: "DescribeTargetHealth",
      Version: "2015-12-01",
      TargetGroupArn: TG_ARN,
    });
    expectSigned(fake.calls[0]!);
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (ELB DescribeTargetHealth): target health of target group ${TG_ARN}`,
      "summary: 3 targets: healthy 1, unhealthy 2",
      "targets (3):",
      "- i-0aaa:80 (us-east-1a): healthy",
      "- i-0bbb:80: unhealthy - Target.ResponseCodeMismatch: Health checks failed with these codes: [502]",
      "- 10.0.0.9:8080: unhealthy - Target.Timeout: Request timed out",
    ]);
  });

  test("a load balancer: each of its target groups (DescribeTargetGroups by LoadBalancerArn), then each one's health", async () => {
    const { text, fake } = await read(`cloud target-health ${LB_ARN}`, {
      "elasticloadbalancing:DescribeTargetGroups": (): FakeResponse => {
        return awsXml(
          "DescribeTargetGroups",
          `<TargetGroups><member><TargetGroupArn>${TG_ARN}</TargetGroupArn><TargetGroupName>web-tg</TargetGroupName><Protocol>HTTP</Protocol><Port>80</Port></member><member><TargetGroupArn>${TG2_ARN}</TargetGroupArn><TargetGroupName>api-tg</TargetGroupName><Protocol>HTTP</Protocol><Port>8080</Port></member></TargetGroups>`,
        );
      },
      "elasticloadbalancing:DescribeTargetHealth": (
        call: AwsLiveCall,
      ): FakeResponse => {
        return call.form.get("TargetGroupArn") === TG_ARN
          ? awsXml("DescribeTargetHealth", targetHealthXml())
          : awsXml("DescribeTargetHealth", "<TargetHealthDescriptions/>");
      },
    });

    expect(Object.fromEntries(fake.calls[0]!.form.entries())).toEqual({
      Action: "DescribeTargetGroups",
      Version: "2015-12-01",
      LoadBalancerArn: LB_ARN,
    });
    expect(
      fake
        .callsTo("elasticloadbalancing:DescribeTargetHealth")
        .map((call: AwsLiveCall): string | null => {
          return call.form.get("TargetGroupArn");
        }),
    ).toEqual([TG_ARN, TG2_ARN]);
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (ELB DescribeTargetGroups, DescribeTargetHealth): target health of load balancer ${LB_ARN}`,
      "target group web-tg (HTTP 80; healthy 1, unhealthy 2) (3):",
      "- i-0aaa:80 (us-east-1a): healthy",
      "- i-0bbb:80: unhealthy - Target.ResponseCodeMismatch: Health checks failed with these codes: [502]",
      "- 10.0.0.9:8080: unhealthy - Target.Timeout: Request timed out",
      "target group api-tg (HTTP 8080): no targets registered",
    ]);
  });
});

// ---- quota-usage -----------------------------------------------------------------

function quota(data: {
  code: string;
  name: string;
  value: number;
  unit?: string;
  usage?: JSONObject;
}): JSONObject {
  return {
    ServiceCode: "ec2",
    QuotaCode: data.code,
    QuotaName: data.name,
    Value: data.value,
    Unit: data.unit || "None",
    ...(data.usage ? { UsageMetric: data.usage } : {}),
  };
}

describe("AWS quota-usage", () => {
  test("ListServiceQuotas of the resource's service in its Region, with usage from CloudWatch (Maximum over the last hour), highest first", async () => {
    const { text, fake } = await read(
      `cloud quota-usage ${EC2_ARN} --limit 3`,
      {
        "servicequotas:ListServiceQuotas": (
          call: AwsLiveCall,
        ): FakeResponse => {
          return call.json["NextToken"]
            ? awsJson({
                Quotas: [
                  quota({
                    code: "L-0263D0A3",
                    name: "EC2-VPC Elastic IPs",
                    value: 5,
                    usage: {
                      MetricNamespace: "AWS/Usage",
                      MetricName: "ResourceCount",
                      MetricDimensions: {
                        Service: "EC2",
                        Type: "Resource",
                        Resource: "ElasticIP",
                      },
                    },
                  }),
                ],
              })
            : awsJson({
                Quotas: [
                  quota({
                    code: "L-1216C47A",
                    name: "Running On-Demand Standard instances",
                    value: 128,
                    unit: "vCPU",
                    usage: {
                      MetricNamespace: "AWS/Usage",
                      MetricName: "ResourceCount",
                      MetricDimensions: {
                        Service: "EC2",
                        Type: "Resource",
                        Resource: "vCPU",
                        Class: "Standard/OnDemand",
                      },
                      MetricStatisticRecommendation: "Maximum",
                    },
                  }),
                  quota({ code: "L-AAAA", name: "AMIs", value: 50000 }),
                  quota({
                    code: "L-BBBB",
                    name: "Spot instances",
                    value: 64,
                    usage: {
                      MetricNamespace: "AWS/Usage",
                      MetricName: "ResourceCount",
                      MetricDimensions: { Resource: "Spot" },
                    },
                  }),
                ],
                NextToken: "page-2",
              });
        },
        "monitoring:GetMetricData": (call: AwsLiveCall): FakeResponse => {
          const queries: Array<JSONObject> = call.json[
            "MetricDataQueries"
          ] as Array<JSONObject>;

          return awsJson({
            MetricDataResults: queries
              .filter((query: JSONObject): boolean => {
                return query["Id"] !== "q2";
              })
              .map((query: JSONObject) => {
                const values: Record<string, Array<number>> = {
                  q0: [60, 96, 80],
                  q3: [4],
                };

                return {
                  Id: query["Id"],
                  Timestamps: (values[String(query["Id"])] || []).map(
                    (_value: number, index: number): number => {
                      return seconds("2026-10-27T09:10:00Z") + index * 300;
                    },
                  ),
                  Values: values[String(query["Id"])] || [],
                };
              }),
          });
        },
      },
    );

    const listed: Array<AwsLiveCall> = fake.callsTo(
      "servicequotas:ListServiceQuotas",
    );
    expect(listed[0]!.request.url).toBe(
      "https://servicequotas.us-east-1.amazonaws.com/",
    );
    expect(listed[0]!.target).toBe("ServiceQuotasV20190624.ListServiceQuotas");
    expect(listed[0]!.json).toEqual({ ServiceCode: "ec2", MaxResults: 100 });
    expect(listed[1]!.json).toEqual({
      ServiceCode: "ec2",
      MaxResults: 100,
      NextToken: "page-2",
    });

    const metrics: AwsLiveCall = fake.callsTo("monitoring:GetMetricData")[0]!;
    expect(metrics.request.url).toBe(
      "https://monitoring.us-east-1.amazonaws.com/",
    );
    expect(metrics.json["StartTime"]).toBe(seconds("2026-10-27T09:00:00Z"));
    expect(metrics.json["EndTime"]).toBe(seconds("2026-10-27T10:00:00Z"));
    expect((metrics.json["MetricDataQueries"] as Array<JSONObject>)[0]).toEqual(
      {
        Id: "q0",
        MetricStat: {
          Metric: {
            Namespace: "AWS/Usage",
            MetricName: "ResourceCount",
            Dimensions: [
              { Name: "Class", Value: "Standard/OnDemand" },
              { Name: "Resource", Value: "vCPU" },
              { Name: "Service", Value: "EC2" },
              { Name: "Type", Value: "Resource" },
            ],
          },
          Period: 300,
          Stat: "Maximum",
        },
        ReturnData: true,
      },
    );

    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (Service Quotas ListServiceQuotas, CloudWatch GetMetricData): the ec2 service quotas in us-east-1, for EC2 instance ${EC2_ARN}, highest usage first`,
      "quotas (3 of 4):",
      "- EC2-VPC Elastic IPs (ec2 L-0263D0A3): 4 of 5 (80%)",
      "- Running On-Demand Standard instances (ec2 L-1216C47A): 96 of 128 vCPU (75%)",
      "- AMIs (ec2 L-AAAA): limit 50000, usage not reported",
    ]);
  });

  test("an ECS service's quotas are ECS's and Fargate's", async () => {
    const { fake } = await read(`cloud quota-usage ${ECS_ARN}`, {
      "servicequotas:ListServiceQuotas": (): FakeResponse => {
        return awsJson({ Quotas: [] });
      },
    });

    expect(
      fake.calls.map((call: AwsLiveCall): unknown => {
        return call.json["ServiceCode"];
      }),
    ).toEqual(["ecs", "fargate"]);
  });

  test("usage CloudWatch will not give is a note; the limits are still shown", async () => {
    const { text } = await read(`cloud quota-usage ${EC2_ARN}`, {
      "servicequotas:ListServiceQuotas": (): FakeResponse => {
        return awsJson({
          Quotas: [
            quota({
              code: "L-1",
              name: "Elastic IPs",
              value: 5,
              usage: {
                MetricNamespace: "AWS/Usage",
                MetricName: "ResourceCount",
                MetricDimensions: { Resource: "ElasticIP" },
              },
            }),
          ],
        });
      },
      "monitoring:GetMetricData": (): FakeResponse => {
        return awsJsonError(400, "AccessDeniedException", "not authorized");
      },
    });

    expect(text).toContain(
      "- Elastic IPs (ec2 L-1): limit 5, no usage in the last hour",
    );
    expect(text).toContain(
      "note: Quota usage not read: the connection may not call cloudwatch:GetMetricData.",
    );
  });

  test("a resource in no Region is refused", async () => {
    const error: unknown = await readError(
      `cloud quota-usage ${BUCKET_ARN}`,
      {},
    );

    expect((error as CloudLiveReadError).reason).toBe("refused");
    expect((error as CloudLiveReadError).message).toBe(
      "arn:aws:s3:::orders-bucket names no AWS Region, and cloud quota-usage reads one Region.",
    );
  });

  test("Service Quotas the role may not read names servicequotas:ListServiceQuotas", async () => {
    const error: unknown = await readError(`cloud quota-usage ${EC2_ARN}`, {
      "servicequotas:ListServiceQuotas": (): FakeResponse => {
        return awsJsonError(400, "AccessDeniedException", "not authorized");
      },
    });

    expect((error as CloudLiveReadError).permission).toBe(
      "servicequotas:ListServiceQuotas",
    );
  });
});

// ---- read-logs ---------------------------------------------------------------------

interface StoredLogEvent {
  timestamp: number;
  message: string;
  logStreamName?: string;
}

/*
 * CloudWatch Logs FilterLogEvents over a store of events: the ones in
 * [startTime, endTime] holding the quoted term, oldest first, a page of at
 * most pageSize, with a nextToken when there are more.
 */
function filterLogEvents(
  store: Record<string, Array<StoredLogEvent>>,
  pageSize: number = 10000,
): AwsLiveHandler {
  return (call: AwsLiveCall): FakeResponse => {
    const group: string = String(call.json["logGroupName"]);
    const start: number = Number(call.json["startTime"]);
    const end: number = Number(call.json["endTime"]);
    const pattern: string = String(call.json["filterPattern"] || "");
    const term: string = pattern.startsWith('"')
      ? pattern.slice(1, -1)
      : pattern;

    if (!store[group]) {
      return awsJsonError(
        400,
        "ResourceNotFoundException",
        "The specified log group does not exist.",
      );
    }

    const matching: Array<StoredLogEvent> = store[group]!.filter(
      (event: StoredLogEvent): boolean => {
        return (
          event.timestamp >= start &&
          event.timestamp <= end &&
          (!term || event.message.includes(term))
        );
      },
    ).sort((a: StoredLogEvent, b: StoredLogEvent): number => {
      return a.timestamp - b.timestamp;
    });

    return awsJson({
      events: matching.slice(0, pageSize).map((event: StoredLogEvent) => {
        return {
          logStreamName: event.logStreamName || "2026/10/27/[$LATEST]abc",
          timestamp: event.timestamp,
          message: event.message,
          eventId: `${group}-${event.timestamp}`,
        };
      }),
      ...(matching.length > pageSize ? { nextToken: "more" } : {}),
    });
  };
}

function at(iso: string): number {
  return Date.parse(iso);
}

describe("AWS read-logs", () => {
  test("a Lambda function: its own log group (LoggingConfig), FilterLogEvents with the quoted --filter over --minutes, newest first", async () => {
    const { text, fake } = await read(
      `cloud read-logs ${LAMBDA_ARN} --filter "Task timed out" --minutes 30 --limit 2`,
      {
        "lambda:GetFunctionConfiguration": (): FakeResponse => {
          return awsJson(
            lambdaConfiguration({
              LoggingConfig: { LogGroup: "/custom/checkout" },
            }),
          );
        },
        "logs:FilterLogEvents": filterLogEvents({
          "/custom/checkout": [
            {
              timestamp: at("2026-10-27T09:20:00Z"),
              message: "Task timed out after 30.03 seconds (too old)",
            },
            {
              timestamp: at("2026-10-27T09:40:00Z"),
              message: "Task timed out after 30.01 seconds",
            },
            {
              timestamp: at("2026-10-27T09:45:00Z"),
              message: "START RequestId: 1",
            },
            {
              timestamp: at("2026-10-27T09:50:00.250Z"),
              message: "Task timed out after 30.02 seconds\n",
            },
            {
              timestamp: at("2026-10-27T09:55:00Z"),
              message:
                "Task timed out after 30.00 seconds\nat handler (index.js:10)",
            },
          ],
        }),
      },
    );

    const filter: AwsLiveCall = fake.callsTo("logs:FilterLogEvents")[0]!;
    expect(filter.request.url).toBe("https://logs.us-east-1.amazonaws.com/");
    expect(filter.target).toBe("Logs_20140328.FilterLogEvents");
    expect(filter.json).toEqual({
      logGroupName: "/custom/checkout",
      startTime: at("2026-10-27T09:30:00Z"),
      endTime: at("2026-10-27T10:00:00Z"),
      limit: 10000,
      filterPattern: '"Task timed out"',
    });
    expectSigned(filter);
    expect(lines(text)).toEqual([
      `Live from AWS at 2026-10-27T10:00:00Z (CloudWatch Logs FilterLogEvents): log lines of Lambda function ${LAMBDA_ARN} from /custom/checkout, the last 30 minutes, containing "Task timed out", newest first`,
      "lines (2):",
      "- 2026-10-27T09:55:00.000Z [2026/10/27/[$LATEST]abc] Task timed out after 30.00 seconds ⏎ at handler (index.js:10)",
      "- 2026-10-27T09:50:00.250Z [2026/10/27/[$LATEST]abc] Task timed out after 30.02 seconds",
    ]);
  });

  test("a function whose configuration cannot be read is read from /aws/lambda/<name>, with a note", async () => {
    const { text, fake } = await read(`cloud read-logs ${LAMBDA_ARN}`, {
      "lambda:GetFunctionConfiguration": (): FakeResponse => {
        return {
          status: 403,
          body: JSON.stringify({ message: "not authorized" }),
        };
      },
      "logs:FilterLogEvents": filterLogEvents({ "/aws/lambda/checkout": [] }),
    });

    expect(fake.callsTo("logs:FilterLogEvents")[0]!.json["logGroupName"]).toBe(
      "/aws/lambda/checkout",
    );
    expect(
      fake.callsTo("logs:FilterLogEvents")[0]!.json["filterPattern"],
    ).toBeUndefined();
    expect(text).toContain("lines: none in the last 60 minutes");
    expect(text).toContain(
      "note: The function's own log group setting not read: the connection may not call lambda:GetFunctionConfiguration.",
    );
  });

  test("a busy log is read again from its end, so the newest lines are the ones shown", async () => {
    const events: Array<StoredLogEvent> = [];

    // A line every 36 seconds for the last hour: 100 lines.
    for (let index: number = 0; index < 100; index++) {
      events.push({
        timestamp: at("2026-10-27T09:00:18Z") + index * 36 * 1000,
        message: `line ${index}`,
      });
    }

    const { text, fake } = await read(
      `cloud read-logs ${LOG_GROUP_ARN} --limit 5`,
      {
        "logs:FilterLogEvents": filterLogEvents({ "/custom/app": events }, 10),
      },
    );

    expect(lines(text).slice(1)).toEqual([
      "lines (5):",
      "- 2026-10-27T09:59:42.000Z [2026/10/27/[$LATEST]abc] line 99",
      "- 2026-10-27T09:59:06.000Z [2026/10/27/[$LATEST]abc] line 98",
      "- 2026-10-27T09:58:30.000Z [2026/10/27/[$LATEST]abc] line 97",
      "- 2026-10-27T09:57:54.000Z [2026/10/27/[$LATEST]abc] line 96",
      "- 2026-10-27T09:57:18.000Z [2026/10/27/[$LATEST]abc] line 95",
    ]);
    expect(text).toContain(
      `log lines of log group ${LOG_GROUP_ARN} from /custom/app`,
    );
    // The whole hour once, then one window at its end.
    expect(fake.callsTo("logs:FilterLogEvents").length).toBeLessThanOrEqual(3);
    expect(text).not.toContain("note:");
  });

  test("a window that still holds more than a page is narrowed until it does not", async () => {
    const events: Array<StoredLogEvent> = [];

    for (let index: number = 0; index < 100; index++) {
      events.push({
        timestamp: at("2026-10-27T09:00:18Z") + index * 36 * 1000,
        message: `line ${index}`,
      });
    }

    const { text, fake } = await read(
      `cloud read-logs ${LOG_GROUP_ARN} --limit 5`,
      { "logs:FilterLogEvents": filterLogEvents({ "/custom/app": events }, 3) },
    );

    expect(
      lines(text)
        .slice(2)
        .map((line: string): string => {
          return line.slice(line.lastIndexOf(" ") + 1);
        }),
    ).toEqual(["99", "98", "97", "96", "95"]);
    expect(fake.callsTo("logs:FilterLogEvents").length).toBeLessThan(20);
    expect(text).not.toContain("note:");
  });

  test("a read the budget stops says lines may be missing", async () => {
    const events: Array<StoredLogEvent> = [];

    for (let index: number = 0; index < 100; index++) {
      events.push({
        timestamp: at("2026-10-27T09:00:18Z") + index * 36 * 1000,
        message: `line ${index}`,
      });
    }

    const { text } = await read(
      `cloud read-logs ${LOG_GROUP_ARN} --limit 50`,
      { "logs:FilterLogEvents": filterLogEvents({ "/custom/app": events }, 3) },
      { maxRequests: 2 },
    );

    expect(text).toContain(
      "note: The read stopped at its request limit, or a second of the log held more lines than one page: lines may be missing between the ones shown.",
    );
  });

  test("an ECS service: the awslogs group of its task definition's containers (DescribeTaskDefinition), never their environment", async () => {
    const { text, fake } = await read(`cloud read-logs ${ECS_ARN} --limit 1`, {
      "ecs:DescribeServices": describeServices(),
      "ecs:DescribeTaskDefinition": (): FakeResponse => {
        return awsJson({
          taskDefinition: {
            family: "web",
            revision: 42,
            containerDefinitions: [
              {
                name: "web",
                environment: [
                  { name: "API_TOKEN", value: "task-env-secret" },
                  {
                    name: "ONEUPTIME_TELEMETRY_INGESTION_KEY",
                    value: "agent-ingestion-key-0123456789",
                  },
                ],
                secrets: [{ name: "DB", valueFrom: "arn:aws:ssm:x" }],
                logConfiguration: {
                  logDriver: "awslogs",
                  options: {
                    "awslogs-group": "/ecs/web",
                    "awslogs-region": "us-west-2",
                    "awslogs-stream-prefix": "ecs",
                  },
                },
              },
              {
                name: "sidecar",
                logConfiguration: {
                  logDriver: "awsfirelens",
                  options: { Name: "datadog" },
                },
              },
            ],
          },
        });
      },
      "logs:FilterLogEvents": filterLogEvents({
        "/ecs/web": [
          {
            timestamp: at("2026-10-27T09:59:00Z"),
            message: "ERROR connection refused",
            logStreamName: "ecs/web/0123456789abcdef0123456789abcdef",
          },
        ],
      }),
    });

    expect(fake.callsTo("ecs:DescribeTaskDefinition")[0]!.json).toEqual({
      taskDefinition: TASK_DEFINITION,
    });
    const filter: AwsLiveCall = fake.callsTo("logs:FilterLogEvents")[0]!;
    // The group's own Region, as the task definition names it.
    expect(filter.request.url).toBe("https://logs.us-west-2.amazonaws.com/");
    expect(filter.json["logGroupName"]).toBe("/ecs/web");
    expect(text).toContain(
      "- 2026-10-27T09:59:00.000Z [ecs/web/0123456789abcdef0123456789abcdef] ERROR connection refused",
    );
    expect(text).not.toContain("task-env-secret");
    expect(text).not.toContain("agent-ingestion-key");
    expect(text).not.toContain("ONEUPTIME_TELEMETRY_INGESTION_KEY");
    expect(text).not.toContain("arn:aws:ssm");
  });

  test("an ECS service that sends no logs to CloudWatch is refused, saying so", async () => {
    const error: unknown = await readError(`cloud read-logs ${ECS_ARN}`, {
      "ecs:DescribeServices": describeServices(),
      "ecs:DescribeTaskDefinition": (): FakeResponse => {
        return awsJson({
          taskDefinition: {
            containerDefinitions: [
              { name: "web", logConfiguration: { logDriver: "awsfirelens" } },
            ],
          },
        });
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("refused");
    expect((error as CloudLiveReadError).message).toContain(
      "sends no container's logs to CloudWatch Logs",
    );
  });

  test("an RDS instance: its exported log groups (DescribeLogGroups by prefix), the error log first", async () => {
    const { text, fake } = await read(`cloud read-logs ${RDS_ARN} --limit 3`, {
      "logs:DescribeLogGroups": (): FakeResponse => {
        return awsJson({
          logGroups: [
            { logGroupName: "/aws/rds/instance/orders/upgrade" },
            { logGroupName: "/aws/rds/instance/orders/postgresql" },
          ],
        });
      },
      "logs:FilterLogEvents": filterLogEvents({
        "/aws/rds/instance/orders/postgresql": [
          {
            timestamp: at("2026-10-27T09:58:00Z"),
            message: "FATAL: remaining connection slots are reserved",
          },
        ],
        "/aws/rds/instance/orders/upgrade": [
          { timestamp: at("2026-10-27T09:59:00Z"), message: "upgrade check" },
        ],
      }),
    });

    expect(fake.callsTo("logs:DescribeLogGroups")[0]!.json).toEqual({
      logGroupNamePrefix: "/aws/rds/instance/orders/",
      limit: 50,
    });
    expect(
      fake.callsTo("logs:FilterLogEvents").map((call: AwsLiveCall): unknown => {
        return call.json["logGroupName"];
      }),
    ).toEqual([
      "/aws/rds/instance/orders/postgresql",
      "/aws/rds/instance/orders/upgrade",
    ]);
    // Lines of several groups say which group each is from.
    expect(text).toContain(
      "- 2026-10-27T09:59:00.000Z [/aws/rds/instance/orders/upgrade 2026/10/27/[$LATEST]abc] upgrade check",
    );
    expect(text).toContain(
      "- 2026-10-27T09:58:00.000Z [/aws/rds/instance/orders/postgresql 2026/10/27/[$LATEST]abc] FATAL: remaining connection slots are reserved",
    );
  });

  test("a database that exports no logs is refused, saying how to export them", async () => {
    const error: unknown = await readError(`cloud read-logs ${AURORA_ARN}`, {
      "logs:DescribeLogGroups": (): FakeResponse => {
        return awsJson({ logGroups: [] });
      },
    });

    expect((error as CloudLiveReadError).message).toBe(
      "The Aurora cluster orders-cluster exports no logs to CloudWatch Logs (no log group starts with /aws/rds/cluster/orders-cluster/), so there are no log lines to read here. Turn on its log exports to read them.",
    );
  });

  test("anything else is refused, naming what read-logs reads", async () => {
    const error: unknown = await readError(`cloud read-logs ${SQS_ARN}`, {});

    expect((error as CloudLiveReadError).reason).toBe("refused");
    expect((error as CloudLiveReadError).message).toBe(
      `cloud read-logs reads the CloudWatch Logs of a Lambda function, an ECS service, an RDS instance or Aurora cluster, or a log group named by its ARN (arn:aws:logs:REGION:ACCOUNT:log-group:NAME) on AWS; ${SQS_ARN} is none of those.`,
    );
  });

  test("FilterLogEvents the role may not call names logs:FilterLogEvents", async () => {
    const error: unknown = await readError(`cloud read-logs ${LOG_GROUP_ARN}`, {
      "logs:FilterLogEvents": (): FakeResponse => {
        return awsJsonError(400, "AccessDeniedException", "not authorized");
      },
    });

    expect((error as CloudLiveReadError).permission).toBe(
      "logs:FilterLogEvents",
    );
  });

  test("a log group that is not there is said to be missing", async () => {
    const error: unknown = await readError(`cloud read-logs ${LOG_GROUP_ARN}`, {
      "logs:FilterLogEvents": filterLogEvents({}),
    });

    expect((error as CloudLiveReadError).reason).toBe("not-found");
    expect((error as CloudLiveReadError).message).toContain(
      "AWS has no log group /custom/app in us-east-1 (ResourceNotFoundException)",
    );
  });

  test("a --filter becomes one quoted term of the characters the catalog allows", () => {
    expect(toAwsFilterPattern("connection refused")).toBe(
      '"connection refused"',
    );
    expect(toAwsFilterPattern('a"b\\c')).toBe('"abc"');
    expect(toAwsFilterPattern("status=500 (POST /api)")).toBe(
      '"status=500 (POST /api)"',
    );
  });
});
