import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import DockerHostFeedService from "../../../Server/Services/DockerHostFeedService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import {
  RESOURCE_AI_AGENT_TAKEOVER_AFTER_SILENT_MS,
  ResourceAiAgentRegistrationRefusedException,
  ResourceAiAgentRegistrationResult,
  Service as ResourceAiAgentServiceClass,
} from "../../../Server/Services/ResourceAiAgentService";
import logger from "../../../Server/Utils/Logger";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  RESOURCE_AI_AGENT_TAKEOVER_AFTER_SILENT_SECONDS,
  ResourceAiAgentSummary,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { getResourceAiAgentDescriptor } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import { getResourceAiRefusedRegistrationWarning } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatus";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ResourceAiAgentService — an agent replaced without signing off (issue
 * #5253: a Docker AI agent upgraded with `docker rm -f` and `docker run`
 * kept showing its old version and "update available", and its AI agent
 * page warned that two agents shared DOCKER_HOST_NAME).
 *
 * rm -f is a SIGKILL: the old agent never signs off, so its row still counts
 * as online. Its replacement is refused (previous_instance_online), and the
 * refusal asks the row's agent to show it is running: every request it
 * authenticates answers it. One that sends nothing for
 * RESOURCE_AI_AGENT_TAKEOVER_AFTER_SILENT_SECONDS has stopped, and the next
 * registration takes its place; a live one answers within seconds and keeps
 * it, so a second install (or anyone holding the ingestion key) still cannot
 * take the row of a running agent.
 *
 * Each test plays a whole story through the service: the agent row lives in
 * an in-memory table, the clock is the test's, and the AI agent page's
 * warning is read from the summary the server builds.
 */

type AnyObject = Record<string, any>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const START: Date = new Date("2026-10-25T09:00:00.000Z");
const TAKEOVER_SECONDS: number =
  RESOURCE_AI_AGENT_TAKEOVER_AFTER_SILENT_SECONDS;
const ALIVE_WINDOW_SECONDS: number =
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60;

// The agent's own cadence (agents/ResourceAIAgent/Config.ts defaults).
const CLAIM_EVERY_SECONDS: number = 3;
const HEARTBEAT_EVERY_SECONDS: number = 30;

const DOCKER_POSTURE: JSONObject = {
  resourceType: AiResourceType.DockerHost,
  resourceIdentifier: "test01",
  allowWrites: false,
  writeTargets: [],
  protectedTargets: ["oneuptime-docker-ai-agent"],
  reachable: true,
};

// What registration hands an agent: its id and key.
interface AgentCredentials {
  agentId: string;
  agentKey: string;
}

type Attempt =
  | { admitted: ResourceAiAgentRegistrationResult; refused: null }
  | { admitted: null; refused: ResourceAiAgentRegistrationRefusedException };

interface Story {
  service: ResourceAiAgentServiceClass;
  // Moves the clock to this many seconds after START.
  at: (seconds: number) => void;
  // One registration, as an agent sends it.
  attempt: (data?: {
    agentVersion?: string | undefined;
    previousAgentKey?: string | undefined;
  }) => Promise<Attempt>;
  // A registration that must be admitted: the agent's credentials.
  registerAgent: (data?: {
    agentVersion?: string | undefined;
  }) => Promise<AgentCredentials>;
  // Any authenticated request (a claim, a job heartbeat, a result).
  request: (agent: AgentCredentials) => Promise<boolean>;
  heartbeat: (agent: AgentCredentials, agentVersion?: string) => Promise<void>;
  // The clean shutdown: POST /disconnect.
  signOff: (agent: AgentCredentials) => Promise<void>;
  row: () => ResourceAiAgent;
  summary: () => ResourceAiAgentSummary;
  // The AI agent page's warning about another agent, or null.
  warning: () => string | null;
  // Every hook-free column write the table received, in order.
  columnWrites: Array<AnyObject>;
  info: Array<string>;
}

function copyOf(row: ResourceAiAgent): ResourceAiAgent {
  const copy: ResourceAiAgent = new ResourceAiAgent();
  Object.assign(copy, row);
  copy.id = row.id;
  return copy;
}

function seconds(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 1000;
}

function setUp(): Story {
  const service: ResourceAiAgentServiceClass =
    new ResourceAiAgentServiceClass();
  let now: Date = START;
  let table: ResourceAiAgent | null = null;
  const columnWrites: Array<AnyObject> = [];
  const info: Array<string> = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(now.getTime());
  });

  jest.spyOn(logger, "info").mockImplementation((message: unknown): void => {
    info.push(String(message));
  });

  for (const level of ["warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  // The resource: a Docker host someone configured, so no defaults apply.
  const found: AnyObject = { _id: RESOURCE_ID.toString() };
  Object.defineProperty(found, "id", { value: RESOURCE_ID });

  const host: DockerHost = new DockerHost();
  host._id = RESOURCE_ID.toString();
  host.projectId = PROJECT_ID;
  host.name = "test01";
  host.isAiInvestigationEnabled = true;
  host.aiRemediationMode = ResourceAiRemediationMode.Disabled;
  host.aiAccessConfiguredAt = START;

  jest
    .spyOn(DockerHostService, "findOrCreateByHostIdentifier")
    .mockResolvedValue(found as never);
  jest.spyOn(DockerHostService, "findOneBy").mockResolvedValue(host as never);
  jest.spyOn(DockerHostService, "updateOneBy").mockResolvedValue(0 as never);
  jest
    .spyOn(DockerHostFeedService, "createDockerHostFeedItem")
    .mockResolvedValue(undefined as never);

  // The agent table: one row, read by id or by its resource.
  jest
    .spyOn(service, "findOneBy")
    .mockImplementation(async (findBy: AnyObject): Promise<never> => {
      const query: AnyObject = findBy["query"] || {};

      if (!table) {
        return null as never;
      }

      if (query["_id"] && query["_id"] !== table.id!.toString()) {
        return null as never;
      }

      return copyOf(table) as never;
    });

  jest
    .spyOn(service, "create")
    .mockImplementation(async (createBy: AnyObject): Promise<never> => {
      const row: ResourceAiAgent = createBy["data"] as ResourceAiAgent;
      row.id = AGENT_ID;
      table = copyOf(row);
      return row as never;
    });

  jest
    .spyOn(service, "updateOneById")
    .mockImplementation(async (updateBy: AnyObject): Promise<never> => {
      Object.assign(table!, updateBy["data"]);
      return undefined as never;
    });

  jest
    .spyOn(service, "updateColumnsByIdWithoutHooks")
    .mockImplementation(async (updateBy: AnyObject): Promise<void> => {
      columnWrites.push({ ...updateBy["data"] });
      Object.assign(table!, updateBy["data"]);
    });

  jest
    .spyOn(service, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);

  const attempt: Story["attempt"] = async (
    data: {
      agentVersion?: string | undefined;
      previousAgentKey?: string | undefined;
    } = {},
  ): Promise<Attempt> => {
    try {
      const admitted: ResourceAiAgentRegistrationResult =
        await service.register({
          projectId: PROJECT_ID,
          resourceType: "docker",
          resourceIdentifier: "test01",
          agentVersion: data.agentVersion || "14.0.88",
          previousAgentKey: data.previousAgentKey,
          posture: {
            ...DOCKER_POSTURE,
            agentVersion: data.agentVersion || "14.0.88",
          },
        });

      return { admitted, refused: null };
    } catch (error) {
      if (error instanceof ResourceAiAgentRegistrationRefusedException) {
        return { admitted: null, refused: error };
      }

      throw error;
    }
  };

  const request: Story["request"] = async (
    agent: AgentCredentials,
  ): Promise<boolean> => {
    return Boolean(
      await service.authenticate({
        agentId: agent.agentId,
        agentKey: agent.agentKey,
      }),
    );
  };

  const story: Story = {
    service,
    at: (offsetSeconds: number): void => {
      now = new Date(START.getTime() + offsetSeconds * 1000);
    },
    attempt,
    registerAgent: async (
      data: { agentVersion?: string | undefined } = {},
    ): Promise<AgentCredentials> => {
      const result: Attempt = await attempt(data);

      expect(result.refused).toBeNull();

      return {
        agentId: result.admitted!.agentId.toString(),
        agentKey: result.admitted!.agentKey,
      };
    },
    request,
    heartbeat: async (
      agent: AgentCredentials,
      agentVersion?: string,
    ): Promise<void> => {
      // As the ingress does: authenticate, then the heartbeat itself.
      const row: ResourceAiAgent | null = await service.authenticate({
        agentId: agent.agentId,
        agentKey: agent.agentKey,
      });

      expect(row).not.toBeNull();

      await service.heartbeat({
        agent: row!,
        agentVersion,
        posture: { ...DOCKER_POSTURE, agentVersion },
      });
    },
    signOff: async (agent: AgentCredentials): Promise<void> => {
      const row: ResourceAiAgent | null = await service.authenticate({
        agentId: agent.agentId,
        agentKey: agent.agentKey,
      });

      expect(row).not.toBeNull();

      await service.markDisconnected({ resourceAiAgentId: row!.id! });
    },
    row: (): ResourceAiAgent => {
      return table!;
    },
    summary: (): ResourceAiAgentSummary => {
      return service.getAgentSummary(table!, now);
    },
    warning: (): string | null => {
      return getResourceAiRefusedRegistrationWarning(
        service.getAgentSummary(table!, now),
        getResourceAiAgentDescriptor(AiResourceType.DockerHost),
        now,
      );
    },
    columnWrites,
    info,
  };

  return story;
}

// The agent's ordinary traffic: a claim every 3 seconds, a heartbeat every 30.
async function runAgent(
  story: Story,
  agent: AgentCredentials,
  fromSeconds: number,
  toSeconds: number,
  agentVersion: string = "14.0.88",
): Promise<void> {
  for (
    let second: number = fromSeconds;
    second <= toSeconds;
    second += CLAIM_EVERY_SECONDS
  ) {
    story.at(second);

    if ((second - fromSeconds) % HEARTBEAT_EVERY_SECONDS === 0) {
      await story.heartbeat(agent, agentVersion);
    } else {
      expect(await story.request(agent)).toBe(true);
    }
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an agent upgraded with docker rm -f and docker run (issue #5253)", () => {
  test("the new agent takes over once the old one has sent nothing for the takeover window, and the page shows it, without a warning", async () => {
    const story: Story = setUp();

    // 14.0.88 has run for an hour.
    story.at(0);
    const old: AgentCredentials = await story.registerAgent({
      agentVersion: "14.0.88",
    });
    await runAgent(story, old, 0, 3600);

    /*
     * docker rm -f at 3601: a SIGKILL, so no sign-off. docker run of the
     * new image a few seconds later.
     */
    story.at(3605);
    const first: Attempt = await story.attempt({ agentVersion: "14.0.89" });

    expect(first.refused?.reason).toBe("previous_instance_online");
    expect(first.refused?.retryAfterSeconds).toBe(TAKEOVER_SECONDS + 1);

    // Until then the page shows the old agent, online, and warns of nothing.
    expect(story.summary().isOnline).toBe(true);
    expect(story.summary().agentVersion).toBe("14.0.88");
    expect(story.warning()).toBeNull();

    // The new agent retries when it was told to.
    story.at(3605 + first.refused!.retryAfterSeconds!);
    const second: Attempt = await story.attempt({ agentVersion: "14.0.89" });

    expect(second.refused).toBeNull();
    expect(second.admitted?.admission).toBe("unresponsive");
    expect(second.admitted?.agentId.toString()).toBe(AGENT_ID.toString());

    const replacement: AgentCredentials = {
      agentId: second.admitted!.agentId.toString(),
      agentKey: second.admitted!.agentKey,
    };

    // The page reads the new agent: its version, online, and no warning.
    expect(story.summary().agentVersion).toBe("14.0.89");
    expect(story.summary().isOnline).toBe(true);
    expect(story.warning()).toBeNull();

    await runAgent(story, replacement, 3700, 3800, "14.0.89");

    expect(story.summary().agentVersion).toBe("14.0.89");
    expect(story.summary().isOnline).toBe(true);
    expect(story.warning()).toBeNull();

    // The old container's key opens nothing any more.
    expect(await story.request(old)).toBe(false);
  });

  test("the whole wait is the takeover window from the first refusal, far inside the 5-minute alive window", async () => {
    const story: Story = setUp();

    story.at(0);
    const old: AgentCredentials = await story.registerAgent();
    // Its last heartbeat right before the kill: the row looks freshly alive.
    story.at(100);
    await story.heartbeat(old, "14.0.88");

    story.at(101);
    const first: Attempt = await story.attempt({ agentVersion: "14.0.89" });
    story.at(101 + first.refused!.retryAfterSeconds!);
    const second: Attempt = await story.attempt({ agentVersion: "14.0.89" });

    expect(second.admitted?.admission).toBe("unresponsive");
    expect(
      seconds(START, story.row().lastRegisteredAt as Date) - 101,
    ).toBeLessThanOrEqual(TAKEOVER_SECONDS + 1);
    expect(TAKEOVER_SECONDS).toBeLessThan(ALIVE_WINDOW_SECONDS / 5);
  });

  test("a crashed agent restarted in place (restart: unless-stopped) takes its own row back the same way", async () => {
    const story: Story = setUp();

    story.at(0);
    const before: AgentCredentials = await story.registerAgent();
    await runAgent(story, before, 0, 300);

    // The process died; the restarted one has no key to prove continuity.
    story.at(305);
    const first: Attempt = await story.attempt();

    expect(first.refused?.reason).toBe("previous_instance_online");

    story.at(305 + first.refused!.retryAfterSeconds!);
    expect((await story.attempt()).admitted?.admission).toBe("unresponsive");
    expect(story.warning()).toBeNull();
  });

  test("the takeover is logged, naming the agent, the resource and the wait", async () => {
    const story: Story = setUp();

    story.at(0);
    await story.registerAgent();
    story.at(10);
    const first: Attempt = await story.attempt();
    story.at(10 + first.refused!.retryAfterSeconds!);
    await story.attempt();

    const line: string | undefined = story.info.find(
      (message: string): boolean => {
        return message.includes("takes it now");
      },
    );

    expect(line).toContain(AGENT_ID.toString());
    expect(line).toContain('Docker host "test01"');
    expect(line).toContain(`${TAKEOVER_SECONDS} seconds`);
  });
});

describe("an agent stopped cleanly (docker stop, compose up, the installers)", () => {
  test("signs off, and its replacement is admitted at once with nothing to wait for or warn about", async () => {
    const story: Story = setUp();

    story.at(0);
    const old: AgentCredentials = await story.registerAgent();
    await runAgent(story, old, 0, 120);

    story.at(121);
    await story.signOff(old);

    story.at(123);
    const replacement: Attempt = await story.attempt({
      agentVersion: "14.0.89",
    });

    expect(replacement.admitted?.admission).toBe("signed_off");
    expect(story.row().lastRefusedRegistrationAt).toBeFalsy();
    expect(story.summary().agentVersion).toBe("14.0.89");
    expect(story.warning()).toBeNull();
  });
});

describe("two agents running with one identity", () => {
  test("the second keeps being refused while the first keeps answering, and the page warns", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    let second: number = 30;
    let refusals: number = 0;

    // Ten minutes of the second agent retrying as told, the first running.
    while (second < 600) {
      story.at(second);
      const attempt: Attempt = await story.attempt();

      expect(attempt.refused?.reason).toBe("previous_instance_online");
      refusals++;

      // The first agent's next claim and heartbeat, before the retry.
      await runAgent(story, first, second + 2, second + 32);

      second += attempt.refused!.retryAfterSeconds!;
    }

    expect(refusals).toBeGreaterThan(10);
    // The first agent still holds its key.
    expect(await story.request(first)).toBe(true);
    expect(story.warning()).toContain(
      "Another agent tried to register for this Docker host at",
    );
    expect(story.warning()).toContain("DOCKER_HOST_NAME");
  });

  test("an agent busy with a long command answers with its job heartbeats alone", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();
    story.at(30);
    await story.heartbeat(first, "14.0.88");

    story.at(31);
    const attempt: Attempt = await story.attempt();

    // No claim while the command runs: a job heartbeat 10 seconds in.
    story.at(41);
    expect(await story.request(first)).toBe(true);

    story.at(31 + attempt.refused!.retryAfterSeconds!);
    expect((await story.attempt()).refused?.reason).toBe(
      "previous_instance_online",
    );
  });

  test("an answer that comes late, but inside the window, still keeps the row", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    story.at(50);
    await story.attempt();

    story.at(50 + TAKEOVER_SECONDS - 1);
    expect(await story.request(first)).toBe(true);

    story.at(50 + TAKEOVER_SECONDS + 1);
    expect((await story.attempt()).refused?.reason).toBe(
      "previous_instance_online",
    );
    expect(await story.request(first)).toBe(true);
  });
});

describe("the wait", () => {
  test("retries cannot push it back: the first refusal the agent did not answer stays on the row", async () => {
    const story: Story = setUp();

    story.at(0);
    await story.registerAgent();

    // A replacement that retries every 5 seconds, whatever it is told.
    const refusedAt: Array<number> = [];
    let admittedAt: number | null = null;

    for (let second: number = 10; second <= 120; second += 5) {
      story.at(second);
      const attempt: Attempt = await story.attempt();

      if (attempt.admitted) {
        admittedAt = second;
        break;
      }

      refusedAt.push(
        seconds(START, story.row().lastRefusedRegistrationAt as Date),
      );
    }

    expect(new Set(refusedAt)).toEqual(new Set([10]));
    expect(admittedAt).toBe(10 + TAKEOVER_SECONDS);
  });

  test("each retry is told when the window ends, not a fixed pace", async () => {
    const story: Story = setUp();

    story.at(0);
    await story.registerAgent();

    story.at(10);
    expect((await story.attempt()).refused?.retryAfterSeconds).toBe(
      TAKEOVER_SECONDS + 1,
    );

    story.at(25);
    expect((await story.attempt()).refused?.retryAfterSeconds).toBe(
      TAKEOVER_SECONDS - 15 + 1,
    );

    story.at(10 + TAKEOVER_SECONDS - 0.5);
    expect((await story.attempt()).refused?.retryAfterSeconds).toBe(2);
  });

  test("a second contender joins the same wait instead of starting its own", async () => {
    const story: Story = setUp();

    story.at(0);
    await story.registerAgent();

    story.at(10);
    await story.attempt();
    story.at(30);
    const late: Attempt = await story.attempt();

    expect(late.refused?.retryAfterSeconds).toBe(TAKEOVER_SECONDS - 20 + 1);

    story.at(10 + TAKEOVER_SECONDS);
    expect((await story.attempt()).admitted?.admission).toBe("unresponsive");
  });

  test("an answered refusal is over: the next attempt starts a new wait", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    story.at(10);
    await story.attempt();
    story.at(12);
    await story.request(first);

    // The first agent stops for good after answering.
    story.at(60);
    const attempt: Attempt = await story.attempt();

    expect(attempt.refused?.retryAfterSeconds).toBe(TAKEOVER_SECONDS + 1);
    expect(seconds(START, story.row().lastRefusedRegistrationAt as Date)).toBe(
      60,
    );

    story.at(60 + TAKEOVER_SECONDS);
    expect((await story.attempt()).admitted?.admission).toBe("unresponsive");
  });

  test("an agent past the alive window is simply offline: no wait at all", async () => {
    const story: Story = setUp();

    story.at(0);
    await story.registerAgent();

    story.at(ALIVE_WINDOW_SECONDS + 1);
    expect((await story.attempt()).admitted?.admission).toBe("offline");
  });

  test("the current key still proves continuity in the middle of a wait", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    story.at(10);
    await story.attempt();

    // The first agent itself re-registering (its key was rejected) wins.
    story.at(11);
    const again: Attempt = await story.attempt({
      previousAgentKey: first.agentKey,
    });

    expect(again.admitted?.admission).toBe("continuity");
  });
});

describe("answering a refusal", () => {
  test("an ordinary request writes nothing: only a request after an unanswered refusal stamps the agent alive", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    for (let second: number = 3; second <= 27; second += 3) {
      story.at(second);
      expect(await story.request(first)).toBe(true);
    }

    expect(story.columnWrites).toEqual([]);
  });

  test("the first request after a refusal answers it, in one write of lastAliveAt; the rest write nothing", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    story.at(10);
    await story.attempt();
    const afterRefusal: number = story.columnWrites.length;

    for (let second: number = 12; second <= 36; second += 3) {
      story.at(second);
      await story.request(first);
    }

    const answers: Array<AnyObject> = story.columnWrites.slice(afterRefusal);

    expect(answers).toHaveLength(1);
    expect(Object.keys(answers[0]!)).toEqual(["lastAliveAt"]);
    expect(seconds(START, answers[0]!["lastAliveAt"] as Date)).toBe(12);
  });

  test("an answer stamped by a server whose clock runs behind still answers", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    story.at(40);
    await story.attempt();

    // Another server, 5 seconds behind, authenticates the agent's claim.
    story.at(37);
    expect(await story.request(first)).toBe(true);
    expect(seconds(START, story.row().lastAliveAt as Date)).toBe(40);

    story.at(40 + TAKEOVER_SECONDS + 1);
    expect((await story.attempt()).refused?.reason).toBe(
      "previous_instance_online",
    );
  });

  test("a failed answer never fails the agent's request", async () => {
    const story: Story = setUp();

    story.at(0);
    const first: AgentCredentials = await story.registerAgent();

    story.at(10);
    await story.attempt();

    (
      story.service.updateColumnsByIdWithoutHooks as unknown as {
        mockRejectedValueOnce: (error: Error) => void;
      }
    ).mockRejectedValueOnce(new Error("database is down"));

    story.at(12);
    expect(await story.request(first)).toBe(true);

    // The next request answers it.
    story.at(15);
    expect(await story.request(first)).toBe(true);
    expect(seconds(START, story.row().lastAliveAt as Date)).toBe(15);
  });

  test("a wrong key answers nothing", async () => {
    const story: Story = setUp();

    story.at(0);
    await story.registerAgent();

    story.at(10);
    await story.attempt();

    story.at(12);
    expect(
      await story.request({
        agentId: AGENT_ID.toString(),
        agentKey: "cd".repeat(32),
      }),
    ).toBe(false);

    story.at(10 + TAKEOVER_SECONDS);
    expect((await story.attempt()).admitted?.admission).toBe("unresponsive");
  });
});

describe("the pieces", () => {
  const service: ResourceAiAgentServiceClass =
    new ResourceAiAgentServiceClass();
  const NOW: Date = new Date("2026-10-25T10:00:00.000Z");

  function ago(secondsAgo: number): Date {
    return new Date(NOW.getTime() - secondsAgo * 1000);
  }

  test("getUnansweredRefusalSince: a previous_instance_online refusal the agent was not heard from after", () => {
    expect(
      service.getUnansweredRefusalSince({
        lastAliveAt: ago(30),
        lastRefusedRegistrationAt: ago(10),
        lastRefusedRegistrationReason: "previous_instance_online",
      }),
    ).toEqual(ago(10));

    // Read from a JSON payload too.
    expect(
      service.getUnansweredRefusalSince({
        lastAliveAt: ago(30).toISOString(),
        lastRefusedRegistrationAt: ago(10).toISOString(),
      }),
    ).toEqual(ago(10));

    // Heard from at, or after, the refusal: answered.
    for (const lastAliveAt of [ago(10), ago(5)]) {
      expect(
        service.getUnansweredRefusalSince({
          lastAliveAt,
          lastRefusedRegistrationAt: ago(10),
        }),
      ).toBeNull();
    }

    // No refusal, another reason, or an unreadable date: nothing to answer.
    expect(
      service.getUnansweredRefusalSince({ lastAliveAt: ago(30) }),
    ).toBeNull();
    expect(
      service.getUnansweredRefusalSince({
        lastAliveAt: ago(30),
        lastRefusedRegistrationAt: ago(10),
        lastRefusedRegistrationReason: "agent_cap_reached",
      }),
    ).toBeNull();
    expect(
      service.getUnansweredRefusalSince({
        lastAliveAt: ago(30),
        lastRefusedRegistrationAt: "not a date",
      }),
    ).toBeNull();

    // A row never heard from at all has not answered.
    expect(
      service.getUnansweredRefusalSince({
        lastRefusedRegistrationAt: ago(10),
      }),
    ).toEqual(ago(10));
  });

  test("isUnresponsive: unanswered for the whole takeover window, to the millisecond", () => {
    const row: (refusedSecondsAgo: number) => AnyObject = (
      refusedSecondsAgo: number,
    ): AnyObject => {
      return {
        connectionStatus: "connected",
        lastAliveAt: ago(refusedSecondsAgo + 20),
        lastRefusedRegistrationAt: ago(refusedSecondsAgo),
      };
    };

    expect(service.isUnresponsive(row(TAKEOVER_SECONDS), NOW)).toBe(true);
    expect(service.isUnresponsive(row(TAKEOVER_SECONDS + 600), NOW)).toBe(true);
    // Unanswered, but a millisecond short of the window.
    expect(
      service.isUnresponsive(
        {
          ...row(TAKEOVER_SECONDS),
          lastRefusedRegistrationAt: new Date(
            NOW.getTime() - RESOURCE_AI_AGENT_TAKEOVER_AFTER_SILENT_MS + 1,
          ),
        },
        NOW,
      ),
    ).toBe(false);
    expect(service.isUnresponsive(row(1), NOW)).toBe(false);
    expect(
      service.isUnresponsive(
        { ...row(TAKEOVER_SECONDS), lastAliveAt: ago(1) },
        NOW,
      ),
    ).toBe(false);
  });

  test("getReRegistrationAdmission: reset, continuity, signed off and offline come first; unresponsive before a refusal", () => {
    const key: string = "ab".repeat(32);
    const pending: AnyObject = {
      keyHash: ResourceAiAgentServiceClass.hashKey(key),
      connectionStatus: "connected",
      lastAliveAt: ago(TAKEOVER_SECONDS + 30),
      lastRefusedRegistrationAt: ago(TAKEOVER_SECONDS),
      lastRefusedRegistrationReason: "previous_instance_online",
    };

    function admission(agent: AnyObject, previousAgentKey?: string): unknown {
      return service.getReRegistrationAdmission({
        agent: agent as never,
        previousAgentKey,
        now: NOW,
      });
    }

    expect(admission(pending)).toBe("unresponsive");
    expect(admission({ ...pending, keyHash: null })).toBe("reset");
    expect(admission(pending, key)).toBe("continuity");
    expect(admission({ ...pending, connectionStatus: "disconnected" })).toBe(
      "signed_off",
    );
    expect(
      admission({ ...pending, lastAliveAt: ago(ALIVE_WINDOW_SECONDS + 1) }),
    ).toBe("offline");
    expect(
      admission({
        ...pending,
        lastRefusedRegistrationAt: ago(TAKEOVER_SECONDS - 1),
      }),
    ).toBeNull();
    expect(admission({ ...pending, lastAliveAt: ago(1) })).toBeNull();
  });

  test("getTakeoverRetryAfterSeconds: the rest of the window plus a second, between 1 and a whole window", () => {
    function retry(unansweredSecondsAgo: number): number {
      return ResourceAiAgentServiceClass.getTakeoverRetryAfterSeconds({
        unansweredSince: ago(unansweredSecondsAgo),
        now: NOW,
      });
    }

    expect(retry(0)).toBe(TAKEOVER_SECONDS + 1);
    expect(retry(10)).toBe(TAKEOVER_SECONDS - 10 + 1);
    expect(retry(TAKEOVER_SECONDS - 0.2)).toBe(2);
    expect(retry(TAKEOVER_SECONDS)).toBe(1);
    expect(retry(TAKEOVER_SECONDS + 3600)).toBe(1);
    // Another server's clock ahead of this one's cannot stretch the wait.
    expect(retry(-3600)).toBe(TAKEOVER_SECONDS + 1);
  });
});
