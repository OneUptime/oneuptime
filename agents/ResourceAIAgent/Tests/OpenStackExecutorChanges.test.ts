import { recordingLogger, RecordingLogger, testConfig } from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { after, before, describe, test } from "node:test";
import { AgentConfig } from "../Config";
import OpenStackExecutor, {
  AI_OPENSTACK_CREDENTIAL_ID_ENV,
  AI_OPENSTACK_CREDENTIAL_SECRET_ENV,
  AI_OPENSTACK_WRITE_CREDENTIAL_ID_ENV,
  AI_OPENSTACK_WRITE_CREDENTIAL_SECRET_ENV,
  OPENSTACK_CLOUDS_FILE_ENV,
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackTransportError,
} from "../Executors/OpenStackExecutor";
import {
  ExecResult,
  PrepareResult,
  PreparedCommand,
  ResourceCommandRequest,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import { makeTempDir } from "./Helpers/FakeBinary";
import { TEST_RESOURCE_ID } from "./Helpers/FakeOneUptime";
import {
  FAKE_TOKEN,
  FakeOpenStack,
  FakeOpenStackOptions,
  fakeReply,
} from "./Helpers/FakeOpenStack";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  OpenStackChangeReach,
  readOpenStackChangeReach,
} from "../Common/Utils/AiRemediation/Resource/OpenStackChangeReach";
import ResourceCommandPolicy from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  ResourceCommandPolicyResult,
  tokenizeResourceCommand,
} from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * THE OPENSTACK AGENT MAKING A CHANGE, AND REFUSING TO.
 *
 * Reads answer from a recording of a real DevStack (FakeOpenStack), so the instances,
 * projects and hosts here are real ones. What a change's call answers a recording does
 * not hold: the fake says what the APIs document (202 and nothing, for an action) and a
 * test that cares says its own. Every request it would send is recorded exactly, so
 * what is asserted is the wire: which credential logged in, which token went with which
 * call, the method, the path and the body.
 */

const CLOUD: string = "prod-eu";
const READ_ID: string = "4f1e9c7a2b3d4c5e8f6a7b8c9d0e1f2a";
const READ_SECRET: string = "read-secret-do-not-print-0123456789";
const WRITE_ID: string = "a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5";
const WRITE_SECRET: string = "write-secret-do-not-print-9876543210";
const WRITE_TOKEN: string = `gAAAAA-write-token-${"w".repeat(60)}`;
const AUTH_URL: string = "https://openstack.example/identity/v3";

// As a real DevStack recorded them.
const RUNNING: string = "358ee736-ba74-40ba-a354-7ead413c5df6";
const STOPPED: string = "4d955c70-df91-45ae-be57-044f4bcaefec";
const RESEARCH: string = "b7d9b739-9ad0-44e5-ad61-cdbfad9ea127";
const NO_HOST: string = "60955ff0-c1ee-4a05-a048-0cb20fc654ae";
const AGENT: string = "f1fe06bd-337d-4ee0-b1df-3284823c1490";
const PAYMENTS_PREFIX: string = "9aee824c";
const RESEARCH_PREFIX: string = "d63a8b7c";
const HOST: string = "compute-01";

let tmpDir: string;
let cloudsFile: string;

before((): void => {
  tmpDir = makeTempDir("agent-openstack-changes-");
  cloudsFile = path.join(tmpDir, "clouds.yaml");
  fs.writeFileSync(
    cloudsFile,
    `clouds:
  "RegionOne":
    region_name: "RegionOne"
    auth_type: v3applicationcredential
    auth:
      auth_url: "${AUTH_URL}"
      application_credential_id: "${READ_ID}"
      application_credential_secret: "${READ_SECRET}"
`,
  );
});

after((): void => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// An agent both switches let write. What the switches do is tested below.
function writableConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const config: AgentConfig = testConfig("https://oneuptime.example.com", {
    DOCKER_HOST_NAME: "",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "openstack",
    OPENSTACK_CLOUD_NAME: CLOUD,
  });

  return {
    ...config,
    allowWrites: true,
    writesOffByFixes: false,
    writesOffReason: null,
    ...overrides,
  };
}

function writeEnv(
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    [OPENSTACK_CLOUDS_FILE_ENV]: cloudsFile,
    [AI_OPENSTACK_WRITE_CREDENTIAL_ID_ENV]: WRITE_ID,
    [AI_OPENSTACK_WRITE_CREDENTIAL_SECRET_ENV]: WRITE_SECRET,
    ...overrides,
  };
}

interface Harness {
  executor: OpenStackExecutor;
  cloud: FakeOpenStack;
  logger: RecordingLogger;
  now: { ms: number };
}

/*
 * A cloud whose Keystone hands each credential its own token, as a real one does,
 * so each call can be held to the one it should have gone with.
 */
function harness(
  data: {
    override?: FakeOpenStackOptions["override"];
    scene?: string | undefined;
    env?: NodeJS.ProcessEnv | undefined;
    config?: AgentConfig | undefined;
    tokenExpiresAt?: string | undefined;
  } = {},
): Harness {
  const logger: RecordingLogger = recordingLogger();
  const now: { ms: number } = { ms: Date.parse("2026-11-04T12:00:00.000Z") };
  const cloud: FakeOpenStack = new FakeOpenStack({
    scene: data.scene,
    tokenExpiresAt: data.tokenExpiresAt,
    override: (
      request: OpenStackHttpRequest,
      url: URL,
    ): OpenStackHttpResponse | Error | undefined => {
      const said: OpenStackHttpResponse | Error | undefined = data.override?.(
        request,
        url,
      );

      if (said) {
        return said;
      }

      if (
        request.method === "POST" &&
        url.pathname.endsWith("/auth/tokens") &&
        (request.body || "").includes(WRITE_ID)
      ) {
        return fakeReply(
          {
            token: {
              expires_at: data.tokenExpiresAt || "2099-01-01T00:00:00.000000Z",
              catalog: cloud.catalog(),
              project: { id: "w", name: "ou-remediation" },
              roles: [{ id: "r", name: "oneuptime_remediation" }],
            },
          },
          201,
          { "x-subject-token": WRITE_TOKEN },
        );
      }

      return undefined;
    },
  });

  return {
    cloud,
    logger,
    now,
    executor: new OpenStackExecutor(
      {
        config: data.config || writableConfig(),
        env: data.env || writeEnv(),
        tmpDir,
        logger,
        now: (): Date => {
          return new Date(now.ms);
        },
      },
      { transport: cloud.send },
    ),
  };
}

function job(
  command: string,
  overrides: Partial<ResourceCommandRequest> = {},
): ResourceCommandRequest {
  const argv: Array<string> = tokenizeResourceCommand(command)
    .argv as Array<string>;
  const policy: ResourceCommandPolicyResult =
    ResourceCommandPolicy.evaluateArgv({
      resourceType: AiResourceType.OpenStackCloud,
      argv,
    });

  return {
    payload: {
      resourceType: AiResourceType.OpenStackCloud,
      resourceId: TEST_RESOURCE_ID,
      resourceIdentifier: CLOUD,
      program: argv[0],
      args: argv.slice(1),
      tier: policy.tier,
    },
    origin: "AiRemediation",
    timeoutInMs: 60_000,
    agentResourceId: TEST_RESOURCE_ID,
    ...overrides,
  };
}

function prepared(result: PrepareResult): PreparedCommand {
  assert.strictEqual(
    result.refusal,
    null,
    `expected the command to be prepared, got: ${String(result.refusal)}`,
  );

  return result as PreparedCommand;
}

function run(h: Harness, command: string): Promise<ExecResult> {
  return prepared(h.executor.prepare(job(command))).run();
}

function refusalOf(h: Harness, command: string): string {
  const result: PrepareResult = h.executor.prepare(job(command));

  assert.ok(result.refusal, `expected "${command}" to be refused`);

  return result.refusal as string;
}

function bodyOf(request: OpenStackHttpRequest): unknown {
  return JSON.parse(request.body as string);
}

function pathOf(request: OpenStackHttpRequest): string {
  return new URL(request.url).pathname;
}

function loginIds(h: Harness): Array<string> {
  return h.cloud.logins().map((login: OpenStackHttpRequest): string => {
    return JSON.parse(login.body as string).auth.identity.application_credential
      .id;
  });
}

function allThatWasSaid(h: Harness, results: Array<ExecResult>): string {
  return [
    ...results.map((result: ExecResult): string => {
      return `${result.output} ${result.errorMessage || ""}`;
    }),
    JSON.stringify(h.logger.records),
  ].join("\n");
}

interface ChangeWire {
  command: string;
  method: "POST" | "PUT";
  path: string;
  body: unknown;
  microversion?: string;
}

const WIRES: ReadonlyArray<ChangeWire> = [
  {
    command: `openstack server start ${STOPPED}`,
    method: "POST",
    path: `/compute/v2.1/servers/${STOPPED}/action`,
    body: { "os-start": null },
  },
  {
    command: `openstack server reboot --soft ${RUNNING}`,
    method: "POST",
    path: `/compute/v2.1/servers/${RUNNING}/action`,
    body: { reboot: { type: "SOFT" } },
  },
  {
    command: `openstack server reboot --hard ${RUNNING}`,
    method: "POST",
    path: `/compute/v2.1/servers/${RUNNING}/action`,
    body: { reboot: { type: "HARD" } },
  },
  {
    command: `openstack server migrate ${RUNNING} --host compute-02`,
    method: "POST",
    path: `/compute/v2.1/servers/${RUNNING}/action`,
    body: { migrate: { host: "compute-02" } },
  },
  {
    command: `openstack server migrate live ${RUNNING}`,
    method: "POST",
    path: `/compute/v2.1/servers/${RUNNING}/action`,
    body: { "os-migrateLive": { host: null, block_migration: "auto" } },
  },
  {
    command: `openstack server evacuate ${RUNNING}`,
    method: "POST",
    path: `/compute/v2.1/servers/${RUNNING}/action`,
    body: { evacuate: {} },
  },
  {
    command: `openstack compute service set --enable ${HOST} nova-compute`,
    method: "PUT",
    path: "/compute/v2.1/os-services/enable",
    body: { host: HOST, binary: "nova-compute" },
    microversion: "2.52",
  },
  {
    command: `openstack compute service set --disable --disable-reason "disk failing" ${HOST} nova-compute`,
    method: "PUT",
    path: "/compute/v2.1/os-services/disable-log-reason",
    body: {
      host: HOST,
      binary: "nova-compute",
      disabled_reason: "disk failing",
    },
    microversion: "2.52",
  },
  {
    command: `openstack network agent set --enable ${AGENT}`,
    method: "PUT",
    path: `/networking/v2.0/agents/${AGENT}`,
    body: { agent: { admin_state_up: true } },
  },
  {
    command: `openstack network agent set --disable ${AGENT}`,
    method: "PUT",
    path: `/networking/v2.0/agents/${AGENT}`,
    body: { agent: { admin_state_up: false } },
  },
];

describe("what goes on the wire", () => {
  for (const wire of WIRES) {
    test(wire.command, async () => {
      const h: Harness = harness();
      const result: ExecResult = await run(h, wire.command);

      assert.strictEqual(result.success, true, result.errorMessage || "");
      assert.strictEqual(result.exitCode, 0);

      const changes: Array<OpenStackHttpRequest> = h.cloud.changes();

      assert.strictEqual(changes.length, 1);

      const sent: OpenStackHttpRequest = changes[0] as OpenStackHttpRequest;

      assert.strictEqual(sent.method, wire.method);
      assert.strictEqual(pathOf(sent), wire.path);
      assert.deepStrictEqual(bodyOf(sent), wire.body);
      assert.strictEqual(new URL(sent.url).search, "");
      assert.strictEqual(sent.headers["Content-Type"], "application/json");
      assert.strictEqual(
        sent.headers["Content-Length"],
        String(Buffer.byteLength(sent.body as string, "utf8")),
      );

      if (wire.microversion) {
        assert.strictEqual(
          sent.headers["OpenStack-API-Version"],
          `compute ${wire.microversion}`,
        );
        assert.strictEqual(
          sent.headers["X-OpenStack-Nova-API-Version"],
          wire.microversion,
        );
      }
    });
  }

  test("a change is sent once, and its reads never carry a body", async () => {
    const h: Harness = harness();

    await run(h, `openstack server start ${STOPPED}`);

    for (const sent of h.cloud.requests) {
      if (sent.method === "GET") {
        assert.strictEqual(sent.body, null, sent.url);
      }
    }

    assert.strictEqual(h.cloud.changes().length, 1);
  });

  test("a change that names another region goes there or nowhere", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      `openstack server start ${STOPPED} --os-region-name Nowhere`,
    );

    // The catalog has no such region, so nothing can have been sent there.
    assert.strictEqual(result.success, false);
    assert.strictEqual(h.cloud.changes().length, 0);
    assert.match(result.errorMessage as string, /Nowhere/);
  });
});

describe("two credentials", () => {
  test("a change is made with the write credential, and read for with the read one", async () => {
    const h: Harness = harness();

    await run(h, `openstack server start ${STOPPED}`);

    assert.deepStrictEqual(loginIds(h), [READ_ID, WRITE_ID]);

    const change: OpenStackHttpRequest = h.cloud.changes()[0] as OpenStackHttpRequest;

    assert.strictEqual(change.headers["X-Auth-Token"], WRITE_TOKEN);

    for (const call of h.cloud.commandCalls()) {
      if (call.method === "GET") {
        assert.strictEqual(call.headers["X-Auth-Token"], FAKE_TOKEN, call.url);
      }
    }
  });

  test("a read never logs in with the write credential", async () => {
    const h: Harness = harness();

    await run(h, "openstack compute service list");
    await run(h, `openstack server show ${RUNNING}`);

    assert.deepStrictEqual(loginIds(h), [READ_ID]);
  });

  test("a dry run never logs in with the write credential", async () => {
    const h: Harness = harness();

    await run(h, `openstack dry-run server evacuate ${RUNNING} ${STOPPED}`);

    assert.deepStrictEqual(loginIds(h), [READ_ID]);
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("each keeps its own token, for an hour's worth of commands", async () => {
    const h: Harness = harness();

    await run(h, `openstack server start ${STOPPED}`);
    await run(h, `openstack server reboot --soft ${RUNNING}`);
    await run(h, "openstack compute service list");

    assert.deepStrictEqual(loginIds(h), [READ_ID, WRITE_ID]);
  });

  test("a change without one is refused before anything is sent", () => {
    for (const env of [
      { [OPENSTACK_CLOUDS_FILE_ENV]: cloudsFile },
      {
        [OPENSTACK_CLOUDS_FILE_ENV]: cloudsFile,
        [AI_OPENSTACK_WRITE_CREDENTIAL_ID_ENV]: WRITE_ID,
      },
      {
        [OPENSTACK_CLOUDS_FILE_ENV]: cloudsFile,
        [AI_OPENSTACK_WRITE_CREDENTIAL_SECRET_ENV]: WRITE_SECRET,
      },
    ] as Array<NodeJS.ProcessEnv>) {
      const h: Harness = harness({ env });

      assert.match(
        refusalOf(h, `openstack server start ${STOPPED}`),
        /credential of its own.*ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID/,
      );
      assert.strictEqual(h.cloud.requests.length, 0);
    }
  });

  test("the credential reads use is refused, from clouds.yaml or the environment", () => {
    const fromFile: Harness = harness({
      env: writeEnv({ [AI_OPENSTACK_WRITE_CREDENTIAL_ID_ENV]: READ_ID }),
    });

    assert.match(
      refusalOf(fromFile, `openstack server start ${STOPPED}`),
      /names the credential the agent reads with/,
    );

    const fromEnv: Harness = harness({
      env: writeEnv({
        [AI_OPENSTACK_CREDENTIAL_ID_ENV]: WRITE_ID,
        [AI_OPENSTACK_CREDENTIAL_SECRET_ENV]: WRITE_SECRET,
      }),
    });

    assert.match(
      refusalOf(fromEnv, `openstack server start ${STOPPED}`),
      /names the credential the agent reads with/,
    );
    assert.strictEqual(fromFile.cloud.requests.length, 0);
    assert.strictEqual(fromEnv.cloud.requests.length, 0);
  });

  test("neither secret is ever printed, whatever happens", async () => {
    const h: Harness = harness();
    const results: Array<ExecResult> = [
      await run(h, `openstack server start ${STOPPED}`),
      await run(h, `openstack dry-run server start ${STOPPED}`),
    ];
    const failing: Harness = harness({
      override: (request: OpenStackHttpRequest) => {
        return request.method === "POST" &&
          !request.url.endsWith("/auth/tokens")
          ? fakeReply({ forbidden: { message: "no", code: 403 } }, 403)
          : undefined;
      },
    });

    results.push(await run(failing, `openstack server start ${STOPPED}`));

    for (const harnessUsed of [h, failing]) {
      const said: string = allThatWasSaid(harnessUsed, results);

      for (const secret of [READ_SECRET, WRITE_SECRET, WRITE_TOKEN, FAKE_TOKEN]) {
        assert.ok(!said.includes(secret), `${secret} was printed`);
      }
    }

    // The secrets' one trip: each login's body, and no other request.
    for (const sent of [...h.cloud.requests, ...failing.cloud.requests]) {
      if (!sent.url.endsWith("/auth/tokens")) {
        assert.ok(!(sent.body || "").includes(WRITE_SECRET), sent.url);
        assert.ok(!(sent.body || "").includes(READ_SECRET), sent.url);
      }
    }
  });

  test("the posture says whether it logs in, and never the secret", async () => {
    const good: ResourcePostureProbe = await harness().executor.probePosture();

    assert.strictEqual(good.details?.["writeCredentialWorks"], true);
    assert.strictEqual(good.details?.["writeCredentialProblem"], undefined);

    const refused: ResourcePostureProbe = await harness({
      override: (request: OpenStackHttpRequest) => {
        return (request.body || "").includes(WRITE_ID)
          ? fakeReply({}, 401)
          : undefined;
      },
    }).executor.probePosture();

    assert.strictEqual(refused.details?.["writeCredentialWorks"], false);
    assert.match(
      String(refused.details?.["writeCredentialProblem"]),
      /refused the credential/,
    );
    assert.ok(!JSON.stringify(refused).includes(WRITE_SECRET));

    const missing: ResourcePostureProbe = await harness({
      env: { [OPENSTACK_CLOUDS_FILE_ENV]: cloudsFile },
    }).executor.probePosture();

    assert.strictEqual(missing.details?.["writeCredentialWorks"], false);
    assert.match(
      String(missing.details?.["writeCredentialProblem"]),
      /credential of its own/,
    );
  });

  test("an agent that may not write does not even try the credential", async () => {
    const h: Harness = harness({
      config: writableConfig({ allowWrites: false }),
    });
    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.details?.["writeCredentialWorks"], undefined);
    assert.deepStrictEqual(loginIds(h), [READ_ID]);
  });
});

describe("with writes off", () => {
  test("no change gets as far as a request, however it is asked", () => {
    for (const wire of WIRES) {
      const h: Harness = harness({
        config: writableConfig({ allowWrites: false }),
      });

      assert.match(
        refusalOf(h, wire.command),
        /Refused by the OpenStack AI agent.*read-only/,
      );
      assert.strictEqual(h.cloud.requests.length, 0, wire.command);
    }
  });

  test("whatever tier the job claims", () => {
    for (const tier of [
      ResourceCommandTier.Read,
      ResourceCommandTier.SafeWrite,
      ResourceCommandTier.RiskyWrite,
    ]) {
      const h: Harness = harness({
        config: writableConfig({ allowWrites: false }),
      });
      const request: ResourceCommandRequest = job(
        `openstack server start ${STOPPED}`,
      );

      request.payload["tier"] = tier;

      assert.ok(h.executor.prepare(request).refusal, tier);
      assert.strictEqual(h.cloud.requests.length, 0, tier);
    }
  });

  test("and a dry run still reads, and says it would be refused", async () => {
    const h: Harness = harness({
      config: writableConfig({ allowWrites: false }),
    });
    const result: ExecResult = await run(
      h,
      `openstack dry-run server start ${STOPPED}`,
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(h.cloud.changes().length, 0);
    assert.match(
      readOpenStackChangeReach(result.output)?.wouldBeRefused || "",
      /read-only/,
    );
  });

  test("an investigation may not make one, writes on or off", () => {
    for (const wire of WIRES) {
      const h: Harness = harness();

      assert.match(
        h.executor.prepare(job(wire.command, { origin: "AiInvestigation" }))
          .refusal as string,
        /may only run read-only/,
      );
      assert.strictEqual(h.cloud.requests.length, 0);
    }
  });

  test("a job that says it is a read is refused for what it is", () => {
    const h: Harness = harness();
    const request: ResourceCommandRequest = job(
      `openstack server reboot --hard ${RUNNING}`,
    );

    request.payload["tier"] = ResourceCommandTier.SafeWrite;

    assert.match(
      h.executor.prepare(request).refusal as string,
      /was not approved for what it does/,
    );
    assert.strictEqual(h.cloud.requests.length, 0);
  });
});

describe("what is denied stays denied, with writes on", () => {
  for (const command of [
    `openstack server delete ${RUNNING}`,
    `openstack volume delete ${RUNNING}`,
    "openstack project delete abc",
    "openstack user list",
    "openstack role add --user a --project b c",
    "openstack quota set --instances 100 abc",
    "openstack security group delete abc",
    `openstack server set --state active ${RUNNING}`,
    `openstack volume set --state available ${RUNNING}`,
    `openstack compute service set --down ${HOST} nova-compute`,
    `openstack server migrate confirm ${RUNNING}`,
    `openstack server reboot ${RUNNING} --hard`,
  ]) {
    test(command, () => {
      const h: Harness = harness();
      const request: ResourceCommandRequest = job(command);

      // Whatever the server claimed for it.
      request.payload["tier"] = ResourceCommandTier.RiskyWrite;

      assert.ok(h.executor.prepare(request).refusal);
      assert.strictEqual(h.cloud.requests.length, 0);
    });
  }
});

describe("it reads before it changes", () => {
  test("the instance is read with the read credential first", async () => {
    const h: Harness = harness();

    await run(h, `openstack server start ${STOPPED}`);

    const calls: Array<OpenStackHttpRequest> = h.cloud.commandCalls();
    const first: OpenStackHttpRequest = calls[0] as OpenStackHttpRequest;
    const last: OpenStackHttpRequest = calls[
      calls.length - 1
    ] as OpenStackHttpRequest;

    assert.strictEqual(first.method, "GET");
    assert.strictEqual(pathOf(first), `/compute/v2.1/servers/${STOPPED}`);
    assert.strictEqual(last.method, "POST");
  });

  test("an instance that is gone: nothing is sent", async () => {
    const h: Harness = harness();
    const gone: string = "00000000-0000-4000-8000-000000000000";
    const result: ExecResult = await run(h, `openstack server start ${gone}`);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.output, "");
    assert.match(
      result.errorMessage as string,
      /could not read what .* would touch, so it changed nothing/,
    );
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("a read the cloud refuses: nothing is sent", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest, url: URL) => {
        return request.method === "GET" &&
          url.pathname.includes("/servers/")
          ? fakeReply({ forbidden: { message: "no", code: 403 } }, 403)
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack server start ${STOPPED}`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.output, "");
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("a read that gets no answer: nothing is sent", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest, url: URL) => {
        return request.method === "GET" &&
          url.pathname.includes("/servers/")
          ? new OpenStackTransportError({
              kind: "connect",
              message: "refused",
              code: "ECONNREFUSED",
            })
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack server reboot --hard ${RUNNING}`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.output, "");
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("one instance of an evacuation it cannot read: none is sent", async () => {
    const gone: string = "00000000-0000-4000-8000-000000000000";
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      `openstack server evacuate ${RUNNING} ${gone} ${STOPPED}`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("a network agent it cannot read: nothing is sent", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      "openstack network agent set --enable 00000000-0000-4000-8000-000000000000",
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(h.cloud.changes().length, 0);
  });
});

describe("protected targets win over every other setting", () => {
  function configWith(lists: {
    protectedTargets?: Array<string>;
    writeTargets?: Array<string>;
  }): AgentConfig {
    return writableConfig({
      protectedTargets: lists.protectedTargets || [],
      writeTargets: lists.writeTargets || [],
    });
  }

  function projectOf(h: Harness, id: string): string {
    return h.cloud
      .readRows("nova-servers", "servers")
      .find((row: Record<string, unknown>): boolean => {
        return row["id"] === id;
      })?.["tenant_id"] as string;
  }

  test("the project it read the instance is in, when its words say nothing of it", async () => {
    const probe: Harness = harness();
    const project: string = projectOf(probe, RUNNING);

    assert.ok(project.startsWith(PAYMENTS_PREFIX));

    const h: Harness = harness({
      config: configWith({ protectedTargets: [`project:${project}`] }),
    });

    // Prepared: the words say nothing of a project. Run: it read one.
    const result: ExecResult = await run(
      h,
      `openstack server reboot --soft ${RUNNING}`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.output, "");
    assert.match(result.errorMessage as string, /wins over every other setting/);
    assert.strictEqual(h.cloud.changes().length, 0);
    assert.deepStrictEqual(loginIds(h), [READ_ID]);
  });

  test("another project's instance runs", async () => {
    const h: Harness = harness({
      config: configWith({ protectedTargets: [`project:${PAYMENTS_PREFIX}*`] }),
    });

    assert.strictEqual(
      (await run(h, `openstack server reboot --soft ${RESEARCH}`)).success,
      true,
    );
    assert.strictEqual(h.cloud.changes().length, 1);
  });

  test("the host it read the instance is on, short name or full", async () => {
    for (const entry of [
      `host:${HOST}`,
      `host:${HOST}.example.internal`,
      "host:COMPUTE-*",
    ]) {
      const h: Harness = harness({
        config: configWith({ protectedTargets: [entry] }),
      });
      const result: ExecResult = await run(
        h,
        `openstack server start ${STOPPED}`,
      );

      assert.strictEqual(result.success, false, entry);
      assert.match(result.errorMessage as string, /wins over every other/);
      assert.strictEqual(h.cloud.changes().length, 0, entry);
    }
  });

  test("the instance itself, refused before anything is read", () => {
    const h: Harness = harness({
      config: configWith({ protectedTargets: [`instance:${RUNNING}`] }),
    });

    assert.match(
      refusalOf(h, `openstack server reboot --hard ${RUNNING}`),
      /wins over every other setting/,
    );
    assert.strictEqual(h.cloud.requests.length, 0);
  });

  test("a host, on the compute service and on a move's destination", () => {
    const h: Harness = harness({
      config: configWith({ protectedTargets: ["host:compute-*"] }),
    });

    for (const command of [
      `openstack compute service set --enable ${HOST} nova-compute`,
      `openstack server migrate ${RUNNING} --host compute-02`,
      `openstack server evacuate ${RUNNING} --host compute-02`,
      // The scheduler might choose it.
      `openstack server migrate ${RUNNING}`,
    ]) {
      assert.match(refusalOf(h, command), /wins over every other setting/);
    }

    assert.strictEqual(h.cloud.requests.length, 0);
  });

  test("a network agent's host, which only it can read", async () => {
    const h: Harness = harness({
      config: configWith({ protectedTargets: [`host:${HOST}`] }),
    });
    const result: ExecResult = await run(
      h,
      `openstack network agent set --disable ${AGENT}`,
    );

    assert.strictEqual(result.success, false);
    assert.match(result.errorMessage as string, /wins over every other/);
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("an instance with no host, when a host is protected: it could not say", async () => {
    const h: Harness = harness({
      config: configWith({ protectedTargets: ["host:db-*"] }),
    });
    const result: ExecResult = await run(
      h,
      `openstack server start ${NO_HOST}`,
    );

    assert.strictEqual(result.success, false);
    assert.match(result.errorMessage as string, /could not read which host/);
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("over a write target that names the same thing", async () => {
    const probe: Harness = harness();
    const project: string = projectOf(probe, RUNNING);
    const h: Harness = harness({
      config: configWith({
        protectedTargets: [`project:${project}`],
        writeTargets: [
          `project:${project}`,
          `host:${HOST}`,
          `instance:${RUNNING}`,
        ],
      }),
    });
    const result: ExecResult = await run(
      h,
      `openstack server reboot --soft ${RUNNING}`,
    );

    assert.strictEqual(result.success, false);
    assert.match(result.errorMessage as string, /wins over every other/);
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("one protected instance among an evacuation's stops all of it", async () => {
    const probe: Harness = harness();
    const h: Harness = harness({
      config: configWith({
        protectedTargets: [`project:${projectOf(probe, RESEARCH)}`],
      }),
    });
    const result: ExecResult = await run(
      h,
      `openstack server evacuate ${RUNNING} ${RESEARCH} ${STOPPED}`,
    );

    assert.strictEqual(result.success, false);
    assert.match(result.errorMessage as string, new RegExp(RESEARCH));
    assert.strictEqual(h.cloud.changes().length, 0);
  });
});

describe("write targets limit where a change lands", () => {
  function configWith(writeTargets: Array<string>): AgentConfig {
    return writableConfig({ writeTargets });
  }

  test("by the project it read", async () => {
    const inside: Harness = harness({
      config: configWith([`project:${PAYMENTS_PREFIX}*`]),
    });

    assert.strictEqual(
      (await run(inside, `openstack server start ${STOPPED}`)).success,
      true,
    );

    const outside: Harness = harness({
      config: configWith([`project:${RESEARCH_PREFIX}*`]),
    });
    const result: ExecResult = await run(
      outside,
      `openstack server start ${STOPPED}`,
    );

    assert.strictEqual(result.success, false);
    assert.match(result.errorMessage as string, /outside the targets/);
    assert.strictEqual(outside.cloud.changes().length, 0);
  });

  test("by the host it read", async () => {
    assert.strictEqual(
      (
        await run(
          harness({ config: configWith(["host:compute-*"]) }),
          `openstack server start ${STOPPED}`,
        )
      ).success,
      true,
    );

    const outside: Harness = harness({ config: configWith(["host:db-*"]) });
    const result: ExecResult = await run(
      outside,
      `openstack server start ${STOPPED}`,
    );

    assert.match(result.errorMessage as string, /outside the targets/);
    assert.strictEqual(outside.cloud.changes().length, 0);
  });

  test("by the instance, on its words alone", () => {
    const h: Harness = harness({ config: configWith([`instance:${STOPPED}`]) });

    assert.match(
      refusalOf(h, `openstack server start ${RUNNING}`),
      /outside the targets/,
    );
    assert.strictEqual(h.cloud.requests.length, 0);
  });

  test("a move's destination stays inside the host entries", () => {
    const h: Harness = harness({ config: configWith(["host:compute-*"]) });

    assert.match(
      refusalOf(h, `openstack server migrate ${RUNNING} --host db-02`),
      /destination:db-02/,
    );
    assert.match(
      refusalOf(h, `openstack server migrate ${RUNNING}`),
      /the-scheduler-chooses/,
    );
    assert.strictEqual(h.cloud.requests.length, 0);
  });
});

describe("an evacuation", () => {
  test("is one call per instance, in order, each with the same body", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      `openstack server evacuate ${RUNNING} ${STOPPED} --host compute-02`,
    );

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(
      h.cloud.changes().map(pathOf),
      [
        `/compute/v2.1/servers/${RUNNING}/action`,
        `/compute/v2.1/servers/${STOPPED}/action`,
      ],
    );

    for (const sent of h.cloud.changes()) {
      assert.deepStrictEqual(bodyOf(sent), {
        evacuate: { host: "compute-02" },
      });
    }
  });

  test("goes on past an instance Nova will not take, and says which", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest) => {
        return request.method === "POST" && request.url.includes(RUNNING)
          ? fakeReply(
              {
                conflictingRequest: {
                  code: 409,
                  message: "Cannot 'evacuate' instance while it is locked",
                },
              },
              409,
            )
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack server evacuate ${RUNNING} ${STOPPED}`,
    );

    assert.strictEqual(h.cloud.changes().length, 2);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, /refused: .*HTTP 409.*locked/);
    assert.match(result.output, new RegExp(`${STOPPED}/action: Nova accepted`));
  });

  test("stops when the credential may not do it: the rest would not go either", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest) => {
        return request.method === "POST" &&
          !request.url.endsWith("/auth/tokens")
          ? fakeReply({ forbidden: { code: 403, message: "no" } }, 403)
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack server evacuate ${RUNNING} ${STOPPED}`,
    );

    assert.strictEqual(h.cloud.changes().length, 1);
    assert.strictEqual(result.success, false);
    assert.match(result.errorMessage as string, /may not make this change/);
  });

  test("stops at no answer, and says the one it was on may have happened", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest) => {
        return request.method === "POST" && request.url.includes(STOPPED)
          ? new OpenStackTransportError({
              kind: "timeout",
              message: "no answer",
            })
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack server evacuate ${RUNNING} ${STOPPED} ${RESEARCH}`,
    );

    // The first took, the second got no answer, and the third was not sent.
    assert.strictEqual(h.cloud.changes().length, 2);
    assert.strictEqual(result.success, false);
    assert.ok(result.output.length > 0, "an empty output reads as never ran");
    assert.match(result.output, /no answer/);
  });
});

describe("how a change's result reads on the server", () => {
  test("accepted: exit 0, and it says what it read and that accepted is not done", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      `openstack server start ${STOPPED}`,
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.output, /This changes 1 instance in 1 project\./);
    assert.match(result.output, /Nova accepted it \(HTTP 202\)/);
    assert.match(result.output, /not the same as done/);

    const reach: OpenStackChangeReach = readOpenStackChangeReach(
      result.output,
    ) as OpenStackChangeReach;

    assert.strictEqual(reach.route, "server start");
    assert.strictEqual(reach.instances[0]?.id, STOPPED);
    assert.strictEqual(reach.instances[0]?.name, "ou-stopped");
    assert.strictEqual(reach.instances[0]?.host, HOST);
  });

  test("an HTTP refusal: exit 1, in Nova's words", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest) => {
        return request.method === "POST" &&
          !request.url.endsWith("/auth/tokens")
          ? fakeReply(
              {
                conflictingRequest: {
                  code: 409,
                  message: "Instance is in vm_state active",
                },
              },
              409,
            )
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack server start ${RUNNING}`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.match(
      result.errorMessage as string,
      /Nova answered POST .*\/action with HTTP 409 \(Instance is in vm_state active\)/,
    );
  });

  test("a login that fails: never ran", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest) => {
        return (request.body || "").includes(WRITE_ID)
          ? fakeReply({}, 401)
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack server start ${STOPPED}`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.output, "");
    assert.match(result.errorMessage as string, /refused the credential/);
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("connection refused on the change: never ran", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest) => {
        return request.method === "POST" &&
          !request.url.endsWith("/auth/tokens")
          ? new OpenStackTransportError({
              kind: "connect",
              message: "refused",
              code: "ECONNREFUSED",
            })
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack server start ${STOPPED}`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.output, "");
  });

  test("a timeout after it was sent: it may have happened, and it says so", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest) => {
        return request.method === "POST" &&
          !request.url.endsWith("/auth/tokens")
          ? new OpenStackTransportError({
              kind: "timeout",
              message: "no answer",
            })
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack server start ${STOPPED}`,
    );

    assert.strictEqual(result.success, false);
    assert.ok(result.output.length > 0);
    // Never sent twice: the first may have happened.
    assert.strictEqual(h.cloud.changes().length, 1);
  });

  test("a redirect is not followed, and the token stays here", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest) => {
        return request.method === "POST" &&
          !request.url.endsWith("/auth/tokens")
          ? fakeReply("", 302, { location: "https://elsewhere.example/" })
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack server start ${STOPPED}`,
    );

    assert.strictEqual(result.success, false);

    for (const sent of h.cloud.requests) {
      assert.ok(!sent.url.startsWith("https://elsewhere.example"), sent.url);
    }
  });

  test("a kept token that has ended: one fresh login and one more try", async () => {
    let refused: boolean = false;
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest) => {
        if (
          request.method === "POST" &&
          !request.url.endsWith("/auth/tokens") &&
          !refused &&
          request.url.includes(RUNNING)
        ) {
          refused = true;
          return fakeReply({}, 401);
        }

        return undefined;
      },
    });

    // The write credential logs in here, and keeps its token.
    await run(h, `openstack server start ${STOPPED}`);

    const result: ExecResult = await run(
      h,
      `openstack server reboot --soft ${RUNNING}`,
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(h.cloud.changes().length, 3);
    assert.deepStrictEqual(loginIds(h), [READ_ID, WRITE_ID, WRITE_ID]);
  });

  test("a new token that meets a 401 is not tried again: it was the path", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest) => {
        return request.method === "POST" &&
          !request.url.endsWith("/auth/tokens")
          ? fakeReply({}, 401)
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack server start ${STOPPED}`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(h.cloud.changes().length, 1);
    assert.deepStrictEqual(loginIds(h), [READ_ID, WRITE_ID]);
  });
});

describe("a dry run", () => {
  test("of an evacuation lists its real instances and projects, and changes nothing", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      `openstack dry-run server evacuate ${RUNNING} ${STOPPED} ${RESEARCH}`,
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(h.cloud.changes().length, 0);
    assert.match(result.output, /Nothing was changed/);
    assert.match(result.output, /This changes 3 instances in 2 projects\./);

    const reach: OpenStackChangeReach = readOpenStackChangeReach(
      result.output,
    ) as OpenStackChangeReach;

    assert.strictEqual(reach.route, "server evacuate");
    assert.strictEqual(reach.kind, "changes");
    assert.strictEqual(reach.instanceCount, 3);
    assert.strictEqual(reach.projectCount, 2);
    assert.deepStrictEqual(
      reach.instances.map((row: { name: string | null }) => {
        return row.name;
      }),
      ["ou-running", "ou-stopped", "ou-research-1"],
    );
    assert.deepStrictEqual(
      reach.projects.map((row: { name: string | null; instanceCount: number }) => {
        return [row.name, row.instanceCount];
      }),
      [
        ["ou-payments", 2],
        ["ou-research", 1],
      ],
    );
    assert.strictEqual(reach.instances[0]?.projectName, "ou-payments");
    assert.strictEqual(reach.isComplete, true);
    assert.deepStrictEqual(reach.problems, []);
  });

  test("it says what state the host is in, and refuses an evacuation of one that is up", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      `openstack dry-run server evacuate ${RUNNING}`,
    );
    const reach: OpenStackChangeReach = readOpenStackChangeReach(
      result.output,
    ) as OpenStackChangeReach;

    assert.deepStrictEqual(reach.hosts[0], {
      name: HOST,
      state: "up",
      status: "enabled",
      forcedDown: false,
      disabledReason: null,
    });
    assert.match(
      reach.wouldBeRefused as string,
      /only takes an evacuation once the instance's host is down.*compute-01 reads up/,
    );
  });

  test("on a recorded dead host it would run, and says what stays behind", async () => {
    const h: Harness = harness({ scene: "compute-down" });
    const result: ExecResult = await run(
      h,
      `openstack dry-run server evacuate ${RUNNING}`,
    );
    const reach: OpenStackChangeReach = readOpenStackChangeReach(
      result.output,
    ) as OpenStackChangeReach;

    assert.strictEqual(reach.hosts[0]?.state, "down");
    assert.strictEqual(reach.wouldBeRefused, null);
    assert.ok(reach.leftBehindCount >= 1);
    assert.ok(
      reach.leftBehind.every((row: { id: string }): boolean => {
        return row.id !== RUNNING;
      }),
    );
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("of a compute service counts what the host holds, and moves nothing", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      `openstack dry-run compute service set --disable --disable-reason maintenance ${HOST} nova-compute`,
    );

    assert.match(
      result.output,
      /This changes no instance, and the host it is about holds 3 instances in 2 projects\./,
    );

    const reach: OpenStackChangeReach = readOpenStackChangeReach(
      result.output,
    ) as OpenStackChangeReach;

    assert.strictEqual(reach.kind, "on-host");
    assert.strictEqual(reach.instanceCount, 3);
    assert.strictEqual(reach.projectCount, 2);
    assert.strictEqual(reach.wouldBeRefused, null);
  });

  test("of a network agent reads its host", async () => {
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      `openstack dry-run network agent set --disable ${AGENT}`,
    );
    const reach: OpenStackChangeReach = readOpenStackChangeReach(
      result.output,
    ) as OpenStackChangeReach;

    assert.strictEqual(reach.kind, "on-host");
    assert.strictEqual(reach.instanceCount, 3);
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("it says what the agent would refuse, on what it read", async () => {
    const protectedHost: Harness = harness({
      config: writableConfig({ protectedTargets: [`host:${HOST}`] }),
    });

    assert.match(
      readOpenStackChangeReach(
        (await run(protectedHost, `openstack dry-run server start ${STOPPED}`))
          .output,
      )?.wouldBeRefused as string,
      /wins over every other setting/,
    );

    const outside: Harness = harness({
      config: writableConfig({ writeTargets: ["project:abc"] }),
    });

    assert.match(
      readOpenStackChangeReach(
        (await run(outside, `openstack dry-run server start ${STOPPED}`)).output,
      )?.wouldBeRefused as string,
      /outside the targets/,
    );

    const noCredential: Harness = harness({
      env: { [OPENSTACK_CLOUDS_FILE_ENV]: cloudsFile },
    });

    assert.match(
      readOpenStackChangeReach(
        (
          await run(
            noCredential,
            `openstack dry-run server start ${STOPPED}`,
          )
        ).output,
      )?.wouldBeRefused as string,
      /credential of its own/,
    );
  });

  test("what it could not read it says, and the numbers read at least", async () => {
    const gone: string = "00000000-0000-4000-8000-000000000000";
    const h: Harness = harness();
    const result: ExecResult = await run(
      h,
      `openstack dry-run server evacuate ${RUNNING} ${gone}`,
    );
    const reach: OpenStackChangeReach = readOpenStackChangeReach(
      result.output,
    ) as OpenStackChangeReach;

    assert.strictEqual(reach.isComplete, false);
    assert.ok(reach.problems.length > 0);
    assert.match(result.output, /at least 2 instances/);
  });

  test("a project Keystone will not name stays its ID, and the rest stands", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest, url: URL) => {
        return request.method === "GET" && url.pathname.includes("/projects/")
          ? fakeReply({ forbidden: { code: 403, message: "no" } }, 403)
          : undefined;
      },
    });
    const reach: OpenStackChangeReach = readOpenStackChangeReach(
      (await run(h, `openstack dry-run server start ${STOPPED}`)).output,
    ) as OpenStackChangeReach;

    assert.strictEqual(reach.isComplete, true);
    assert.strictEqual(reach.projects[0]?.name, null);
    assert.ok(reach.projects[0]?.id.startsWith(PAYMENTS_PREFIX));
  });

  test("an investigation may run one", async () => {
    const h: Harness = harness();
    const result: ExecResult = await prepared(
      h.executor.prepare(
        job(`openstack dry-run server start ${STOPPED}`, {
          origin: "AiInvestigation",
        }),
      ),
    ).run();

    assert.strictEqual(result.success, true);
    assert.strictEqual(h.cloud.changes().length, 0);
  });

  test("an instance's name it masks stays a name, and the facts survive", async () => {
    const h: Harness = harness({
      override: (request: OpenStackHttpRequest, url: URL) => {
        return request.method === "GET" &&
          url.pathname === `/compute/v2.1/servers/${STOPPED}`
          ? fakeReply({
              server: {
                id: STOPPED,
                name: "password=hunter2 api_key=abc123",
                tenant_id: "9aee824cac87464292adffc328de1662",
                status: "SHUTOFF",
                "OS-EXT-SRV-ATTR:host": HOST,
              },
            })
          : undefined;
      },
    });
    const result: ExecResult = await run(
      h,
      `openstack dry-run server start ${STOPPED}`,
    );
    const reach: OpenStackChangeReach = readOpenStackChangeReach(
      result.output,
    ) as OpenStackChangeReach;

    assert.ok(!result.output.includes("hunter2"));
    assert.ok(!result.output.includes("abc123"));
    assert.strictEqual(reach.instances[0]?.id, STOPPED);
    assert.strictEqual(reach.instances[0]?.host, HOST);
    assert.strictEqual(reach.projectCount, 1);
  });
});
