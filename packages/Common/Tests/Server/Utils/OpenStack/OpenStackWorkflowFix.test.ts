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
import OpenStackExecutor from "../../../../../../agents/ResourceAIAgent/Executors/OpenStackExecutor";
import {
  ExecResult,
  PrepareResult,
  PreparedCommand,
} from "../../../../../../agents/ResourceAIAgent/Executors/ResourceExecutor";
import { FakeOpenStack } from "../../../../../../agents/ResourceAIAgent/Tests/Helpers/FakeOpenStack";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertService from "../../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentService from "../../../../Server/Services/IncidentService";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import ResourceAiAgentService from "../../../../Server/Services/ResourceAiAgentService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import AiCommandKillSwitch from "../../../../Server/Utils/AI/AiCommandKillSwitch";
import RemediationExecutionRunner, {
  describeProposedPlanForFeed,
} from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import ResourceCommandJobRunner, {
  ResourceCommandJobOutcome,
} from "../../../../Server/Utils/AI/ResourceAccess/ResourceCommandJobRunner";
import logger from "../../../../Server/Utils/Logger";
import OpenStackWorkflowFix, {
  MAX_OPENSTACK_WORKFLOW_PROPOSALS_PER_PROJECT_PER_HOUR,
  OpenStackWorkflowFixInput,
  OpenStackWorkflowFixResult,
} from "../../../../Server/Utils/OpenStack/OpenStackWorkflowFix";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
  ResourceCommandJobPayload,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";

/*
 * A WORKFLOW'S PROPOSAL, THROUGH WHAT A PROPOSAL GOES THROUGH.
 *
 * The real toolkit, the real enqueue chokepoint and the agent's real policy and executor, over
 * answers a real DevStack gave (FakeOpenStack). What is not real here is the database. The
 * point of all of it is what never happens: a workflow's step makes no change, whatever the
 * cloud's mode says, and all it can do is put a card in front of a person.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLOUD_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_CLOUD_ID: ObjectID = new ObjectID(
  "34343434-3434-4343-8343-343434343434",
);
const AGENT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const ALERT_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const INCIDENT_ID: ObjectID = new ObjectID(
  "56565656-5656-4656-8656-565656565656",
);
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
const DISABLE: string = `openstack compute service set --disable --disable-reason "Reported down" ${HOST} nova-compute`;
const ENABLE: string = `openstack compute service set --enable ${HOST} nova-compute`;
const EVACUATE: string = `openstack server evacuate ${RUNNING} ${STOPPED} ${RESEARCH}`;

let tmpDir: string;
let cloudsFile: string;
let cloud: FakeOpenStack;
let executor: OpenStackExecutor;
let saved: Array<AutoRemediationSuggestion>;
let runs: Array<AIRun>;
let jobs: Array<RunnerJob>;
let announced: Array<AutoRemediationSuggestion>;

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

function posture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    resourceType: AiResourceType.OpenStackCloud,
    resourceIdentifier: CLOUD,
    allowWrites: true,
    writeTargets: [],
    protectedTargets: [],
    reachable: true,
    ...overrides,
  };
}

function agentRow(overrides: Record<string, unknown> = {}): ResourceAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    resourceType: AiResourceType.OpenStackCloud,
    resourceId: CLOUD_ID,
    resourceIdentifier: CLOUD,
    connectionStatus: "connected",
    lastAliveAt: new Date(),
    posture: posture(overrides),
  } as unknown as ResourceAiAgent;
}

function status(
  mode: ResourceAiRemediationMode = ResourceAiRemediationMode.RequireApproval,
  overrides: Partial<ResourceAiAccessStatus> = {},
  postureOverrides: Record<string, unknown> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.OpenStackCloud,
    resourceId: CLOUD_ID.toString(),
    resourceName: CLOUD,
    isAiInvestigationEnabled: true,
    aiRemediationMode: mode,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID.toString(),
      connectionStatus: "connected",
      isOnline: true,
      posture: posture(postureOverrides),
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
    ...overrides,
  } as unknown as ResourceAiAccessStatus;
}

function useStatus(value: ResourceAiAccessStatus | null): void {
  jest
    .spyOn(ResourceAiAccessService, "getStatusForResource")
    .mockResolvedValue(value);
}

function linkedTo(clouds: Array<ObjectID>): void {
  const rows: Array<LinkedAffectedResource> = clouds.map(
    (id: ObjectID): LinkedAffectedResource => {
      return {
        type: LinkedAffectedResourceType.OpenStackCloud,
        id: id.toString(),
        name: CLOUD,
      } as LinkedAffectedResource;
    },
  );

  jest.spyOn(LinkedAffectedResources, "readForAlert").mockResolvedValue(rows);
  jest
    .spyOn(LinkedAffectedResources, "readForIncident")
    .mockResolvedValue(rows);
}

function input(
  overrides: Partial<OpenStackWorkflowFixInput> = {},
): OpenStackWorkflowFixInput {
  return {
    projectId: PROJECT_ID,
    workflowName: "Page and propose",
    alertId: ALERT_ID,
    command: DISABLE,
    reason: "This host stopped reporting to Nova.",
    ...overrides,
  };
}

function refusalOf(result: OpenStackWorkflowFixResult): string {
  if (result.isProposed) {
    throw new Error("It proposed a fix, and should have refused.");
  }

  return result.refusal;
}

function theOnlyPlan(): AiRemediationCommandPlan {
  expect(saved).toHaveLength(1);

  return AiRemediationCommandPlanUtil.parse(
    saved[0]!.commandPlan,
  ) as AiRemediationCommandPlan;
}

// Nothing has been asked of the cloud that changes it, and no job asks for it.
function expectNoChange(): void {
  expect(cloud.changes()).toEqual([]);

  for (const job of jobs) {
    expect((job.payload as unknown as ResourceCommandJobPayload).tier).toBe(
      "Read",
    );
    expect(job.origin).toBe(RunnerJobOrigin.AiInvestigation);
  }
}

// A job the chokepoint let through, handed to the agent the way the job loop does.
async function runOnAgent(job: RunnerJob): Promise<ExecResult> {
  const prepared: PrepareResult = executor.prepare({
    payload: job.payload as unknown as Record<string, unknown>,
    origin: job.origin as string,
    timeoutInMs: 60_000,
    agentResourceId: CLOUD_ID.toString(),
  });

  if (prepared.refusal !== null) {
    return { success: false, output: "", errorMessage: prepared.refusal };
  }

  return (prepared as PreparedCommand).run();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openstack-workflow-fix-"));
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

  saved = [];
  runs = [];
  jobs = [];
  announced = [];

  useCloud("compute-disabled");
  useStatus(status());
  linkedTo([CLOUD_ID]);

  jest.spyOn(AiCommandKillSwitch, "isAiOff").mockResolvedValue(false);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest
    .spyOn(RemediationExecutionRunner, "checkProjectGates")
    .mockResolvedValue(null);
  jest
    .spyOn(RemediationExecutionRunner, "withTrackRecords")
    .mockImplementation((async (data: { plan: AiRemediationCommandPlan }) => {
      return data.plan;
    }) as never);
  jest
    .spyOn(RemediationExecutionRunner, "announceProposedPlan")
    .mockImplementation((async (data: {
      suggestion: AutoRemediationSuggestion;
    }) => {
      announced.push(data.suggestion);
    }) as never);
  jest.spyOn(AlertService, "findOneBy").mockResolvedValue({
    _id: ALERT_ID.toString(),
  } as never);
  jest.spyOn(IncidentService, "findOneBy").mockResolvedValue({
    _id: INCIDENT_ID.toString(),
  } as never);
  jest.spyOn(AIRunService, "create").mockImplementation((async (data: {
    data: AIRun;
  }) => {
    data.data.id = RUN_ID;
    runs.push(data.data);

    return data.data;
  }) as never);
  jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
    _id: RUN_ID.toString(),
  } as never);
  jest
    .spyOn(AIRunService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "create")
    .mockImplementation((async (data: { data: AutoRemediationSuggestion }) => {
      data.data.id = SUGGESTION_ID;
      saved.push(data.data);

      return data.data;
    }) as never);
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue(null);
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneBy")
    .mockResolvedValue(null);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
    .mockResolvedValue([]);
  jest.spyOn(OpenStackCloudService, "findBy").mockResolvedValue([
    {
      _id: CLOUD_ID.toString(),
      id: CLOUD_ID,
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
    jobs.push(data.data);

    return data.data;
  }) as never);
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

describe("what a workflow gets for asking", () => {
  test("one fix waiting for a person, about that alert, and nothing changed", async () => {
    const result: OpenStackWorkflowFixResult =
      await OpenStackWorkflowFix.propose(input({ command: ENABLE }));

    expect(result).toEqual({
      isProposed: true,
      suggestionId: SUGGESTION_ID,
      tierName: "Safe",
      wasAlreadyWaiting: false,
    });

    const suggestion: AutoRemediationSuggestion = saved[0]!;

    expect(saved).toHaveLength(1);
    expect(suggestion.status).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(suggestion.suggestionType).toBe(
      AutoRemediationSuggestionType.CommandPlan,
    );
    expect(suggestion.executionMode).toBe(AutoRemediationExecutionMode.Suggest);
    expect(suggestion.autoResolveOnRecovery).toBe(false);
    expect(suggestion.alertId).toEqual(ALERT_ID);
    expect(suggestion.incidentId).toBeUndefined();
    expect(suggestion.resourceType).toBe(AiResourceType.OpenStackCloud);
    expect(suggestion.resourceId).toEqual(CLOUD_ID);
    expect(suggestion.ruleNameSnapshot).toBe('Workflow "Page and propose"');
    expect(suggestion.rationaleMarkdown).toContain(
      "This host stopped reporting to Nova.",
    );
    expect(announced).toHaveLength(1);
    expectNoChange();
  });

  test("the plan is that one command, asking a person, with what the agent read of it", async () => {
    await OpenStackWorkflowFix.propose(input({ command: ENABLE }));

    const plan: AiRemediationCommandPlan = theOnlyPlan();
    const planned: AiRemediationCommand = plan.commands[0]!;

    expect(plan.commands).toHaveLength(1);
    expect(planned.command).toBe(ENABLE);
    expect(planned.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(planned.runnerId).toBe(AGENT_ID.toString());
    // Read from the cloud by the agent: this scene's service really is disabled.
    expect(planned.reach?.hosts[0]?.name).toBe(HOST);
    expect(planned.reach?.hosts[0]?.status).toBe("disabled");
  });

  test("it can be about an incident", async () => {
    await OpenStackWorkflowFix.propose(
      input({ alertId: undefined, incidentId: INCIDENT_ID, command: ENABLE }),
    );

    expect(saved[0]!.incidentId).toEqual(INCIDENT_ID);
    expect(saved[0]!.alertId).toBeUndefined();
    expect(runs[0]!.triggeredByIncidentId).toEqual(INCIDENT_ID);
  });

  test("the run it files its reads under is finished from the start, so nothing picks it up", async () => {
    await OpenStackWorkflowFix.propose(input({ command: ENABLE }));

    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe(AIRunStatus.Completed);
    expect(runs[0]!.runType).toBe(AIRunType.RemediationExecution);
    expect(runs[0]!.triggeredByAlertId).toEqual(ALERT_ID);
    expect(saved[0]!.aiRunId).toEqual(RUN_ID);
    // The fix's own reads went to the agent as reads.
    expect(jobs.length).toBeGreaterThan(0);
    expectNoChange();
  });

  test.each([
    ResourceAiRemediationMode.RequireApproval,
    ResourceAiRemediationMode.Automatic,
    ResourceAiRemediationMode.BypassApproval,
  ])(
    "on %s, it still only asks: the cloud's mode is about what OneUptime AI may do",
    async (mode: ResourceAiRemediationMode) => {
      useStatus(status(mode));

      const result: OpenStackWorkflowFixResult =
        await OpenStackWorkflowFix.propose(input({ command: ENABLE }));

      expect(result.isProposed).toBe(true);
      expect(saved[0]!.status).toBe(AutoRemediationSuggestionStatus.Suggested);
      expect(saved[0]!.executionMode).toBe(
        AutoRemediationExecutionMode.Suggest,
      );
      expect(theOnlyPlan().commands[0]!.policyVerdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
      expectNoChange();
    },
  );

  test("the same change on the same cloud is one card, however often it is asked for", async () => {
    jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([
      {
        id: SUGGESTION_ID,
        _id: SUGGESTION_ID.toString(),
        commandPlan: {
          commands: [
            {
              sequence: 1,
              stepType: "ResourceCommand",
              command: ENABLE,
              rationale: "r",
              expectedEffect: "e",
              policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
              runnerId: AGENT_ID.toString(),
              resourceType: AiResourceType.OpenStackCloud,
              resourceId: CLOUD_ID.toString(),
              timeoutInMs: 60_000,
            },
          ],
        },
      },
    ] as never);

    const result: OpenStackWorkflowFixResult =
      await OpenStackWorkflowFix.propose(input({ command: ENABLE }));

    expect(result).toEqual({
      isProposed: true,
      suggestionId: SUGGESTION_ID,
      tierName: "Safe",
      wasAlreadyWaiting: true,
    });
    expect(saved).toEqual([]);
    expect(runs).toEqual([]);
    expect(announced).toEqual([]);
  });

  test("a different change on that cloud is its own card", async () => {
    jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([
      {
        id: SUGGESTION_ID,
        _id: SUGGESTION_ID.toString(),
        commandPlan: { commands: [] },
      },
    ] as never);

    await OpenStackWorkflowFix.propose(input({ command: ENABLE }));

    expect(saved).toHaveLength(1);
  });
});

describe("what the alert's feed says", () => {
  test("a workflow proposed it, and no model composed it", () => {
    const plan: AiRemediationCommandPlan = {
      commands: [
        {
          sequence: 1,
          command: ENABLE,
        } as unknown as AiRemediationCommand,
      ],
    };
    const line: string = describeProposedPlanForFeed({
      sourceLabel: 'Workflow "Page and propose"',
      plan,
      isProposedByWorkflow: true,
    }).toString();

    expect(line).toContain("proposes a fix");
    expect(line).not.toContain("AI composed");
  });

  test("the words a model's plan has are what they were", () => {
    const line: string = describeProposedPlanForFeed({
      sourceLabel: "AI remediation",
      plan: {
        commands: [
          {
            sequence: 1,
            command: ENABLE,
          } as unknown as AiRemediationCommand,
        ],
      },
    }).toString();

    expect(line).toContain("AI composed a 1-command remediation plan");
  });
});

describe("what never gets as far as a card", () => {
  test.each([
    ["a delete", `openstack server delete ${RUNNING}`],
    ["a stop", `openstack server stop ${RUNNING}`],
    ["forcing a state", `openstack server set --state error ${RUNNING}`],
    ["Keystone", "openstack user list"],
    ["a quota", "openstack quota set --instances 100 ou-research"],
    ["a security group", "openstack security group delete default"],
    [
      "forcing a service down",
      `openstack compute service set --down ${HOST} nova-compute`,
    ],
    ["a confirm", `openstack server migrate confirm ${RUNNING}`],
    ["another flag order", `openstack server reboot ${RUNNING} --hard`],
    [
      "a second action in an argument",
      `openstack server start ${RUNNING}; openstack server delete ${RUNNING}`,
    ],
    ["another program", "rm -rf /"],
    ["nothing", "   "],
  ])("%s", async (_name: string, command: string) => {
    const refusal: string = refusalOf(
      await OpenStackWorkflowFix.propose(input({ command })),
    );

    expect(refusal.length).toBeGreaterThan(0);
    expect(saved).toEqual([]);
    expect(runs).toEqual([]);
    expect(announced).toEqual([]);
    expect(jobs).toEqual([]);
  });

  test("a read has nothing to approve", async () => {
    expect(
      refusalOf(
        await OpenStackWorkflowFix.propose(
          input({
            command: "openstack server list --all-projects --limit 200",
          }),
        ),
      ),
    ).toContain("only reads");
    expect(saved).toEqual([]);
  });

  test.each([
    ["neither", { alertId: undefined, incidentId: undefined }],
    ["both", { alertId: ALERT_ID, incidentId: INCIDENT_ID }],
  ])(
    "%s an alert and an incident",
    async (_name: string, subject: Partial<OpenStackWorkflowFixInput>) => {
      expect(
        refusalOf(await OpenStackWorkflowFix.propose(input(subject))),
      ).toContain("one of them");
      expect(saved).toEqual([]);
    },
  );

  test("another project's alert, whatever ID the workflow's variables resolved to", async () => {
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(null);

    expect(refusalOf(await OpenStackWorkflowFix.propose(input()))).toContain(
      "no such alert",
    );
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: ALERT_ID.toString(), projectId: PROJECT_ID },
      }),
    );
    expect(saved).toEqual([]);
  });

  test("another project's incident", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);

    expect(
      refusalOf(
        await OpenStackWorkflowFix.propose(
          input({ alertId: undefined, incidentId: INCIDENT_ID }),
        ),
      ),
    ).toContain("no such incident");
  });

  test("a record linked to no cloud, unless the step names one", async () => {
    linkedTo([]);

    expect(refusalOf(await OpenStackWorkflowFix.propose(input()))).toContain(
      "not linked to an OpenStack cloud",
    );

    const named: OpenStackWorkflowFixResult =
      await OpenStackWorkflowFix.propose(
        input({ cloudId: CLOUD_ID, command: ENABLE }),
      );

    expect(named.isProposed).toBe(true);
  });

  test("a record linked to two, unless the step says which", async () => {
    linkedTo([CLOUD_ID, OTHER_CLOUD_ID]);

    expect(refusalOf(await OpenStackWorkflowFix.propose(input()))).toContain(
      "linked to 2 OpenStack clouds",
    );

    const named: OpenStackWorkflowFixResult =
      await OpenStackWorkflowFix.propose(
        input({ cloudId: CLOUD_ID, command: ENABLE }),
      );

    expect(named.isProposed).toBe(true);
  });

  test("a cloud the record isn't about", async () => {
    expect(
      refusalOf(
        await OpenStackWorkflowFix.propose(input({ cloudId: OTHER_CLOUD_ID })),
      ),
    ).toContain("not one this record is linked to");
    expect(saved).toEqual([]);
  });

  test("a cloud that isn't this project's", async () => {
    linkedTo([]);
    useStatus(null);

    expect(
      refusalOf(
        await OpenStackWorkflowFix.propose(input({ cloudId: OTHER_CLOUD_ID })),
      ),
    ).toContain("not in this project");
  });

  test("a project with AI turned off", async () => {
    jest
      .spyOn(RemediationExecutionRunner, "checkProjectGates")
      .mockResolvedValue("AI was disabled for this project.");

    expect(refusalOf(await OpenStackWorkflowFix.propose(input()))).toBe(
      "AI was disabled for this project.",
    );
    expect(saved).toEqual([]);
  });

  test("a cloud with fixes off says what to do about it", async () => {
    useStatus(
      status(ResourceAiRemediationMode.Disabled, {
        isRemediationReady: false,
        gaps: [
          {
            code: "remediation_disabled",
            title: "AI fixes are turned off for this OpenStack cloud",
            nextStep: 'Set "Fixes" to "Ask for approval".',
            blocksInvestigation: false,
            blocksRemediation: true,
          },
        ],
      }),
    );

    expect(refusalOf(await OpenStackWorkflowFix.propose(input()))).toBe(
      'AI fixes are turned off for this OpenStack cloud. Set "Fixes" to "Ask for approval".',
    );
    expect(saved).toEqual([]);
    expect(jobs).toEqual([]);
  });

  test("an agent with writes off", async () => {
    useStatus(
      status(
        ResourceAiRemediationMode.RequireApproval,
        {
          isRemediationReady: false,
          gaps: [
            {
              code: "remediation_write_access_missing",
              title: "The OpenStack AI agent is read-only",
              nextStep: "Set ONEUPTIME_AI_ALLOW_WRITES=true.",
              blocksInvestigation: false,
              blocksRemediation: true,
            },
          ],
        },
        { allowWrites: false },
      ),
    );

    expect(refusalOf(await OpenStackWorkflowFix.propose(input()))).toContain(
      "read-only",
    );
    expect(saved).toEqual([]);
  });

  test("a status that says it is ready, from an agent that says it isn't", async () => {
    useStatus(
      status(
        ResourceAiRemediationMode.RequireApproval,
        {},
        {
          allowWrites: false,
        },
      ),
    );

    expect(
      refusalOf(await OpenStackWorkflowFix.propose(input())).length,
    ).toBeGreaterThan(0);
    expect(saved).toEqual([]);
    expect(jobs).toEqual([]);
  });

  test("a protected target wins, a workflow's say-so included", async () => {
    useCloud("compute-disabled", {
      ONEUPTIME_AI_PROTECTED_TARGETS: `host:${HOST}`,
    });
    jest
      .spyOn(ResourceAiAgentService, "findOnlineAgentForResource")
      .mockResolvedValue(agentRow({ protectedTargets: [`host:${HOST}`] }));
    useStatus(
      status(
        ResourceAiRemediationMode.RequireApproval,
        {},
        {
          protectedTargets: [`host:${HOST}`],
        },
      ),
    );

    const result: OpenStackWorkflowFixResult =
      await OpenStackWorkflowFix.propose(input({ command: ENABLE }));

    expect(result.isProposed).toBe(false);
    expect(saved).toEqual([]);
    expectNoChange();
  });

  test("a project whose workflows have asked too often", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(
          MAX_OPENSTACK_WORKFLOW_PROPOSALS_PER_PROJECT_PER_HOUR,
        ),
      );

    expect(
      refusalOf(await OpenStackWorkflowFix.propose(input({ command: ENABLE }))),
    ).toContain("in the last hour");
    expect(saved).toEqual([]);
    expect(runs).toEqual([]);
  });
});

describe("an evacuation", () => {
  test("of a dead host, listing what it would touch, and still only asking", async () => {
    useCloud("compute-down");

    const result: OpenStackWorkflowFixResult =
      await OpenStackWorkflowFix.propose(input({ command: EVACUATE }));

    expect(result.isProposed).toBe(true);

    const planned: AiRemediationCommand = theOnlyPlan().commands[0]!;

    expect(planned.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
    expect(planned.reach?.instances.length).toBeGreaterThan(0);
    expect(planned.reach?.projects.length).toBeGreaterThan(0);
    expect(planned.reach?.hosts[0]?.state).toBe("down");
    expectNoChange();
  });

  test("of a host that's alive is not proposed", async () => {
    useCloud("healthy");

    expect(
      (await OpenStackWorkflowFix.propose(input({ command: EVACUATE })))
        .isProposed,
    ).toBe(false);
    expect(saved).toEqual([]);
    expectNoChange();
  });

  test("the agent can't read in full is not proposed", async () => {
    useCloud("compute-down");
    jest.spyOn(ResourceCommandJobRunner, "run").mockResolvedValue({
      jobId: JOB_ID.toString(),
      succeeded: false,
      output: "",
      errorMessage: "The agent did not answer.",
      displayCommand: EVACUATE,
    } as ResourceCommandJobOutcome);

    expect(
      (await OpenStackWorkflowFix.propose(input({ command: EVACUATE })))
        .isProposed,
    ).toBe(false);
    expect(saved).toEqual([]);
  });
});

describe("once a person approves it", () => {
  test("it runs by the road a fix runs by, and with writes off at the agent it doesn't", async () => {
    await OpenStackWorkflowFix.propose(input({ command: ENABLE }));

    const planned: AiRemediationCommand = theOnlyPlan().commands[0]!;
    const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand({
      projectId: PROJECT_ID,
      aiRunId: saved[0]!.aiRunId!,
      origin: RunnerJobOrigin.AiRemediation,
      autoRemediationSuggestionId: SUGGESTION_ID,
      resourceType: AiResourceType.OpenStackCloud,
      resourceId: CLOUD_ID,
      stepId: "ai-command-1",
      targetResourceAiAgentId: new ObjectID(planned.runnerId),
      command: planned.command,
      timeoutInMs: planned.timeoutInMs,
    });

    useCloud("compute-disabled", { ONEUPTIME_AI_ALLOW_WRITES: "false" });
    expect((await runOnAgent(job)).success).toBe(false);
    expect(cloud.changes()).toEqual([]);

    useCloud("compute-disabled");
    expect((await runOnAgent(job)).success).toBe(true);
    expect(cloud.changes()).toHaveLength(1);
    expect(cloud.changes()[0]!.method).toBe("PUT");
  });
});
