import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { parseConfig } from "../../../../../../agents/ResourceAIAgent/Config";
import OpenStackExecutor, {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../../../../agents/ResourceAIAgent/Executors/OpenStackExecutor";
import { DEFAULT_GUARD_POLICY } from "../../../../../../agents/ResourceAIAgent/Executors/PrepareGuard";
import {
  ExecResult,
  PrepareResult,
  PreparedCommand,
} from "../../../../../../agents/ResourceAIAgent/Executors/ResourceExecutor";
import { GuardPolicy } from "../../../../../../agents/ResourceAIAgent/Executors/ResourceExecutor";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import ResourceAiAgentService from "../../../../Server/Services/ResourceAiAgentService";
import RunnerJobService, {
  ResourceCommandEnqueueRefusedException,
} from "../../../../Server/Services/RunnerJobService";
import AiCommandKillSwitch from "../../../../Server/Utils/AI/AiCommandKillSwitch";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import RemediationCommandToolkit from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import ResourceCommandJobRunner from "../../../../Server/Utils/AI/ResourceAccess/ResourceCommandJobRunner";
import logger from "../../../../Server/Utils/Logger";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import {
  buildOpenStackChangeReach,
  renderOpenStackChangeReach,
} from "../../../../Utils/AiRemediation/Resource/OpenStackChangeReach";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";

/*
 * WITH WRITES OFF, NOTHING RUNS, AND THREE THINGS EACH SAY SO.
 *
 * OneUptime AI's tool, the enqueue chokepoint and the agent each refuse a change on an
 * agent that has not been let write, and none of them leans on another. This runs the
 * real three in a row, with a cloud behind them that records what reaches it, and then
 * breaks them in turn. With any one broken the other two still refuse. With any two
 * broken the last still does. With all three broken the change reaches the cloud, which
 * is what shows this suite can see a leak: if it could not, every line above it would
 * pass for nothing. The break is that point's own check answering yes, so each row also
 * proves that this test fails when that check is gone.
 *
 * The agent here is the real agent's code, with its own copy of the policy, so breaking
 * the server's copy cannot break the agent's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const AGENT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const CLOUD: string = "prod-eu";
const SERVER: string = "358ee736-ba74-40ba-a354-7ead413c5df6";
const OTHER: string = "4d955c70-df91-45ae-be57-044f4bcaefec";
const AGENT: string = "d7e6c5b4-a392-4180-b6f5-e4d3c2b1a098";
const WRITE_ID: string = "a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5";

const CHANGES: ReadonlyArray<string> = [
  `openstack server start ${SERVER}`,
  `openstack server reboot --soft ${SERVER}`,
  `openstack server reboot --hard ${SERVER}`,
  `openstack server migrate ${SERVER} --host compute-02`,
  `openstack server migrate live ${SERVER} --host compute-02`,
  `openstack server evacuate ${SERVER} ${OTHER} --host compute-02`,
  "openstack compute service set --enable compute-01 nova-compute",
  "openstack compute service set --disable --disable-reason maintenance compute-01 nova-compute",
  `openstack network agent set --enable ${AGENT}`,
  `openstack network agent set --disable ${AGENT}`,
];

type Point = "tool" | "chokepoint" | "agent";

const POINTS: ReadonlyArray<Point> = ["tool", "chokepoint", "agent"];

let tmpDir: string;
let cloudsFile: string;

function offAgentRow(): ResourceAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    resourceType: AiResourceType.OpenStackCloud,
    resourceId: RESOURCE_ID,
    resourceIdentifier: CLOUD,
    connectionStatus: "connected",
    lastAliveAt: new Date(),
    posture: {
      resourceType: AiResourceType.OpenStackCloud,
      resourceIdentifier: CLOUD,
      // Writes off: the one fact all three points are held to.
      allowWrites: false,
      writeTargets: [],
      protectedTargets: [],
      reachable: true,
    },
  } as unknown as ResourceAiAgent;
}

// The cloud as the run sees it: the worst setting there is, and an agent that says no.
function offStatus(): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.OpenStackCloud,
    resourceId: RESOURCE_ID.toString(),
    resourceName: CLOUD,
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
    aiCommandAllowlist: CHANGES.slice(),
    agent: {
      agentId: AGENT_ID.toString(),
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType: AiResourceType.OpenStackCloud,
        resourceIdentifier: CLOUD,
        allowWrites: false,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
      },
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  } as unknown as ResourceAiAccessStatus;
}

interface Cloud {
  changes: Array<OpenStackHttpRequest>;
  send: (request: OpenStackHttpRequest) => Promise<OpenStackHttpResponse>;
}

function makeCloud(): Cloud {
  const changes: Array<OpenStackHttpRequest> = [];
  const reply: (
    body: unknown,
    statusCode?: number,
    headers?: Record<string, string>,
  ) => OpenStackHttpResponse = (
    body: unknown,
    statusCode: number = 200,
    headers: Record<string, string> = {},
  ): OpenStackHttpResponse => {
    return {
      statusCode,
      statusMessage: "",
      headers,
      body: JSON.stringify(body),
      truncated: false,
    };
  };

  return {
    changes,
    send: async (
      request: OpenStackHttpRequest,
    ): Promise<OpenStackHttpResponse> => {
      if (request.url.endsWith("/auth/tokens")) {
        return reply(
          {
            token: {
              expires_at: "2099-01-01T00:00:00.000000Z",
              catalog: [
                {
                  type: "compute",
                  endpoints: [
                    {
                      interface: "public",
                      region_id: "RegionOne",
                      url: "https://cloud.example/compute/v2.1",
                    },
                  ],
                },
                {
                  type: "network",
                  endpoints: [
                    {
                      interface: "public",
                      region_id: "RegionOne",
                      url: "https://cloud.example/network",
                    },
                  ],
                },
              ],
            },
          },
          201,
          {
            "x-subject-token": (request.body || "").includes(WRITE_ID)
              ? "write-token"
              : "read-token",
          },
        );
      }

      if (request.method !== "GET") {
        changes.push(request);
        return reply({}, 202);
      }

      if (request.url.includes("/agents/")) {
        return reply({ agent: { id: AGENT, host: "net-01", binary: "b" } });
      }

      if (request.url.includes("/servers/")) {
        return reply({
          server: {
            id: request.url.includes(OTHER) ? OTHER : SERVER,
            tenant_id: "9aee824cac87464292adffc328de1662",
            "OS-EXT-SRV-ATTR:host": "compute-01",
          },
        });
      }

      return reply({ versions: [] });
    },
  };
}

// The agent, as it runs: its own settings, from its own environment.
function agentEnv(): NodeJS.ProcessEnv {
  return {
    ONEUPTIME_URL: "https://oneuptime.example.com",
    ONEUPTIME_API_KEY: "key",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "openstack",
    OPENSTACK_CLOUD_NAME: CLOUD,
    OS_CLIENT_CONFIG_FILE: cloudsFile,
    /*
     * Everything else lined up. A credential for changes is there, and the mode is
     * named: the write switch is the one thing missing.
     */
    ONEUPTIME_AI_FIXES: "bypass-approval",
    ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID: WRITE_ID,
    ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET: "write-secret",
  };
}

// Every word is checked: the job's payload is what the chokepoint would have sent.
function payloadOf(command: string, tier?: string): JSONObject {
  const words: Array<string> = command.match(/"[^"]*"|\S+/g) as Array<string>;
  const argv: Array<string> = words.map((word: string): string => {
    return word.split('"').join("");
  });

  return {
    resourceType: AiResourceType.OpenStackCloud,
    resourceId: RESOURCE_ID.toString(),
    resourceIdentifier: CLOUD,
    program: argv[0] as string,
    args: argv.slice(1),
    displayCommand: command,
    tier:
      tier ||
      ResourceCommandPolicy.evaluateCommand({
        resourceType: AiResourceType.OpenStackCloud,
        command,
      }).tier,
  };
}

interface Run {
  refusedBy: Array<Point>;
  reachedCloud: boolean;
}

/*
 * One command, through each point in turn. A point's own refusal is recorded and the
 * run goes on, so a row says everything that would have stopped it. A broken point is
 * that point's own check answering yes, for as long as that point is asked.
 */
async function askFor(
  command: string,
  broken: ReadonlyArray<Point>,
): Promise<Run> {
  const refusedBy: Array<Point> = [];

  // ---- The tool.
  const tool: jest.SpiedFunction<
    typeof RemediationCommandToolkit.getResourceWriteScopeRefusal
  > | null = broken.includes("tool")
    ? jest
        .spyOn(RemediationCommandToolkit, "getResourceWriteScopeRefusal")
        .mockReturnValue(null)
    : null;
  const toolkit: RemediationCommandToolkit = new RemediationCommandToolkit({
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    suggestionId: SUGGESTION_ID,
    mode: "Suggest",
    allowlistPatterns: [],
    allowedRunnerIds: [],
    clusterTargets: [],
    resourceTargets: [offStatus()],
    proposesRefusedCommands: true,
    resourceHold: { anyOrder: false },
  });
  const propose: ToolCallOutcome | undefined = await toolkit
    .buildTools()
    .find((candidate: { definition: { name: string } }) => {
      return candidate.definition.name === "propose_remediation_commands";
    })
    ?.execute({
      commands: [
        {
          stepType: "ResourceCommand",
          resourceId: RESOURCE_ID.toString(),
          command,
          rationale: "asked to",
          expectedEffect: "it runs",
        },
      ],
    } as JSONObject);

  if (propose?.success === false && toolkit.getProposedPlan() === null) {
    refusedBy.push("tool");
  }

  tool?.mockRestore();

  // ---- The chokepoint.
  const chokepoint: jest.SpiedFunction<
    typeof ResourceCommandPolicy.getWriteScopeRefusal
  > | null = broken.includes("chokepoint")
    ? jest
        .spyOn(ResourceCommandPolicy, "getWriteScopeRefusal")
        .mockReturnValue(null)
    : null;

  try {
    await RunnerJobService.enqueueAiResourceCommand({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      origin: RunnerJobOrigin.AiRemediation,
      autoRemediationSuggestionId: SUGGESTION_ID,
      resourceType: AiResourceType.OpenStackCloud,
      resourceId: RESOURCE_ID,
      stepId: "ai-approved-1",
      command,
      timeoutInMs: 60_000,
    });
  } catch (error: unknown) {
    if (!(error instanceof ResourceCommandEnqueueRefusedException)) {
      throw error;
    }

    expect(error.refusalCode).toBe("write_scope");
    refusedBy.push("chokepoint");
  }

  chokepoint?.mockRestore();

  // ---- The agent, with what the job would have carried, whoever let it through.
  const cloud: Cloud = makeCloud();
  const env: NodeJS.ProcessEnv = agentEnv();
  const parsed: ReturnType<typeof parseConfig> = parseConfig(env);

  expect(parsed.config.allowWrites).toBe(false);

  const brokenPolicy: GuardPolicy = {
    evaluateArgv: DEFAULT_GUARD_POLICY.evaluateArgv,
    getWriteScopeRefusal: (): string | null => {
      return null;
    },
  };
  const executor: OpenStackExecutor = new OpenStackExecutor(
    {
      config: broken.includes("agent")
        ? { ...parsed.config, allowWrites: true }
        : parsed.config,
      env,
      tmpDir,
      logger: {
        info: (): void => {},
        warn: (): void => {},
        error: (): void => {},
        debug: (): void => {},
      },
      ...(broken.includes("agent") ? { guardPolicy: brokenPolicy } : {}),
    } as never,
    { transport: cloud.send },
  );
  const prepared: PrepareResult = executor.prepare({
    payload: payloadOf(command),
    origin: "AiRemediation",
    timeoutInMs: 60_000,
    agentResourceId: RESOURCE_ID.toString(),
  });

  if (prepared.refusal !== null) {
    refusedBy.push("agent");
  } else if (refusedBy.length === 0) {
    // Only what got past the first two is ever a job the agent is handed.
    const result: ExecResult = await (prepared as PreparedCommand).run();

    expect(result.success).toBe(true);
  }

  return { refusedBy, reachedCloud: cloud.changes.length > 0 };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openstack-three-points-"));
  cloudsFile = path.join(tmpDir, "clouds.yaml");
  fs.writeFileSync(
    cloudsFile,
    `clouds:
  "RegionOne":
    region_name: "RegionOne"
    auth:
      auth_url: "https://cloud.example/identity/v3"
      application_credential_id: "readid"
      application_credential_secret: "read-secret"
`,
  );

  jest.spyOn(AiCommandKillSwitch, "isAiOff").mockResolvedValue(false);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
    _id: RUN_ID.toString(),
  } as never);
  jest.spyOn(RunnerJobService, "create").mockImplementation((async (data: {
    data: RunnerJob;
  }) => {
    return data.data;
  }) as never);
  jest.spyOn(OpenStackCloudService, "findBy").mockResolvedValue([
    {
      _id: RESOURCE_ID.toString(),
      id: RESOURCE_ID,
      projectId: PROJECT_ID,
      name: CLOUD,
      isAiInvestigationEnabled: true,
      aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
      aiCommandAllowlist: [],
    },
  ] as never);
  jest
    .spyOn(ResourceAiAgentService, "findOnlineAgentForResource")
    .mockResolvedValue(offAgentRow());
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneBy")
    .mockResolvedValue(null);
  // A tool let through goes on to read what the change touches, which reads fine.
  jest.spyOn(ResourceCommandJobRunner, "run").mockResolvedValue({
    jobId: "j",
    succeeded: true,
    output: renderOpenStackChangeReach(
      buildOpenStackChangeReach({
        route: "server evacuate",
        kind: "changes",
        instances: [],
        projectNames: new Map<string, string>(),
        hosts: [],
        leftBehind: [],
        isComplete: true,
        problems: [],
        wouldBeRefused: null,
      }),
    ),
    displayCommand: "",
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ROWS: Array<[string]> = CHANGES.map((command: string): [string] => {
  return [command];
});

describe("nothing is broken", () => {
  test.each(ROWS)("all three refuse %s", async (command: string) => {
    const run: Run = await askFor(command, []);

    expect(run.refusedBy).toEqual(["tool", "chokepoint", "agent"]);
    expect(run.reachedCloud).toBe(false);
  });
});

describe.each(POINTS)("the %s is broken", (point: Point) => {
  test.each(ROWS)("the other two refuse %s", async (command: string) => {
    const run: Run = await askFor(command, [point]);

    // That the point no longer refuses is what would fail this suite without the break.
    expect(run.refusedBy).toEqual(
      POINTS.filter((other: Point): boolean => {
        return other !== point;
      }),
    );
    expect(run.reachedCloud).toBe(false);
  });
});

describe.each(POINTS)("only the %s still stands", (standing: Point) => {
  test.each(ROWS)("it refuses %s on its own", async (command: string) => {
    const run: Run = await askFor(
      command,
      POINTS.filter((other: Point): boolean => {
        return other !== standing;
      }),
    );

    expect(run.refusedBy).toEqual([standing]);
    expect(run.reachedCloud).toBe(false);
  });
});

describe("all three are broken", () => {
  test.each(ROWS)(
    "%s reaches the cloud, which is how this suite knows it would see a leak",
    async (command: string) => {
      const run: Run = await askFor(command, ["tool", "chokepoint", "agent"]);

      expect(run.refusedBy).toEqual([]);
      expect(run.reachedCloud).toBe(true);
    },
  );
});

describe("however it is asked", () => {
  test.each(ROWS)(
    "%s, with a job that claims any tier: the agent refuses it",
    (command: string) => {
      for (const tier of [
        ResourceCommandTier.Read,
        ResourceCommandTier.SafeWrite,
        ResourceCommandTier.RiskyWrite,
      ]) {
        const cloud: Cloud = makeCloud();
        const env: NodeJS.ProcessEnv = agentEnv();
        const executor: OpenStackExecutor = new OpenStackExecutor(
          {
            config: parseConfig(env).config,
            env,
            tmpDir,
            logger: {
              info: (): void => {},
              warn: (): void => {},
              error: (): void => {},
              debug: (): void => {},
            },
          } as never,
          { transport: cloud.send },
        );

        for (const origin of ["AiRemediation", "AiInvestigation"]) {
          expect(
            executor.prepare({
              payload: payloadOf(command, tier),
              origin,
              timeoutInMs: 60_000,
              agentResourceId: RESOURCE_ID.toString(),
            }).refusal,
          ).toBeTruthy();
        }

        expect(cloud.changes.length).toBe(0);
      }
    },
  );

  test.each(ROWS)(
    "%s, through an investigation's job: the chokepoint refuses it",
    async (command: string) => {
      await expect(
        RunnerJobService.enqueueAiResourceCommand({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
          origin: RunnerJobOrigin.AiInvestigation,
          resourceType: AiResourceType.OpenStackCloud,
          resourceId: RESOURCE_ID,
          stepId: "ai-1",
          command,
          timeoutInMs: 60_000,
        }),
      ).rejects.toThrow(/may only run read-only commands/);
    },
  );

  test("the write switch itself is what is missing: turning it on is enough for the agent to run one", async () => {
    const env: NodeJS.ProcessEnv = {
      ...agentEnv(),
      ONEUPTIME_AI_ALLOW_WRITES: "true",
    };
    const cloud: Cloud = makeCloud();
    const prepared: PrepareResult = new OpenStackExecutor(
      {
        config: parseConfig(env).config,
        env,
        tmpDir,
        logger: {
          info: (): void => {},
          warn: (): void => {},
          error: (): void => {},
          debug: (): void => {},
        },
      } as never,
      { transport: cloud.send },
    ).prepare({
      payload: payloadOf(`openstack server start ${SERVER}`),
      origin: "AiRemediation",
      timeoutInMs: 60_000,
      agentResourceId: RESOURCE_ID.toString(),
    });

    expect(prepared.refusal).toBeNull();
    await (prepared as PreparedCommand).run();
    expect(cloud.changes.length).toBe(1);
  });
});
