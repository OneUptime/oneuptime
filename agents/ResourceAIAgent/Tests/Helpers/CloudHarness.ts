import { recordingLogger, testConfig, RecordingLogger } from "./TestSupport";
import assert from "assert";
import { AgentConfig } from "../../Config";
import CloudExecutor from "../../Executors/CloudExecutor";
import { GuardPolicy } from "../../Executors/PrepareGuard";
import {
  ExecResult,
  PrepareResult,
  PreparedCommand,
  ResourceCommandRequest,
} from "../../Executors/ResourceExecutor";
import {
  AWS_ACCOUNT,
  AWS_CREDENTIALS_PATH,
  AWS_WRITE_ROLE_ARN,
  AZURE_IDENTITY_ENDPOINT,
  AZURE_IDENTITY_HEADER,
  AZURE_SUBSCRIPTION,
  FakeArm,
  FakeAws,
  FakeClock,
  FakeCloud,
  FakeGcp,
  GCP_PROJECT,
} from "./FakeCloud";
import { TEST_RESOURCE_ID } from "./FakeOneUptime";
import AiResourceType from "../../Common/Types/ResourceAiAgent/AiResourceType";
import {
  formatCloudReplacedValue,
  readCloudReplacedValue,
} from "../../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";
import ResourceCommandPolicy from "../../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";

/*
 * One Cloud AI agent per test, against the fake clouds: its configuration
 * and its environment are built from the same variables (as the agent's
 * are, from one process environment), its clock only moves when it waits,
 * and every request it sends is answered by FakeAws, FakeArm or FakeGcp.
 */

export const ONEUPTIME_URL: string = "https://oneuptime.example.com";

export type CloudName = "aws" | "azure" | "gcp";

export const CLOUD_TYPES: Readonly<Record<CloudName, AiResourceType>> = {
  aws: AiResourceType.AwsAccount,
  azure: AiResourceType.AzureSubscription,
  gcp: AiResourceType.GoogleCloudProject,
};

export const CLOUD_IDENTITIES: Readonly<Record<CloudName, string>> = {
  aws: AWS_ACCOUNT,
  azure: AZURE_SUBSCRIPTION,
  gcp: GCP_PROJECT,
};

const IDENTITY_VARIABLES: Readonly<Record<CloudName, string>> = {
  aws: "AWS_ACCOUNT_ID",
  azure: "AZURE_SUBSCRIPTION_ID",
  gcp: "GOOGLE_CLOUD_PROJECT",
};

// Where each cloud's agent runs by default: an ECS task with a write role, a Container App, Cloud Run.
export function defaultCloudEnv(cloud: CloudName): Record<string, string> {
  switch (cloud) {
    case "aws":
      return {
        AWS_REGION: "us-east-1",
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: AWS_CREDENTIALS_PATH,
        ONEUPTIME_AI_AWS_WRITE_ROLE_ARN: AWS_WRITE_ROLE_ARN,
      };
    case "azure":
      return {
        IDENTITY_ENDPOINT: AZURE_IDENTITY_ENDPOINT,
        IDENTITY_HEADER: AZURE_IDENTITY_HEADER,
      };
    default:
      return {};
  }
}

export interface CloudHarness {
  executor: CloudExecutor;
  config: AgentConfig;
  env: Record<string, string>;
  clock: FakeClock;
  cloud: FakeCloud;
  aws: FakeAws;
  arm: FakeArm;
  gcp: FakeGcp;
  logger: RecordingLogger;
}

export function cloudHarness(
  cloud: CloudName,
  data: {
    // Variables on top of the defaults ("" removes one).
    env?: Record<string, string> | undefined;
    writes?: boolean | undefined;
    // null: no identity variable (the executor asks the cloud).
    identity?: string | null | undefined;
    guardPolicy?: GuardPolicy | undefined;
    randomIds?: Array<string> | undefined;
    readFile?: ((path: string) => string) | undefined;
  } = {},
): CloudHarness {
  const env: Record<string, string> = {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: cloud,
    ...(data.identity === null
      ? {}
      : {
          [IDENTITY_VARIABLES[cloud]]: data.identity ?? CLOUD_IDENTITIES[cloud],
        }),
    ...(data.writes === false ? {} : { ONEUPTIME_AI_ALLOW_WRITES: "true" }),
    ...defaultCloudEnv(cloud),
  };

  for (const [name, value] of Object.entries(data.env || {})) {
    if (value === "") {
      delete env[name];
    } else {
      env[name] = value;
    }
  }

  const config: AgentConfig = testConfig(ONEUPTIME_URL, {
    DOCKER_HOST_NAME: "",
    ...env,
  });
  const clock: FakeClock = new FakeClock();
  const fake: FakeCloud = new FakeCloud();
  const aws: FakeAws = new FakeAws(fake, clock);
  const arm: FakeArm = new FakeArm(fake, clock);
  const gcp: FakeGcp = new FakeGcp(fake);
  const logger: RecordingLogger = recordingLogger();
  const ids: Array<string> = [...(data.randomIds || [])];
  const executor: CloudExecutor = new CloudExecutor(
    {
      config,
      env: { ...env },
      tmpDir: "/tmp",
      logger,
      now: clock.now,
      guardPolicy: data.guardPolicy,
    },
    {
      transport: fake.transport,
      sleep: clock.sleep,
      randomId: (): string => {
        return ids.shift() || "0a1b2c3d";
      },
      readFile: data.readFile,
    },
  );

  return { executor, config, env, clock, cloud: fake, aws, arm, gcp, logger };
}

// The payload OneUptime would send for this command: the tier the real policy gives.
export function cloudPayload(
  cloud: CloudName,
  command: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const argv: Array<string> = command.split(" ");
  const resourceType: AiResourceType = CLOUD_TYPES[cloud];

  return {
    resourceType,
    resourceId: TEST_RESOURCE_ID,
    resourceIdentifier: CLOUD_IDENTITIES[cloud],
    program: argv[0],
    args: argv.slice(1),
    displayCommand: command,
    tier: ResourceCommandPolicy.evaluateArgv({ resourceType, argv }).tier,
    ...overrides,
  };
}

export function cloudRequest(
  cloud: CloudName,
  command: string,
  data: {
    origin?: string | undefined;
    payload?: Record<string, unknown> | undefined;
    timeoutInMs?: number | undefined;
  } = {},
): ResourceCommandRequest {
  return {
    payload: cloudPayload(cloud, command, data.payload || {}),
    origin: data.origin || "AiRemediation",
    timeoutInMs: data.timeoutInMs ?? 30_000,
    agentResourceId: TEST_RESOURCE_ID,
  };
}

export function prepared(result: PrepareResult): PreparedCommand {
  assert.strictEqual(
    result.refusal,
    null,
    `expected the command to be prepared, got: ${String(result.refusal)}`,
  );
  return result as PreparedCommand;
}

export function refusalOf(
  h: CloudHarness,
  cloud: CloudName,
  command: string,
  data: {
    origin?: string | undefined;
    payload?: Record<string, unknown> | undefined;
  } = {},
): string {
  const result: PrepareResult = h.executor.prepare(
    cloudRequest(cloud, command, data),
  );
  assert.notStrictEqual(
    result.refusal,
    null,
    `expected "${command}" to be refused`,
  );
  return String(result.refusal);
}

export async function runCloud(
  h: CloudHarness,
  cloud: CloudName,
  command: string,
  data: {
    origin?: string | undefined;
    payload?: Record<string, unknown> | undefined;
    timeoutInMs?: number | undefined;
  } = {},
): Promise<ExecResult> {
  return prepared(h.executor.prepare(cloudRequest(cloud, command, data))).run();
}

export function outputLines(result: ExecResult): Array<string> {
  return result.output.split("\n");
}

/*
 * A change that ran: success, exit code 0, and an output whose first line
 * is the replaced value — exactly this one, read back as the server reads it.
 */
export function assertChanged(
  result: ExecResult,
  replaced: Record<string, string>,
): Array<string> {
  assert.strictEqual(
    result.success,
    true,
    `expected success, got: ${String(result.errorMessage)}\n${result.output}`,
  );
  assert.strictEqual(result.exitCode, 0);

  const lines: Array<string> = outputLines(result);

  assert.strictEqual(lines[0], formatCloudReplacedValue(replaced));
  assert.deepStrictEqual(readCloudReplacedValue(result.output), replaced);
  return lines;
}

// A command that never ran: no exit code, no output, this reason.
export function assertNotRun(result: ExecResult, reason: RegExp): void {
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.exitCode, undefined);
  assert.strictEqual(result.output, "");
  assert.match(String(result.errorMessage), reason);
}
