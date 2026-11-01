import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import { createExecutor } from "../Executors/ExecutorFactory";
import CloudExecutor, { describeCloudUndo } from "../Executors/CloudExecutor";
import {
  ExecResult,
  PrepareResult,
  ResourceExecutor,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import { CloudTransportError } from "../Executors/Cloud/CloudHttp";
import { redactOutput } from "../Executors/SpawnSandbox";
import { fakePolicy } from "./Helpers/FakeExecutor";
import {
  AWS_ACCOUNT,
  AWS_TASK_ACCESS_KEY,
  AWS_TASK_CALLER_ARN,
  AWS_WRITE_ROLE_ARN,
  AwsCall,
  AssumeRoleCall,
  FakeAnswer,
  awsJsonError,
  awsQueryError,
  ec2Error,
  jsonReply,
  xmlReply,
} from "./Helpers/FakeCloud";
import {
  CloudHarness,
  assertChanged,
  assertNotRun,
  cloudHarness,
  cloudRequest,
  outputLines,
  prepared,
  refusalOf,
  runCloud,
} from "./Helpers/CloudHarness";
import { TEST_RESOURCE_ID } from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_RESOURCE_AGENT_OUTPUT_BYTES,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  CloudCommandParse,
  formatCloudReplacedValue,
  parseCloudCommand,
  readCloudReplacedValue,
} from "../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * The Cloud AI agent's executor against fake clouds (Helpers/FakeCloud):
 * every request it would send is recorded exactly — and for AWS its SigV4
 * signature verified and its assumed-role session's policy enforced — so
 * each check before a change, the ONE call a change makes, what it
 * reports (the replaced value first) and how each failure reads are pinned
 * without a cloud. This file holds the shared contract and AWS; Azure and
 * Google Cloud have files of their own, and the building blocks (SigV4,
 * the XML reader, the settings, the transport) CloudPrimitives.test.ts.
 */

const REFUSED: string = "Refused by the Cloud AI agent";

const ECS_ARN: string = `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:service/prod/web`;
const ECS_TASK_DEFINITION: string = `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:task-definition/web:41`;
const EC2_ARN: string = `arn:aws:ec2:us-east-1:${AWS_ACCOUNT}:instance/i-0abc1234def567890`;
const RDS_ARN: string = `arn:aws:rds:us-east-1:${AWS_ACCOUNT}:db:orders`;
const AURORA_ARN: string = `arn:aws:rds:us-east-1:${AWS_ACCOUNT}:cluster:orders-aurora`;
const ASG_ARN: string = `arn:aws:autoscaling:us-east-1:${AWS_ACCOUNT}:autoScalingGroup:0e9d8c7b-6a5f-4e3d-2c1b-0a9f8e7d6c5b:autoScalingGroupName/web-asg`;
const LAMBDA_ARN: string = `arn:aws:lambda:us-east-1:${AWS_ACCOUNT}:function:checkout`;
const LAMBDA_ALIAS_ARN: string = `${LAMBDA_ARN}:live`;
const SQS_ARN: string = `arn:aws:sqs:us-east-1:${AWS_ACCOUNT}:orders-dlq`;
const SQS_SOURCE_ARN: string = `arn:aws:sqs:us-east-1:${AWS_ACCOUNT}:orders`;

// ---- AWS fixtures -------------------------------------------------------------------------

function ecsService(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    serviceArn: ECS_ARN,
    serviceName: "web",
    clusterArn: `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:cluster/prod`,
    status: "ACTIVE",
    desiredCount: 2,
    runningCount: 2,
    pendingCount: 0,
    taskDefinition: ECS_TASK_DEFINITION,
    deployments: [
      { id: "ecs-svc/1111111111111111111", status: "PRIMARY", desiredCount: 2 },
    ],
    tags: [{ key: "team", value: "shop" }],
    ...overrides,
  };
}

function withEcsService(
  h: CloudHarness,
  overrides: Record<string, unknown> = {},
): void {
  h.aws.handle("ecs:DescribeServices", (): FakeAnswer => {
    return jsonReply({ services: [ecsService(overrides)], failures: [] });
  });
  h.aws.handle("ecs:UpdateService", (call: AwsCall): FakeAnswer => {
    return jsonReply({
      service: {
        ...ecsService(overrides),
        deployments: [
          { id: "ecs-svc/2222222222222222222", status: "PRIMARY" },
          { id: "ecs-svc/1111111111111111111", status: "ACTIVE" },
        ],
        ...(call.json || {}),
      },
    });
  });
}

function withScalableTarget(
  h: CloudHarness,
  target: { min: number; max: number } | null,
): void {
  h.aws.handle(
    "application-autoscaling:DescribeScalableTargets",
    (): FakeAnswer => {
      return jsonReply({
        ScalableTargets: target
          ? [
              {
                ServiceNamespace: "ecs",
                ResourceId: "service/prod/web",
                ScalableDimension: "ecs:service:DesiredCount",
                MinCapacity: target.min,
                MaxCapacity: target.max,
              },
            ]
          : [],
      });
    },
  );
}

function ec2DescribeXml(state: string, tags: string = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<DescribeInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
  <requestId>req-1</requestId>
  <reservationSet>
    <item>
      <reservationId>r-0123</reservationId>
      <ownerId>${AWS_ACCOUNT}</ownerId>
      <instancesSet>
        <item>
          <instanceId>i-0abc1234def567890</instanceId>
          <instanceState><code>16</code><name>${state}</name></instanceState>
          <tagSet>${tags}</tagSet>
        </item>
      </instancesSet>
    </item>
  </reservationSet>
</DescribeInstancesResponse>`;
}

function rdsInstanceXml(fields: Record<string, string>): string {
  const body: string = Object.entries(fields)
    .map(([name, value]: [string, string]): string => {
      return `<${name}>${value}</${name}>`;
    })
    .join("");

  return `<DescribeDBInstancesResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/">
  <DescribeDBInstancesResult><DBInstances><DBInstance>
    <DBInstanceIdentifier>orders</DBInstanceIdentifier>
    ${body}
  </DBInstance></DBInstances></DescribeDBInstancesResult>
  <ResponseMetadata><RequestId>req-1</RequestId></ResponseMetadata>
</DescribeDBInstancesResponse>`;
}

function asgXml(fields: Record<string, string>): string {
  const body: string = Object.entries({
    AutoScalingGroupName: "web-asg",
    AutoScalingGroupARN: ASG_ARN,
    MinSize: "2",
    MaxSize: "6",
    DesiredCapacity: "3",
    ...fields,
  })
    .map(([name, value]: [string, string]): string => {
      return `<${name}>${value}</${name}>`;
    })
    .join("");

  return `<DescribeAutoScalingGroupsResponse xmlns="http://autoscaling.amazonaws.com/doc/2011-01-01/">
  <DescribeAutoScalingGroupsResult><AutoScalingGroups><member>${body}<Tags><member><Key>oneuptime-ai</Key><Value>allow</Value><ResourceId>web-asg</ResourceId><ResourceType>auto-scaling-group</ResourceType><PropagateAtLaunch>true</PropagateAtLaunch></member></Tags></member></AutoScalingGroups></DescribeAutoScalingGroupsResult>
</DescribeAutoScalingGroupsResponse>`;
}

function okXml(action: string): FakeAnswer {
  return xmlReply(
    `<${action}Response><ResponseMetadata><RequestId>req-1</RequestId></ResponseMetadata></${action}Response>`,
  );
}

// The one session the change assumed, with its policy.
function onlySession(h: CloudHarness): AssumeRoleCall {
  assert.strictEqual(h.aws.assumed.length, 1, "one write session per change");
  return h.aws.assumed[0] as AssumeRoleCall;
}

function assertCleanAws(h: CloudHarness): void {
  assert.deepStrictEqual(h.aws.signatureFailures, []);
  assert.deepStrictEqual(h.aws.policyDenials, []);
}

// ---- prepare ------------------------------------------------------------------------------

describe("prepare: the shared checks run first", () => {
  test("the factory builds a CloudExecutor for every cloud", () => {
    for (const cloud of ["aws", "azure", "gcp"] as const) {
      const h: CloudHarness = cloudHarness(cloud);
      const executor: ResourceExecutor = createExecutor({
        config: h.config,
        env: h.env,
        tmpDir: "/tmp",
        logger: h.logger,
      });

      assert.ok(executor instanceof CloudExecutor, cloud);
    }
  });

  test("a command for another account is refused before anything is sent", () => {
    const h: CloudHarness = cloudHarness("aws");

    assert.match(
      refusalOf(h, "aws", "cloud whoami", {
        origin: "AiInvestigation",
        payload: { resourceIdentifier: "999999999999" },
      }),
      /^Refused by the Cloud AI agent: this command is for AWS account "999999999999", but this agent serves "123456789012"/,
    );
    assert.deepStrictEqual(h.cloud.requests, []);
  });

  test("an investigation may only run whoami; a change needs ONEUPTIME_AI_ALLOW_WRITES=true", () => {
    const h: CloudHarness = cloudHarness("aws");

    assert.match(
      refusalOf(h, "aws", `cloud restart-service ${ECS_ARN}`, {
        origin: "AiInvestigation",
      }),
      /an investigation may only run read-only commands, and "cloud restart-service arn:aws:ecs:us-east-1:123456789012:service\/prod\/web" is SafeWrite/,
    );

    const readOnly: CloudHarness = cloudHarness("aws", { writes: false });

    assert.match(
      refusalOf(readOnly, "aws", `cloud restart-service ${ECS_ARN}`),
      /changes the AWS account, and this agent is read-only \(ONEUPTIME_AI_ALLOW_WRITES is not set\)/,
    );
    assert.deepStrictEqual(readOnly.cloud.requests, []);
  });

  test("a change outside ONEUPTIME_AI_WRITE_TARGETS is refused", () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_WRITE_TARGETS: "arn:aws:ecs:*:service/staging/*" },
    });

    assert.match(
      refusalOf(h, "aws", `cloud restart-service ${ECS_ARN}`),
      /outside the targets the Cloud AI agent may change/,
    );
  });

  test("the agent's own stack is protected: its ECS service, its resource group, its Cloud Run service", () => {
    const aws: CloudHarness = cloudHarness("aws");

    assert.match(
      refusalOf(
        aws,
        "aws",
        `cloud restart-service arn:aws:ecs:eu-west-1:${AWS_ACCOUNT}:service/oneuptime-ai-agent/oneuptime-ai-agent`,
      ),
      /which the Cloud AI agent protects \(arn:aws\*:ecs:\*:123456789012:service\/oneuptime-ai-agent\/\*\)/,
    );

    const azure: CloudHarness = cloudHarness("azure");

    assert.match(
      refusalOf(
        azure,
        "azure",
        "cloud restart-service /subscriptions/0b1c2d3e-4f50-4172-8394-a5b6c7d8e9f0/resourceGroups/OneUptime-AI-Agent/providers/Microsoft.App/containerApps/oneuptime-ai-agent",
      ),
      /which the Cloud AI agent protects/,
    );

    const gcp: CloudHarness = cloudHarness("gcp");

    assert.match(
      refusalOf(
        gcp,
        "gcp",
        "cloud scale-out //run.googleapis.com/projects/shop-prod-1234/locations/us-central1/services/oneuptime-ai-agent --count 2",
      ),
      /which the Cloud AI agent protects/,
    );
  });

  test("ONEUPTIME_AI_PROTECTED_TARGETS adds to what the agent protects", () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_PROTECTED_TARGETS: "arn:aws:ecs:*:service/prod/*" },
    });

    assert.match(
      refusalOf(h, "aws", `cloud restart-service ${ECS_ARN}`),
      /protects \(arn:aws:ecs:\*:service\/prod\/\*\)/,
    );
  });

  test("a command the cloud catalog cannot read is refused (only an injected policy can send one)", () => {
    const h: CloudHarness = cloudHarness("aws", {
      guardPolicy: fakePolicy({ "cloud reboot": ResourceCommandTier.Read }),
    });

    assert.match(
      refusalOf(h, "aws", "cloud reboot", {
        origin: "AiInvestigation",
        payload: { tier: "Read" },
      }),
      /^Refused by the Cloud AI agent: its cloud catalog refuses "cloud reboot": "reboot" is not a cloud operation; write reboot-instance instead\.$/,
    );
  });

  test("a change the policy under-tiers is refused (the catalog's tier wins)", () => {
    const command: string = `cloud reboot-instance ${EC2_ARN}`;
    const h: CloudHarness = cloudHarness("aws", {
      guardPolicy: fakePolicy({
        [command]: { tier: ResourceCommandTier.SafeWrite, targets: [EC2_ARN] },
      }),
    });

    assert.match(
      refusalOf(h, "aws", command, { payload: { tier: "SafeWrite" } }),
      /reads "cloud reboot-instance .*" as SafeWrite, but cloud reboot-instance is RiskyWrite in its catalog/,
    );
  });

  test("the reads run on OneUptime, never on the agent", () => {
    const h: CloudHarness = cloudHarness("aws");

    for (const command of [
      `cloud describe ${ECS_ARN}`,
      `cloud recent-events ${ECS_ARN}`,
      `cloud quota-usage ${ECS_ARN}`,
      `cloud read-logs ${ECS_ARN}`,
    ]) {
      assert.match(
        refusalOf(h, "aws", command, { origin: "AiInvestigation" }),
        /^Refused by the Cloud AI agent: cloud [a-z-]+ runs on OneUptime through the account's read-only connection, not on the agent\.$/,
        command,
      );
    }

    assert.strictEqual(
      refusalOf(h, "aws", `cloud describe ${ECS_ARN}`, {
        origin: "AiInvestigation",
      }),
      `${REFUSED}: cloud describe runs on OneUptime through the account's read-only connection, not on the agent.`,
    );
  });
});

describe("prepare: what the agent's own settings allow", () => {
  test("a change ONEUPTIME_AI_CLOUD_OPERATIONS does not enable is refused", () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_CLOUD_OPERATIONS: "restart-service, scale-out" },
    });

    assert.strictEqual(
      refusalOf(h, "aws", `cloud scale-in ${ECS_ARN} --count 1`),
      `${REFUSED}: cloud scale-in is not one of the changes this agent may make (ONEUPTIME_AI_CLOUD_OPERATIONS=restart-service,scale-out). Add it to ONEUPTIME_AI_CLOUD_OPERATIONS on the agent (and its permissions to the agent's role) to let OneUptime AI make it.`,
    );
    prepared(
      h.executor.prepare(
        cloudRequest("aws", `cloud scale-out ${ECS_ARN} --count 3`),
      ),
    );
    // whoami is a read: never in the list, always available.
    prepared(
      h.executor.prepare(
        cloudRequest("aws", "cloud whoami", { origin: "AiInvestigation" }),
      ),
    );
  });

  test("a list naming no change it knows enables nothing", () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_CLOUD_OPERATIONS: "restart, describe" },
    });

    assert.match(
      refusalOf(h, "aws", `cloud restart-service ${ECS_ARN}`),
      /\(ONEUPTIME_AI_CLOUD_OPERATIONS=nothing it knows\)/,
    );
  });

  test("an unreadable required tag or write role refuses every change, never none", () => {
    const tag: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai" },
    });

    assert.match(
      refusalOf(tag, "aws", `cloud restart-service ${ECS_ARN}`),
      /ONEUPTIME_AI_CLOUD_REQUIRED_TAG="oneuptime-ai" is not a tag written as key=value/,
    );

    const role: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_AWS_WRITE_ROLE_ARN: "OneUptimeAiAgentWrite" },
    });

    assert.match(
      refusalOf(role, "aws", `cloud restart-service ${ECS_ARN}`),
      /ONEUPTIME_AI_AWS_WRITE_ROLE_ARN="OneUptimeAiAgentWrite" is not an IAM role ARN/,
    );
  });

  test("a write role of another account is refused", () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: {
        ONEUPTIME_AI_AWS_WRITE_ROLE_ARN:
          "arn:aws:iam::210987654321:role/OneUptimeAiAgentWrite",
      },
    });

    assert.match(
      refusalOf(h, "aws", `cloud restart-service ${ECS_ARN}`),
      /names a role of account 210987654321, but the agent serves account 123456789012/,
    );
  });

  test("a resource of another account is refused: an ARN's account, a subscription, a project", () => {
    const aws: CloudHarness = cloudHarness("aws");

    assert.strictEqual(
      refusalOf(
        aws,
        "aws",
        "cloud restart-service arn:aws:ecs:us-east-1:210987654321:service/prod/web",
      ),
      `${REFUSED}: arn:aws:ecs:us-east-1:210987654321:service/prod/web is in AWS account 210987654321, and this agent acts in account 123456789012 only.`,
    );

    const azure: CloudHarness = cloudHarness("azure");

    assert.match(
      refusalOf(
        azure,
        "azure",
        "cloud restart-service /subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/prod/providers/Microsoft.Web/sites/web",
      ),
      /is in subscription 11111111-2222-3333-4444-555555555555, and this agent acts in subscription 0b1c2d3e-4f50-4172-8394-a5b6c7d8e9f0 only/,
    );

    // Azure compares subscriptions without case.
    prepared(
      azure.executor.prepare(
        cloudRequest(
          "azure",
          "cloud restart-service /subscriptions/0B1C2D3E-4F50-4172-8394-A5B6C7D8E9F0/resourceGroups/prod/providers/Microsoft.Web/sites/web",
        ),
      ),
    );

    const gcp: CloudHarness = cloudHarness("gcp");

    assert.match(
      refusalOf(
        gcp,
        "gcp",
        "cloud start-instance //compute.googleapis.com/projects/other-project/zones/us-central1-a/instances/vm-1",
      ),
      /is in Google Cloud project other-project, and this agent acts in project shop-prod-1234 only/,
    );
  });
});

// ---- whoami -------------------------------------------------------------------------------

describe("AWS: whoami", () => {
  test("names the account, the principal, the Region, the write role (which it can assume), writes, the enabled changes and the tag", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: {
        ONEUPTIME_AI_CLOUD_OPERATIONS: "restart-service,scale-out",
        ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow",
      },
      randomIds: ["aaaa1111"],
    });
    const result: ExecResult = await runCloud(h, "aws", "cloud whoami", {
      origin: "AiInvestigation",
    });

    assert.strictEqual(result.success, true, result.errorMessage || "");
    assert.strictEqual(result.exitCode, 0);
    assert.deepStrictEqual(outputLines(result), [
      "Cloud: AWS",
      "Account: 123456789012",
      `Signed in as: ${AWS_TASK_CALLER_ARN} (the ECS task role)`,
      "Region: us-east-1",
      `Write role: ${AWS_WRITE_ROLE_ARN}, assumed for each change with a session policy that allows that change alone (the agent can assume it, as arn:aws:sts::123456789012:assumed-role/OneUptimeAiAgentWrite/oneuptime-ai-whoami-aaaa1111)`,
      "Changes: allowed (ONEUPTIME_AI_ALLOW_WRITES=true)",
      "Enabled changes: restart-service, scale-out (ONEUPTIME_AI_CLOUD_OPERATIONS)",
      "Required tag: oneuptime-ai=allow (only resources that carry it are changed)",
    ]);
    // The check assumes the role with a policy that allows nothing.
    assert.deepStrictEqual(onlySession(h).policy, {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "OneUptimeAiNothing",
          Effect: "Deny",
          Action: "*",
          Resource: "*",
        },
      ],
    });
    assert.deepStrictEqual(h.aws.actions(), [
      "sts:GetCallerIdentity",
      "sts:AssumeRole",
    ]);
    assertCleanAws(h);
  });

  test("without a write role it says changes use the agent's own credentials; read-only says so", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      writes: false,
      env: { ONEUPTIME_AI_AWS_WRITE_ROLE_ARN: "" },
    });
    const lines: Array<string> = outputLines(
      await runCloud(h, "aws", "cloud whoami", { origin: "AiInvestigation" }),
    );

    assert.ok(
      lines.includes(
        "Write role: none (ONEUPTIME_AI_AWS_WRITE_ROLE_ARN is not set): changes use the agent's own credentials, with whatever they allow",
      ),
      lines.join("\n"),
    );
    assert.ok(
      lines.includes(
        "Changes: not allowed: the agent is read-only (ONEUPTIME_AI_ALLOW_WRITES is not set)",
      ),
    );
    assert.ok(
      lines.includes(
        "Enabled changes: restart-service, start-instance, scale-out, scale-in, reboot-instance, roll-back-service, set-concurrency, fail-over-database, stop-instance, redrive-queue (every change of the catalog: ONEUPTIME_AI_CLOUD_OPERATIONS is not set)",
      ),
    );
    assert.ok(
      lines.includes(
        "Required tag: none (ONEUPTIME_AI_CLOUD_REQUIRED_TAG is not set)",
      ),
    );
    assert.deepStrictEqual(h.aws.assumed, []);
  });

  test("a write role it cannot assume is said, and whoami still answers", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("sts:AssumeRole", (): FakeAnswer => {
      return awsQueryError(
        "AccessDenied",
        "User: arn:aws:sts::123456789012:assumed-role/OneUptimeAiAgentTask/x is not authorized to perform: sts:AssumeRole on resource: arn:aws:iam::123456789012:role/OneUptimeAiAgentWrite",
      );
    });

    const result: ExecResult = await runCloud(h, "aws", "cloud whoami", {
      origin: "AiInvestigation",
    });
    const writeRole: string =
      outputLines(result).find((line: string): boolean => {
        return line.startsWith("Write role:");
      }) || "";

    assert.strictEqual(result.success, true);
    assert.match(
      writeRole,
      /the agent could NOT assume it, so every change fails: AWS refused sts:AssumeRole \(HTTP 403 AccessDenied\): .*The agent's own identity \(the ECS task role arn:aws:iam::123456789012:role\/OneUptimeAiAgentTask\) may not assume/,
    );
  });

  test("credentials for another account are a warning", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_AWS_WRITE_ROLE_ARN: "" },
    });

    h.aws.callerAccount = "210987654321";

    const lines: Array<string> = outputLines(
      await runCloud(h, "aws", "cloud whoami", { origin: "AiInvestigation" }),
    );

    assert.ok(
      lines.includes(
        "Warning: these credentials are for account 210987654321, not 123456789012, so every change is refused.",
      ),
    );
  });

  test("no credentials at all: never ran, and says what to set", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "" },
    });

    assertNotRun(
      await runCloud(h, "aws", "cloud whoami", { origin: "AiInvestigation" }),
      /^The agent could not ask AWS who the agent is \(STS GetCallerIdentity\), so nothing was changed: The agent has no AWS credentials to sign with\. Run it as an ECS task with a task role \(the setup command does\), or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY\.$/,
    );
  });
});

// ---- AWS changes ----------------------------------------------------------------------------

describe("AWS: ECS services", () => {
  test("restart-service: one UpdateService with forceNewDeployment, as the write role with a policy for this change alone", async () => {
    const h: CloudHarness = cloudHarness("aws", { randomIds: ["1a2b3c4d"] });

    withEcsService(h);

    const result: ExecResult = await runCloud(
      h,
      "aws",
      `cloud restart-service ${ECS_ARN}`,
    );
    const lines: Array<string> = assertChanged(result, {});

    assert.deepStrictEqual(lines.slice(1), [
      "Started a new deployment of the ECS service web in cluster prod: its tasks (desired count 2) are replaced, on the task definition it runs now, web:41.",
      "API call: ecs:UpdateService with forceNewDeployment (forceNewDeployment=true), in us-east-1, as arn:aws:sts::123456789012:assumed-role/OneUptimeAiAgentWrite/oneuptime-ai-restart-service-1a2b3c4d (the write role, with a session policy for this change alone).",
      "Deployment: ecs-svc/2222222222222222222.",
      "Nothing to undo: the same version runs again.",
    ]);

    const session: AssumeRoleCall = onlySession(h);

    assert.strictEqual(session.roleArn, AWS_WRITE_ROLE_ARN);
    assert.strictEqual(
      session.sessionName,
      "oneuptime-ai-restart-service-1a2b3c4d",
    );
    assert.strictEqual(session.durationSeconds, "900");
    assert.strictEqual(session.callerAccessKeyId, AWS_TASK_ACCESS_KEY);
    assert.deepStrictEqual(session.policy, {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "OneUptimeAiChange",
          Effect: "Allow",
          Action: ["ecs:UpdateService"],
          Resource: [ECS_ARN],
        },
        {
          Sid: "OneUptimeAiRead",
          Effect: "Allow",
          Action: ["ecs:DescribeServices"],
          Resource: "*",
        },
      ],
    });
    assert.deepStrictEqual(h.aws.actions(), [
      "sts:AssumeRole",
      "ecs:DescribeServices",
      "ecs:UpdateService",
    ]);
    // Both ECS calls are signed by the session, in the ARN's Region.
    for (const call of [
      ...h.aws.callsTo("ecs:DescribeServices"),
      ...h.aws.callsTo("ecs:UpdateService"),
    ]) {
      assert.strictEqual(call.accessKeyId, session.accessKeyId);
      assert.strictEqual(call.region, "us-east-1");
      assert.strictEqual(call.url.hostname, "ecs.us-east-1.amazonaws.com");
      assert.strictEqual(
        call.request.headers["Content-Type"],
        "application/x-amz-json-1.1",
      );
      assert.strictEqual(
        call.request.headers["X-Amz-Security-Token"],
        "session-token-1",
      );
      assert.match(
        call.request.headers["Authorization"] || "",
        /^AWS4-HMAC-SHA256 Credential=ASIASESSION000000001\/20261027\/us-east-1\/ecs\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, Signature=[0-9a-f]{64}$/,
      );
    }

    assert.deepStrictEqual(h.aws.callsTo("ecs:DescribeServices")[0]?.json, {
      cluster: "prod",
      services: ["web"],
      include: ["TAGS"],
    });
    assert.deepStrictEqual(h.aws.callsTo("ecs:UpdateService")[0]?.json, {
      cluster: "prod",
      service: "web",
      forceNewDeployment: true,
    });
    assert.strictEqual(
      h.aws.callsTo("ecs:UpdateService")[0]?.request.headers["X-Amz-Target"],
      "AmazonEC2ContainerServiceV20141113.UpdateService",
    );
    assertCleanAws(h);
  });

  test("scale-out within the scalable target's maximum; the undo scales back in to the count it replaced", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h);
    withScalableTarget(h, { min: 1, max: 10 });

    const command: string = `cloud scale-out ${ECS_ARN} --count 8`;
    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", command),
      {
        count: "2",
      },
    );

    assert.strictEqual(
      lines[1],
      "ECS service web in cluster prod: desired count 2 → 8 (it runs 2 now).",
    );
    assert.match(
      lines[2] || "",
      /^API call: ecs:UpdateService with desiredCount \(desiredCount=8\), in us-east-1, as /,
    );
    assert.strictEqual(
      lines[3],
      "Application Auto Scaling scales it within 1-10 and may change the count again.",
    );
    assert.strictEqual(
      lines[4],
      `To undo it: cloud scale-in ${ECS_ARN} --count 2`,
    );
    assert.deepStrictEqual(
      h.aws.callsTo("application-autoscaling:DescribeScalableTargets")[0]?.json,
      {
        ServiceNamespace: "ecs",
        ResourceIds: ["service/prod/web"],
        ScalableDimension: "ecs:service:DesiredCount",
      },
    );
    assert.strictEqual(
      h.aws.callsTo("application-autoscaling:DescribeScalableTargets")[0]?.url
        .hostname,
      "application-autoscaling.us-east-1.amazonaws.com",
    );
    assert.deepStrictEqual(h.aws.callsTo("ecs:UpdateService")[0]?.json, {
      cluster: "prod",
      service: "web",
      desiredCount: 8,
    });
    assert.deepStrictEqual(
      (onlySession(h).policy["Statement"] as Array<unknown>)[1],
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: [
          "ecs:DescribeServices",
          "application-autoscaling:DescribeScalableTargets",
        ],
        Resource: "*",
      },
    );
    assertCleanAws(h);
  });

  test("scale-out bounds: above the current count, within the target's maximum, at most double without one, never from zero", async () => {
    const cases: Array<{
      desired: number;
      target: { min: number; max: number } | null;
      count: number;
      reason: RegExp;
    }> = [
      {
        desired: 2,
        target: null,
        count: 2,
        reason:
          /--count 2 is not above the ECS service's desired count, 2: scale-out raises it/,
      },
      {
        desired: 2,
        target: { min: 1, max: 5 },
        count: 6,
        reason:
          /--count 6 is above 5, the most the ECS service may run \(the maximum of its scalable target in Application Auto Scaling\)/,
      },
      {
        desired: 3,
        target: null,
        count: 7,
        reason:
          /--count 7 is above 6, the most the ECS service may run \(double its desired count of 3: no maximum is set, and the agent never more than doubles it\)/,
      },
      {
        desired: 0,
        target: null,
        count: 1,
        reason: /desired count is 0, and nothing bounds a scale out from zero/,
      },
    ];

    for (const entry of cases) {
      const h: CloudHarness = cloudHarness("aws");

      withEcsService(h, { desiredCount: entry.desired });
      withScalableTarget(h, entry.target);

      const result: ExecResult = await runCloud(
        h,
        "aws",
        `cloud scale-out ${ECS_ARN} --count ${entry.count}`,
      );

      assertNotRun(result, entry.reason);
      assert.match(
        String(result.errorMessage),
        /^Refused by the Cloud AI agent: /,
      );
      assert.deepStrictEqual(h.aws.callsTo("ecs:UpdateService"), []);
    }

    // Exactly double is allowed.
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h, { desiredCount: 3 });
    withScalableTarget(h, null);
    assertChanged(
      await runCloud(h, "aws", `cloud scale-out ${ECS_ARN} --count 6`),
      { count: "3" },
    );
  });

  test("scale-in: below the current count, never under the scalable target's minimum", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h, { desiredCount: 6 });
    withScalableTarget(h, { min: 3, max: 10 });

    assertNotRun(
      await runCloud(h, "aws", `cloud scale-in ${ECS_ARN} --count 2`),
      /--count 2 is below 3, the fewest the ECS service may run \(the minimum of its scalable target in Application Auto Scaling\)/,
    );
    assertNotRun(
      await runCloud(h, "aws", `cloud scale-in ${ECS_ARN} --count 7`),
      /--count 7 is not below the ECS service's desired count, 6: scale-in lowers it/,
    );

    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud scale-in ${ECS_ARN} --count 3`),
      { count: "6" },
    );

    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud scale-out ${ECS_ARN} --count 6`,
    );
  });

  test("roll-back-service: the family's ACTIVE revision before the current one, by default", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h);
    h.aws.handle("ecs:ListTaskDefinitions", (call: AwsCall): FakeAnswer => {
      return call.json && call.json["nextToken"]
        ? jsonReply({
            taskDefinitionArns: [
              `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:task-definition/web:38`,
            ],
          })
        : jsonReply({
            taskDefinitionArns: [
              `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:task-definition/web:41`,
              `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:task-definition/web-worker:40`,
              `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:task-definition/web:39`,
            ],
            nextToken: "page-2",
          });
    });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud roll-back-service ${ECS_ARN}`),
      { version: "web:41" },
    );

    assert.strictEqual(
      lines[1],
      "ECS service web in cluster prod: task definition web:41 → web:39; its tasks are replaced one by one.",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud roll-back-service ${ECS_ARN} --to web:41`,
    );
    assert.deepStrictEqual(
      h.aws.callsTo("ecs:ListTaskDefinitions").map((call: AwsCall): unknown => {
        return call.json;
      }),
      [
        {
          familyPrefix: "web",
          status: "ACTIVE",
          sort: "DESC",
          maxResults: 100,
        },
        {
          familyPrefix: "web",
          status: "ACTIVE",
          sort: "DESC",
          maxResults: 100,
          nextToken: "page-2",
        },
      ],
    );
    assert.deepStrictEqual(h.aws.callsTo("ecs:UpdateService")[0]?.json, {
      cluster: "prod",
      service: "web",
      taskDefinition: "web:39",
    });
    assertCleanAws(h);
  });

  test("roll-back-service --to: a revision of the service's own family only, ACTIVE, not the current one", async () => {
    const setup: () => CloudHarness = (): CloudHarness => {
      const h: CloudHarness = cloudHarness("aws");

      withEcsService(h);
      h.aws.handle("ecs:ListTaskDefinitions", (): FakeAnswer => {
        return jsonReply({
          taskDefinitionArns: [41, 40, 37].map((revision: number): string => {
            return `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:task-definition/web:${revision}`;
          }),
        });
      });

      return h;
    };

    assertNotRun(
      await runCloud(
        setup(),
        "aws",
        `cloud roll-back-service ${ECS_ARN} --to billing:40`,
      ),
      /--to billing:40 is not a revision of the service's own task definition family, web \(write it as web:REVISION\)/,
    );
    assertNotRun(
      await runCloud(
        setup(),
        "aws",
        `cloud roll-back-service ${ECS_ARN} --to web:39`,
      ),
      /web:39 is not an ACTIVE revision of the family/,
    );
    assertNotRun(
      await runCloud(
        setup(),
        "aws",
        `cloud roll-back-service ${ECS_ARN} --to web:41`,
      ),
      /already runs web:41/,
    );

    const h: CloudHarness = setup();

    assertChanged(
      await runCloud(
        h,
        "aws",
        `cloud roll-back-service ${ECS_ARN} --to web:37`,
      ),
      {
        version: "web:41",
      },
    );
    assert.strictEqual(
      h.aws.callsTo("ecs:UpdateService")[0]?.json?.["taskDefinition"],
      "web:37",
    );

    // A bare revision number means the service's own family.
    const bare: CloudHarness = setup();

    assertChanged(
      await runCloud(bare, "aws", `cloud roll-back-service ${ECS_ARN} --to 40`),
      {
        version: "web:41",
      },
    );
    assert.strictEqual(
      bare.aws.callsTo("ecs:UpdateService")[0]?.json?.["taskDefinition"],
      "web:40",
    );
  });

  test("roll-back-service with no earlier revision is refused", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h);
    h.aws.handle("ecs:ListTaskDefinitions", (): FakeAnswer => {
      return jsonReply({ taskDefinitionArns: [ECS_TASK_DEFINITION] });
    });

    assertNotRun(
      await runCloud(h, "aws", `cloud roll-back-service ${ECS_ARN}`),
      /has no ACTIVE revision before web:41, the one the service runs, so there is nothing to roll back to/,
    );
  });

  test("a service ECS does not know, or one that is draining, is refused", async () => {
    const missing: CloudHarness = cloudHarness("aws");

    missing.aws.handle("ecs:DescribeServices", (): FakeAnswer => {
      return jsonReply({
        services: [],
        failures: [{ arn: ECS_ARN, reason: "MISSING" }],
      });
    });
    assertNotRun(
      await runCloud(missing, "aws", `cloud restart-service ${ECS_ARN}`),
      /ECS has no service web in cluster prod \(MISSING\), so nothing was changed/,
    );

    const draining: CloudHarness = cloudHarness("aws");

    withEcsService(draining, { status: "DRAINING" });
    assertNotRun(
      await runCloud(draining, "aws", `cloud restart-service ${ECS_ARN}`),
      /the ECS service web is DRAINING, so nothing was changed/,
    );
  });
});

describe("AWS: the required tag", () => {
  test("a resource without the tag is refused after the read, and nothing is changed", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    withEcsService(h, { tags: [{ key: "oneuptime-ai", value: "Allow" }] });

    const result: ExecResult = await runCloud(
      h,
      "aws",
      `cloud restart-service ${ECS_ARN}`,
    );

    assertNotRun(
      result,
      /^Refused by the Cloud AI agent: the agent only changes resources that carry the tag oneuptime-ai=allow \(ONEUPTIME_AI_CLOUD_REQUIRED_TAG\), and the ECS service arn:aws:ecs:us-east-1:123456789012:service\/prod\/web does not, so nothing was changed\. Add the tag to the resource to let OneUptime AI change it\.$/,
    );
    assert.deepStrictEqual(h.aws.callsTo("ecs:UpdateService"), []);
  });

  test("a resource with exactly the tag is changed", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: " oneuptime-ai = allow " },
    });

    withEcsService(h, { tags: [{ key: "oneuptime-ai", value: "allow" }] });
    assertChanged(
      await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`),
      {},
    );
  });

  test("the Lambda and SQS tag reads join the session policy only while a tag is required", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    h.aws.handle("lambda:ListTags", (): FakeAnswer => {
      return jsonReply({ Tags: { "oneuptime-ai": "allow" } });
    });
    h.aws.handle("lambda:GetFunctionConcurrency", (): FakeAnswer => {
      return jsonReply({ ReservedConcurrentExecutions: 50 });
    });
    h.aws.handle(
      "lambda:PutFunctionConcurrency",
      (call: AwsCall): FakeAnswer => {
        return jsonReply(call.json);
      },
    );

    assertChanged(
      await runCloud(
        h,
        "aws",
        `cloud set-concurrency ${LAMBDA_ARN} --value 20`,
      ),
      { value: "50" },
    );
    assert.deepStrictEqual(onlySession(h).policy["Statement"], [
      {
        Sid: "OneUptimeAiChange",
        Effect: "Allow",
        Action: [
          "lambda:PutFunctionConcurrency",
          "lambda:DeleteFunctionConcurrency",
        ],
        Resource: [LAMBDA_ARN],
      },
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: ["lambda:GetFunctionConcurrency", "lambda:ListTags"],
        Resource: "*",
      },
    ]);
    // The function's ARN, encoded once on the wire (twice in the signature, which verified).
    assert.strictEqual(
      h.aws.callsTo("lambda:ListTags")[0]?.url.pathname,
      "/2017-03-31/tags/arn%3Aaws%3Alambda%3Aus-east-1%3A123456789012%3Afunction%3Acheckout",
    );
    assertCleanAws(h);
  });
});

describe("AWS: Auto Scaling groups", () => {
  test("scale-out within MaxSize, with HonorCooldown=false", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("autoscaling:DescribeAutoScalingGroups", (): FakeAnswer => {
      return xmlReply(asgXml({}));
    });
    h.aws.handle("autoscaling:SetDesiredCapacity", (): FakeAnswer => {
      return okXml("SetDesiredCapacity");
    });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud scale-out ${ASG_ARN} --count 6`),
      { count: "3" },
    );

    assert.strictEqual(
      lines[1],
      "Auto Scaling group web-asg: desired capacity 3 → 6 (MinSize 2, MaxSize 6).",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud scale-in ${ASG_ARN} --count 3`,
    );
    assert.deepStrictEqual(
      h.aws.callsTo("autoscaling:DescribeAutoScalingGroups")[0]?.form,
      {
        Action: "DescribeAutoScalingGroups",
        Version: "2011-01-01",
        "AutoScalingGroupNames.member.1": "web-asg",
      },
    );
    assert.deepStrictEqual(
      h.aws.callsTo("autoscaling:SetDesiredCapacity")[0]?.form,
      {
        Action: "SetDesiredCapacity",
        Version: "2011-01-01",
        AutoScalingGroupName: "web-asg",
        DesiredCapacity: "6",
        HonorCooldown: "false",
      },
    );
    assert.strictEqual(
      h.aws.callsTo("autoscaling:SetDesiredCapacity")[0]?.request.headers[
        "Content-Type"
      ],
      "application/x-www-form-urlencoded; charset=utf-8",
    );
    assert.strictEqual(
      h.aws.callsTo("autoscaling:SetDesiredCapacity")[0]?.url.hostname,
      "autoscaling.us-east-1.amazonaws.com",
    );
    assert.deepStrictEqual(onlySession(h).policy["Statement"], [
      {
        Sid: "OneUptimeAiChange",
        Effect: "Allow",
        Action: ["autoscaling:SetDesiredCapacity"],
        Resource: [ASG_ARN],
      },
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: ["autoscaling:DescribeAutoScalingGroups"],
        Resource: "*",
      },
    ]);
    assertCleanAws(h);
  });

  test("scale-in down to MinSize; the undo scales back out", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("autoscaling:DescribeAutoScalingGroups", (): FakeAnswer => {
      return xmlReply(asgXml({ DesiredCapacity: "5" }));
    });
    h.aws.handle("autoscaling:SetDesiredCapacity", (): FakeAnswer => {
      return okXml("SetDesiredCapacity");
    });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud scale-in ${ASG_ARN} --count 2`),
      { count: "5" },
    );

    assert.strictEqual(
      lines[1],
      "Auto Scaling group web-asg: desired capacity 5 → 2 (MinSize 2, MaxSize 6).",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud scale-out ${ASG_ARN} --count 5`,
    );
    assert.strictEqual(
      h.aws.callsTo("autoscaling:SetDesiredCapacity")[0]?.form[
        "DesiredCapacity"
      ],
      "2",
    );
    assertCleanAws(h);
  });

  test("MaxSize and MinSize bound a scale; a group created again under the same name is not the ARN's", async () => {
    const setup: (fields: Record<string, string>) => CloudHarness = (
      fields: Record<string, string>,
    ): CloudHarness => {
      const h: CloudHarness = cloudHarness("aws");

      h.aws.handle("autoscaling:DescribeAutoScalingGroups", (): FakeAnswer => {
        return xmlReply(asgXml(fields));
      });
      return h;
    };

    assertNotRun(
      await runCloud(setup({}), "aws", `cloud scale-out ${ASG_ARN} --count 7`),
      /--count 7 is above 6, the most the Auto Scaling group may run \(its MaxSize\)/,
    );
    assertNotRun(
      await runCloud(setup({}), "aws", `cloud scale-in ${ASG_ARN} --count 1`),
      /--count 1 is below 2, the fewest the Auto Scaling group may run \(its MinSize\)/,
    );
    assertNotRun(
      await runCloud(
        setup({
          AutoScalingGroupARN: `arn:aws:autoscaling:us-east-1:${AWS_ACCOUNT}:autoScalingGroup:11111111-2222-3333-4444-555555555555:autoScalingGroupName/web-asg`,
        }),
        "aws",
        `cloud scale-out ${ASG_ARN} --count 4`,
      ),
      /the Auto Scaling group named web-asg is not the one .* names \(it was deleted and created again\)/,
    );
  });
});

describe("AWS: EC2 instances", () => {
  const setup: (state: string) => CloudHarness = (
    state: string,
  ): CloudHarness => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("ec2:DescribeInstances", (): FakeAnswer => {
      return xmlReply(ec2DescribeXml(state));
    });

    for (const [action, to] of [
      ["StartInstances", "pending"],
      ["StopInstances", "stopping"],
    ] as Array<[string, string]>) {
      h.aws.handle(`ec2:${action}`, (): FakeAnswer => {
        return xmlReply(
          `<${action}Response xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>r</requestId><instancesSet><item><instanceId>i-0abc1234def567890</instanceId><currentState><code>0</code><name>${to}</name></currentState><previousState><code>80</code><name>${state}</name></previousState></item></instancesSet></${action}Response>`,
        );
      });
    }

    h.aws.handle("ec2:RebootInstances", (): FakeAnswer => {
      return xmlReply(
        `<RebootInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>r</requestId><return>true</return></RebootInstancesResponse>`,
      );
    });

    return h;
  };

  test("start-instance on a stopped instance; the undo stops it again", async () => {
    const h: CloudHarness = setup("stopped");
    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud start-instance ${EC2_ARN}`),
      { state: "stopped" },
    );

    assert.strictEqual(
      lines[1],
      "EC2 instance i-0abc1234def567890: stopped → pending.",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud stop-instance ${EC2_ARN}`,
    );
    assert.deepStrictEqual(h.aws.callsTo("ec2:StartInstances")[0]?.form, {
      Action: "StartInstances",
      Version: "2016-11-15",
      "InstanceId.1": "i-0abc1234def567890",
    });
    assert.strictEqual(
      h.aws.callsTo("ec2:StartInstances")[0]?.url.hostname,
      "ec2.us-east-1.amazonaws.com",
    );
    assert.deepStrictEqual(onlySession(h).policy["Statement"], [
      {
        Sid: "OneUptimeAiChange",
        Effect: "Allow",
        Action: ["ec2:StartInstances"],
        Resource: [EC2_ARN],
      },
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: ["ec2:DescribeInstances"],
        Resource: "*",
      },
    ]);
    assertCleanAws(h);
  });

  test("stop-instance and reboot-instance on a running instance", async () => {
    const stop: CloudHarness = setup("running");
    const stopLines: Array<string> = assertChanged(
      await runCloud(stop, "aws", `cloud stop-instance ${EC2_ARN}`),
      { state: "running" },
    );

    assert.strictEqual(
      stopLines[1],
      "EC2 instance i-0abc1234def567890: running → stopping.",
    );
    assert.strictEqual(
      stopLines[stopLines.length - 1],
      `To undo it: cloud start-instance ${EC2_ARN}`,
    );

    const reboot: CloudHarness = setup("running");
    const rebootLines: Array<string> = assertChanged(
      await runCloud(reboot, "aws", `cloud reboot-instance ${EC2_ARN}`),
      {},
    );

    assert.strictEqual(
      rebootLines[1],
      "EC2 instance i-0abc1234def567890: rebooting (it stays on the same host and keeps its addresses).",
    );
    assert.strictEqual(rebootLines[rebootLines.length - 1], "Nothing to undo.");
    assert.strictEqual(reboot.aws.callsTo("ec2:RebootInstances").length, 1);
  });

  test("the instance's state decides: no start of a running instance, no stop of a stopped one", async () => {
    assertNotRun(
      await runCloud(
        setup("running"),
        "aws",
        `cloud start-instance ${EC2_ARN}`,
      ),
      /the EC2 instance i-0abc1234def567890 is running, and cloud start-instance needs it stopped, so nothing was changed/,
    );
    assertNotRun(
      await runCloud(setup("stopped"), "aws", `cloud stop-instance ${EC2_ARN}`),
      /is stopped, and cloud stop-instance needs it running/,
    );
    assertNotRun(
      await runCloud(
        setup("stopping"),
        "aws",
        `cloud reboot-instance ${EC2_ARN}`,
      ),
      /is stopping, and cloud reboot-instance needs it running/,
    );
  });

  test("an instance EC2 does not know: the read fails, nothing changed", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("ec2:DescribeInstances", (): FakeAnswer => {
      return ec2Error(
        "InvalidInstanceID.NotFound",
        "The instance ID 'i-0abc1234def567890' does not exist",
      );
    });

    assertNotRun(
      await runCloud(h, "aws", `cloud start-instance ${EC2_ARN}`),
      /^The agent could not ask AWS about the EC2 instance i-0abc1234def567890 \(ec2:DescribeInstances\), so nothing was changed: AWS refused ec2:DescribeInstances \(HTTP 400 InvalidInstanceID\.NotFound\): The instance ID 'i-0abc1234def567890' does not exist\.$/,
    );
  });
});

describe("AWS: RDS", () => {
  const setup: (fields: Record<string, string>) => CloudHarness = (
    fields: Record<string, string>,
  ): CloudHarness => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("rds:DescribeDBInstances", (): FakeAnswer => {
      return xmlReply(
        rdsInstanceXml({
          DBInstanceStatus: "available",
          MultiAZ: "true",
          AvailabilityZone: "us-east-1a",
          SecondaryAvailabilityZone: "us-east-1b",
          DBInstanceArn: RDS_ARN,
          ...fields,
        }),
      );
    });
    h.aws.handle("rds:RebootDBInstance", (): FakeAnswer => {
      return okXml("RebootDBInstance");
    });
    h.aws.handle("rds:StartDBInstance", (): FakeAnswer => {
      return okXml("StartDBInstance");
    });
    return h;
  };

  test("fail-over-database on a Multi-AZ instance: RebootDBInstance with ForceFailover, reporting the primary it left", async () => {
    const h: CloudHarness = setup({});
    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud fail-over-database ${RDS_ARN}`),
      { primary: "us-east-1a" },
    );

    assert.strictEqual(
      lines[1],
      "RDS instance orders: failing over from its primary in us-east-1a to its standby in us-east-1b (a reboot with failover).",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud fail-over-database ${RDS_ARN}`,
    );
    assert.deepStrictEqual(h.aws.callsTo("rds:RebootDBInstance")[0]?.form, {
      Action: "RebootDBInstance",
      Version: "2014-10-31",
      DBInstanceIdentifier: "orders",
      ForceFailover: "true",
    });
    assert.strictEqual(
      h.aws.callsTo("rds:RebootDBInstance")[0]?.url.hostname,
      "rds.us-east-1.amazonaws.com",
    );
    assertCleanAws(h);
  });

  test("fail-over-database needs Multi-AZ; an Aurora member points at its cluster", async () => {
    assertNotRun(
      await runCloud(
        setup({ MultiAZ: "false" }),
        "aws",
        `cloud fail-over-database ${RDS_ARN}`,
      ),
      /the RDS instance orders is not Multi-AZ, so it has no standby to fail over to, and nothing was changed/,
    );
    assertNotRun(
      await runCloud(
        setup({ DBClusterIdentifier: "orders-aurora" }),
        "aws",
        `cloud fail-over-database ${RDS_ARN}`,
      ),
      /belongs to the cluster orders-aurora: fail the cluster over instead \(cloud fail-over-database on the cluster's ARN\)/,
    );
  });

  test("reboot-instance reboots in place, without failover", async () => {
    const h: CloudHarness = setup({});
    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud reboot-instance ${RDS_ARN}`),
      {},
    );

    assert.strictEqual(
      lines[1],
      "RDS instance orders: rebooting in place, without failover.",
    );
    assert.strictEqual(
      h.aws.callsTo("rds:RebootDBInstance")[0]?.form["ForceFailover"],
      "false",
    );
  });

  test("start-instance on a stopped instance (an RDS instance is never stopped by the agent, so nothing to undo)", async () => {
    const h: CloudHarness = setup({ DBInstanceStatus: "stopped" });
    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud start-instance ${RDS_ARN}`),
      { state: "stopped" },
    );

    assert.strictEqual(lines[1], "RDS instance orders: stopped → starting.");
    assert.match(
      lines[lines.length - 1] || "",
      /^Nothing to undo: cloud stop-instance does not work on a RDS instance/,
    );
    assert.deepStrictEqual(h.aws.callsTo("rds:StartDBInstance")[0]?.form, {
      Action: "StartDBInstance",
      Version: "2014-10-31",
      DBInstanceIdentifier: "orders",
    });

    assertNotRun(
      await runCloud(setup({}), "aws", `cloud start-instance ${RDS_ARN}`),
      /the RDS instance orders is available, and cloud start-instance needs it stopped/,
    );
  });

  test("an Aurora cluster fails over from its writer to a reader", async () => {
    const h: CloudHarness = cloudHarness("aws");
    const members: string = [
      ["orders-aurora-1", "true"],
      ["orders-aurora-2", "false"],
    ]
      .map(([id, writer]: Array<string>): string => {
        return `<DBClusterMember><DBInstanceIdentifier>${id}</DBInstanceIdentifier><IsClusterWriter>${writer}</IsClusterWriter></DBClusterMember>`;
      })
      .join("");

    h.aws.handle("rds:DescribeDBClusters", (): FakeAnswer => {
      return xmlReply(
        `<DescribeDBClustersResponse><DescribeDBClustersResult><DBClusters><DBCluster><DBClusterIdentifier>orders-aurora</DBClusterIdentifier><Status>available</Status><DBClusterMembers>${members}</DBClusterMembers><TagList/></DBCluster></DBClusters></DescribeDBClustersResult></DescribeDBClustersResponse>`,
      );
    });
    h.aws.handle("rds:FailoverDBCluster", (): FakeAnswer => {
      return okXml("FailoverDBCluster");
    });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud fail-over-database ${AURORA_ARN}`),
      { primary: "orders-aurora-1" },
    );

    assert.strictEqual(
      lines[1],
      "Cluster orders-aurora: failing over — its writer, orders-aurora-1, hands over to one of its readers (orders-aurora-2).",
    );
    assert.deepStrictEqual(h.aws.callsTo("rds:FailoverDBCluster")[0]?.form, {
      Action: "FailoverDBCluster",
      Version: "2014-10-31",
      DBClusterIdentifier: "orders-aurora",
    });
    assert.deepStrictEqual(onlySession(h).policy["Statement"], [
      {
        Sid: "OneUptimeAiChange",
        Effect: "Allow",
        Action: ["rds:FailoverDBCluster"],
        Resource: [AURORA_ARN],
      },
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: ["rds:DescribeDBClusters"],
        Resource: "*",
      },
    ]);
    assertCleanAws(h);
  });

  test("an Aurora cluster without a reader is refused", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("rds:DescribeDBClusters", (): FakeAnswer => {
      return xmlReply(
        `<DescribeDBClustersResponse><DescribeDBClustersResult><DBClusters><DBCluster><DBClusterIdentifier>orders-aurora</DBClusterIdentifier><Status>available</Status><DBClusterMembers><DBClusterMember><DBInstanceIdentifier>only</DBInstanceIdentifier><IsClusterWriter>true</IsClusterWriter></DBClusterMember></DBClusterMembers></DBCluster></DBClusters></DescribeDBClustersResult></DescribeDBClustersResponse>`,
      );
    });

    assertNotRun(
      await runCloud(h, "aws", `cloud fail-over-database ${AURORA_ARN}`),
      /the cluster orders-aurora has no reader instance to fail over to/,
    );
  });
});

describe("AWS: Lambda", () => {
  test("set-concurrency: PutFunctionConcurrency, reporting the value it replaced", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("lambda:GetFunctionConcurrency", (): FakeAnswer => {
      return jsonReply({ ReservedConcurrentExecutions: 100 });
    });
    h.aws.handle(
      "lambda:PutFunctionConcurrency",
      (call: AwsCall): FakeAnswer => {
        return jsonReply(call.json);
      },
    );

    const lines: Array<string> = assertChanged(
      await runCloud(
        h,
        "aws",
        `cloud set-concurrency ${LAMBDA_ARN} --value 20`,
      ),
      { value: "100" },
    );

    assert.strictEqual(
      lines[1],
      "Lambda function checkout: reserved concurrency 100 → 20.",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud set-concurrency ${LAMBDA_ARN} --value 100`,
    );

    const get: AwsCall | undefined = h.aws.callsTo(
      "lambda:GetFunctionConcurrency",
    )[0];
    const put: AwsCall | undefined = h.aws.callsTo(
      "lambda:PutFunctionConcurrency",
    )[0];

    assert.strictEqual(get?.method, "GET");
    assert.strictEqual(
      get?.url.toString(),
      "https://lambda.us-east-1.amazonaws.com/2019-09-30/functions/checkout/concurrency",
    );
    assert.strictEqual(get?.request.body, null);
    assert.strictEqual(put?.method, "PUT");
    assert.strictEqual(
      put?.url.pathname,
      "/2017-03-31/functions/checkout/concurrency",
    );
    assert.deepStrictEqual(put?.json, { ReservedConcurrentExecutions: 20 });
    assertCleanAws(h);
  });

  test("set-concurrency none deletes the limit; the undo puts it back", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("lambda:GetFunctionConcurrency", (): FakeAnswer => {
      return jsonReply({ ReservedConcurrentExecutions: 5 });
    });
    h.aws.handle("lambda:DeleteFunctionConcurrency", (): FakeAnswer => {
      return { status: 204, headers: {}, body: "", truncated: false };
    });

    const lines: Array<string> = assertChanged(
      await runCloud(
        h,
        "aws",
        `cloud set-concurrency ${LAMBDA_ARN} --value none`,
      ),
      { value: "5" },
    );

    assert.strictEqual(
      lines[1],
      "Lambda function checkout: reserved concurrency 5 → none (it now draws on the account's unreserved concurrency).",
    );
    assert.strictEqual(
      h.aws.callsTo("lambda:DeleteFunctionConcurrency")[0]?.method,
      "DELETE",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud set-concurrency ${LAMBDA_ARN} --value 5`,
    );
  });

  test("set-concurrency from no explicit limit reports none; the same value, or a function stopped at 0, is refused", async () => {
    const setup: (answer: Record<string, unknown>) => CloudHarness = (
      answer: Record<string, unknown>,
    ): CloudHarness => {
      const h: CloudHarness = cloudHarness("aws");

      h.aws.handle("lambda:GetFunctionConcurrency", (): FakeAnswer => {
        return jsonReply(answer);
      });
      h.aws.handle(
        "lambda:PutFunctionConcurrency",
        (call: AwsCall): FakeAnswer => {
          return jsonReply(call.json);
        },
      );
      return h;
    };

    const unlimited: Array<string> = assertChanged(
      await runCloud(
        setup({}),
        "aws",
        `cloud set-concurrency ${LAMBDA_ARN} --value 10`,
      ),
      { value: "none" },
    );

    assert.strictEqual(
      unlimited[unlimited.length - 1],
      `To undo it: cloud set-concurrency ${LAMBDA_ARN} --value none`,
    );
    assertNotRun(
      await runCloud(
        setup({ ReservedConcurrentExecutions: 10 }),
        "aws",
        `cloud set-concurrency ${LAMBDA_ARN} --value 10`,
      ),
      /reserved concurrency is already 10/,
    );
    assertNotRun(
      await runCloud(
        setup({}),
        "aws",
        `cloud set-concurrency ${LAMBDA_ARN} --value none`,
      ),
      /reserved concurrency is already none/,
    );
    assertNotRun(
      await runCloud(
        setup({ ReservedConcurrentExecutions: 0 }),
        "aws",
        `cloud set-concurrency ${LAMBDA_ARN} --value 10`,
      ),
      /has a reserved concurrency of 0, which stops it on purpose: lifting that is left to a person/,
    );
  });

  const aliasSetup: (alias: Record<string, unknown>) => CloudHarness = (
    alias: Record<string, unknown>,
  ): CloudHarness => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("lambda:GetAlias", (): FakeAnswer => {
      return jsonReply({
        AliasArn: LAMBDA_ALIAS_ARN,
        Name: "live",
        FunctionVersion: "7",
        RevisionId: "rev-7a",
        ...alias,
      });
    });
    h.aws.handle(
      "lambda:ListVersionsByFunction",
      (call: AwsCall): FakeAnswer => {
        return call.url.searchParams.get("Marker")
          ? jsonReply({ Versions: [{ Version: "6" }, { Version: "7" }] })
          : jsonReply({
              Versions: [
                { Version: "$LATEST" },
                { Version: "3" },
                { Version: "5" },
              ],
              NextMarker: "page 2",
            });
      },
    );
    h.aws.handle("lambda:UpdateAlias", (call: AwsCall): FakeAnswer => {
      return jsonReply({ AliasArn: LAMBDA_ALIAS_ARN, ...(call.json || {}) });
    });
    return h;
  };

  test("roll-back-service on an alias: the published version before the current one, for all traffic", async () => {
    const h: CloudHarness = aliasSetup({
      RoutingConfig: { AdditionalVersionWeights: { "8": 0.1 } },
    });
    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud roll-back-service ${LAMBDA_ALIAS_ARN}`),
      { version: "7" },
    );

    assert.deepStrictEqual(lines.slice(1), [
      "Lambda alias live of function checkout: version 7 → 6, for all of its traffic.",
      `API call: lambda:UpdateAlias with FunctionVersion (a version of the same function) (FunctionVersion=6), in us-east-1, as arn:aws:sts::123456789012:assumed-role/OneUptimeAiAgentWrite/oneuptime-ai-roll-back-service-0a1b2c3d (the write role, with a session policy for this change alone).`,
      "It also sent traffic to 8 at 10%; that routing was cleared, and undoing this change does not bring it back.",
      `To undo it: cloud roll-back-service ${LAMBDA_ALIAS_ARN} --to 7`,
    ]);
    assert.deepStrictEqual(h.aws.callsTo("lambda:UpdateAlias")[0]?.json, {
      FunctionVersion: "6",
      RoutingConfig: { AdditionalVersionWeights: {} },
      RevisionId: "rev-7a",
    });
    assert.deepStrictEqual(
      h.aws
        .callsTo("lambda:ListVersionsByFunction")
        .map((call: AwsCall): string => {
          return `${call.url.pathname}${call.url.search}`;
        }),
      [
        "/2015-03-31/functions/checkout/versions?MaxItems=50",
        "/2015-03-31/functions/checkout/versions?Marker=page%202&MaxItems=50",
      ],
    );
    assert.deepStrictEqual(onlySession(h).policy["Statement"], [
      {
        Sid: "OneUptimeAiChange",
        Effect: "Allow",
        Action: ["lambda:UpdateAlias"],
        Resource: [LAMBDA_ALIAS_ARN, LAMBDA_ARN],
      },
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: ["lambda:GetAlias", "lambda:ListVersionsByFunction"],
        Resource: "*",
      },
    ]);
    assertCleanAws(h);
  });

  test("roll-back-service --to: a published version of the same function only", async () => {
    assertNotRun(
      await runCloud(
        aliasSetup({}),
        "aws",
        `cloud roll-back-service ${LAMBDA_ALIAS_ARN} --to billing:3`,
      ),
      /--to billing:3 is not a published version of the alias's own function, checkout/,
    );
    assertNotRun(
      await runCloud(
        aliasSetup({}),
        "aws",
        `cloud roll-back-service ${LAMBDA_ALIAS_ARN} --to 4`,
      ),
      /the Lambda function checkout has no version 4/,
    );
    assertNotRun(
      await runCloud(
        aliasSetup({}),
        "aws",
        `cloud roll-back-service ${LAMBDA_ALIAS_ARN} --to 7`,
      ),
      /already points at version 7/,
    );

    const h: CloudHarness = aliasSetup({});

    assertChanged(
      await runCloud(
        h,
        "aws",
        `cloud roll-back-service ${LAMBDA_ALIAS_ARN} --to checkout:3`,
      ),
      { version: "7" },
    );
    assert.strictEqual(
      h.aws.callsTo("lambda:UpdateAlias")[0]?.json?.["FunctionVersion"],
      "3",
    );
  });

  test("an alias on $LATEST, or on its first version, has nothing before it", async () => {
    assertNotRun(
      await runCloud(
        aliasSetup({ FunctionVersion: "$LATEST" }),
        "aws",
        `cloud roll-back-service ${LAMBDA_ALIAS_ARN}`,
      ),
      /points at \$LATEST, which has no version before it: name the version to move to with --to/,
    );
    assertNotRun(
      await runCloud(
        aliasSetup({ FunctionVersion: "3" }),
        "aws",
        `cloud roll-back-service ${LAMBDA_ALIAS_ARN}`,
      ),
      /has no published version before 3, so there is nothing to roll back to/,
    );
  });
});

describe("AWS: SQS redrive", () => {
  const sourceUrl: string = `https://sqs.us-east-1.amazonaws.com/${AWS_ACCOUNT}/orders`;

  const setup: (data: {
    sources?: Array<string> | undefined;
    messages?: string | undefined;
  }) => CloudHarness = (data: {
    sources?: Array<string> | undefined;
    messages?: string | undefined;
  }): CloudHarness => {
    const h: CloudHarness = cloudHarness("aws", {
      randomIds: ["read0001", "move0002"],
    });

    h.aws.handle("sqs:GetQueueAttributes", (): FakeAnswer => {
      return jsonReply({
        Attributes: {
          ApproximateNumberOfMessages: data.messages ?? "42",
          QueueArn: SQS_ARN,
        },
      });
    });
    h.aws.handle("sqs:ListDeadLetterSourceQueues", (): FakeAnswer => {
      return jsonReply({ queueUrls: data.sources ?? [sourceUrl] });
    });
    h.aws.handle("sqs:StartMessageMoveTask", (): FakeAnswer => {
      return jsonReply({ TaskHandle: "task-handle-1" });
    });
    return h;
  };

  test("moves a dead-letter queue's messages back to its one source queue, with a session for those two queues", async () => {
    const h: CloudHarness = setup({});
    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud redrive-queue ${SQS_ARN}`),
      {},
    );

    assert.deepStrictEqual(lines.slice(1), [
      `Queue orders-dlq: started moving its ~42 messages back to ${SQS_SOURCE_ARN}; SQS moves them in the background.`,
      `API call: sqs:StartMessageMoveTask from the dead-letter queue to its source queue (SourceArn=${SQS_ARN}, DestinationArn=${SQS_SOURCE_ARN}), in us-east-1, as arn:aws:sts::123456789012:assumed-role/OneUptimeAiAgentWrite/oneuptime-ai-redrive-queue-move0002 (the write role, with a session policy for this change alone).`,
      "Move task: task-handle-1",
      "Nothing to undo.",
    ]);

    const getAttributes: AwsCall | undefined = h.aws.callsTo(
      "sqs:GetQueueAttributes",
    )[0];

    assert.deepStrictEqual(getAttributes?.json, {
      QueueUrl: `https://sqs.us-east-1.amazonaws.com/${AWS_ACCOUNT}/orders-dlq`,
      AttributeNames: ["ApproximateNumberOfMessages", "QueueArn"],
    });
    assert.strictEqual(
      getAttributes?.request.headers["Content-Type"],
      "application/x-amz-json-1.0",
    );
    assert.strictEqual(
      getAttributes?.request.headers["X-Amz-Target"],
      "AmazonSQS.GetQueueAttributes",
    );
    assert.deepStrictEqual(h.aws.callsTo("sqs:StartMessageMoveTask")[0]?.json, {
      SourceArn: SQS_ARN,
      DestinationArn: SQS_SOURCE_ARN,
    });

    // Reads with a session that may change nothing; the move with one for the two queues.
    assert.strictEqual(h.aws.assumed.length, 2);
    assert.deepStrictEqual(h.aws.assumed[0]?.policy["Statement"], [
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: ["sqs:GetQueueAttributes", "sqs:ListDeadLetterSourceQueues"],
        Resource: "*",
      },
    ]);
    assert.deepStrictEqual(h.aws.assumed[1]?.policy["Statement"], [
      {
        Sid: "OneUptimeAiChange",
        Effect: "Allow",
        Action: [
          "sqs:StartMessageMoveTask",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:SendMessage",
        ],
        Resource: [SQS_ARN, SQS_SOURCE_ARN],
      },
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: ["sqs:GetQueueAttributes", "sqs:ListDeadLetterSourceQueues"],
        Resource: "*",
      },
    ]);
    assert.strictEqual(
      h.aws.callsTo("sqs:StartMessageMoveTask")[0]?.accessKeyId,
      h.aws.assumed[1]?.accessKeyId,
    );
    assertCleanAws(h);
  });

  test("several source queues: the messages go back to where each came from (no DestinationArn)", async () => {
    const h: CloudHarness = setup({
      sources: [
        sourceUrl,
        `https://sqs.us-east-1.amazonaws.com/${AWS_ACCOUNT}/payments`,
      ],
    });

    assertChanged(
      await runCloud(h, "aws", `cloud redrive-queue ${SQS_ARN}`),
      {},
    );
    assert.deepStrictEqual(h.aws.callsTo("sqs:StartMessageMoveTask")[0]?.json, {
      SourceArn: SQS_ARN,
    });
  });

  test("no source queue, no messages, or a source in another account: refused", async () => {
    assertNotRun(
      await runCloud(
        setup({ sources: [] }),
        "aws",
        `cloud redrive-queue ${SQS_ARN}`,
      ),
      /the queue orders-dlq is no queue's dead-letter queue/,
    );
    assertNotRun(
      await runCloud(
        setup({ messages: "0" }),
        "aws",
        `cloud redrive-queue ${SQS_ARN}`,
      ),
      /the queue orders-dlq holds no messages, so there is nothing to redrive/,
    );
    assertNotRun(
      await runCloud(
        setup({
          sources: ["https://sqs.us-east-1.amazonaws.com/210987654321/orders"],
        }),
        "aws",
        `cloud redrive-queue ${SQS_ARN}`,
      ),
      /a queue that sends its failed messages to orders-dlq is not one of this account's/,
    );
  });
});

// ---- Credentials, sessions, errors ----------------------------------------------------------------

describe("AWS: credentials and the acting principal", () => {
  test("the ECS task role's credentials are fetched once and reused until shortly before they expire", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h);

    await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`);
    await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`);
    assert.strictEqual(h.aws.credentialRequests, 1);

    // Six hours later (they expire then): fetched again.
    h.clock.nowMs += 6 * 60 * 60 * 1000 - 60_000;
    await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`);
    assert.strictEqual(h.aws.credentialRequests, 2);
    assert.strictEqual(
      h.cloud.requests.filter((request: { url: string }): boolean => {
        return request.url === "http://169.254.170.2/v2/credentials/0f1e2d3c";
      }).length,
      2,
    );
  });

  test("AWS_CONTAINER_CREDENTIALS_FULL_URI with the token from its file", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: {
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "",
        AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://127.0.0.1:1338/creds",
        AWS_CONTAINER_AUTHORIZATION_TOKEN: "ignored-when-the-file-is-set",
        AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: "/var/run/token",
      },
      readFile: (path: string): string => {
        assert.strictEqual(path, "/var/run/token");
        return "file-token\n";
      },
    });

    h.cloud.on("GET", "http://127.0.0.1:1338/creds", (): FakeAnswer => {
      return jsonReply({
        AccessKeyId: AWS_TASK_ACCESS_KEY,
        SecretAccessKey: "task-role-secret-0000000000000000000000",
        Token: "t",
        Expiration: "2026-10-27T18:00:00Z",
      });
    });
    withEcsService(h);

    assertChanged(
      await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`),
      {},
    );

    const credentials: { headers: Record<string, string> } | undefined =
      h.cloud.requests.find((request: { url: string }): boolean => {
        return request.url === "http://127.0.0.1:1338/creds";
      });

    assert.strictEqual(credentials?.headers["Authorization"], "file-token");
  });

  test("AWS_CONTAINER_CREDENTIALS_FULL_URI over plain http to anything but a loopback or link-local address is refused", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: {
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "",
        AWS_CONTAINER_CREDENTIALS_FULL_URI:
          "http://credentials.example.com/creds",
      },
    });

    assertNotRun(
      await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`),
      /AWS_CONTAINER_CREDENTIALS_FULL_URI must be an https:\/\/ URL, or http:\/\/ to a loopback or ECS\/EKS link-local address/,
    );
    assert.deepStrictEqual(h.cloud.requests, []);
  });

  test("keys in the environment sign directly; half a pair is refused", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: {
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "",
        ONEUPTIME_AI_AWS_WRITE_ROLE_ARN: "",
        AWS_ACCESS_KEY_ID: "AKIAENVIRONMENT00001",
        AWS_SECRET_ACCESS_KEY: "environment-secret",
      },
    });

    h.aws.registerKey("AKIAENVIRONMENT00001", "environment-secret");
    withEcsService(h);

    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`),
      {},
    );

    assert.match(
      lines[2] || "",
      /as arn:aws:sts::123456789012:assumed-role\/OneUptimeAiAgentTask\/ecs-agent-task \(the agent's own credentials, as ONEUPTIME_AI_AWS_WRITE_ROLE_ARN is not set\)\.$/,
    );
    assert.deepStrictEqual(h.aws.actions(), [
      "sts:GetCallerIdentity",
      "ecs:DescribeServices",
      "ecs:UpdateService",
    ]);
    assert.strictEqual(
      h.aws.callsTo("ecs:UpdateService")[0]?.request.headers[
        "X-Amz-Security-Token"
      ],
      undefined,
    );
    assertCleanAws(h);

    const half: CloudHarness = cloudHarness("aws", {
      env: {
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "",
        AWS_ACCESS_KEY_ID: "AKIAENVIRONMENT00001",
      },
    });

    assertNotRun(
      await runCloud(half, "aws", `cloud restart-service ${ECS_ARN}`),
      /AWS_ACCESS_KEY_ID is set but AWS_SECRET_ACCESS_KEY is not/,
    );
  });

  test("a session in another account than the agent serves changes nothing", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.sessionAccount = "210987654321";
    withEcsService(h);

    assertNotRun(
      await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`),
      /the write role arn:aws:iam::123456789012:role\/OneUptimeAiAgentWrite acts in account 210987654321, but the agent serves account 123456789012/,
    );
    assert.deepStrictEqual(h.aws.callsTo("ecs:DescribeServices"), []);
  });

  test("without a write role, base credentials of another account change nothing", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_AWS_WRITE_ROLE_ARN: "" },
    });

    h.aws.callerAccount = "210987654321";
    withEcsService(h);

    assertNotRun(
      await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`),
      /the agent's AWS credentials are for account 210987654321, but it serves account 123456789012/,
    );
  });

  test("the write role refused: never ran, and says who may not assume what", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("sts:AssumeRole", (): FakeAnswer => {
      return awsQueryError(
        "AccessDenied",
        "not authorized to perform: sts:AssumeRole",
      );
    });

    assertNotRun(
      await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`),
      /^The agent could not ask AWS for a session of the write role arn:aws:iam::123456789012:role\/OneUptimeAiAgentWrite \(STS AssumeRole\), so nothing was changed: AWS refused sts:AssumeRole \(HTTP 403 AccessDenied\): not authorized to perform: sts:AssumeRole\. The agent's own identity .* may not assume arn:aws:iam::123456789012:role\/OneUptimeAiAgentWrite/,
    );
  });
});

describe("AWS: how a failure reads", () => {
  test("a read the role may not make: never ran, naming the permission and what the change needs", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("ecs:DescribeServices", (): FakeAnswer => {
      return awsJsonError(
        "AccessDeniedException",
        "User: arn:aws:sts::123456789012:assumed-role/OneUptimeAiAgentWrite/s is not authorized to perform: ecs:DescribeServices",
      );
    });

    assertNotRun(
      await runCloud(h, "aws", `cloud scale-out ${ECS_ARN} --count 3`),
      /AWS refused ecs:DescribeServices \(HTTP 400 AccessDeniedException\): User: .* is not authorized to perform: ecs:DescribeServices\. The write role arn:aws:iam::123456789012:role\/OneUptimeAiAgentWrite lacks ecs:DescribeServices on arn:aws:ecs:us-east-1:123456789012:service\/prod\/web: the setup command grants it when scale-out is in ONEUPTIME_AI_CLOUD_OPERATIONS \(cloud scale-out on an ECS service needs ecs:UpdateService, ecs:DescribeServices, application-autoscaling:DescribeScalableTargets\)\./,
    );
  });

  test("the change refused (403): exit code 1, the replaced value first, the missing permission named", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h);
    withScalableTarget(h, null);
    h.aws.handle("ecs:UpdateService", (): FakeAnswer => {
      return awsJsonError(
        "AccessDeniedException",
        "not authorized to perform: ecs:UpdateService",
        403,
      );
    });

    const result: ExecResult = await runCloud(
      h,
      "aws",
      `cloud scale-out ${ECS_ARN} --count 3`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.deepStrictEqual(readCloudReplacedValue(result.output), {
      count: "2",
    });
    assert.match(
      String(result.errorMessage),
      /^Exit code 1: AWS refused ecs:UpdateService \(HTTP 403 AccessDeniedException\): not authorized to perform: ecs:UpdateService\. The write role .* lacks ecs:UpdateService on arn:aws:ecs:us-east-1:123456789012:service\/prod\/web/,
    );
    assert.match(
      outputLines(result)[1] || "",
      /^AWS refused ecs:UpdateService/,
    );
  });

  test("no answer to the change in time: Killed (timeout), with output, so it reads as ran", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h);
    h.aws.handle("ecs:UpdateService", (): FakeAnswer => {
      return new CloudTransportError({
        kind: "timeout",
        message: "no answer within 20000ms",
      });
    });

    const result: ExecResult = await runCloud(
      h,
      "aws",
      `cloud restart-service ${ECS_ARN}`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.deepStrictEqual(outputLines(result), [
      formatCloudReplacedValue({}),
      "AWS did not answer the change in time (ecs:UpdateService at https://ecs.us-east-1.amazonaws.com: no answer within 20000ms). It may still have been carried out: read the ECS service's state before trying again.",
    ]);
    assert.match(
      String(result.errorMessage),
      /^Killed \(timeout 30000ms\): AWS did not answer the change in time/,
    );
  });

  test("a change that never left the agent (no connection) changed nothing", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h);
    h.aws.handle("ecs:UpdateService", (): FakeAnswer => {
      return new CloudTransportError({
        kind: "connect",
        code: "ECONNREFUSED",
        message: "connect ECONNREFUSED",
      });
    });

    assertNotRun(
      await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`),
      /^The change was not sent, so nothing was changed: ecs:UpdateService at https:\/\/ecs\.us-east-1\.amazonaws\.com: connect ECONNREFUSED\.$/,
    );
  });

  test("a connection dropped after the change was sent: no exit code, but output (it may have landed)", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h);
    h.aws.handle("ecs:UpdateService", (): FakeAnswer => {
      return new CloudTransportError({
        kind: "reset",
        code: "ECONNRESET",
        message: "socket hang up",
      });
    });

    const result: ExecResult = await runCloud(
      h,
      "aws",
      `cloud restart-service ${ECS_ARN}`,
    );

    assert.strictEqual(result.exitCode, undefined);
    assert.notStrictEqual(result.output, "");
    assert.match(
      result.output,
      /The connection to AWS failed after the change was sent/,
    );
  });

  test("expired credentials are not a permission problem", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("ecs:DescribeServices", (): FakeAnswer => {
      return awsJsonError(
        "ExpiredTokenException",
        "The security token included in the request is expired",
        400,
      );
    });

    assertNotRun(
      await runCloud(h, "aws", `cloud restart-service ${ECS_ARN}`),
      /AWS refused ecs:DescribeServices \(HTTP 400 ExpiredTokenException\): The security token included in the request is expired\. AWS did not accept the credentials of the write role session .*: they may have expired, or the agent's clock may be off\./,
    );
  });

  test("the output is redacted and capped", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h);
    h.aws.handle("ecs:UpdateService", (): FakeAnswer => {
      return jsonReply({
        service: {
          deployments: [
            {
              id: `password=hunter2hunter2 ${"x".repeat(MAX_RESOURCE_AGENT_OUTPUT_BYTES + 100)}`,
              status: "PRIMARY",
            },
          ],
        },
      });
    });

    const result: ExecResult = await runCloud(
      h,
      "aws",
      `cloud restart-service ${ECS_ARN}`,
    );

    assert.ok(!result.output.includes("hunter2"), "the password is masked");
    assert.ok(
      Buffer.byteLength(result.output, "utf8") <=
        MAX_RESOURCE_AGENT_OUTPUT_BYTES,
    );
    assert.ok(result.output.endsWith("... [output truncated]"));
    assert.deepStrictEqual(readCloudReplacedValue(result.output), {});
  });

  test("the replaced-value line survives the redactor for every key it may carry", () => {
    for (const values of [
      { count: "12" },
      { version: "web:41" },
      { version: "checkout-00042-abc" },
      { version: "$LATEST" },
      { value: "none" },
      { state: "deallocated" },
      { primary: "us-east-1a" },
      { primary: "orders-sql-west" },
    ]) {
      const output: string = `${formatCloudReplacedValue(values)}\nAPI call: ...`;
      const redacted: string = redactOutput({
        resourceType: AiResourceType.AwsAccount,
        program: "cloud",
        text: output,
      });

      assert.strictEqual(redacted, output);
      assert.deepStrictEqual(readCloudReplacedValue(redacted), values);
    }
  });
});

describe("the undo line", () => {
  function parsed(command: string): CloudCommandParse {
    return parseCloudCommand("aws", command.split(" "));
  }

  test("an inverse with the replaced value; nothing to undo; an unknown value", () => {
    const scale: CloudCommandParse = parsed(
      `cloud scale-out ${ECS_ARN} --count 4`,
    );
    const restart: CloudCommandParse = parsed(
      `cloud restart-service ${ECS_ARN}`,
    );

    assert.ok(scale.ok && restart.ok);

    if (!scale.ok || !restart.ok) {
      return;
    }

    assert.strictEqual(
      describeCloudUndo(scale.command, { count: "2" }),
      `To undo it: cloud scale-in ${ECS_ARN} --count 2`,
    );
    assert.strictEqual(
      describeCloudUndo(restart.command, {}),
      "Nothing to undo: the same version runs again.",
    );
    assert.strictEqual(
      describeCloudUndo(scale.command, {}),
      "It cannot be undone exactly: cloud scale-out did not report the count it replaced, so it cannot be undone exactly.",
    );
  });
});

// ---- Identity and posture -------------------------------------------------------------------------

describe("the identity the agent asks its cloud for", () => {
  test("AWS: STS GetCallerIdentity's account", async () => {
    const h: CloudHarness = cloudHarness("aws", { identity: null });

    assert.strictEqual(h.config.resourceIdentifier, null);
    assert.strictEqual(
      await h.executor.resolveResourceIdentifier(),
      AWS_ACCOUNT,
    );
    assert.deepStrictEqual(h.aws.actions(), ["sts:GetCallerIdentity"]);
    // Signed with the task role, on the Region's STS endpoint.
    assert.strictEqual(
      h.aws.calls[0]?.url.hostname,
      "sts.us-east-1.amazonaws.com",
    );
    assert.strictEqual(h.aws.calls[0]?.accessKeyId, AWS_TASK_ACCESS_KEY);
  });

  test("AWS without a Region: the global STS endpoint, signed for us-east-1", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      identity: null,
      env: { AWS_REGION: "" },
    });

    assert.strictEqual(
      await h.executor.resolveResourceIdentifier(),
      AWS_ACCOUNT,
    );
    assert.strictEqual(h.aws.calls[0]?.url.hostname, "sts.amazonaws.com");
    assert.strictEqual(h.aws.calls[0]?.region, "us-east-1");
  });

  test("a cloud that does not answer: null, and a warning", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      identity: null,
      env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "" },
    });

    assert.strictEqual(await h.executor.resolveResourceIdentifier(), null);
    assert.match(
      h.logger.records[0]?.message || "",
      /Could not ask AWS which account the agent is in/,
    );
  });
});

describe("the posture", () => {
  test("AWS: reachable with its account, principal, Region, the enabled changes, the tag, the write role; its own stack and service protected", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: {
        ONEUPTIME_AI_CLOUD_OPERATIONS: "restart-service,scale-out,scale-in",
        ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow",
        ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/abc123",
      },
    });

    h.cloud.on("GET", "http://169.254.170.2/v4/abc123/task", (): FakeAnswer => {
      return jsonReply({
        Cluster: `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:cluster/ops-tools`,
        TaskARN: `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:task/ops-tools/0123456789abcdef`,
        ServiceName: "ai-agent",
      });
    });

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: "AWS",
      reachable: true,
      reachError: null,
      details: {
        cloudProvider: "aws",
        cloudAccountId: AWS_ACCOUNT,
        enabledOperations: "restart-service,scale-out,scale-in",
        requiredTag: "oneuptime-ai=allow",
        awsWriteRoleArn: AWS_WRITE_ROLE_ARN,
        awsPrincipalArn: AWS_TASK_CALLER_ARN,
        awsRegion: "us-east-1",
      },
      protectedTargets: [
        "arn:aws*:ecs:*:123456789012:service/oneuptime-ai-agent/*",
        "arn:aws*:ecs:*:123456789012:cluster/oneuptime-ai-agent",
        "arn:aws*:iam::123456789012:role/OneUptimeAiAgentTask",
        "arn:aws*:iam::123456789012:role/OneUptimeAiAgentWrite",
        "arn:aws*:cloudformation:*:123456789012:stack/oneuptime-ai-agent/*",
        "arn:aws:ecs:us-east-1:123456789012:service/ops-tools/ai-agent",
      ],
    });

    // prepare() enforces what the posture reports.
    assert.match(
      refusalOf(
        h,
        "aws",
        `cloud restart-service arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:service/ops-tools/ai-agent`,
      ),
      /which the Cloud AI agent protects \(arn:aws:ecs:us-east-1:123456789012:service\/ops-tools\/ai-agent\)/,
    );
  });

  test("AWS: a task that does not name its service protects its whole cluster", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/abc123" },
    });

    h.cloud.on("GET", "http://169.254.170.2/v4/abc123/task", (): FakeAnswer => {
      return jsonReply({
        Cluster: "ops-tools",
        TaskARN: `arn:aws:ecs:eu-west-1:${AWS_ACCOUNT}:task/ops-tools/0123456789abcdef`,
      });
    });

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.ok(
      (probe.protectedTargets || []).includes(
        "arn:aws:ecs:eu-west-1:123456789012:service/ops-tools/*",
      ),
    );
  });

  test("AWS: unreachable without credentials, or with credentials of another account and no write role", async () => {
    const none: CloudHarness = cloudHarness("aws", {
      env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "" },
    });
    const noneProbe: ResourcePostureProbe = await none.executor.probePosture();

    assert.strictEqual(noneProbe.reachable, false);
    assert.match(
      String(noneProbe.reachError),
      /^The AWS Cloud AI agent could not ask AWS who it is \(STS GetCallerIdentity with no credentials\): The agent has no AWS credentials/,
    );
    assert.strictEqual(noneProbe.toolVersion, "AWS");
    assert.ok(
      (noneProbe.protectedTargets || []).length > 0,
      "its own stack stays protected",
    );

    const other: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_AWS_WRITE_ROLE_ARN: "" },
    });

    other.aws.callerAccount = "210987654321";

    const otherProbe: ResourcePostureProbe =
      await other.executor.probePosture();

    assert.strictEqual(otherProbe.reachable, false);
    assert.match(
      String(otherProbe.reachError),
      /The agent's AWS credentials are for account 210987654321, but it serves account 123456789012: it can change nothing there/,
    );
  });

  test("AWS: a probe never throws, even when the transport does", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.cloud.on(
      "*",
      (): boolean => {
        return true;
      },
      (): FakeAnswer => {
        throw new Error("the transport broke");
      },
    );

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(String(probe.reachError), /the transport broke/);
  });

  test("enabledOperations stays within the posture's string limit, cut at a comma", async () => {
    const h: CloudHarness = cloudHarness("aws");
    const probe: ResourcePostureProbe = await h.executor.probePosture();
    const enabled: string = String(probe.details?.["enabledOperations"]);

    assert.strictEqual(
      enabled,
      "restart-service,start-instance,scale-out,scale-in,reboot-instance,roll-back-service,set-concurrency,fail-over-database,stop-instance,redrive-queue",
    );
    assert.ok(enabled.length <= 256);
  });
});

describe("the job contract", () => {
  test("prepare never sends anything; run never throws", async () => {
    const h: CloudHarness = cloudHarness("aws");
    const result: PrepareResult = h.executor.prepare(
      cloudRequest("aws", `cloud restart-service ${ECS_ARN}`),
    );

    assert.strictEqual(result.refusal, null);
    assert.deepStrictEqual(h.cloud.requests, []);

    h.cloud.on(
      "*",
      (): boolean => {
        return true;
      },
      (): FakeAnswer => {
        throw new TypeError("unexpected");
      },
    );

    const outcome: ExecResult = await prepared(result).run();

    assert.strictEqual(outcome.success, false);
  });

  test("the payload's resource id must be this agent's", () => {
    const h: CloudHarness = cloudHarness("aws");

    assert.match(
      refusalOf(h, "aws", "cloud whoami", {
        origin: "AiInvestigation",
        payload: { resourceId: "another-account-row" },
      }),
      new RegExp(
        `this command is for resource id "another-account-row", but this agent is registered for "${TEST_RESOURCE_ID}"`,
      ),
    );
  });

  test("job directories: none to sweep or remove", async () => {
    const h: CloudHarness = cloudHarness("aws");

    await h.executor.sweepOrphanedJobDirs();
    await h.executor.removeAllJobDirs();
  });
});
