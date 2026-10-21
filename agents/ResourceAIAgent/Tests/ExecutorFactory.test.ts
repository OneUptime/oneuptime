import { recordingLogger, testConfig } from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { after, before, describe, test } from "node:test";
import { AgentConfig } from "../Config";
import CephExecutor from "../Executors/CephExecutor";
import DatabaseExecutor from "../Executors/DatabaseExecutor";
import DockerExecutor from "../Executors/DockerExecutor";
import {
  EXECUTOR_CLASSES,
  createExecutor,
  getExecutorClass,
} from "../Executors/ExecutorFactory";
import GovcExecutor from "../Executors/GovcExecutor";
import HostExecutor from "../Executors/HostExecutor";
import ProxmoxExecutor from "../Executors/ProxmoxExecutor";
import {
  ExecutorOptions,
  PrepareResult,
  ResourceExecutor,
  ResourceExecutorClass,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import { JOB_DIR_PARENT_NAME } from "../Executors/SpawnSandbox";
import UnavailableExecutor from "../Executors/UnavailableExecutor";
import { fakePolicy } from "./Helpers/FakeExecutor";
import { makeTempDir } from "./Helpers/FakeBinary";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
} from "../Common/Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * One agent, one resource, one executor: the factory maps every resource
 * type to its executor class, and every class is built the same way. The
 * per-tool executors are placeholders until their kit lands; the contract
 * tests below hold for placeholders and real executors alike, and the
 * placeholder behaviour is checked only on executors that still are one.
 */

const URL: string = "https://oneuptime.example.com";

// A complete environment for each type (its alias and identity).
const TYPE_ENV: Record<AiResourceType, Record<string, string>> = {
  [AiResourceType.DockerHost]: {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "docker",
    DOCKER_HOST_NAME: "res-1",
  },
  [AiResourceType.PodmanHost]: {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "podman",
    PODMAN_HOST_NAME: "res-1",
  },
  [AiResourceType.DockerSwarmCluster]: {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "docker-swarm",
    DOCKER_SWARM_CLUSTER_NAME: "res-1",
  },
  [AiResourceType.ProxmoxCluster]: {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "proxmox",
    PROXMOX_CLUSTER_NAME: "res-1",
  },
  [AiResourceType.VMwareVCenter]: {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "vmware",
    VMWARE_VCENTER_NAME: "res-1",
  },
  [AiResourceType.CephCluster]: {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "ceph",
    CEPH_CLUSTER_NAME: "res-1",
  },
  [AiResourceType.DatabaseServer]: {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "database",
    ONEUPTIME_AI_AGENT_RESOURCE_NAME: "res-1",
    DATABASE_SYSTEM: "postgresql",
    DATABASE_SERVER_ADDRESS: "db.internal",
  },
  [AiResourceType.Host]: {
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "host",
    HOST_NAME: "res-1",
  },
};

let tmpDir: string;

before((): void => {
  tmpDir = makeTempDir("agent-factory-");
});

after((): void => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function options(
  type: AiResourceType | null,
  extra: Partial<ExecutorOptions> = {},
): ExecutorOptions {
  const config: AgentConfig = testConfig(
    URL,
    type
      ? { DOCKER_HOST_NAME: "", ...TYPE_ENV[type] }
      : { ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "" },
  );

  return {
    config,
    env: {},
    tmpDir,
    logger: recordingLogger(),
    ...extra,
  };
}

// The type's first "Test connection" command, as a payload for this agent.
function testCommandPayload(
  type: AiResourceType,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const [program, ...args] = (
    AI_RESOURCE_TYPE_INFO[type].testCommands[0] || ""
  ).split(" ");

  return {
    resourceType: type,
    resourceId: "resource-1",
    resourceIdentifier: "res-1",
    program,
    args,
    displayCommand: AI_RESOURCE_TYPE_INFO[type].testCommands[0],
    tier: "Read",
    ...overrides,
  };
}

describe("which executor serves which resource", () => {
  test("every type maps to its executor class", () => {
    const expected: Record<AiResourceType, ResourceExecutorClass> = {
      [AiResourceType.DockerHost]: DockerExecutor,
      [AiResourceType.PodmanHost]: DockerExecutor,
      [AiResourceType.DockerSwarmCluster]: DockerExecutor,
      [AiResourceType.ProxmoxCluster]: ProxmoxExecutor,
      [AiResourceType.VMwareVCenter]: GovcExecutor,
      [AiResourceType.CephCluster]: CephExecutor,
      [AiResourceType.DatabaseServer]: DatabaseExecutor,
      [AiResourceType.Host]: HostExecutor,
    };

    assert.deepStrictEqual(
      Object.keys(EXECUTOR_CLASSES).sort(),
      [...ALL_AI_RESOURCE_TYPES].sort(),
    );

    for (const type of ALL_AI_RESOURCE_TYPES) {
      assert.strictEqual(EXECUTOR_CLASSES[type], expected[type], type);
      assert.strictEqual(getExecutorClass(type), expected[type], type);
    }
  });

  test("no (known) type: an executor that runs nothing", () => {
    assert.strictEqual(getExecutorClass(null), UnavailableExecutor);
    assert.strictEqual(
      getExecutorClass("Kubernetes" as AiResourceType),
      UnavailableExecutor,
    );
    assert.ok(createExecutor(options(null)) instanceof UnavailableExecutor);
  });

  test("createExecutor builds the configured type's class with the options as given", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      const executor: ResourceExecutor = createExecutor(options(type));

      assert.ok(
        executor instanceof EXECUTOR_CLASSES[type],
        `${type} -> ${executor.constructor.name}`,
      );
    }
  });
});

describe("the contract every executor keeps", () => {
  for (const type of ALL_AI_RESOURCE_TYPES) {
    test(`${type}: PrepareGuard runs first — a command for another resource never runs`, () => {
      const executor: ResourceExecutor = createExecutor(options(type));
      const prepared: PrepareResult = executor.prepare({
        payload: testCommandPayload(type, {
          resourceIdentifier: "someone-else",
        }),
        origin: "AiInvestigation",
        timeoutInMs: 30_000,
      });

      assert.notStrictEqual(prepared.refusal, null);
      assert.match(
        String(prepared.refusal),
        new RegExp(
          `^Refused by the ${AI_RESOURCE_TYPE_INFO[type].agentDisplayName}: this command is for ${AI_RESOURCE_TYPE_INFO[type].displayName} "someone-else"`,
        ),
      );
    });

    test(`${type}: a program the type does not run is refused, whatever the executor`, () => {
      const executor: ResourceExecutor = createExecutor(options(type));
      const prepared: PrepareResult = executor.prepare({
        payload: testCommandPayload(type, {
          program: "sh",
          args: ["-c", "id"],
          displayCommand: "sh -c id",
        }),
        origin: "AiRemediation",
        timeoutInMs: 30_000,
      });

      assert.match(
        String(prepared.refusal),
        /"sh" is not a program the .* runs/,
      );
    });

    test(`${type}: a command from a runbook is refused, whatever the executor`, () => {
      const executor: ResourceExecutor = createExecutor(options(type));
      const prepared: PrepareResult = executor.prepare({
        payload: testCommandPayload(type),
        origin: "Runbook",
        timeoutInMs: 30_000,
      });

      assert.match(String(prepared.refusal), /this job came from "Runbook"/);
    });

    test(`${type}: job directories are swept and removed without throwing`, async () => {
      const executor: ResourceExecutor = createExecutor(options(type));

      await executor.sweepOrphanedJobDirs();
      await executor.removeAllJobDirs();
    });
  }
});

describe("placeholders (until each kit replaces its executor)", () => {
  for (const type of ALL_AI_RESOURCE_TYPES) {
    test(`${type}: a command every shared check allows is refused as not available`, async () => {
      const guardPolicy: ReturnType<typeof fakePolicy> = fakePolicy({
        [(AI_RESOURCE_TYPE_INFO[type].testCommands[0] || "").trim()]:
          ResourceCommandTier.Read,
      });
      const executor: ResourceExecutor = createExecutor(
        options(type, { guardPolicy }),
      );

      if (!(executor instanceof UnavailableExecutor)) {
        // This type's kit has landed: its own tests cover it.
        return;
      }

      const prepared: PrepareResult = executor.prepare({
        payload: testCommandPayload(type),
        origin: "AiInvestigation",
        timeoutInMs: 30_000,
      });
      const displayName: string = AI_RESOURCE_TYPE_INFO[type].agentDisplayName;

      assert.strictEqual(
        prepared.refusal,
        `Refused by the ${displayName}: The ${displayName} executor is not available in this build.`,
      );
      // The guard really ran: the policy was asked about this argv.
      assert.strictEqual(guardPolicy.calls.length, 1);

      const probe: ResourcePostureProbe = await executor.probePosture();
      assert.deepStrictEqual(probe, {
        toolVersion: null,
        reachable: false,
        reachError: `The ${displayName} executor is not available in this build.`,
        details: {},
        protectedTargets: [],
      });
    });
  }
});

describe("UnavailableExecutor", () => {
  test("without a resource type it refuses everything and says why", async () => {
    const executor: UnavailableExecutor = new UnavailableExecutor(
      options(null),
    );

    assert.match(
      String(
        executor.prepare({
          payload: testCommandPayload(AiResourceType.DockerHost),
          origin: "AiInvestigation",
          timeoutInMs: 1_000,
        }).refusal,
      ),
      /^Refused by the resource AI agent: it has no resource type configured/,
    );
    assert.match(
      executor.getUnavailableReason(),
      /no resource type configured \(ONEUPTIME_AI_AGENT_RESOURCE_TYPE\)/,
    );
    assert.strictEqual((await executor.probePosture()).reachable, false);
  });

  test("the start-up sweep removes what a previous run left behind, and logs it", async () => {
    const logger: ReturnType<typeof recordingLogger> = recordingLogger();
    const executor: UnavailableExecutor = new UnavailableExecutor(
      options(AiResourceType.DockerHost, { logger }),
    );
    const leftover: string = path.join(tmpDir, JOB_DIR_PARENT_NAME, "job-old");
    fs.mkdirSync(path.join(leftover, "home"), { recursive: true });

    await executor.sweepOrphanedJobDirs();

    assert.strictEqual(fs.existsSync(leftover), false);
    assert.deepStrictEqual(logger.records, [
      {
        level: "info",
        message: "Removed job directories a previous run left behind",
      },
    ]);

    await executor.sweepOrphanedJobDirs();
    assert.strictEqual(
      logger.records.length,
      1,
      "nothing to say the second time",
    );
  });
});
