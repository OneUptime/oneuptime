import { recordingLogger, testConfig } from "./TestSupport";
import assert from "assert";
import { TEST_RESOURCE_ID } from "./FakeOneUptime";
import { FakeDrivers } from "./FakeDatabase";
import { AgentConfig } from "../../Config";
import DatabaseExecutor, {
  DatabaseExecutorInternals,
} from "../../Executors/DatabaseExecutor";
import { GuardPolicy } from "../../Executors/PrepareGuard";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  PreparedCommand,
  ResourceCommandRequest,
} from "../../Executors/ResourceExecutor";
import AiResourceType from "../../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../Common/Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy from "../../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * A Database AI agent's executor wired to fake drivers, the way the agent
 * builds it: one environment feeds both the agent's configuration (its
 * identity: DATABASE_SYSTEM|DATABASE_SERVER_ADDRESS:PORT) and the executor
 * (its connection settings), and payloads carry the tier the real db
 * policy gives, exactly as OneUptime would send them.
 */

export const DATABASE_URL: string = "https://oneuptime.example.com";
export const DATABASE_PASSWORD: string = "Sup3r-Secret-Pw";

export const ENGINE_ENV: Readonly<Record<string, Record<string, string>>> = {
  postgresql: {
    DATABASE_SYSTEM: "postgresql",
    DATABASE_ENDPOINT: "pg.internal:5432",
    DATABASE_SERVER_PORT: "5432",
    DATABASE_USERNAME: "oneuptime_monitor",
    DATABASE_PASSWORD,
  },
  mysql: {
    DATABASE_SYSTEM: "mysql",
    DATABASE_ENDPOINT: "mysql.internal:3306",
    DATABASE_SERVER_PORT: "3306",
    DATABASE_USERNAME: "oneuptime_monitor",
    DATABASE_PASSWORD,
  },
  mariadb: {
    DATABASE_SYSTEM: "mariadb",
    DATABASE_ENDPOINT: "maria.internal:3306",
    DATABASE_SERVER_PORT: "3306",
    DATABASE_USERNAME: "oneuptime_monitor",
    DATABASE_PASSWORD,
  },
  redis: {
    DATABASE_SYSTEM: "redis",
    DATABASE_ENDPOINT: "cache.internal:6379",
    DATABASE_SERVER_PORT: "6379",
    DATABASE_USERNAME: "",
    DATABASE_PASSWORD,
  },
  mongodb: {
    DATABASE_SYSTEM: "mongodb",
    DATABASE_ENDPOINT: "mongo.internal:27017",
    DATABASE_SERVER_PORT: "27017",
    DATABASE_USERNAME: "oneuptime_monitor",
    DATABASE_PASSWORD,
  },
};

export interface DatabaseHarness {
  executor: DatabaseExecutor;
  drivers: FakeDrivers;
  config: AgentConfig;
  env: Record<string, string>;
  sleeps: Array<number>;
}

export function databaseEnv(
  engine: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    DATABASE_SERVER_ADDRESS: "db.example.com",
    ...(ENGINE_ENV[engine] || {}),
    ...overrides,
  };
}

export function databaseHarness(
  data: {
    engine?: string | undefined;
    env?: Record<string, string> | undefined;
    drivers?: FakeDrivers | undefined;
    guardPolicy?: GuardPolicy | undefined;
    internals?: DatabaseExecutorInternals | undefined;
  } = {},
): DatabaseHarness {
  const env: Record<string, string> = databaseEnv(
    data.engine || "postgresql",
    data.env,
  );
  const config: AgentConfig = testConfig(DATABASE_URL, {
    DOCKER_HOST_NAME: "",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "database",
    ...env,
  });
  const drivers: FakeDrivers = data.drivers || new FakeDrivers();
  const sleeps: Array<number> = [];
  const options: ExecutorOptions = {
    config,
    env,
    tmpDir: "/nonexistent-tmp",
    logger: recordingLogger(),
    guardPolicy: data.guardPolicy,
  };

  return {
    executor: new DatabaseExecutor(options, {
      drivers,
      sleep: (ms: number): Promise<void> => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      settleMs: 250,
      ...(data.internals || {}),
    }),
    drivers,
    config,
    env,
    sleeps,
  };
}

// The argv of a command written with single spaces.
export function argvOf(command: string | Array<string>): Array<string> {
  return Array.isArray(command) ? command.slice() : command.split(" ");
}

/*
 * The payload OneUptime would send for this agent: the real policy's
 * reading of the command — its tier, and its normalized arguments (the
 * catalog's canonical argv) — as the server enqueues it.
 */
export function databasePayload(
  h: DatabaseHarness,
  command: string | Array<string>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const argv: Array<string> = argvOf(command);
  const result: ResourceCommandPolicyResult =
    ResourceCommandPolicy.evaluateArgv({
      resourceType: AiResourceType.DatabaseServer,
      argv,
    });
  const denied: boolean = result.tier === ResourceCommandTier.Denied;

  return {
    resourceType: AiResourceType.DatabaseServer,
    resourceId: TEST_RESOURCE_ID,
    resourceIdentifier: h.config.resourceIdentifier,
    program: argv[0],
    args: denied ? argv.slice(1) : result.args,
    displayCommand: denied ? argv.join(" ") : result.displayCommand,
    tier: result.tier,
    ...overrides,
  };
}

export function readRequest(
  h: DatabaseHarness,
  command: string | Array<string>,
  overrides: Partial<ResourceCommandRequest> = {},
  payloadOverrides: Record<string, unknown> = {},
): ResourceCommandRequest {
  return {
    payload: databasePayload(h, command, payloadOverrides),
    origin: "AiInvestigation",
    timeoutInMs: 30_000,
    agentResourceId: TEST_RESOURCE_ID,
    ...overrides,
  };
}

export function writeRequest(
  h: DatabaseHarness,
  command: string | Array<string>,
  overrides: Partial<ResourceCommandRequest> = {},
): ResourceCommandRequest {
  return readRequest(h, command, { origin: "AiRemediation", ...overrides });
}

export function preparedOf(result: PrepareResult): PreparedCommand {
  assert.strictEqual(
    result.refusal,
    null,
    `expected the command to be prepared, got: ${String(result.refusal)}`,
  );
  return result as PreparedCommand;
}

export function refusalOf(
  h: DatabaseHarness,
  request: ResourceCommandRequest,
): string {
  const result: PrepareResult = h.executor.prepare(request);
  assert.notStrictEqual(result.refusal, null, "expected a refusal");
  return String(result.refusal);
}

// Prepare and run a read (an investigation's command).
export function runRead(
  h: DatabaseHarness,
  command: string,
  overrides: Partial<ResourceCommandRequest> = {},
): Promise<ExecResult> {
  return preparedOf(
    h.executor.prepare(readRequest(h, command, overrides)),
  ).run();
}

// Prepare and run a write (a fix's command).
export function runWrite(
  h: DatabaseHarness,
  command: string,
  overrides: Partial<ResourceCommandRequest> = {},
): Promise<ExecResult> {
  return preparedOf(
    h.executor.prepare(writeRequest(h, command, overrides)),
  ).run();
}

// The output without the "[stdout]" header, for assertions on the body.
export function stdoutOf(result: ExecResult): string {
  return result.output.replace(/^\[stdout\]\n/, "");
}

// Every result the executor reports must be free of the login's password.
export function assertNoPassword(value: unknown): void {
  const text: string = JSON.stringify(value);
  assert.ok(
    !text.includes(DATABASE_PASSWORD),
    `leaked the database password: ${text}`,
  );
}
