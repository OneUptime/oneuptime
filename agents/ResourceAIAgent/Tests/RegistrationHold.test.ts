import {
  CapturedLogs,
  RecordingSleep,
  captureLogs,
  recordingSleep,
  testConfig,
} from "./Helpers/TestSupport";
import assert from "assert";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import AgentStatus from "../AgentStatus";
import IngestClient from "../IngestClient";
import {
  AgentPosture,
  DEFAULT_PROBE_REFRESH_MS,
  REGISTRATION_HOLD_RETRY_MS,
  describeRegistrationHold,
} from "../Posture";
import { AgentIdentity, AgentSession } from "../Registration";
import { SleepFunction } from "../Sleep";
import FakeOneUptime, { RecordedRequest } from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";

/*
 * Regression: every Docker Swarm AI agent registered, whatever its node. The
 * server keeps the first agent that registers for a resource for as long as
 * it heartbeats, so an agent on a worker (the collector's compose file run on
 * every node, or workers up first after a reboot) held the cluster's place
 * while unable to run anything, and the manager's agent was refused forever.
 * An agent on a worker now never registers; it does once its node is a
 * manager.
 */

function swarmPosture(swarmRole: string): AgentPosture {
  return {
    resourceType: AiResourceType.DockerSwarmCluster,
    resourceIdentifier: "prod-swarm",
    allowWrites: false,
    writeTargets: [],
    protectedTargets: [],
    reachable: swarmRole === "manager",
    ...(swarmRole === "manager"
      ? {}
      : { reachError: "This Docker engine is a swarm worker, ..." }),
    details: { engine: "docker", swarmRole },
  };
}

describe("describeRegistrationHold", () => {
  test("a Docker Swarm agent on a worker is held back, and told why and what to do", () => {
    const hold: string | null = describeRegistrationHold(
      swarmPosture("worker"),
    );

    assert.ok(hold);
    assert.match(hold, /^This node is a swarm worker/);
    assert.match(hold, /"prod-swarm"/);
    assert.match(hold, /registers once this node is a manager/);
    assert.match(hold, /install\.sh leaves it out on the others/);
  });

  test("a manager registers, and so does an engine whose role is not a definite worker", () => {
    for (const role of ["manager", "inactive"]) {
      assert.strictEqual(
        describeRegistrationHold(swarmPosture(role)),
        null,
        role,
      );
    }

    const noDetails: AgentPosture = swarmPosture("worker");
    delete noDetails.details;
    assert.strictEqual(describeRegistrationHold(noDetails), null);
  });

  test("a Docker or Podman host on a swarm worker is not held back: the role is only reported", () => {
    for (const resourceType of [
      AiResourceType.DockerHost,
      AiResourceType.PodmanHost,
    ]) {
      assert.strictEqual(
        describeRegistrationHold({
          ...swarmPosture("worker"),
          resourceType,
          reachable: true,
        }),
        null,
      );
    }
  });

  test("it looks again after one probe refresh, so every look is a fresh probe", () => {
    assert.strictEqual(REGISTRATION_HOLD_RETRY_MS, DEFAULT_PROBE_REFRESH_MS);
  });
});

describe("a Docker Swarm agent on a worker node", () => {
  let server: FakeOneUptime;
  let status: AgentStatus;
  let logs: CapturedLogs;

  before(async (): Promise<void> => {
    server = new FakeOneUptime();
    await server.start();
  });

  after(async (): Promise<void> => {
    await server.stop();
  });

  beforeEach((): void => {
    server.reset();
    status = new AgentStatus();
    logs = captureLogs();
  });

  afterEach((): void => {
    logs.restore();
  });

  function session(
    getPosture: () => Promise<AgentPosture>,
    sleep: SleepFunction,
  ): AgentSession {
    return new AgentSession({
      client: new IngestClient({ oneuptimeUrl: server.url, apiKey: "k" }),
      config: testConfig(server.url, {
        ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "docker-swarm",
        DOCKER_SWARM_CLUSTER_NAME: "prod-swarm",
      }),
      status,
      getPosture,
      sleep,
    });
  }

  test("never registers while it is a worker, and registers once the node is a manager", async () => {
    let role: string = "worker";
    const sleeper: RecordingSleep = recordingSleep();
    const sleep: SleepFunction = (
      ms: number,
      signal?: AbortSignal,
    ): Promise<void> => {
      // The node is promoted after the agent has waited twice.
      if (sleeper.delays.length === 1) {
        role = "manager";
      }
      return sleeper.sleep(ms, signal);
    };

    const identity: AgentIdentity | null = await session(
      (): Promise<AgentPosture> => {
        return Promise.resolve(swarmPosture(role));
      },
      sleep,
    ).ensureRegistered();

    assert.ok(identity);
    assert.deepStrictEqual(sleeper.delays, [
      REGISTRATION_HOLD_RETRY_MS,
      REGISTRATION_HOLD_RETRY_MS,
    ]);

    // Only the manager's attempt reached OneUptime.
    const requests: Array<RecordedRequest> = server.requestsTo("/register");
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(
      (requests[0]!.body["posture"] as AgentPosture).details!["swarmRole"],
      "manager",
    );
    assert.strictEqual(status.phase, "connected");
  });

  test("says why once, at info, and shows it in /status", async () => {
    const sleeper: RecordingSleep = recordingSleep();
    const agentSession: AgentSession = session(
      (): Promise<AgentPosture> => {
        return Promise.resolve(swarmPosture("worker"));
      },
      (ms: number, signal?: AbortSignal): Promise<void> => {
        if (sleeper.delays.length === 2) {
          void agentSession.stop();
        }
        return sleeper.sleep(ms, signal);
      },
    );

    assert.strictEqual(await agentSession.ensureRegistered(), null);

    assert.strictEqual(server.requestsTo("/register").length, 0);
    assert.strictEqual(
      logs.messages("info").filter((message: string): boolean => {
        return message.startsWith("This node is a swarm worker");
      }).length,
      1,
    );
    assert.deepStrictEqual(logs.messages("error"), []);
    assert.match(String(status.lastError), /^This node is a swarm worker/);
    assert.strictEqual(status.phase, "registering");
    assert.strictEqual(status.snapshot().registered, false);
  });
});
