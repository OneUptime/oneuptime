import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import { ExecResult } from "../Executors/ResourceExecutor";
import {
  AWS_ACCOUNT,
  AWS_WRITE_ROLE_ARN,
  ArmCall,
  AssumeRoleCall,
  AwsCall,
  AZURE_SUBSCRIPTION,
  FakeAnswer,
  GCP_PROJECT,
  GcpCall,
  awsJsonError,
  jsonReply,
  reply,
  xmlReply,
} from "./Helpers/FakeCloud";
import {
  CloudHarness,
  assertChanged,
  assertNotRun,
  cloudHarness,
  outputLines,
  runCloud,
} from "./Helpers/CloudHarness";
import {
  formatCloudDryRunVerdict,
  formatCloudReplacedValue,
} from "../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * App Platforms' own platforms on the Cloud AI agent, against the fake
 * clouds: an App Runner service and an Elastic Beanstalk environment on
 * AWS, a container group on Azure, an App Engine service on Google Cloud.
 * For each change it is pinned that the agent makes the reads that decide
 * whether it may run, then the ONE call it maps to (with, on AWS, a
 * session of the write role whose policy holds that change on that one
 * resource and the reads alone), reports the value it replaced first and
 * its exact undo, refuses what would not be the version running now or
 * what a person decides, and that a dry run stops before the call.
 */

const APP_RUNNER_ARN: string = `arn:aws:apprunner:us-east-1:${AWS_ACCOUNT}:service/checkout-web/8fe1e10304f84fd2b0df550fe98a71fa`;
const BEANSTALK_ARN: string = `arn:aws:elasticbeanstalk:us-east-1:${AWS_ACCOUNT}:environment/shop/shop-prod`;
const CONTAINER_GROUP: string = `/subscriptions/${AZURE_SUBSCRIPTION}/resourceGroups/jobs/providers/Microsoft.ContainerInstance/containerGroups/nightly-export`;
const CONTAINER_GROUP_SHOWN: string = CONTAINER_GROUP.toLowerCase();
const APP_ENGINE: string = `//appengine.googleapis.com/apps/${GCP_PROJECT}/services/default`;
const APP_ENGINE_URL: string = `https://appengine.googleapis.com/v1/apps/${GCP_PROJECT}/services/default`;
const APP_ENGINE_OPERATION: string = `apps/${GCP_PROJECT}/operations/7c0c6a2e-1d2b-4c3a-9e8f-1a2b3c4d5e6f`;
const APP_ENGINE_OPERATION_URL: string = `https://appengine.googleapis.com/v1/${APP_ENGINE_OPERATION}`;

function onlySession(h: CloudHarness): AssumeRoleCall {
  assert.strictEqual(h.aws.assumed.length, 1, "one write session per change");
  return h.aws.assumed[0] as AssumeRoleCall;
}

function assertCleanAws(h: CloudHarness): void {
  assert.deepStrictEqual(h.aws.signatureFailures, []);
  assert.deepStrictEqual(h.aws.policyDenials, []);
}

// ---- App Runner ------------------------------------------------------------------------------

function appRunnerService(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ServiceName: "checkout-web",
    ServiceId: "8fe1e10304f84fd2b0df550fe98a71fa",
    ServiceArn: APP_RUNNER_ARN,
    ServiceUrl: "abcdefgh.us-east-1.awsapprunner.com",
    Status: "RUNNING",
    SourceConfiguration: {
      AutoDeploymentsEnabled: true,
      ImageRepository: {
        ImageIdentifier: `${AWS_ACCOUNT}.dkr.ecr.us-east-1.amazonaws.com/checkout-web:live`,
        ImageRepositoryType: "ECR",
      },
    },
    ...overrides,
  };
}

function withAppRunner(
  h: CloudHarness,
  overrides: Record<string, unknown> = {},
): void {
  h.aws.handle("apprunner:DescribeService", (): FakeAnswer => {
    return jsonReply({ Service: appRunnerService(overrides) });
  });
  h.aws.handle("apprunner:StartDeployment", (): FakeAnswer => {
    return jsonReply({ OperationId: "a1b2c3d4e5f60718293a4b5c6d7e8f90" });
  });
}

describe("AWS: an App Runner service", () => {
  test("restart-service redeploys the version it runs: one StartDeployment, as the write role with a policy for this change alone", async () => {
    const h: CloudHarness = cloudHarness("aws", { randomIds: ["1a2b3c4d"] });

    withAppRunner(h);

    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud restart-service ${APP_RUNNER_ARN}`),
      {},
    );

    assert.deepStrictEqual(lines.slice(1), [
      `App Runner service checkout-web: redeploying the image ${AWS_ACCOUNT}.dkr.ecr.us-east-1.amazonaws.com/checkout-web:live, the version it runs now (automatic deployments are on, so the latest version of its source is the one running). App Runner replaces its instances one by one, and keeps the version it runs if the new deployment fails.`,
      `API call: apprunner:StartDeployment (a redeploy of the version it runs, automatic deployments on) (ServiceArn=${APP_RUNNER_ARN}), in us-east-1, as arn:aws:sts::${AWS_ACCOUNT}:assumed-role/OneUptimeAiAgentWrite/oneuptime-ai-restart-service-1a2b3c4d (the write role, with a session policy for this change alone).`,
      "Operation: a1b2c3d4e5f60718293a4b5c6d7e8f90.",
      "Nothing to undo: the same version runs again.",
    ]);

    const session: AssumeRoleCall = onlySession(h);

    assert.strictEqual(session.roleArn, AWS_WRITE_ROLE_ARN);
    assert.deepStrictEqual(session.policy, {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "OneUptimeAiChange",
          Effect: "Allow",
          Action: ["apprunner:StartDeployment"],
          Resource: [APP_RUNNER_ARN],
        },
        {
          Sid: "OneUptimeAiRead",
          Effect: "Allow",
          Action: ["apprunner:DescribeService"],
          Resource: "*",
        },
      ],
    });
    assert.deepStrictEqual(h.aws.actions(), [
      "sts:AssumeRole",
      "apprunner:DescribeService",
      "apprunner:StartDeployment",
    ]);

    for (const call of [
      ...h.aws.callsTo("apprunner:DescribeService"),
      ...h.aws.callsTo("apprunner:StartDeployment"),
    ]) {
      assert.strictEqual(
        call.url.hostname,
        "apprunner.us-east-1.amazonaws.com",
      );
      assert.strictEqual(call.accessKeyId, session.accessKeyId);
      assert.strictEqual(
        call.request.headers["Content-Type"],
        "application/x-amz-json-1.0",
      );
      assert.deepStrictEqual(call.json, { ServiceArn: APP_RUNNER_ARN });
    }

    assertCleanAws(h);
  });

  test("a service built from a repository is redeployed from its branch, named so", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withAppRunner(h, {
      SourceConfiguration: {
        AutoDeploymentsEnabled: true,
        CodeRepository: {
          RepositoryUrl: "https://github.com/acme/checkout-web",
          SourceCodeVersion: { Type: "BRANCH", Value: "main" },
        },
      },
    });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud restart-service ${APP_RUNNER_ARN}`),
      {},
    );

    assert.match(
      lines[1] as string,
      /^App Runner service checkout-web: redeploying the latest commit of https:\/\/github\.com\/acme\/checkout-web \(main\), the version it runs now/,
    );
  });

  test("with automatic deployments off a redeploy could start a newer version, so it is refused before any change", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withAppRunner(h, {
      SourceConfiguration: {
        AutoDeploymentsEnabled: false,
        ImageRepository: { ImageIdentifier: "public.ecr.aws/acme/web:latest" },
      },
    });

    assertNotRun(
      await runCloud(h, "aws", `cloud restart-service ${APP_RUNNER_ARN}`),
      /^Refused by the Cloud AI agent: the App Runner service checkout-web deploys a new version of its source only when someone asks \(automatic deployments are off\), so a redeploy could start a version newer than the one it runs: a person redeploys it, and nothing was changed\.$/,
    );
    assert.deepStrictEqual(h.aws.callsTo("apprunner:StartDeployment"), []);
  });

  test("a paused, or busy, service is not redeployed", async () => {
    for (const status of ["PAUSED", "OPERATION_IN_PROGRESS"]) {
      const h: CloudHarness = cloudHarness("aws");

      withAppRunner(h, { Status: status });

      assertNotRun(
        await runCloud(h, "aws", `cloud restart-service ${APP_RUNNER_ARN}`),
        new RegExp(
          `the App Runner service checkout-web is ${status}, and a redeploy needs it RUNNING, so nothing was changed`,
        ),
      );
      assert.deepStrictEqual(h.aws.callsTo("apprunner:StartDeployment"), []);
    }
  });

  test("a service App Runner does not know, or another one than the id names, is never changed", async () => {
    const gone: CloudHarness = cloudHarness("aws");

    gone.aws.handle("apprunner:DescribeService", (): FakeAnswer => {
      return awsJsonError(
        "ResourceNotFoundException",
        "Resource not found",
        400,
      );
    });

    assertNotRun(
      await runCloud(gone, "aws", `cloud restart-service ${APP_RUNNER_ARN}`),
      /^The agent could not ask AWS about the App Runner service checkout-web \(apprunner:DescribeService\), so nothing was changed/,
    );

    const other: CloudHarness = cloudHarness("aws");

    withAppRunner(other, {
      ServiceArn: APP_RUNNER_ARN.replace(
        "8fe1e10304f84fd2b0df550fe98a71fa",
        "00000000000000000000000000000001",
      ),
    });

    assertNotRun(
      await runCloud(other, "aws", `cloud restart-service ${APP_RUNNER_ARN}`),
      /App Runner has no service arn:aws:apprunner:.+, so nothing was changed/,
    );
    assert.deepStrictEqual(other.aws.callsTo("apprunner:StartDeployment"), []);
  });

  test("the required tag is read with ListTagsForResource, which joins the session's reads only then", async () => {
    const tagged: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    withAppRunner(tagged);
    tagged.aws.handle("apprunner:ListTagsForResource", (): FakeAnswer => {
      return jsonReply({ Tags: [{ Key: "oneuptime-ai", Value: "allow" }] });
    });

    assertChanged(
      await runCloud(tagged, "aws", `cloud restart-service ${APP_RUNNER_ARN}`),
      {},
    );
    assert.deepStrictEqual(onlySession(tagged).policy["Statement"], [
      {
        Sid: "OneUptimeAiChange",
        Effect: "Allow",
        Action: ["apprunner:StartDeployment"],
        Resource: [APP_RUNNER_ARN],
      },
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: ["apprunner:DescribeService", "apprunner:ListTagsForResource"],
        Resource: "*",
      },
    ]);
    assert.deepStrictEqual(
      tagged.aws.callsTo("apprunner:ListTagsForResource")[0]?.json,
      { ResourceArn: APP_RUNNER_ARN },
    );
    assertCleanAws(tagged);

    const untagged: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    withAppRunner(untagged);
    untagged.aws.handle("apprunner:ListTagsForResource", (): FakeAnswer => {
      return jsonReply({ Tags: [{ Key: "team", Value: "shop" }] });
    });

    assertNotRun(
      await runCloud(
        untagged,
        "aws",
        `cloud restart-service ${APP_RUNNER_ARN}`,
      ),
      /does not, so nothing was changed\. Add the tag to the resource to let OneUptime AI change it\.$/,
    );
    assert.deepStrictEqual(
      untagged.aws.callsTo("apprunner:StartDeployment"),
      [],
    );
  });

  test("a dry run makes the reads, says it would run, and never deploys; its session only reads", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withAppRunner(h);

    const result: ExecResult = await runCloud(
      h,
      "aws",
      `cloud dry-run restart-service ${APP_RUNNER_ARN}`,
      { origin: "AiInvestigation" },
    );
    const lines: Array<string> = outputLines(result);

    assert.strictEqual(result.success, true);
    assert.strictEqual(lines[0], formatCloudDryRunVerdict("would-run"));
    assert.strictEqual(lines[1], formatCloudReplacedValue({}));
    assert.deepStrictEqual(h.aws.callsTo("apprunner:StartDeployment"), []);
    assert.deepStrictEqual(onlySession(h).policy["Statement"], [
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: ["apprunner:DescribeService"],
        Resource: "*",
      },
    ]);
  });
});

// ---- Elastic Beanstalk ------------------------------------------------------------------------

function beanstalkXml(
  data: {
    status?: string;
    name?: string;
    application?: string;
    arn?: string;
    version?: string;
  } = {},
): string {
  const name: string = data.name ?? "shop-prod";
  const application: string = data.application ?? "shop";

  return `<DescribeEnvironmentsResponse xmlns="http://elasticbeanstalk.amazonaws.com/docs/2010-12-01/">
  <DescribeEnvironmentsResult>
    <Environments>
      <member>
        <EnvironmentName>${name}</EnvironmentName>
        <EnvironmentId>e-abcd1234ef</EnvironmentId>
        <ApplicationName>${application}</ApplicationName>
        <VersionLabel>${data.version ?? "v42"}</VersionLabel>
        <Status>${data.status ?? "Ready"}</Status>
        <Health>Red</Health>
        <EnvironmentArn>${data.arn ?? BEANSTALK_ARN}</EnvironmentArn>
      </member>
    </Environments>
  </DescribeEnvironmentsResult>
  <ResponseMetadata><RequestId>req-eb-1</RequestId></ResponseMetadata>
</DescribeEnvironmentsResponse>`;
}

function withBeanstalk(
  h: CloudHarness,
  data: Parameters<typeof beanstalkXml>[0] = {},
): void {
  h.aws.handle("elasticbeanstalk:DescribeEnvironments", (): FakeAnswer => {
    return xmlReply(beanstalkXml(data));
  });
  h.aws.handle("elasticbeanstalk:RestartAppServer", (): FakeAnswer => {
    return xmlReply(
      `<RestartAppServerResponse xmlns="http://elasticbeanstalk.amazonaws.com/docs/2010-12-01/"><ResponseMetadata><RequestId>req-eb-2</RequestId></ResponseMetadata></RestartAppServerResponse>`,
    );
  });
}

describe("AWS: an Elastic Beanstalk environment", () => {
  test("restart-service restarts every instance's app server on the version it runs: one RestartAppServer, on this environment alone", async () => {
    const h: CloudHarness = cloudHarness("aws", { randomIds: ["5e6f7a8b"] });

    withBeanstalk(h);

    const lines: Array<string> = assertChanged(
      await runCloud(h, "aws", `cloud restart-service ${BEANSTALK_ARN}`),
      {},
    );

    assert.deepStrictEqual(lines.slice(1), [
      "Elastic Beanstalk environment shop-prod (application shop): restarting the app server on each of its instances, on the version it runs now, v42. Requests may fail while the app servers restart.",
      `API call: elasticbeanstalk:RestartAppServer (every instance's app server, on the version it runs) (EnvironmentName=shop-prod), in us-east-1, as arn:aws:sts::${AWS_ACCOUNT}:assumed-role/OneUptimeAiAgentWrite/oneuptime-ai-restart-service-5e6f7a8b (the write role, with a session policy for this change alone).`,
      "Nothing to undo: the same version runs again.",
    ]);
    assert.deepStrictEqual(onlySession(h).policy["Statement"], [
      {
        Sid: "OneUptimeAiChange",
        Effect: "Allow",
        Action: ["elasticbeanstalk:RestartAppServer"],
        Resource: [BEANSTALK_ARN],
      },
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: ["elasticbeanstalk:DescribeEnvironments"],
        Resource: "*",
      },
    ]);

    const describe: AwsCall | undefined = h.aws.callsTo(
      "elasticbeanstalk:DescribeEnvironments",
    )[0];

    assert.strictEqual(
      describe?.url.hostname,
      "elasticbeanstalk.us-east-1.amazonaws.com",
    );
    assert.deepStrictEqual(describe?.form, {
      Action: "DescribeEnvironments",
      Version: "2010-12-01",
      ApplicationName: "shop",
      "EnvironmentNames.member.1": "shop-prod",
      IncludeDeleted: "false",
    });
    assert.deepStrictEqual(
      h.aws.callsTo("elasticbeanstalk:RestartAppServer")[0]?.form,
      {
        Action: "RestartAppServer",
        Version: "2010-12-01",
        EnvironmentName: "shop-prod",
      },
    );
    assertCleanAws(h);
  });

  test("an environment that is updating, or not there, is not restarted", async () => {
    const updating: CloudHarness = cloudHarness("aws");

    withBeanstalk(updating, { status: "Updating" });
    assertNotRun(
      await runCloud(updating, "aws", `cloud restart-service ${BEANSTALK_ARN}`),
      /the Elastic Beanstalk environment shop-prod is Updating, and a restart needs it Ready, so nothing was changed/,
    );
    assert.deepStrictEqual(
      updating.aws.callsTo("elasticbeanstalk:RestartAppServer"),
      [],
    );

    const missing: CloudHarness = cloudHarness("aws");

    withBeanstalk(missing, { name: "shop-staging" });
    assertNotRun(
      await runCloud(missing, "aws", `cloud restart-service ${BEANSTALK_ARN}`),
      /there is no Elastic Beanstalk environment shop-prod of the application shop in us-east-1, so nothing was changed/,
    );
  });

  test("an environment of the same name that is not the one the id names is never changed", async () => {
    const h: CloudHarness = cloudHarness("aws");

    withBeanstalk(h, {
      arn: `arn:aws:elasticbeanstalk:us-east-1:${AWS_ACCOUNT}:environment/other/shop-prod`,
    });

    assertNotRun(
      await runCloud(h, "aws", `cloud restart-service ${BEANSTALK_ARN}`),
      /the Elastic Beanstalk environment named shop-prod is not the one .+ names, so nothing was changed/,
    );
    assert.deepStrictEqual(
      h.aws.callsTo("elasticbeanstalk:RestartAppServer"),
      [],
    );
  });

  test("the required tag is read with ListTagsForResource on the environment's ARN", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    withBeanstalk(h);
    h.aws.handle("elasticbeanstalk:ListTagsForResource", (): FakeAnswer => {
      return xmlReply(
        `<ListTagsForResourceResponse><ListTagsForResourceResult><ResourceArn>${BEANSTALK_ARN}</ResourceArn><ResourceTags><member><Key>oneuptime-ai</Key><Value>allow</Value></member></ResourceTags></ListTagsForResourceResult></ListTagsForResourceResponse>`,
      );
    });

    assertChanged(
      await runCloud(h, "aws", `cloud restart-service ${BEANSTALK_ARN}`),
      {},
    );
    assert.strictEqual(
      h.aws.callsTo("elasticbeanstalk:ListTagsForResource")[0]?.form[
        "ResourceArn"
      ],
      BEANSTALK_ARN,
    );
    assert.deepStrictEqual(onlySession(h).policy["Statement"], [
      {
        Sid: "OneUptimeAiChange",
        Effect: "Allow",
        Action: ["elasticbeanstalk:RestartAppServer"],
        Resource: [BEANSTALK_ARN],
      },
      {
        Sid: "OneUptimeAiRead",
        Effect: "Allow",
        Action: [
          "elasticbeanstalk:DescribeEnvironments",
          "elasticbeanstalk:ListTagsForResource",
        ],
        Resource: "*",
      },
    ]);
    assertCleanAws(h);
  });
});

// ---- Azure Container Instances -------------------------------------------------------------------

function withContainerGroup(
  h: CloudHarness,
  data: { state: string; tags?: Record<string, string> },
): void {
  h.arm.handle("GET", CONTAINER_GROUP, (): FakeAnswer => {
    return jsonReply({
      id: CONTAINER_GROUP,
      name: "nightly-export",
      tags: data.tags || { team: "data" },
      properties: {
        provisioningState: "Succeeded",
        instanceView: { state: data.state },
      },
    });
  });

  for (const action of ["restart", "start", "stop"]) {
    h.arm.handle("POST", `${CONTAINER_GROUP}/${action}`, (): FakeAnswer => {
      return reply(204, "");
    });
  }
}

describe("Azure: a container group", () => {
  test("restart-service restarts its containers in place: one POST restart, on its own api-version", async () => {
    const h: CloudHarness = cloudHarness("azure");

    withContainerGroup(h, { state: "Running" });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud restart-service ${CONTAINER_GROUP}`),
      {},
    );

    assert.strictEqual(
      lines[1],
      "Container group nightly-export (resource group jobs): restarting its containers in place. If the tag of an image it runs now points to a newer image, Azure pulls that one.",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      "Nothing to undo: the same version runs again.",
    );

    const restart: ArmCall | undefined = h.arm.callsTo(
      "POST",
      `${CONTAINER_GROUP}/restart`,
    )[0];

    assert.strictEqual(restart?.apiVersion, "2023-05-01");
    assert.strictEqual(
      h.arm.callsTo("GET", CONTAINER_GROUP)[0]?.apiVersion,
      "2023-05-01",
    );
  });

  test("start-instance starts a stopped group, and is undone by stopping it", async () => {
    const h: CloudHarness = cloudHarness("azure");

    withContainerGroup(h, { state: "Stopped" });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud start-instance ${CONTAINER_GROUP}`),
      { state: "stopped" },
    );

    assert.strictEqual(
      lines[1],
      "Container group nightly-export (resource group jobs): stopped → running.",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud stop-instance ${CONTAINER_GROUP_SHOWN}`,
    );
    assert.strictEqual(
      h.arm.callsTo("POST", `${CONTAINER_GROUP}/start`).length,
      1,
    );
  });

  test("stop-instance stops a running group, and is undone by starting it", async () => {
    const h: CloudHarness = cloudHarness("azure");

    withContainerGroup(h, { state: "Running" });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud stop-instance ${CONTAINER_GROUP}`),
      { state: "running" },
    );

    assert.strictEqual(
      lines[1],
      "Container group nightly-export (resource group jobs): running → stopped (stopped: its compute is released and no longer billed).",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud start-instance ${CONTAINER_GROUP_SHOWN}`,
    );
  });

  test("a group in another state than the change needs is not touched", async () => {
    for (const [command, state] of [
      ["start-instance", "Running"],
      ["stop-instance", "Stopped"],
      ["restart-service", "Stopped"],
      ["start-instance", "Pending"],
    ] as Array<[string, string]>) {
      const h: CloudHarness = cloudHarness("azure");

      withContainerGroup(h, { state });

      assertNotRun(
        await runCloud(h, "azure", `cloud ${command} ${CONTAINER_GROUP}`),
        new RegExp(
          `the container group nightly-export is ${state.toLowerCase()}, and cloud ${command} needs it (running|stopped), so nothing was changed`,
        ),
      );
      assert.deepStrictEqual(
        h.arm.paths().filter((path: string): boolean => {
          return path.startsWith("POST");
        }),
        [],
      );
    }
  });

  test("the required tag is read from the group's own tags", async () => {
    const h: CloudHarness = cloudHarness("azure", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    withContainerGroup(h, { state: "Running", tags: { team: "data" } });

    assertNotRun(
      await runCloud(h, "azure", `cloud restart-service ${CONTAINER_GROUP}`),
      /the container group .+ does not, so nothing was changed/,
    );

    const allowed: CloudHarness = cloudHarness("azure", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    withContainerGroup(allowed, {
      state: "Running",
      tags: { "oneuptime-ai": "allow" },
    });
    assertChanged(
      await runCloud(
        allowed,
        "azure",
        `cloud restart-service ${CONTAINER_GROUP}`,
      ),
      {},
    );
  });

  test("a dry run of a stop reads the group, would run, and sends no POST", async () => {
    const h: CloudHarness = cloudHarness("azure");

    withContainerGroup(h, { state: "Running" });

    const result: ExecResult = await runCloud(
      h,
      "azure",
      `cloud dry-run stop-instance ${CONTAINER_GROUP}`,
      { origin: "AiInvestigation" },
    );
    const lines: Array<string> = outputLines(result);

    assert.strictEqual(lines[0], formatCloudDryRunVerdict("would-run"));
    assert.strictEqual(
      lines[1],
      formatCloudReplacedValue({ state: "running" }),
    );
    assert.deepStrictEqual(
      h.arm.paths().filter((path: string): boolean => {
        return path.startsWith("POST");
      }),
      [],
    );
  });
});

// ---- App Engine ----------------------------------------------------------------------------------

function withAppEngine(
  h: CloudHarness,
  data: {
    allocations?: Record<string, number>;
    labels?: Record<string, string>;
    versions?: Array<Record<string, unknown>>;
    version?: Record<string, unknown>;
  } = {},
): void {
  h.gcp.handle("GET", APP_ENGINE_URL, (): FakeAnswer => {
    return jsonReply({
      name: `apps/${GCP_PROJECT}/services/default`,
      id: "default",
      split: {
        shardBy: "IP",
        allocations: data.allocations || { "20261106t083000": 1 },
      },
      labels: data.labels || {},
    });
  });
  h.gcp.handle(
    "GET",
    `${APP_ENGINE_URL}/versions`,
    (call: GcpCall): FakeAnswer => {
      const versions: Array<Record<string, unknown>> = data.versions || [
        {
          id: "20261106t083000",
          servingStatus: "SERVING",
          createTime: "2026-11-06T08:30:00Z",
        },
        {
          id: "20261105t101500",
          servingStatus: "SERVING",
          createTime: "2026-11-05T10:15:00Z",
        },
        {
          id: "20261101t090000",
          servingStatus: "SERVING",
          createTime: "2026-11-01T09:00:00Z",
        },
      ];

      // Two pages: the newest two, then the rest.
      return call.query["pageToken"]
        ? jsonReply({ versions: versions.slice(2) })
        : jsonReply({ versions: versions.slice(0, 2), nextPageToken: "p2" });
    },
  );
  h.gcp.handle(
    "GET",
    `${APP_ENGINE_URL}/versions/20261106t083000`,
    (): FakeAnswer => {
      return jsonReply(
        data.version || {
          id: "20261106t083000",
          servingStatus: "SERVING",
          env: "flexible",
          manualScaling: { instances: 2 },
        },
      );
    },
  );
  h.gcp.handle("PATCH", APP_ENGINE_URL, (): FakeAnswer => {
    return jsonReply({ name: APP_ENGINE_OPERATION, done: false });
  });
  h.gcp.handle(
    "PATCH",
    `${APP_ENGINE_URL}/versions/20261106t083000`,
    (): FakeAnswer => {
      return jsonReply({ name: APP_ENGINE_OPERATION, done: false });
    },
  );
  h.gcp.handle("GET", APP_ENGINE_OPERATION_URL, (): FakeAnswer => {
    return jsonReply({ name: APP_ENGINE_OPERATION, done: true });
  });
}

describe("Google Cloud: an App Engine service", () => {
  test("roll-back-service moves all traffic to the serving version created before the one serving, and follows the operation", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    withAppEngine(h);

    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud roll-back-service ${APP_ENGINE}`),
      { version: "20261106t083000" },
    );

    assert.deepStrictEqual(lines.slice(1), [
      "App Engine service default: traffic 20261106t083000 → 20261105t101500 (all of it). A new deployment serves no traffic until traffic moves to it.",
      `API call: appengine.apps.services.patch of its traffic split (a version of the same service) (updateMask=split, 20261105t101500=1), as the service account oneuptime-ai-agent@${GCP_PROJECT}.iam.gserviceaccount.com.`,
      `Google Cloud carried the change out (operation ${APP_ENGINE_OPERATION}).`,
      `To undo it: cloud roll-back-service ${APP_ENGINE} --to 20261106t083000`,
    ]);

    const patch: GcpCall | undefined = h.gcp.callsTo(
      "PATCH",
      APP_ENGINE_URL,
    )[0];

    assert.deepStrictEqual(patch?.query, { updateMask: "split" });
    assert.deepStrictEqual(patch?.body, {
      split: { allocations: { "20261105t101500": 1 } },
    });
    assert.deepStrictEqual(
      h.gcp
        .callsTo("GET", `${APP_ENGINE_URL}/versions`)
        .map((call: GcpCall): Record<string, string> => {
          return call.query;
        }),
      [
        { view: "BASIC", pageSize: "100" },
        { view: "BASIC", pageSize: "100", pageToken: "p2" },
      ],
    );
  });

  test("--to moves the traffic to that serving version, and refuses one that is stopped, unknown or already serving", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    withAppEngine(h);
    assertChanged(
      await runCloud(
        h,
        "gcp",
        `cloud roll-back-service ${APP_ENGINE} --to 20261101t090000`,
      ),
      { version: "20261106t083000" },
    );
    assert.deepStrictEqual(h.gcp.callsTo("PATCH", APP_ENGINE_URL)[0]?.body, {
      split: { allocations: { "20261101t090000": 1 } },
    });

    const stopped: CloudHarness = cloudHarness("gcp");

    withAppEngine(stopped, {
      versions: [
        {
          id: "20261106t083000",
          servingStatus: "SERVING",
          createTime: "2026-11-06T08:30:00Z",
        },
        {
          id: "20261105t101500",
          servingStatus: "STOPPED",
          createTime: "2026-11-05T10:15:00Z",
        },
      ],
    });

    for (const [to, reason] of [
      ["20261105t101500", /is stopped, so it could not take the traffic/],
      ["20250101t000000", /is not a version of the App Engine service default/],
      ["20261106t083000", /already sends its traffic to 20261106t083000/],
    ] as Array<[string, RegExp]>) {
      assertNotRun(
        await runCloud(
          stopped,
          "gcp",
          `cloud roll-back-service ${APP_ENGINE} --to ${to}`,
        ),
        reason,
      );
    }

    assert.deepStrictEqual(stopped.gcp.callsTo("PATCH", APP_ENGINE_URL), []);
  });

  test("without an older serving version there is nothing to roll back to; stopped versions do not count", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    withAppEngine(h, {
      versions: [
        {
          id: "20261106t083000",
          servingStatus: "SERVING",
          createTime: "2026-11-06T08:30:00Z",
        },
        {
          id: "20261105t101500",
          servingStatus: "STOPPED",
          createTime: "2026-11-05T10:15:00Z",
        },
      ],
    });

    assertNotRun(
      await runCloud(h, "gcp", `cloud roll-back-service ${APP_ENGINE}`),
      /has no serving version older than 20261106t083000, so there is nothing to roll back to/,
    );
  });

  test("traffic split between versions is a person's to move: a roll back and a scale are refused", async () => {
    for (const command of [
      `cloud roll-back-service ${APP_ENGINE}`,
      `cloud scale-out ${APP_ENGINE} --count 4`,
    ]) {
      const h: CloudHarness = cloudHarness("gcp");

      withAppEngine(h, {
        allocations: { "20261106t083000": 0.9, "20261105t101500": 0.1 },
      });

      assertNotRun(
        await runCloud(h, "gcp", command),
        /splits its traffic between 2 versions \(20261106t083000, 20261105t101500\): a person decides where split traffic goes, so nothing was changed/,
      );
      assert.deepStrictEqual(
        h.gcp.calls.filter((call: GcpCall): boolean => {
          return call.method === "PATCH";
        }),
        [],
      );
    }
  });

  test("scale-out sets the instances of the manually scaled version that serves it, within double, and is undone by scale-in", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    withAppEngine(h);

    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud scale-out ${APP_ENGINE} --count 4`),
      { count: "2" },
    );

    assert.strictEqual(
      lines[1],
      "App Engine service default, version 20261106t083000: instances 2 → 4 (manual scaling).",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud scale-in ${APP_ENGINE} --count 2`,
    );

    const patch: GcpCall | undefined = h.gcp.callsTo(
      "PATCH",
      `${APP_ENGINE_URL}/versions/20261106t083000`,
    )[0];

    assert.deepStrictEqual(patch?.query, {
      updateMask: "manualScaling.instances",
    });
    assert.deepStrictEqual(patch?.body, { manualScaling: { instances: 4 } });
    assert.deepStrictEqual(
      h.gcp.callsTo("GET", `${APP_ENGINE_URL}/versions/20261106t083000`)[0]
        ?.query,
      { view: "FULL" },
    );

    const tooFar: CloudHarness = cloudHarness("gcp");

    withAppEngine(tooFar);
    assertNotRun(
      await runCloud(tooFar, "gcp", `cloud scale-out ${APP_ENGINE} --count 5`),
      /--count 5 is above 4/,
    );
  });

  test("a version that scales on its own is left to a person", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    withAppEngine(h, {
      version: {
        id: "20261106t083000",
        servingStatus: "SERVING",
        automaticScaling: { maxConcurrentRequests: 10 },
      },
    });

    assertNotRun(
      await runCloud(h, "gcp", `cloud scale-in ${APP_ENGINE} --count 1`),
      /scales on its own \(automatic or basic scaling\): its scaling settings are a person's to change, so nothing was changed/,
    );
  });

  test("the required label is read from the service's own labels", async () => {
    const unlabelled: CloudHarness = cloudHarness("gcp", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    withAppEngine(unlabelled);
    assertNotRun(
      await runCloud(
        unlabelled,
        "gcp",
        `cloud roll-back-service ${APP_ENGINE}`,
      ),
      /carry the label oneuptime-ai=allow .+ does not, so nothing was changed/,
    );

    const labelled: CloudHarness = cloudHarness("gcp", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    withAppEngine(labelled, { labels: { "oneuptime-ai": "allow" } });
    assertChanged(
      await runCloud(labelled, "gcp", `cloud roll-back-service ${APP_ENGINE}`),
      { version: "20261106t083000" },
    );
  });

  test("a dry run of a roll back reads what it would replace and sends no PATCH", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    withAppEngine(h);

    const lines: Array<string> = outputLines(
      await runCloud(
        h,
        "gcp",
        `cloud dry-run roll-back-service ${APP_ENGINE}`,
        {
          origin: "AiInvestigation",
        },
      ),
    );

    assert.strictEqual(lines[0], formatCloudDryRunVerdict("would-run"));
    assert.strictEqual(
      lines[1],
      formatCloudReplacedValue({ version: "20261106t083000" }),
    );
    assert.deepStrictEqual(
      h.gcp.calls.filter((call: GcpCall): boolean => {
        return call.method === "PATCH";
      }),
      [],
    );
  });
});
