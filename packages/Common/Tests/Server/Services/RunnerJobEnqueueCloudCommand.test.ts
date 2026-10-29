import RunnerJobService, {
  ResourceCommandEnqueueRefusedException,
} from "../../../Server/Services/RunnerJobService";
import AIRunService from "../../../Server/Services/AIRunService";
import CloudAccountService from "../../../Server/Services/CloudAccountService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import ResourceAiAgentService from "../../../Server/Services/ResourceAiAgentService";
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
import AiCommandKillSwitch from "../../../Server/Utils/AI/AiCommandKillSwitch";

/*
 * Enable AI is on throughout: what turning it off does to these paths is
 * AiCommandKillSwitch's own suite (AiCommandKillSwitch.test.ts).
 */
beforeEach(() => {
  jest.spyOn(AiCommandKillSwitch, "isAiOff").mockResolvedValue(false);
});

/*
 * RunnerJobService.enqueueAiResourceCommand for a cloud account: every
 * rule of the chokepoint holds as for any resource, and one more —
 * a change (never a read) must name a resource of the account's own
 * inventory, so OneUptime AI never changes what OneUptime does not list
 * for the account, whatever the model asked for. The job carries the
 * catalog's canonical argv, so the agent runs exactly what was checked.
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

type EnqueueArgs = Parameters<
  typeof RunnerJobService.enqueueAiResourceCommand
>[0];

function accountRow(overrides: Record<string, unknown> = {}): CloudAccount {
  return {
    _id: ACCOUNT_ROW_ID.toString(),
    id: ACCOUNT_ROW_ID,
    projectId: PROJECT_ID,
    name: "prod",
    provider: "aws",
    accountId: "123456789012",
    cloudConnectionId: ObjectID.generate(),
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    ...overrides,
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

function args(overrides: Partial<EnqueueArgs> = {}): EnqueueArgs {
  return {
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    origin: RunnerJobOrigin.AiRemediation,
    autoRemediationSuggestionId: SUGGESTION_ID,
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ROW_ID,
    stepId: "ai-command-1",
    targetResourceAiAgentId: AGENT_ID,
    command: `cloud scale-out ${ECS} --count 4`,
    timeoutInMs: 60000,
    ...overrides,
  };
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

describe("RunnerJobService.enqueueAiResourceCommand on a cloud account", () => {
  let createdRows: Array<RunnerJob>;
  let accountLookup: jest.SpyInstance;
  let inventoryAccountLookup: jest.SpyInstance;
  let inventoryLookup: jest.SpyInstance;

  beforeEach(() => {
    createdRows = [];
    // @CaptureSpan logs the expected throws at error level.
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
      id: RUN_ID,
      runType: AIRunType.RemediationExecution,
    } as unknown as AIRun);
    jest
      .spyOn(RunnerJobService, "create")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        const row: RunnerJob = (data as { data: RunnerJob }).data;
        createdRows.push(row);
        return row;
      });
    accountLookup = jest
      .spyOn(CloudAccountService, "findBy")
      .mockResolvedValue([accountRow()] as never);
    inventoryAccountLookup = jest
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

  it("enqueues a change to a resource of the account's inventory, as the catalog's argv", async () => {
    const job: RunnerJob =
      await RunnerJobService.enqueueAiResourceCommand(args());

    expect(createdRows).toHaveLength(1);
    expect(job.targetResourceAiAgentId?.toString()).toBe(AGENT_ID.toString());
    expect(job.payload as unknown as ResourceCommandJobPayload).toEqual({
      resourceType: AiResourceType.AwsAccount,
      resourceId: ACCOUNT_ROW_ID.toString(),
      resourceIdentifier: "123456789012",
      program: "cloud",
      args: ["scale-out", ECS, "--count", "4"],
      displayCommand: `cloud scale-out ${ECS} --count 4`,
      tier: ResourceCommandTier.SafeWrite,
    });

    // The account is read among its cloud's accounts in the caller's project.
    const query: Record<string, unknown> = (
      accountLookup.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["provider"]).toBe("aws");

    // The inventory is read for the account the job runs on.
    expect(
      (
        inventoryAccountLookup.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query["_id"],
    ).toBe(ACCOUNT_ROW_ID.toString());
  });

  it("refuses a change to a resource the inventory does not list", async () => {
    inventoryLookup.mockResolvedValue(null);

    const refusal: ResourceCommandEnqueueRefusedException =
      await refusalOf(args());

    expect(refusal.refusalCode).toBe("target_not_in_inventory");
    expect(refusal.message).toContain("not in this AWS account's inventory");
    expect(refusal.message).toContain("It was not enqueued.");
    expect(createdRows).toHaveLength(0);
  });

  it("fails closed when the inventory cannot be read", async () => {
    inventoryLookup.mockRejectedValue(new Error("database down"));

    await expect(
      RunnerJobService.enqueueAiResourceCommand(args()),
    ).rejects.toThrow("database down");
    expect(createdRows).toHaveLength(0);
  });

  it("never checks the inventory for a read", async () => {
    const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand(
      args({
        origin: RunnerJobOrigin.AiInvestigation,
        autoRemediationSuggestionId: undefined,
        stepId: "ai-investigation-resource-1",
        command: "cloud whoami",
      }),
    );

    expect((job.payload as unknown as ResourceCommandJobPayload).tier).toBe(
      ResourceCommandTier.Read,
    );
    expect(inventoryLookup).not.toHaveBeenCalled();
  });

  it("refuses a change to the agent's own stack before reading the inventory", async () => {
    const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
      args({
        command:
          "cloud restart-service arn:aws:ecs:us-east-1:123456789012:service/oneuptime-ai-agent/oneuptime-ai-agent",
      }),
    );

    expect(refusal.refusalCode).toBe("write_scope");
    expect(inventoryLookup).not.toHaveBeenCalled();
  });

  it("refuses a change while the agent does not allow writes", async () => {
    jest
      .spyOn(ResourceAiAgentService, "findOnlineAgentForResource")
      .mockResolvedValue(agent({ allowWrites: false }));

    const refusal: ResourceCommandEnqueueRefusedException =
      await refusalOf(args());

    expect(refusal.refusalCode).toBe("write_scope");
  });

  it("refuses an operation outside the catalog", async () => {
    const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
      args({ command: `cloud delete-service ${ECS}` }),
    );

    expect(refusal.refusalCode).toBe("policy_denied");
    expect(createdRows).toHaveLength(0);
  });

  it("refuses an account of another cloud's id shape under the AWS type", async () => {
    const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
      args({
        command:
          "cloud restart-service /subscriptions/00000000-0000-0000-0000-0000000000ab/resourceGroups/prod/providers/Microsoft.Web/sites/web",
      }),
    );

    expect(refusal.refusalCode).toBe("policy_denied");
  });

  it("refuses when the account is not this project's", async () => {
    accountLookup.mockResolvedValue([] as never);

    const refusal: ResourceCommandEnqueueRefusedException =
      await refusalOf(args());

    expect(refusal.refusalCode).toBe("resource_not_found");
  });
});
