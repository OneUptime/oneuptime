import RunnerJobService, {
  MAX_AI_DRY_RUN_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
  MAX_AI_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
  ResourceCommandEnqueueRefusedException,
} from "../../../Server/Services/RunnerJobService";
import AIRunService from "../../../Server/Services/AIRunService";
import CloudAccountService from "../../../Server/Services/CloudAccountService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import ResourceAiAgentService from "../../../Server/Services/ResourceAiAgentService";
import AiCommandKillSwitch from "../../../Server/Utils/AI/AiCommandKillSwitch";
import logger from "../../../Server/Utils/Logger";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import AIRunType from "../../../Types/AI/AIRunType";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { getCloudAiAgentOwnTargets } from "../../../Types/ResourceAiAgent/CloudAiAgentNames";
import {
  ResourceAiRemediationMode,
  ResourceCommandJobPayload,
  ResourceCommandTier,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — a cloud DRY RUN at the enqueue chokepoint
 * (RunnerJobService.enqueueAiResourceCommand):
 *
 *  - `cloud dry-run <change>` is enqueued as the Read it is: an
 *    investigation may run it, the agent's write scope is the agent's to
 *    answer about (it says the change would be refused), and the payload
 *    carries the canonical argv the agent re-reads;
 *  - the change it checks must name a resource of the account's inventory,
 *    like the change itself - a dry run of a change OneUptime would never
 *    send would say nothing true;
 *  - the step id of the dry runs OneUptime asks for before an approval
 *    (ai-dry-run-<n>) carries only that: a fix's job that is a dry run of a
 *    change. Anything else under it is refused, so its brake is never a way
 *    around the fixes' brake;
 *  - those dry runs have a brake of their own (60 an hour), and the fixes'
 *    brake (30 an hour) never counts them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ACCOUNT_ROW_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const AGENT_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const AGENT_ECS: string =
  "arn:aws:ecs:us-east-1:123456789012:service/oneuptime-ai-agent/oneuptime-ai-agent";
const DRY_RUN: string = `cloud dry-run scale-out ${ECS} --count 4`;

type EnqueueArgs = Parameters<
  typeof RunnerJobService.enqueueAiResourceCommand
>[0];

function accountRow(): CloudAccount {
  return {
    _id: ACCOUNT_ROW_ID.toString(),
    id: ACCOUNT_ROW_ID,
    projectId: PROJECT_ID,
    name: "prod",
    provider: "aws",
    accountId: "123456789012",
    cloudConnectionId: ObjectID.generate(),
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
  } as unknown as CloudAccount;
}

function agent(
  postureOverrides: Record<string, unknown> = {},
): ResourceAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ROW_ID,
    resourceIdentifier: "123456789012",
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    posture: {
      resourceType: AiResourceType.AwsAccount,
      resourceIdentifier: "123456789012",
      allowWrites: true,
      writeTargets: [],
      protectedTargets: getCloudAiAgentOwnTargets({
        provider: "aws",
        accountId: "123456789012",
      }),
      reachable: true,
      ...postureOverrides,
    },
  } as unknown as ResourceAiAgent;
}

function inventoryResource(): CloudResource {
  const resource: CloudResource = new CloudResource();
  resource.id = ObjectID.generate();
  resource._id = resource.id.toString();
  resource.name = "web";
  resource.providerResourceId = ECS;
  resource.cloudTags = {};
  return resource;
}

// A fix's dry run, as CloudChangeDryRun asks for it.
function planDryRunArgs(overrides: Partial<EnqueueArgs> = {}): EnqueueArgs {
  return {
    projectId: PROJECT_ID,
    origin: RunnerJobOrigin.AiRemediation,
    autoRemediationSuggestionId: SUGGESTION_ID,
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ROW_ID,
    stepId: "ai-dry-run-1",
    targetResourceAiAgentId: AGENT_ID,
    command: DRY_RUN,
    timeoutInMs: 60000,
    ...overrides,
  };
}

// The SQL a query's Raw condition writes for a column (TypeORM's getSql).
function sqlOf(condition: unknown): string {
  const getSql: unknown = (condition as { getSql?: unknown } | undefined)
    ?.getSql;

  return typeof getSql === "function"
    ? String((getSql as (alias: string) => string)("stepId"))
    : "";
}

async function refusalOf(
  data: EnqueueArgs,
): Promise<ResourceCommandEnqueueRefusedException> {
  try {
    await RunnerJobService.enqueueAiResourceCommand(data);
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceCommandEnqueueRefusedException);
    return error as ResourceCommandEnqueueRefusedException;
  }

  throw new Error("enqueueAiResourceCommand did not refuse");
}

describe("a cloud dry run at the enqueue chokepoint", () => {
  let createdRows: Array<RunnerJob>;
  let countBy: jest.SpyInstance;
  let inventoryLookup: jest.SpyInstance;

  beforeEach(() => {
    createdRows = [];
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(AiCommandKillSwitch, "isAiOff").mockResolvedValue(false);
    countBy = jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
      id: RUN_ID,
      runType: AIRunType.Investigation,
    } as unknown as AIRun);
    jest
      .spyOn(RunnerJobService, "create")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        const row: RunnerJob = (data as { data: RunnerJob }).data;
        createdRows.push(row);
        return row;
      });
    jest
      .spyOn(CloudAccountService, "findBy")
      .mockResolvedValue([accountRow()] as never);
    jest
      .spyOn(CloudAccountService, "findOneBy")
      .mockResolvedValue(accountRow() as never);
    inventoryLookup = jest
      .spyOn(CloudResourceService, "findOneBy")
      .mockResolvedValue(inventoryResource() as never);
    jest
      .spyOn(ResourceAiAgentService, "findOnlineAgentForResource")
      .mockResolvedValue(agent());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("enqueues a fix's dry run as a Read, with the catalog's canonical argv", async () => {
    const job: RunnerJob =
      await RunnerJobService.enqueueAiResourceCommand(planDryRunArgs());

    expect(createdRows).toHaveLength(1);
    expect(job.origin).toBe(RunnerJobOrigin.AiRemediation);
    expect(job.stepId).toBe("ai-dry-run-1");
    expect(job.autoRemediationSuggestionId?.toString()).toBe(
      SUGGESTION_ID.toString(),
    );
    expect(job.payload as unknown as ResourceCommandJobPayload).toEqual({
      resourceType: AiResourceType.AwsAccount,
      resourceId: ACCOUNT_ROW_ID.toString(),
      resourceIdentifier: "123456789012",
      program: "cloud",
      args: ["dry-run", "scale-out", ECS, "--count", "4"],
      displayCommand: DRY_RUN,
      tier: ResourceCommandTier.Read,
    });
  });

  it("an investigation may run one: it changes nothing", async () => {
    const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand(
      planDryRunArgs({
        origin: RunnerJobOrigin.AiInvestigation,
        aiRunId: RUN_ID,
        autoRemediationSuggestionId: undefined,
        stepId: "ai-investigation-resource-3",
      }),
    );

    expect(job.origin).toBe(RunnerJobOrigin.AiInvestigation);
    expect((job.payload as unknown as ResourceCommandJobPayload).tier).toBe(
      ResourceCommandTier.Read,
    );
  });

  it("the change it checks must be in the account's inventory, like the change itself", async () => {
    inventoryLookup.mockResolvedValue(null);

    const refusal: ResourceCommandEnqueueRefusedException =
      await refusalOf(planDryRunArgs());

    expect(refusal.refusalCode).toBe("target_not_in_inventory");
    expect(refusal.message).toContain(
      `${ECS} is not in this AWS account's inventory`,
    );
    expect(createdRows).toHaveLength(0);

    // The lookup is for the change's own resource.
    const query: Record<string, unknown> = (
      inventoryLookup.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["providerResourceId"]).toBe(ECS);
  });

  it("the agent answers about its own write scope: a dry run of a change to its own stack is still asked", async () => {
    const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand(
      planDryRunArgs({ command: `cloud dry-run restart-service ${AGENT_ECS}` }),
    );

    expect(createdRows).toHaveLength(1);
    expect((job.payload as unknown as ResourceCommandJobPayload).tier).toBe(
      ResourceCommandTier.Read,
    );
  });

  it("refuses anything but a fix's dry run of a change under a dry run's step id", async () => {
    for (const overrides of [
      // A change dressed as a dry run would spend the dry runs' brake.
      { command: `cloud scale-out ${ECS} --count 4` },
      // A plain read is no dry run.
      { command: `cloud describe ${ECS}` },
      // Only a fix asks for these dry runs.
      {
        origin: RunnerJobOrigin.AiInvestigation,
        aiRunId: RUN_ID,
        autoRemediationSuggestionId: undefined,
      },
    ] as Array<Partial<EnqueueArgs>>) {
      const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
        planDryRunArgs(overrides),
      );

      expect(refusal.refusalCode).toBe("invalid_request");
      expect(refusal.message).toContain(
        "A fix's dry run checks one change and changes nothing",
      );
    }

    expect(createdRows).toHaveLength(0);
  });

  it("counts a fix's dry runs against their own brake of 60 an hour", async () => {
    await RunnerJobService.enqueueAiResourceCommand(planDryRunArgs());

    const query: Record<string, unknown> = (
      countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["origin"]).toBe(RunnerJobOrigin.AiRemediation);
    // Only the dry runs: the step ids that start with theirs.
    expect(sqlOf(query["stepId"])).toContain("CAST(stepId AS TEXT) ILIKE :");
    expect(sqlOf(query["stepId"])).not.toContain("NOT ILIKE");
    expect(MAX_AI_DRY_RUN_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR).toBe(60);

    countBy.mockResolvedValue(
      new PositiveNumber(
        MAX_AI_DRY_RUN_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
      ),
    );

    const refusal: ResourceCommandEnqueueRefusedException =
      await refusalOf(planDryRunArgs());

    expect(refusal.refusalCode).toBe("hourly_limit");
    expect(refusal.message).toBe(
      "This project has run 60 dry runs of proposed fixes on its infrastructure in the last hour, which is its limit (60). No further dry runs can run this hour; the fixes themselves are not held back.",
    );
  });

  it("a fix's change is held to the fixes' brake of 30, which counts no dry run", async () => {
    // At 30 dry runs, a change still runs: they are counted apart.
    countBy.mockImplementation(
      async (data: {
        query: Record<string, unknown>;
      }): Promise<PositiveNumber> => {
        // The fixes' count leaves the dry runs out; the dry runs' would be 30.
        return new PositiveNumber(
          sqlOf(data.query["stepId"]).includes("NOT ILIKE") ? 0 : 30,
        );
      },
    );

    const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand(
      planDryRunArgs({
        stepId: "ai-approved-1",
        command: `cloud scale-out ${ECS} --count 4`,
      }),
    );

    expect(job.stepId).toBe("ai-approved-1");

    countBy.mockResolvedValue(
      new PositiveNumber(MAX_AI_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR),
    );

    const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
      planDryRunArgs({
        stepId: "ai-approved-1",
        command: `cloud scale-out ${ECS} --count 4`,
      }),
    );

    expect(refusal.refusalCode).toBe("hourly_limit");
    expect(refusal.message).toContain("AI remediation commands");
  });

  it("Enable AI off stops a dry run too", async () => {
    jest.spyOn(AiCommandKillSwitch, "isAiOff").mockResolvedValue(true);

    const refusal: ResourceCommandEnqueueRefusedException =
      await refusalOf(planDryRunArgs());

    expect(refusal.refusalCode).toBe("ai_disabled");
    expect(createdRows).toHaveLength(0);
  });
});
