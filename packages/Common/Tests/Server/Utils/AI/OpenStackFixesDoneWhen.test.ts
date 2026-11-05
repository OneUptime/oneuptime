import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { parseConfig } from "../../../../../../agents/ResourceAIAgent/Config";
import OpenStackExecutor, {
  OpenStackHttpRequest,
} from "../../../../../../agents/ResourceAIAgent/Executors/OpenStackExecutor";
import {
  ExecResult,
  PrepareResult,
  PreparedCommand,
} from "../../../../../../agents/ResourceAIAgent/Executors/ResourceExecutor";
import { FakeOpenStack } from "../../../../../../agents/ResourceAIAgent/Tests/Helpers/FakeOpenStack";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import ResourceAiAgentService from "../../../../Server/Services/ResourceAiAgentService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import AiCommandKillSwitch from "../../../../Server/Utils/AI/AiCommandKillSwitch";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import RemediationCommandToolkit, {
  RemediationCommandNeedingApproval,
  RemediationCommandMode,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import ResourceCommandJobRunner, {
  ResourceCommandJobOutcome,
} from "../../../../Server/Utils/AI/ResourceAccess/ResourceCommandJobRunner";
import logger from "../../../../Server/Utils/Logger";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
  ResourceCommandJobPayload,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import { OpenStackChangeReach } from "../../../../Utils/AiRemediation/Resource/OpenStackChangeReach";

/*
 * THE ISSUE'S "DONE WHEN", ON RECORDINGS OF A REAL CLOUD.
 *
 * OneUptime AI's real toolkit, the real enqueue chokepoint and the agent's real policy and
 * executor, in a row, over answers a real DevStack gave with a real disabled nova-compute and
 * a real stopped one (FakeOpenStack, scenes compute-disabled and compute-down). What is not
 * real here is the model, whose tool calls are written out, the database, and what a change's
 * own call answers. Tests/Ops/openstack-e2e/ai-agent-record.sh does the same on a live cloud.
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
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const CLOUD: string = "prod-eu";
const HOST: string = "compute-01";
const RUNNING: string = "358ee736-ba74-40ba-a354-7ead413c5df6";
const STOPPED: string = "4d955c70-df91-45ae-be57-044f4bcaefec";
const RESEARCH: string = "b7d9b739-9ad0-44e5-ad61-cdbfad9ea127";
const ENABLE: string = `openstack compute service set --enable ${HOST} nova-compute`;
const EVACUATE: string = `openstack server evacuate ${RUNNING} ${STOPPED} ${RESEARCH}`;

let tmpDir: string;
let cloudsFile: string;
let cloud: FakeOpenStack;
let executor: OpenStackExecutor;

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ONEUPTIME_URL: "https://oneuptime.example.com",
    ONEUPTIME_API_KEY: "key",
    ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "openstack",
    OPENSTACK_CLOUD_NAME: CLOUD,
    OS_CLIENT_CONFIG_FILE: cloudsFile,
    ONEUPTIME_AI_ALLOW_WRITES: "true",
    ONEUPTIME_AI_FIXES: "ask-for-approval",
    ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID: "writeid",
    ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET: "write-secret",
    ...extra,
  };
}

function useCloud(scene: string, extra: Record<string, string> = {}): void {
  const environment: NodeJS.ProcessEnv = env(extra);

  cloud = new FakeOpenStack({ scene });
  executor = new OpenStackExecutor(
    {
      config: parseConfig(environment).config,
      env: environment,
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
}

function agentRow(): ResourceAiAgent {
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
      allowWrites: true,
      writeTargets: [],
      protectedTargets: [],
      reachable: true,
    },
  } as unknown as ResourceAiAgent;
}

function status(mode: ResourceAiRemediationMode): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.OpenStackCloud,
    resourceId: RESOURCE_ID.toString(),
    resourceName: CLOUD,
    isAiInvestigationEnabled: true,
    aiRemediationMode: mode,
    aiCommandAllowlist: [EVACUATE, ENABLE],
    agent: {
      agentId: AGENT_ID.toString(),
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType: AiResourceType.OpenStackCloud,
        resourceIdentifier: CLOUD,
        allowWrites: true,
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

function toolkitFor(
  mode: RemediationCommandMode,
  remediationMode: ResourceAiRemediationMode,
): RemediationCommandToolkit {
  jest
    .spyOn(ResourceAiAccessService, "getStatusForResource")
    .mockResolvedValue(status(remediationMode));

  return new RemediationCommandToolkit({
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    suggestionId: SUGGESTION_ID,
    mode,
    allowlistPatterns: [],
    allowedRunnerIds: [],
    clusterTargets: [],
    resourceTargets: [status(remediationMode)],
    proposesRefusedCommands: true,
    resourceHold: { anyOrder: false },
  });
}

function callTool(
  toolkit: RemediationCommandToolkit,
  name: string,
  args: JSONObject,
): Promise<ToolCallOutcome> {
  const tool: { execute: (args: JSONObject) => Promise<ToolCallOutcome> } =
    toolkit.buildTools().find((candidate: { definition: { name: string } }) => {
      return candidate.definition.name === name;
    }) as never;

  return tool.execute(args);
}

function commandArgs(command: string): JSONObject {
  return {
    stepType: "ResourceCommand",
    resourceId: RESOURCE_ID.toString(),
    command,
    rationale: "what an investigation found",
    expectedEffect: "the cloud recovers",
  } as JSONObject;
}

// A job the chokepoint let through, handed to the agent the way the job loop does.
async function runOnAgent(job: RunnerJob): Promise<ExecResult> {
  const prepared: PrepareResult = executor.prepare({
    payload: job.payload as unknown as Record<string, unknown>,
    origin: job.origin as string,
    timeoutInMs: 60_000,
    agentResourceId: RESOURCE_ID.toString(),
  });

  if (prepared.refusal !== null) {
    return { success: false, output: "", errorMessage: prepared.refusal };
  }

  return (prepared as PreparedCommand).run();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openstack-done-when-"));
  cloudsFile = path.join(tmpDir, "clouds.yaml");
  fs.writeFileSync(
    cloudsFile,
    `clouds:
  "RegionOne":
    region_name: "RegionOne"
    auth:
      auth_url: "https://openstack.example/identity/v3"
      application_credential_id: "readid"
      application_credential_secret: "read-secret"
`,
  );

  jest.spyOn(AiCommandKillSwitch, "isAiOff").mockResolvedValue(false);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue({
      id: SUGGESTION_ID,
      _id: SUGGESTION_ID.toString(),
      status: AutoRemediationSuggestionStatus.Planning,
    } as unknown as AutoRemediationSuggestion);
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
    .mockResolvedValue([]);
  jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
    _id: RUN_ID.toString(),
  } as never);
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ id: "lock" } as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(ResourceAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  jest.spyOn(OpenStackCloudService, "findBy").mockResolvedValue([
    {
      _id: RESOURCE_ID.toString(),
      id: RESOURCE_ID,
      projectId: PROJECT_ID,
      name: CLOUD,
      isAiInvestigationEnabled: true,
      aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      aiCommandAllowlist: [],
    },
  ] as never);
  jest
    .spyOn(ResourceAiAgentService, "findOnlineAgentForResource")
    .mockResolvedValue(agentRow());
  jest.spyOn(RunnerJobService, "create").mockImplementation((async (data: {
    data: RunnerJob;
  }) => {
    data.data.id = JOB_ID;

    return data.data;
  }) as never);

  /*
   * The bridge the job loop and the agent's report are in real life: a read the toolkit
   * asks for goes through the real chokepoint, and then to the real agent.
   */
  jest.spyOn(ResourceCommandJobRunner, "run").mockImplementation((async (data: {
    aiRunId: ObjectID;
    origin: RunnerJobOrigin.AiInvestigation;
    resourceId: ObjectID;
    command: string;
    stepId: string;
    timeoutInMs: number;
    targetResourceAiAgentId: ObjectID;
  }): Promise<ResourceCommandJobOutcome> => {
    const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand({
      projectId: PROJECT_ID,
      aiRunId: data.aiRunId,
      origin: data.origin,
      resourceType: AiResourceType.OpenStackCloud,
      resourceId: data.resourceId,
      stepId: data.stepId,
      targetResourceAiAgentId: data.targetResourceAiAgentId,
      command: data.command,
      timeoutInMs: data.timeoutInMs,
    });
    const result: ExecResult = await runOnAgent(job);

    return {
      jobId: JOB_ID.toString(),
      succeeded: result.success,
      output: result.output,
      errorMessage: result.errorMessage || undefined,
      displayCommand: data.command,
    };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("a disabled compute service is proposed for re-enabling, and done on approval", () => {
  test("the proposal says what it read, and changes nothing", async () => {
    useCloud("compute-disabled");

    const toolkit: RemediationCommandToolkit = toolkitFor(
      "Suggest",
      ResourceAiRemediationMode.RequireApproval,
    );
    const outcome: ToolCallOutcome = await callTool(
      toolkit,
      "propose_remediation_commands",
      { commands: [commandArgs(ENABLE)] } as JSONObject,
    );

    expect(outcome.success).toBe(true);
    expect(cloud.changes()).toEqual([]);

    const plan: AiRemediationCommandPlan =
      toolkit.getProposedPlan() as AiRemediationCommandPlan;
    const command: AiRemediationCommand = plan.commands[0]!;

    expect(command.command).toBe(ENABLE);
    expect(command.resourceCommandTier).toBe(ResourceCommandTier.SafeWrite);
    expect(command.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );

    const reach: OpenStackChangeReach = command.reach as OpenStackChangeReach;

    expect(reach.kind).toBe("on-host");
    expect(reach.hosts[0]).toEqual({
      name: HOST,
      state: "up",
      status: "disabled",
      forcedDown: false,
      disabledReason: "OneUptime drill: planned maintenance",
    });
    expect(reach.wouldBeRefused).toBeNull();
    // The instances the recorded cloud holds there, with their real names and projects.
    expect(reach.instanceCount).toBe(3);
    expect(reach.projectCount).toBe(2);
    expect(
      reach.instances
        .map((row: { name: string | null }) => {
          return row.name;
        })
        .sort(),
    ).toEqual(["ou-research-1", "ou-running", "ou-stopped"]);
    expect(
      reach.projects.map((row: { name: string | null }) => {
        return row.name;
      }),
    ).toEqual(["ou-payments", "ou-research"]);

    // What the plan keeps survives being stored and read back.
    expect(
      AiRemediationCommandPlanUtil.parse(
        AiRemediationCommandPlanUtil.toJSON(plan),
      )?.commands[0]?.reach,
    ).toEqual(reach);
  });

  test("approved, it is one PUT with the write credential's token, through the real three", async () => {
    useCloud("compute-disabled");

    // What CommandPlanExecutor does with a plan a person approved.
    const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      origin: RunnerJobOrigin.AiRemediation,
      autoRemediationSuggestionId: SUGGESTION_ID,
      resourceType: AiResourceType.OpenStackCloud,
      resourceId: RESOURCE_ID,
      stepId: "ai-approved-1",
      targetResourceAiAgentId: AGENT_ID,
      command: ENABLE,
      timeoutInMs: 60_000,
    });
    const payload: ResourceCommandJobPayload =
      job.payload as unknown as ResourceCommandJobPayload;

    expect(payload.tier).toBe(ResourceCommandTier.SafeWrite);

    const result: ExecResult = await runOnAgent(job);

    expect(result.success).toBe(true);
    expect(cloud.changes().length).toBe(1);

    const put: OpenStackHttpRequest = cloud.changes()[0]!;

    expect(put.method).toBe("PUT");
    expect(new URL(put.url).pathname).toBe("/compute/v2.1/os-services/enable");
    expect(JSON.parse(put.body as string)).toEqual({
      host: HOST,
      binary: "nova-compute",
    });
    expect(put.headers["OpenStack-API-Version"]).toBe("compute 2.52");
  });

  test("on Automatic it is a safe change, and runs without asking", async () => {
    useCloud("compute-disabled");

    jest.spyOn(RunnerJobService, "enqueueAiResourceCommand");
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockImplementation((async () => {
        return {
          id: JOB_ID,
          _id: JOB_ID.toString(),
          status: "Succeeded",
          exitCode: 0,
          output: "ok",
          payload: { displayCommand: ENABLE, program: "openstack" },
        };
      }) as never);
    jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue({
      id: JOB_ID,
      claimedAt: new Date(),
      startedAt: new Date(),
    } as unknown as RunnerJob);

    const toolkit: RemediationCommandToolkit = toolkitFor(
      "FullAuto",
      ResourceAiRemediationMode.Automatic,
    );

    await callTool(toolkit, "execute_remediation_command", commandArgs(ENABLE));

    expect(toolkit.getExecutedCommands().length).toBe(1);
    expect(toolkit.getCommandsNeedingApproval()).toEqual([]);
  });

  test("with writes off at the agent, the same approval changes nothing", async () => {
    useCloud("compute-disabled", { ONEUPTIME_AI_ALLOW_WRITES: "false" });

    const prepared: PrepareResult = executor.prepare({
      payload: {
        resourceType: AiResourceType.OpenStackCloud,
        resourceId: RESOURCE_ID.toString(),
        resourceIdentifier: CLOUD,
        program: "openstack",
        args: ENABLE.split(" ").slice(1),
        tier: ResourceCommandTier.SafeWrite,
      },
      origin: "AiRemediation",
      timeoutInMs: 60_000,
      agentResourceId: RESOURCE_ID.toString(),
    });

    expect(prepared.refusal).toMatch(/read-only/);
    expect(cloud.requests.length).toBe(0);
  });
});

describe("a dead hypervisor's evacuation proposal lists what it touches, and asks in every mode", () => {
  function expectFullReach(reach: OpenStackChangeReach): void {
    expect(reach.route).toBe("server evacuate");
    expect(reach.kind).toBe("changes");
    expect(reach.instanceCount).toBe(3);
    expect(reach.projectCount).toBe(2);
    expect(
      reach.instances.map((row: { name: string | null }) => {
        return row.name;
      }),
    ).toEqual(["ou-running", "ou-stopped", "ou-research-1"]);
    expect(
      reach.projects.map(
        (row: { name: string | null; instanceCount: number }) => {
          return [row.name, row.instanceCount];
        },
      ),
    ).toEqual([
      ["ou-payments", 2],
      ["ou-research", 1],
    ]);
    expect(reach.hosts[0]?.state).toBe("down");
    expect(reach.wouldBeRefused).toBeNull();
    expect(reach.isComplete).toBe(true);
  }

  test("proposed, it lists its real instances and projects, and sends nothing", async () => {
    useCloud("compute-down");

    const toolkit: RemediationCommandToolkit = toolkitFor(
      "Suggest",
      ResourceAiRemediationMode.RequireApproval,
    );
    const outcome: ToolCallOutcome = await callTool(
      toolkit,
      "propose_remediation_commands",
      { commands: [commandArgs(EVACUATE)] } as JSONObject,
    );

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain(
      "This changes 3 instances in 2 projects.",
    );
    expect(cloud.changes()).toEqual([]);
    expectFullReach(
      toolkit.getProposedPlan()?.commands[0]?.reach as OpenStackChangeReach,
    );
  });

  test.each([
    ["Automatic", ResourceAiRemediationMode.Automatic],
    ["Bypass approval", ResourceAiRemediationMode.BypassApproval],
  ])(
    "on %s, with the command on the allowlist too, it does not run: it is kept for a person",
    async (_name: string, mode: ResourceAiRemediationMode) => {
      useCloud("compute-down");

      const toolkit: RemediationCommandToolkit = toolkitFor("FullAuto", mode);
      const enqueue: jest.SpiedFunction<
        typeof RunnerJobService.enqueueAiResourceCommand
      > = jest.spyOn(RunnerJobService, "enqueueAiResourceCommand");
      const outcome: ToolCallOutcome = await callTool(
        toolkit,
        "execute_remediation_command",
        commandArgs(EVACUATE),
      );

      expect(outcome.success).toBe(false);
      expect(outcome.textForLlm).toMatch(/always needs a human, in every mode/);
      expect(toolkit.getExecutedCommands()).toEqual([]);
      expect(cloud.changes()).toEqual([]);

      // Only the read of what it touches was ever enqueued.
      for (const call of enqueue.mock.calls) {
        expect((call[0] as { command: string }).command).toContain(
          "openstack dry-run ",
        );
      }

      const kept: Array<RemediationCommandNeedingApproval> =
        toolkit.getCommandsNeedingApproval();

      expect(kept.length).toBe(1);
      expect(kept[0]?.reason).toMatch(/always needs a human/);
      expectFullReach(kept[0]?.command.reach as OpenStackChangeReach);
    },
  );

  test("it says what it leaves behind on that host", async () => {
    useCloud("compute-down");

    const toolkit: RemediationCommandToolkit = toolkitFor(
      "Suggest",
      ResourceAiRemediationMode.RequireApproval,
    );

    await callTool(toolkit, "propose_remediation_commands", {
      commands: [commandArgs(`openstack server evacuate ${RUNNING}`)],
    } as JSONObject);

    const reach: OpenStackChangeReach = toolkit.getProposedPlan()?.commands[0]
      ?.reach as OpenStackChangeReach;

    expect(reach.instanceCount).toBe(1);
    expect(reach.leftBehindCount).toBe(2);
    expect(
      reach.leftBehind
        .map((row: { name: string | null }) => {
          return row.name;
        })
        .sort(),
    ).toEqual(["ou-research-1", "ou-stopped"]);
  });

  test("an evacuation of a host that is alive is never proposed", async () => {
    useCloud("healthy");

    const toolkit: RemediationCommandToolkit = toolkitFor(
      "Suggest",
      ResourceAiRemediationMode.RequireApproval,
    );
    const outcome: ToolCallOutcome = await callTool(
      toolkit,
      "propose_remediation_commands",
      { commands: [commandArgs(EVACUATE)] } as JSONObject,
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toMatch(/nova-compute on compute-01 reads up/);
    expect(toolkit.getProposedPlan()).toBeNull();
    expect(cloud.changes()).toEqual([]);
  });

  test("one the agent cannot read in full is never proposed", async () => {
    useCloud("compute-down");

    const toolkit: RemediationCommandToolkit = toolkitFor(
      "Suggest",
      ResourceAiRemediationMode.RequireApproval,
    );
    const outcome: ToolCallOutcome = await callTool(
      toolkit,
      "propose_remediation_commands",
      {
        commands: [
          commandArgs(
            `openstack server evacuate ${RUNNING} 00000000-0000-4000-8000-000000000000`,
          ),
        ],
      } as JSONObject,
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toMatch(/could not read them all/);
    expect(toolkit.getProposedPlan()).toBeNull();
  });

  test("one with no agent to ask is never proposed either", async () => {
    useCloud("compute-down");

    jest
      .spyOn(ResourceCommandJobRunner, "run")
      .mockRejectedValue(new Error("no online agent"));

    const toolkit: RemediationCommandToolkit = toolkitFor(
      "Suggest",
      ResourceAiRemediationMode.RequireApproval,
    );
    const outcome: ToolCallOutcome = await callTool(
      toolkit,
      "propose_remediation_commands",
      { commands: [commandArgs(EVACUATE)] } as JSONObject,
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("no online agent");
  });

  test("approved, each instance is its own call, and none before", async () => {
    useCloud("compute-down");

    const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      origin: RunnerJobOrigin.AiRemediation,
      autoRemediationSuggestionId: SUGGESTION_ID,
      resourceType: AiResourceType.OpenStackCloud,
      resourceId: RESOURCE_ID,
      stepId: "ai-approved-1",
      targetResourceAiAgentId: AGENT_ID,
      command: EVACUATE,
      timeoutInMs: 60_000,
    });

    expect(cloud.changes()).toEqual([]);

    const result: ExecResult = await runOnAgent(job);

    expect(result.success).toBe(true);
    expect(
      cloud.changes().map((sent: OpenStackHttpRequest) => {
        return new URL(sent.url).pathname;
      }),
    ).toEqual([
      `/compute/v2.1/servers/${RUNNING}/action`,
      `/compute/v2.1/servers/${STOPPED}/action`,
      `/compute/v2.1/servers/${RESEARCH}/action`,
    ]);
  });
});

describe("protected targets win over every other setting, from the proposal on", () => {
  test("a protected project is not proposed, whatever the mode or the allowlist", async () => {
    const project: string = new FakeOpenStack({ scene: "compute-disabled" })
      .readRows("nova-servers", "servers")
      .find((row: Record<string, unknown>): boolean => {
        return row["id"] === RUNNING;
      })?.["tenant_id"] as string;

    useCloud("compute-down", {
      ONEUPTIME_AI_PROTECTED_TARGETS: `project:${project}`,
    });

    const toolkit: RemediationCommandToolkit = toolkitFor(
      "FullAuto",
      ResourceAiRemediationMode.BypassApproval,
    );
    const outcome: ToolCallOutcome = await callTool(
      toolkit,
      "execute_remediation_command",
      commandArgs(`openstack server reboot --hard ${RUNNING}`),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toMatch(/wins over every other setting/);
    expect(toolkit.getExecutedCommands()).toEqual([]);
    expect(toolkit.getCommandsNeedingApproval()).toEqual([]);
    expect(cloud.changes()).toEqual([]);
  });
});
