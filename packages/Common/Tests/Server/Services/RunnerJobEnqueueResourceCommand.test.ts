import RunnerJobService, {
  MAX_AI_INVESTIGATION_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
  MAX_AI_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
  ResourceCommandEnqueueRefusalCode,
  ResourceCommandEnqueueRefusedException,
  Service as RunnerJobServiceClass,
} from "../../../Server/Services/RunnerJobService";
import AIRunService from "../../../Server/Services/AIRunService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import HostService from "../../../Server/Services/HostService";
import ResourceAiAgentService from "../../../Server/Services/ResourceAiAgentService";
import { ResourceAiAccessRow } from "../../../Server/Services/ResourceAiAccessService";
import logger from "../../../Server/Utils/Logger";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import AIRunType from "../../../Types/AI/AIRunType";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiRemediationMode,
  ResourceCommandJobPayload,
  ResourceCommandTier,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — RunnerJobService.enqueueAiResourceCommand, the
 * server-side chokepoint between an LLM's output and an infrastructure
 * resource (a Docker host, a database server, a host, ...), mirroring
 * enqueueAiKubectlCommand's order:
 *
 *  1. the call itself (type, id, origin, suggestion, run, access test);
 *  2. the resource command policy, re-run: Denied never enqueues and an
 *     investigation must be Read — whatever the tool layer decided;
 *  3. the hourly brake, counted on ResourceCommand rows only (240
 *     investigation / 30 remediation per project);
 *  4. the resource must be this project's;
 *  5. the target is the resource's ONLINE agent right now (and the one the
 *     caller named, if any);
 *  6. the switch the job needs (investigation, or fixes) is still on;
 *  7. no credential ever travels;
 *  8. the agent's posture names this resource, and a write fits its write
 *     scope (ONEUPTIME_AI_ALLOW_WRITES, write targets, protected targets).
 *
 * The row it writes targets ONLY the agent (targetResourceAiAgentId),
 * never a Runner or a Kubernetes AI agent, and carries an argv payload.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const AGENT_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const OTHER_AGENT_ID: ObjectID = new ObjectID(
  "67676767-6767-4676-8676-676767676767",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

type EnqueueArgs = Parameters<
  typeof RunnerJobService.enqueueAiResourceCommand
>[0];

function dockerHostRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    name: "web-1",
    hostIdentifier: "web-1",
    isArchived: false,
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    ...overrides,
  };
}

function agent(
  overrides: Record<string, unknown> = {},
  postureOverrides: Record<string, unknown> = {},
): ResourceAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceIdentifier: "web-1",
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    posture: {
      resourceType: AiResourceType.DockerHost,
      resourceIdentifier: "web-1",
      allowWrites: true,
      writeTargets: [],
      protectedTargets: ["oneuptime-ai-agent"],
      reachable: true,
      ...postureOverrides,
    },
    ...overrides,
  } as unknown as ResourceAiAgent;
}

function args(overrides: Partial<EnqueueArgs> = {}): EnqueueArgs {
  return {
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    origin: RunnerJobOrigin.AiInvestigation,
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    stepId: "ai-investigation-resource-1",
    targetResourceAiAgentId: AGENT_ID,
    command: "docker ps -a",
    timeoutInMs: 30000,
    ...overrides,
  };
}

function remediationArgs(overrides: Partial<EnqueueArgs> = {}): EnqueueArgs {
  return args({
    origin: RunnerJobOrigin.AiRemediation,
    autoRemediationSuggestionId: SUGGESTION_ID,
    command: "docker restart web",
    stepId: "ai-command-1",
    ...overrides,
  });
}

async function refusalOf(
  data: EnqueueArgs,
): Promise<ResourceCommandEnqueueRefusedException> {
  try {
    await RunnerJobService.enqueueAiResourceCommand(data);
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceCommandEnqueueRefusedException);
    expect(error).toBeInstanceOf(BadDataException);
    return error as ResourceCommandEnqueueRefusedException;
  }

  throw new Error("enqueueAiResourceCommand did not refuse");
}

describe("RunnerJobService.enqueueAiResourceCommand", () => {
  let createdRows: Array<RunnerJob>;
  let countBy: jest.SpyInstance;
  let resourceLookup: jest.SpyInstance;
  let agentLookup: jest.SpyInstance;
  let runLookup: jest.SpyInstance;

  beforeEach(() => {
    createdRows = [];
    // @CaptureSpan logs the expected throws at error level.
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    countBy = jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    runLookup = jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
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
    resourceLookup = jest
      .spyOn(DockerHostService, "findBy")
      .mockResolvedValue([dockerHostRow()] as never);
    agentLookup = jest
      .spyOn(ResourceAiAgentService, "findOnlineAgentForResource")
      .mockResolvedValue(agent());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the row it writes", () => {
    it("targets only the resource's agent, with an argv payload", async () => {
      const job: RunnerJob =
        await RunnerJobService.enqueueAiResourceCommand(args());

      expect(createdRows).toHaveLength(1);
      expect(job.stepType).toBe(RunbookStepType.ResourceCommand);
      expect(job.status).toBe(RunnerJobStatus.Pending);
      expect(job.origin).toBe(RunnerJobOrigin.AiInvestigation);
      expect(job.aiRunId?.toString()).toBe(RUN_ID.toString());
      expect(job.targetResourceAiAgentId?.toString()).toBe(AGENT_ID.toString());
      expect(job.targetAgentId).toBeUndefined();
      expect(job.targetKubernetesAiAgentId).toBeUndefined();
      expect(job.kubernetesClusterId).toBeUndefined();
      expect(job.resourceType).toBe(AiResourceType.DockerHost);
      expect(job.resourceId?.toString()).toBe(RESOURCE_ID.toString());
      expect(job.script).toBe("");
      expect(job.stepId).toBe("ai-investigation-resource-1");
      expect(job.timeoutInMs).toBe(30000);

      const payload: ResourceCommandJobPayload =
        job.payload as unknown as ResourceCommandJobPayload;

      expect(payload).toEqual({
        resourceType: AiResourceType.DockerHost,
        resourceId: RESOURCE_ID.toString(),
        resourceIdentifier: "web-1",
        program: "docker",
        args: ["ps", "-a"],
        displayCommand: "docker ps -a",
        tier: ResourceCommandTier.Read,
      });
    });

    it("never carries a credential or a shell line in the payload", async () => {
      const job: RunnerJob =
        await RunnerJobService.enqueueAiResourceCommand(args());
      const payload: Record<string, unknown> = job.payload as Record<
        string,
        unknown
      >;

      expect(Object.keys(payload).sort()).toEqual(
        [
          "args",
          "displayCommand",
          "program",
          "resourceId",
          "resourceIdentifier",
          "resourceType",
          "tier",
        ].sort(),
      );
      expect(payload["credentialId"]).toBeUndefined();
    });

    it("sets the claim deadline from the claim window", async () => {
      const before: number = Date.now();
      const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand(
        args({ claimTimeoutInMs: 20_000 }),
      );
      const deadline: number = job.claimDeadlineAt!.getTime();

      expect(deadline).toBeGreaterThanOrEqual(before + 19_000);
      expect(deadline).toBeLessThanOrEqual(Date.now() + 21_000);
    });

    it("defaults the claim window to two minutes", async () => {
      const job: RunnerJob =
        await RunnerJobService.enqueueAiResourceCommand(args());

      expect(job.claimDeadlineAt!.getTime()).toBeGreaterThan(
        Date.now() + 110_000,
      );
    });

    it("writes a remediation job with its suggestion and the write's tier", async () => {
      const job: RunnerJob =
        await RunnerJobService.enqueueAiResourceCommand(remediationArgs());

      expect(job.origin).toBe(RunnerJobOrigin.AiRemediation);
      expect(job.autoRemediationSuggestionId?.toString()).toBe(
        SUGGESTION_ID.toString(),
      );
      expect((job.payload as unknown as ResourceCommandJobPayload).tier).toBe(
        ResourceCommandTier.SafeWrite,
      );
      expect(
        (job.payload as unknown as ResourceCommandJobPayload).args,
      ).toEqual(["restart", "web"]);
    });

    it("reads the resource and its online agent in the caller's project", async () => {
      await RunnerJobService.enqueueAiResourceCommand(args());

      const query: Record<string, unknown> = (
        resourceLookup.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(agentLookup).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          resourceType: AiResourceType.DockerHost,
        }),
      );
      expect(
        (
          agentLookup.mock.calls[0]![0] as { resourceId: ObjectID }
        ).resourceId.toString(),
      ).toBe(RESOURCE_ID.toString());
    });

    it("works without a named agent: whichever agent is the resource's online one", async () => {
      const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand(
        args({ targetResourceAiAgentId: undefined }),
      );

      expect(job.targetResourceAiAgentId?.toString()).toBe(AGENT_ID.toString());
    });

    it("carries the identity the agent registered with, else its posture's", async () => {
      agentLookup.mockResolvedValue(agent({ resourceIdentifier: undefined }));

      const job: RunnerJob =
        await RunnerJobService.enqueueAiResourceCommand(args());

      expect(
        (job.payload as unknown as ResourceCommandJobPayload)
          .resourceIdentifier,
      ).toBe("web-1");
    });
  });

  describe("1. the call itself", () => {
    it.each<[string, Partial<EnqueueArgs>]>([
      ["an unknown resource type", { resourceType: "Kubernetes" as never }],
      ["no resource id", { resourceId: undefined as never }],
      ["a runbook origin", { origin: RunnerJobOrigin.Runbook as never }],
      [
        "a remediation job without its suggestion",
        {
          origin: RunnerJobOrigin.AiRemediation,
          autoRemediationSuggestionId: undefined,
        },
      ],
      ["an investigation job without its run", { aiRunId: undefined }],
      ["an access test with a run", { isAccessTest: true, aiRunId: RUN_ID }],
      [
        "an access test for remediation",
        {
          isAccessTest: true,
          aiRunId: undefined,
          origin: RunnerJobOrigin.AiRemediation,
          autoRemediationSuggestionId: SUGGESTION_ID,
        },
      ],
    ])(
      "refuses %s before reading anything",
      async (_label: string, overrides: Partial<EnqueueArgs>) => {
        const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
          args(overrides),
        );

        expect(refusal.refusalCode).toBe("invalid_request");
        expect(countBy).not.toHaveBeenCalled();
        expect(resourceLookup).not.toHaveBeenCalled();
        expect(createdRows).toHaveLength(0);
      },
    );
  });

  describe("2. the policy, re-run", () => {
    it.each<[string, string]>([
      ["a denied program verb", "docker rm web"],
      ["exec", "docker exec web sh"],
      ["a pipe", "docker ps -a | grep web"],
      ["sudo", "sudo docker ps"],
      ["another type's program", "systemctl status nginx"],
      ["an empty command", ""],
    ])(
      "never enqueues %s, whatever the origin",
      async (_label: string, command: string) => {
        for (const data of [args({ command }), remediationArgs({ command })]) {
          const refusal: ResourceCommandEnqueueRefusedException =
            await refusalOf(data);
          expect(refusal.refusalCode).toBe("policy_denied");
          expect(refusal.message).toContain(
            "Denied by the Docker host command policy",
          );
        }

        expect(countBy).not.toHaveBeenCalled();
        expect(createdRows).toHaveLength(0);
      },
    );

    it.each<[string, string]>([
      ["a safe write", "docker restart web"],
      ["a risky write", "docker stop web"],
    ])(
      "refuses %s for an investigation",
      async (_label: string, command: string) => {
        const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
          args({ command }),
        );

        expect(refusal.refusalCode).toBe("not_read_only");
        expect(refusal.message).toContain(
          "An investigation may only run read-only commands",
        );
        expect(createdRows).toHaveLength(0);
      },
    );

    it("lets a remediation run a read", async () => {
      const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand(
        remediationArgs({ command: "docker ps -a" }),
      );

      expect((job.payload as unknown as ResourceCommandJobPayload).tier).toBe(
        ResourceCommandTier.Read,
      );
    });
  });

  describe("3. the hourly brake", () => {
    it("counts only this project's investigation ResourceCommand rows with a run", async () => {
      await RunnerJobService.enqueueAiResourceCommand(args());

      const query: Record<string, unknown> = (
        countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["origin"]).toBe(RunnerJobOrigin.AiInvestigation);
      expect(query["stepType"]).toBe(RunbookStepType.ResourceCommand);
      expect(query["createdAt"]).toBeDefined();
      expect(query["aiRunId"]).toBeDefined();
    });

    it("counts remediation rows on their own, without the run filter", async () => {
      await RunnerJobService.enqueueAiResourceCommand(remediationArgs());

      const query: Record<string, unknown> = (
        countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;

      expect(query["origin"]).toBe(RunnerJobOrigin.AiRemediation);
      expect(query["stepType"]).toBe(RunbookStepType.ResourceCommand);
      expect(query["aiRunId"]).toBeUndefined();
    });

    it("refuses an investigation command at 240 an hour", async () => {
      countBy.mockResolvedValue(
        new PositiveNumber(
          MAX_AI_INVESTIGATION_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
        ),
      );

      const refusal: ResourceCommandEnqueueRefusedException =
        await refusalOf(args());

      expect(
        MAX_AI_INVESTIGATION_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
      ).toBe(240);
      expect(refusal.refusalCode).toBe("hourly_limit");
      expect(refusal.message).toContain("(240)");
      expect(resourceLookup).not.toHaveBeenCalled();
    });

    it("refuses a remediation command at 30 an hour, and allows 29", async () => {
      expect(MAX_AI_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR).toBe(30);

      countBy.mockResolvedValue(new PositiveNumber(29));
      await RunnerJobService.enqueueAiResourceCommand(remediationArgs());
      expect(createdRows).toHaveLength(1);

      countBy.mockResolvedValue(new PositiveNumber(30));
      const refusal: ResourceCommandEnqueueRefusedException =
        await refusalOf(remediationArgs());
      expect(refusal.refusalCode).toBe("hourly_limit");
    });

    it("never counts the access test against the brake", async () => {
      countBy.mockResolvedValue(new PositiveNumber(10_000));

      const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand(
        args({ isAccessTest: true, aiRunId: undefined }),
      );

      expect(countBy).not.toHaveBeenCalled();
      expect(job.aiRunId).toBeUndefined();
    });
  });

  describe("4. the resource", () => {
    it("refuses a resource that is not this project's", async () => {
      resourceLookup.mockResolvedValue([] as never);

      const refusal: ResourceCommandEnqueueRefusedException =
        await refusalOf(args());

      expect(refusal.refusalCode).toBe("resource_not_found");
      expect(refusal.message).toBe(
        "Docker host not found or it does not belong to this project.",
      );
      expect(agentLookup).not.toHaveBeenCalled();
    });

    it("refuses a row that says it is another project's", async () => {
      resourceLookup.mockResolvedValue([
        dockerHostRow({ projectId: ObjectID.generate() }),
      ] as never);

      const refusal: ResourceCommandEnqueueRefusedException =
        await refusalOf(args());

      expect(refusal.refusalCode).toBe("resource_not_found");
    });

    it("fails closed when the resource cannot be read", async () => {
      resourceLookup.mockRejectedValue(new Error("database unavailable"));

      await expect(
        RunnerJobService.enqueueAiResourceCommand(args()),
      ).rejects.toThrow("database unavailable");
      expect(createdRows).toHaveLength(0);
    });
  });

  describe("5. the target, re-resolved now", () => {
    it("refuses when the resource has no online agent, and says what to install", async () => {
      agentLookup.mockResolvedValue(null);

      const refusal: ResourceCommandEnqueueRefusedException =
        await refusalOf(args());

      expect(refusal.refusalCode).toBe("agent_not_online");
      expect(refusal.message).toContain(
        'Docker host "web-1" has no online Docker AI agent',
      );
      expect(refusal.message).toContain("oneuptime/resource-ai-agent");
      expect(refusal.message).toContain("DOCKER_HOST_NAME=web-1");
    });

    it("fails closed when the agent cannot be read", async () => {
      agentLookup.mockRejectedValue(new Error("agent read failed"));

      await expect(
        RunnerJobService.enqueueAiResourceCommand(args()),
      ).rejects.toThrow("agent read failed");
      expect(createdRows).toHaveLength(0);
    });

    it("refuses when the caller named another agent (reset or replaced)", async () => {
      const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
        args({ targetResourceAiAgentId: OTHER_AGENT_ID }),
      );

      expect(refusal.refusalCode).toBe("agent_changed");
      expect(refusal.message).toContain("no longer reached through this");
    });

    it.each<[string, Record<string, unknown>]>([
      ["another project's", { projectId: ObjectID.generate() }],
      ["another resource's", { resourceId: ObjectID.generate() }],
      ["another type's", { resourceType: AiResourceType.PodmanHost }],
    ])(
      "refuses an agent row that is %s",
      async (_label: string, overrides: Record<string, unknown>) => {
        agentLookup.mockResolvedValue(agent(overrides));

        const refusal: ResourceCommandEnqueueRefusedException =
          await refusalOf(args());

        expect(refusal.refusalCode).toBe("agent_changed");
      },
    );
  });

  describe("6. the switch", () => {
    it("refuses an investigation read when investigation is off", async () => {
      resourceLookup.mockResolvedValue([
        dockerHostRow({ isAiInvestigationEnabled: false }),
      ] as never);

      const refusal: ResourceCommandEnqueueRefusedException =
        await refusalOf(args());

      expect(refusal.refusalCode).toBe("switch_off");
      expect(refusal.message).toBe(
        'AI investigation is turned off for Docker host "web-1", so this investigation command was not enqueued.',
      );
    });

    it("lets the access test read with investigation off", async () => {
      resourceLookup.mockResolvedValue([
        dockerHostRow({
          isAiInvestigationEnabled: false,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
        }),
      ] as never);

      const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand(
        args({ isAccessTest: true, aiRunId: undefined }),
      );

      expect(job.stepType).toBe(RunbookStepType.ResourceCommand);
      expect(runLookup).not.toHaveBeenCalled();
    });

    it("refuses a remediation command when fixes are off", async () => {
      resourceLookup.mockResolvedValue([
        dockerHostRow({
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
        }),
      ] as never);

      const refusal: ResourceCommandEnqueueRefusedException =
        await refusalOf(remediationArgs());

      expect(refusal.refusalCode).toBe("switch_off");
      expect(refusal.message).toContain("AI fixes are turned off");
    });

    it("reads an unknown stored mode as fixes off", async () => {
      resourceLookup.mockResolvedValue([
        dockerHostRow({ aiRemediationMode: "Everything" }),
      ] as never);

      const refusal: ResourceCommandEnqueueRefusedException =
        await refusalOf(remediationArgs());

      expect(refusal.refusalCode).toBe("switch_off");
    });

    it("lets a remediation run's reads through with investigation off, and refuses them with fixes off", async () => {
      runLookup.mockResolvedValue({
        id: RUN_ID,
        runType: AIRunType.RemediationExecution,
      } as unknown as AIRun);
      resourceLookup.mockResolvedValue([
        dockerHostRow({ isAiInvestigationEnabled: false }),
      ] as never);

      await RunnerJobService.enqueueAiResourceCommand(args());
      expect(createdRows).toHaveLength(1);

      resourceLookup.mockResolvedValue([
        dockerHostRow({
          isAiInvestigationEnabled: true,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
        }),
      ] as never);

      const refusal: ResourceCommandEnqueueRefusedException =
        await refusalOf(args());
      expect(refusal.refusalCode).toBe("switch_off");
    });
  });

  describe("7. no credential", () => {
    it("refuses a command that names a credential", async () => {
      const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
        args({ credentialId: ObjectID.generate().toString() }),
      );

      expect(refusal.refusalCode).toBe("credential_refused");
      expect(refusal.message).toContain("never given one by OneUptime");
      expect(createdRows).toHaveLength(0);
    });
  });

  describe("8. the agent's posture", () => {
    it.each<[string, ResourceAiAgent]>([
      ["no posture", agent({ posture: undefined })],
      ["an unreadable posture", agent({ posture: { allowWrites: true } })],
      [
        "a posture for another type",
        agent(
          {},
          {
            resourceType: AiResourceType.PodmanHost,
          },
        ),
      ],
    ])(
      "refuses an agent with %s",
      async (_label: string, row: ResourceAiAgent) => {
        agentLookup.mockResolvedValue(row);

        const refusal: ResourceCommandEnqueueRefusedException =
          await refusalOf(args());

        expect(refusal.refusalCode).toBe("agent_posture_mismatch");
        expect(refusal.message).toContain(
          "the Docker host's AI agent page (AI → AI agent)",
        );
      },
    );

    it("refuses every write from a read-only agent, naming the setting", async () => {
      agentLookup.mockResolvedValue(agent({}, { allowWrites: false }));

      const refusal: ResourceCommandEnqueueRefusedException =
        await refusalOf(remediationArgs());

      expect(refusal.refusalCode).toBe("write_scope");
      expect(refusal.message).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
      expect(refusal.message).toContain("It was not enqueued.");
    });

    it("still lets a read-only agent run reads", async () => {
      agentLookup.mockResolvedValue(agent({}, { allowWrites: false }));

      await RunnerJobService.enqueueAiResourceCommand(args());
      await RunnerJobService.enqueueAiResourceCommand(
        remediationArgs({ command: "docker ps" }),
      );

      expect(createdRows).toHaveLength(2);
    });

    it("refuses a write on one of the agent's protected targets", async () => {
      const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
        remediationArgs({ command: "docker restart oneuptime-ai-agent" }),
      );

      expect(refusal.refusalCode).toBe("write_scope");
      expect(refusal.message).toContain("which the Docker AI agent protects");
    });

    it("refuses a write outside the agent's write targets and allows one inside", async () => {
      agentLookup.mockResolvedValue(agent({}, { writeTargets: ["api-*"] }));

      const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
        remediationArgs({ command: "docker restart web" }),
      );
      expect(refusal.refusalCode).toBe("write_scope");
      expect(refusal.message).toContain("ONEUPTIME_AI_WRITE_TARGETS=api-*");

      await RunnerJobService.enqueueAiResourceCommand(
        remediationArgs({ command: "docker restart api-1" }),
      );
      expect(createdRows).toHaveLength(1);
    });
  });

  describe("other resource types", () => {
    it("enqueues a host's systemctl read for the Host AI agent", async () => {
      jest.spyOn(HostService, "findBy").mockResolvedValue([
        {
          _id: RESOURCE_ID.toString(),
          projectId: PROJECT_ID,
          name: "db-host",
          hostIdentifier: "db-host",
          isAiInvestigationEnabled: true,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
        },
      ] as never);
      agentLookup.mockResolvedValue(
        agent(
          {
            resourceType: AiResourceType.Host,
            resourceIdentifier: "db-host",
          },
          { resourceType: AiResourceType.Host, resourceIdentifier: "db-host" },
        ),
      );

      const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand(
        args({
          resourceType: AiResourceType.Host,
          command: "systemctl status nginx --no-pager",
        }),
      );

      const payload: ResourceCommandJobPayload =
        job.payload as unknown as ResourceCommandJobPayload;
      expect(payload.program).toBe("systemctl");
      expect(payload.resourceType).toBe(AiResourceType.Host);
      expect(payload.resourceIdentifier).toBe("db-host");
      expect(job.resourceType).toBe(AiResourceType.Host);
    });

    it("refuses a docker command for a host (wrong program for the type)", async () => {
      const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
        args({ resourceType: AiResourceType.Host, command: "docker ps" }),
      );

      expect(refusal.refusalCode).toBe("policy_denied");
      expect(refusal.message).toContain("Denied by the Host command policy");
    });

    it("enqueues a database catalog read and names the database server in refusals", async () => {
      jest.spyOn(DatabaseServerService, "findBy").mockResolvedValue([
        {
          _id: RESOURCE_ID.toString(),
          projectId: PROJECT_ID,
          name: "orders",
          dbSystem: "postgresql",
          serverAddress: "db.internal",
          serverPort: 5432,
          isAiInvestigationEnabled: false,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
        },
      ] as never);
      agentLookup.mockResolvedValue(
        agent(
          {
            resourceType: AiResourceType.DatabaseServer,
            resourceIdentifier: "postgresql|db.internal:5432",
          },
          {
            resourceType: AiResourceType.DatabaseServer,
            resourceIdentifier: "postgresql|db.internal:5432",
          },
        ),
      );

      const refusal: ResourceCommandEnqueueRefusedException = await refusalOf(
        args({
          resourceType: AiResourceType.DatabaseServer,
          command: "db sessions --limit 5",
        }),
      );

      expect(refusal.refusalCode).toBe("switch_off");
      expect(refusal.message).toContain('database server "orders"');
    });

    it("carries a database agent's registered endpoint identity", async () => {
      jest.spyOn(DatabaseServerService, "findBy").mockResolvedValue([
        {
          _id: RESOURCE_ID.toString(),
          projectId: PROJECT_ID,
          name: "orders",
          dbSystem: "postgresql",
          serverAddress: "db.internal",
          serverPort: 5432,
          isAiInvestigationEnabled: true,
        },
      ] as never);
      agentLookup.mockResolvedValue(
        agent(
          {
            resourceType: AiResourceType.DatabaseServer,
            resourceIdentifier: "postgres|db.internal:5432",
          },
          {
            resourceType: AiResourceType.DatabaseServer,
            resourceIdentifier: "postgres|db.internal:5432",
          },
        ),
      );

      const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand(
        args({
          resourceType: AiResourceType.DatabaseServer,
          command: "db sessions --limit 5",
        }),
      );
      const payload: ResourceCommandJobPayload =
        job.payload as unknown as ResourceCommandJobPayload;

      // The agent compares this to what it registered with, not the row's.
      expect(payload.resourceIdentifier).toBe("postgres|db.internal:5432");
      expect(payload.program).toBe("db");
      expect(payload.args).toEqual(["sessions", "--limit", "5"]);
    });
  });
});

describe("RunnerJobService.getResourceBindingRefusal", () => {
  function row(
    overrides: Partial<ResourceAiAccessRow> = {},
  ): ResourceAiAccessRow {
    return {
      resourceType: AiResourceType.CephCluster,
      id: RESOURCE_ID,
      projectId: PROJECT_ID,
      name: "ceph-prod",
      identifier: "ceph-prod",
      isAiInvestigationEnabled: true,
      aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      aiCommandAllowlist: [],
      isArchived: false,
      ...overrides,
    };
  }

  function cephAgent(): ResourceAiAgent {
    return agent({ resourceType: AiResourceType.CephCluster });
  }

  function codeOf(
    refusal: { code: ResourceCommandEnqueueRefusalCode } | null,
  ): ResourceCommandEnqueueRefusalCode | null {
    return refusal ? refusal.code : null;
  }

  it("allows the resource's own online agent with the switch on", () => {
    expect(
      RunnerJobServiceClass.getResourceBindingRefusal({
        resource: row(),
        agent: cephAgent(),
        requiredSwitch: "investigation",
      }),
    ).toBeNull();
  });

  it("checks the agent before the switch, and the switch before the credential", () => {
    expect(
      codeOf(
        RunnerJobServiceClass.getResourceBindingRefusal({
          resource: row({ isAiInvestigationEnabled: false }),
          agent: null,
          credentialId: "x",
          requiredSwitch: "investigation",
        }),
      ),
    ).toBe("agent_not_online");

    expect(
      codeOf(
        RunnerJobServiceClass.getResourceBindingRefusal({
          resource: row({ isAiInvestigationEnabled: false }),
          agent: cephAgent(),
          credentialId: "x",
          requiredSwitch: "investigation",
        }),
      ),
    ).toBe("switch_off");

    expect(
      codeOf(
        RunnerJobServiceClass.getResourceBindingRefusal({
          resource: row(),
          agent: cephAgent(),
          credentialId: "x",
          requiredSwitch: "investigation",
        }),
      ),
    ).toBe("credential_refused");
  });

  it("needs no switch for the access test", () => {
    expect(
      RunnerJobServiceClass.getResourceBindingRefusal({
        resource: row({
          isAiInvestigationEnabled: false,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
        }),
        agent: cephAgent(),
        requiredSwitch: null,
      }),
    ).toBeNull();
  });

  it.each<[ResourceAiRemediationMode]>([
    [ResourceAiRemediationMode.RequireApproval],
    [ResourceAiRemediationMode.Automatic],
    [ResourceAiRemediationMode.BypassApproval],
  ])(
    "lets remediation through in mode %s",
    (mode: ResourceAiRemediationMode) => {
      expect(
        RunnerJobServiceClass.getResourceBindingRefusal({
          resource: row({ aiRemediationMode: mode }),
          agent: cephAgent(),
          requiredSwitch: "remediation",
        }),
      ).toBeNull();
    },
  );

  it("words the refusal for the resource's own noun", () => {
    const refusal: {
      code: ResourceCommandEnqueueRefusalCode;
      message: string;
    } | null = RunnerJobServiceClass.getResourceBindingRefusal({
      resource: row({ aiRemediationMode: ResourceAiRemediationMode.Disabled }),
      agent: cephAgent(),
      requiredSwitch: "remediation",
    });

    expect(refusal?.message).toBe(
      'AI fixes are turned off for Ceph cluster "ceph-prod", so this command was not enqueued.',
    );
  });
});
