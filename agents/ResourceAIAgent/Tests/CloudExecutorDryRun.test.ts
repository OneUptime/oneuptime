import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  describeReplacedValue,
  withoutNothingChanged,
} from "../Executors/CloudExecutor";
import { ExecResult } from "../Executors/ResourceExecutor";
import {
  AWS_ACCOUNT,
  AWS_WRITE_ROLE_ARN,
  AssumeRoleCall,
  AwsCall,
  FakeAnswer,
  GCP_PROJECT,
  AZURE_SUBSCRIPTION,
  jsonReply,
  reply,
} from "./Helpers/FakeCloud";
import {
  CloudHarness,
  cloudHarness,
  cloudRequest,
  outputLines,
  prepared,
  runCloud,
} from "./Helpers/CloudHarness";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  formatCloudDryRunVerdict,
  formatCloudReplacedValue,
  readCloudDryRunVerdict,
  readCloudReplacedValue,
  withoutCloudDryRunVerdict,
} from "../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * A dry run of a cloud change on the Cloud AI agent: `cloud dry-run
 * <change>`, a Read. Against the fake clouds, it is pinned that:
 *
 *  - it makes the reads the change makes first, and NEVER the change's
 *    call: on AWS no UpdateService (and its session of the write role
 *    holds the reads alone, so the call would be denied even by mistake),
 *    on Azure no POST, on Google Cloud no PATCH;
 *  - a change that would run answers would-run, then the value it would
 *    replace (the line the server reads), what it would call and its undo;
 *  - everything that would stop the change answers would-be-refused, with
 *    the reason the change itself would get: the write switch, the enabled
 *    changes, the agent's own protected stack, the account, the required
 *    tag, the resource's state and the bounds of a scale;
 *  - a read it cannot make is a dry run that could not answer (never ran);
 *  - an investigation may run it: it changes nothing.
 */

const ECS_ARN: string = `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:service/prod/web`;
const ECS_TASK_DEFINITION: string = `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:task-definition/web:41`;
const AGENT_ECS_ARN: string = `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:service/oneuptime-ai-agent/oneuptime-ai-agent`;
const OTHER_ACCOUNT_ECS_ARN: string =
  "arn:aws:ecs:us-east-1:999988887777:service/prod/web";

const SITE: string = `/subscriptions/${AZURE_SUBSCRIPTION}/resourceGroups/prod/providers/Microsoft.Web/sites/web`;
const RUN: string = `//run.googleapis.com/projects/${GCP_PROJECT}/locations/us-central1/services/web`;
const RUN_URL: string = `https://run.googleapis.com/v2/projects/${GCP_PROJECT}/locations/us-central1/services/web`;

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

// The service, and an UpdateService that records itself: a dry run must never reach it.
function withEcsService(
  h: CloudHarness,
  overrides: Record<string, unknown> = {},
): void {
  h.aws.handle("ecs:DescribeServices", (): FakeAnswer => {
    return jsonReply({ services: [ecsService(overrides)], failures: [] });
  });
  h.aws.handle("ecs:UpdateService", (call: AwsCall): FakeAnswer => {
    return jsonReply({
      service: { ...ecsService(overrides), ...(call.json || {}) },
    });
  });
}

function withScalableTarget(
  h: CloudHarness,
  target: { min: number; max: number },
): void {
  h.aws.handle(
    "application-autoscaling:DescribeScalableTargets",
    (): FakeAnswer => {
      return jsonReply({
        ScalableTargets: [
          {
            ServiceNamespace: "ecs",
            ResourceId: "service/prod/web",
            ScalableDimension: "ecs:service:DesiredCount",
            MinCapacity: target.min,
            MaxCapacity: target.max,
          },
        ],
      });
    },
  );
}

// A dry run that worked: exit code 0, and its verdict first.
function assertVerdict(
  result: ExecResult,
  verdict: "would-run" | "would-be-refused",
): Array<string> {
  assert.strictEqual(
    result.success,
    true,
    `expected the dry run to answer, got: ${String(result.errorMessage)}`,
  );
  assert.strictEqual(result.exitCode, 0);

  const lines: Array<string> = outputLines(result);

  assert.strictEqual(lines[0], formatCloudDryRunVerdict(verdict));
  assert.strictEqual(readCloudDryRunVerdict(result.output), verdict);
  return lines;
}

// The one session the dry run assumed: the write role, holding reads only.
function onlySession(h: CloudHarness): AssumeRoleCall {
  assert.strictEqual(h.aws.assumed.length, 1, "one session per dry run");
  return h.aws.assumed[0] as AssumeRoleCall;
}

describe("a dry run is a read the agent runs", () => {
  test("the agent prepares it as Read, for a fix and for an investigation alike", () => {
    const h: CloudHarness = cloudHarness("aws");
    const command: string = `cloud dry-run scale-out ${ECS_ARN} --count 4`;

    for (const origin of ["AiRemediation", "AiInvestigation"]) {
      const ready: ReturnType<typeof prepared> = prepared(
        h.executor.prepare(cloudRequest("aws", command, { origin })),
      );

      assert.strictEqual(ready.tier, ResourceCommandTier.Read);
      assert.strictEqual(ready.displayCommand, command);
    }
  });

  test("a read-only agent still answers it (the answer says the change would be refused)", () => {
    const h: CloudHarness = cloudHarness("aws", { writes: false });

    assert.strictEqual(
      h.executor.prepare(
        cloudRequest("aws", `cloud dry-run scale-out ${ECS_ARN} --count 4`),
      ).refusal,
      null,
    );
  });

  test("a refusal's reason says once that nothing was changed", () => {
    assert.strictEqual(
      withoutNothingChanged(
        "--count 8 is above 3, the most it may run, so nothing was changed",
      ),
      "--count 8 is above 3, the most it may run",
    );
    assert.strictEqual(
      withoutNothingChanged(
        "the service does not, so nothing was changed. Add the tag.",
      ),
      "the service does not. Add the tag.",
    );
    assert.strictEqual(
      withoutNothingChanged("no phrase here"),
      "no phrase here",
    );
  });

  test("describeReplacedValue names what a change would replace, or nothing", () => {
    assert.strictEqual(describeReplacedValue({}), "");
    assert.strictEqual(
      describeReplacedValue({ count: "2" }),
      ", replacing count 2",
    );
    assert.strictEqual(
      describeReplacedValue({ version: "web:41", count: "2" }),
      ", replacing count 2 and version web:41",
    );
    assert.strictEqual(
      describeReplacedValue({ value: "none" }),
      ", replacing limit none",
    );
  });
});

describe("AWS: a dry run reads and stops before the change", () => {
  test("scale-out would run: the count it would replace, the call, the undo - and no UpdateService", async () => {
    const h: CloudHarness = cloudHarness("aws", { randomIds: ["5e6f7a8b"] });

    withEcsService(h);
    withScalableTarget(h, { min: 1, max: 10 });

    const result: ExecResult = await runCloud(
      h,
      "aws",
      `cloud dry-run scale-out ${ECS_ARN} --count 4`,
    );
    const lines: Array<string> = assertVerdict(result, "would-run");

    assert.deepStrictEqual(lines.slice(1), [
      formatCloudReplacedValue({ count: "2" }),
      `Dry run: nothing was changed. cloud scale-out ${ECS_ARN} --count 4 would run, replacing count 2.`,
      "It would make ecs:UpdateService with desiredCount, and nothing else.",
      `To undo it: cloud scale-in ${ECS_ARN} --count 2`,
    ]);
    // What the server reads back: the replaced value after the verdict.
    assert.deepStrictEqual(
      readCloudReplacedValue(withoutCloudDryRunVerdict(result.output)),
      { count: "2" },
    );

    assert.deepStrictEqual(h.aws.actions(), [
      "sts:AssumeRole",
      "ecs:DescribeServices",
      "application-autoscaling:DescribeScalableTargets",
    ]);
    assert.deepStrictEqual(h.aws.callsTo("ecs:UpdateService"), []);
    assert.deepStrictEqual(h.aws.policyDenials, []);
    assert.deepStrictEqual(h.aws.signatureFailures, []);
  });

  test("its session of the write role holds the reads alone, under a dry run's name", async () => {
    const h: CloudHarness = cloudHarness("aws", { randomIds: ["5e6f7a8b"] });

    withEcsService(h);
    withScalableTarget(h, { min: 1, max: 10 });

    await runCloud(h, "aws", `cloud dry-run scale-out ${ECS_ARN} --count 4`);

    const session: AssumeRoleCall = onlySession(h);

    assert.strictEqual(session.roleArn, AWS_WRITE_ROLE_ARN);
    assert.strictEqual(
      session.sessionName,
      "oneuptime-ai-dry-run-scale-out-5e6f7a8b",
    );
    assert.strictEqual(session.durationSeconds, "900");
    // No OneUptimeAiChange statement: the session cannot write, whatever is sent.
    assert.deepStrictEqual(session.policy, {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "OneUptimeAiRead",
          Effect: "Allow",
          Action: [
            "ecs:DescribeServices",
            "application-autoscaling:DescribeScalableTargets",
          ],
          Resource: "*",
        },
      ],
    });
  });

  test("restart-service would run with nothing to replace, and nothing to undo", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h);

    const lines: Array<string> = assertVerdict(
      await runCloud(h, "aws", `cloud dry-run restart-service ${ECS_ARN}`),
      "would-run",
    );

    assert.deepStrictEqual(lines.slice(1), [
      formatCloudReplacedValue({}),
      `Dry run: nothing was changed. cloud restart-service ${ECS_ARN} would run.`,
      "It would make ecs:UpdateService with forceNewDeployment, and nothing else.",
      "Nothing to undo: the same version runs again.",
    ]);
    assert.deepStrictEqual(h.aws.callsTo("ecs:UpdateService"), []);
  });

  test("a scale above the platform's maximum would be refused for that bound, after the reads", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withEcsService(h);
    withScalableTarget(h, { min: 1, max: 3 });

    const lines: Array<string> = assertVerdict(
      await runCloud(h, "aws", `cloud dry-run scale-out ${ECS_ARN} --count 8`),
      "would-be-refused",
    );

    assert.strictEqual(lines.length, 2);

    const line: string = lines[1] || "";

    assert.ok(
      line.startsWith(
        `Dry run: nothing was changed. cloud scale-out ${ECS_ARN} --count 8 would be refused: --count 8 is above 3, the most the ECS service may run (the maximum of its scalable target in Application Auto Scaling)`,
      ),
      line,
    );
    assert.deepStrictEqual(h.aws.callsTo("ecs:UpdateService"), []);
  });

  test("a read-only agent: the change would be refused, saying how to allow writes - and nothing is read", async () => {
    const h: CloudHarness = cloudHarness("aws", { writes: false });

    withEcsService(h);

    const lines: Array<string> = assertVerdict(
      await runCloud(h, "aws", `cloud dry-run scale-out ${ECS_ARN} --count 4`),
      "would-be-refused",
    );

    assert.match(
      lines[1] || "",
      /would be refused: "cloud scale-out .* --count 4" changes the AWS account, and this agent is read-only \(ONEUPTIME_AI_ALLOW_WRITES is not set\)\. To let OneUptime AI apply fixes, set ONEUPTIME_AI_ALLOW_WRITES=true on the agent and restart it\.$/,
    );
    assert.deepStrictEqual(h.aws.actions(), []);
  });

  test("a change the agent may not make (ONEUPTIME_AI_CLOUD_OPERATIONS) would be refused", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_CLOUD_OPERATIONS: "restart-service" },
    });

    withEcsService(h);

    const lines: Array<string> = assertVerdict(
      await runCloud(h, "aws", `cloud dry-run scale-out ${ECS_ARN} --count 4`),
      "would-be-refused",
    );

    assert.match(
      lines[1] || "",
      /would be refused: cloud scale-out is not one of the changes this agent may make \(ONEUPTIME_AI_CLOUD_OPERATIONS=restart-service\)\./,
    );
    assert.deepStrictEqual(h.aws.actions(), []);
  });

  test("the agent's own service would be refused: it protects its own stack", async () => {
    const h: CloudHarness = cloudHarness("aws");

    const lines: Array<string> = assertVerdict(
      await runCloud(
        h,
        "aws",
        `cloud dry-run restart-service ${AGENT_ECS_ARN}`,
      ),
      "would-be-refused",
    );

    assert.match(
      lines[1] || "",
      /would be refused: "cloud restart-service .*oneuptime-ai-agent" would change .*, which the Cloud AI agent protects \(.*\): OneUptime AI never changes the agent itself or what it runs in\.$/,
    );
    assert.deepStrictEqual(h.aws.actions(), []);
  });

  test("a resource of another account would be refused", async () => {
    const h: CloudHarness = cloudHarness("aws");

    const lines: Array<string> = assertVerdict(
      await runCloud(
        h,
        "aws",
        `cloud dry-run restart-service ${OTHER_ACCOUNT_ECS_ARN}`,
      ),
      "would-be-refused",
    );

    assert.match(
      lines[1] || "",
      /would be refused: .* is in AWS account 999988887777, and this agent acts in account 123456789012 only\./,
    );
  });

  test("a resource without the required tag would be refused, after its tags were read", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    withEcsService(h);

    const lines: Array<string> = assertVerdict(
      await runCloud(h, "aws", `cloud dry-run restart-service ${ECS_ARN}`),
      "would-be-refused",
    );

    assert.match(
      lines[1] || "",
      /would be refused: the agent only changes resources that carry the tag oneuptime-ai=allow \(ONEUPTIME_AI_CLOUD_REQUIRED_TAG\), and the ECS service .* does not\. Add the tag to the resource to let OneUptime AI change it\.$/,
    );
    assert.deepStrictEqual(h.aws.callsTo("ecs:UpdateService"), []);
  });

  test("a read it cannot make: the dry run could not answer, and nothing was changed", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("ecs:DescribeServices", (): FakeAnswer => {
      return reply(500, "internal error");
    });

    const result: ExecResult = await runCloud(
      h,
      "aws",
      `cloud dry-run restart-service ${ECS_ARN}`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.output, "");
    assert.match(
      String(result.errorMessage),
      /^The dry run of cloud restart-service .* could not be finished, and nothing was changed: /,
    );
    assert.deepStrictEqual(h.aws.callsTo("ecs:UpdateService"), []);
  });
});

describe("Azure and Google Cloud: a dry run never sends the change", () => {
  test("Azure: restart-service of a running app would run - the app is read, no POST restart", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", SITE, (): FakeAnswer => {
      return jsonReply({
        id: SITE,
        tags: {},
        properties: { state: "Running" },
      });
    });
    h.arm.handle("POST", `${SITE}/restart`, (): FakeAnswer => {
      return reply(200, "");
    });

    const lines: Array<string> = assertVerdict(
      await runCloud(h, "azure", `cloud dry-run restart-service ${SITE}`),
      "would-run",
    );

    assert.strictEqual(lines[1], formatCloudReplacedValue({}));
    assert.strictEqual(
      lines[2],
      `Dry run: nothing was changed. cloud restart-service ${SITE.toLowerCase()} would run.`,
    );
    assert.deepStrictEqual(h.arm.paths(), [`GET ${SITE}`]);
    assert.deepStrictEqual(h.arm.callsTo("POST", `${SITE}/restart`), []);
  });

  test("Azure: a stopped app would be refused, for the state the change would meet", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", SITE, (): FakeAnswer => {
      return jsonReply({ id: SITE, properties: { state: "Stopped" } });
    });

    const lines: Array<string> = assertVerdict(
      await runCloud(h, "azure", `cloud dry-run restart-service ${SITE}`),
      "would-be-refused",
    );

    assert.match(
      lines[1] || "",
      /would be refused: the app web is Stopped: restart-service restarts a running app\.$/,
    );
  });

  test("Google Cloud: scale-out of a Cloud Run service would run - the service is read, no PATCH", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    h.gcp.handle("GET", RUN_URL, (): FakeAnswer => {
      return jsonReply({
        name: `projects/${GCP_PROJECT}/locations/us-central1/services/web`,
        labels: {},
        scaling: { minInstanceCount: 1 },
        template: { scaling: { maxInstanceCount: 10 } },
      });
    });
    h.gcp.handle("PATCH", RUN_URL, (): FakeAnswer => {
      return jsonReply({ name: "op", done: true });
    });

    const lines: Array<string> = assertVerdict(
      await runCloud(h, "gcp", `cloud dry-run scale-out ${RUN} --count 2`),
      "would-run",
    );

    assert.deepStrictEqual(lines.slice(1, 3), [
      formatCloudReplacedValue({ count: "1" }),
      `Dry run: nothing was changed. cloud scale-out ${RUN} --count 2 would run, replacing count 1.`,
    ]);
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud scale-in ${RUN} --count 1`,
    );
    assert.deepStrictEqual(h.gcp.callsTo("PATCH", RUN_URL), []);
  });
});
