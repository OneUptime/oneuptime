import AiCommandKillSwitch, {
  AI_COMMANDS_OFF_CLAIM_MESSAGE,
  AI_COMMANDS_OFF_ENQUEUE_MESSAGE,
} from "../../../../Server/Utils/AI/AiCommandKillSwitch";
import RunnerJobService, {
  ResourceCommandEnqueueRefusedException,
} from "../../../../Server/Services/RunnerJobService";
import AIRunService from "../../../../Server/Services/AIRunService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import KubernetesAiAgentService from "../../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ResourceAiAgentService from "../../../../Server/Services/ResourceAiAgentService";
import RunnerService from "../../../../Server/Services/RunnerService";
import logger from "../../../../Server/Utils/Logger";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import Project from "../../../../Models/DatabaseModels/Project";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import Runner from "../../../../Models/DatabaseModels/Runner";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AIRunType from "../../../../Types/AI/AIRunType";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { KubernetesAiRemediationMode } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Contract under test — Enable AI (Project.enableAi) stops every command
 * OneUptime AI sends to infrastructure, not only its model calls
 * (AIKillSwitchBackstop pins those):
 *
 *  - AiCommandKillSwitch reads the switch the way every AI gate does
 *    (=== false, root, one column) and fails closed on a project that is
 *    gone;
 *  - each of the three enqueue chokepoints - enqueueAiCommand (a Runner's
 *    Bash), enqueueAiKubectlCommand (a cluster) and enqueueAiResourceCommand
 *    (a resource's AI agent, a cloud account's included) - refuses with AI
 *    off before it reads or writes anything else, and writes no job;
 *  - Test connection and Test access are the one exception: a person runs
 *    them to check an agent before turning AI on;
 *  - a job an agent claims after the switch went off is refused at the
 *    claim (getClaimRefusal), unless it is an access test or a runbook's
 *    own step;
 *  - and a source guard: every enqueueAi* chokepoint of RunnerJobService
 *    reads the switch, so a new lane cannot forget it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const RUN_ID: ObjectID = new ObjectID("23232323-2323-4323-8323-232323232323");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "34343434-3434-4434-8434-343434343434",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "45454545-4545-4545-8545-454545454545",
);
const AGENT_ID: ObjectID = new ObjectID("56565656-5656-4656-8656-565656565656");
const CLUSTER_ID: ObjectID = new ObjectID(
  "67676767-6767-4767-8767-676767676767",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "78787878-7878-4878-8878-787878787878",
);

const RUNNER_JOB_SERVICE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Services",
  "RunnerJobService.ts",
);

function project(enableAi: boolean | undefined): Project {
  const row: Project = new Project();
  row.id = PROJECT_ID;

  if (enableAi !== undefined) {
    row.enableAi = enableAi;
  }

  return row;
}

function dockerHostRow(): Record<string, unknown> {
  return {
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    name: "web-1",
    hostIdentifier: "web-1",
    isArchived: false,
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
  };
}

function dockerAgent(): ResourceAiAgent {
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
    },
  } as unknown as ResourceAiAgent;
}

function cluster(): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-us",
    clusterIdentifier: "prod-us",
    aiAccessRunnerId: RUNNER_ID,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
  } as unknown as KubernetesCluster;
}

function inClusterRunner(): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    projectId: PROJECT_ID,
    name: "kubernetes-agent/prod-us",
    hostInfo: {
      kubernetes: {
        inCluster: true,
        allowWrites: true,
        clusterIdentifier: "prod-us",
      },
    },
  } as unknown as Runner;
}

function officeRunner(): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    projectId: PROJECT_ID,
    name: "office-runner",
  } as unknown as Runner;
}

async function rejectionOf(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    return error as Error;
  }

  throw new Error("expected the call to be refused");
}

/*
 * The body of one method of a class source: from its signature to the
 * closing brace at its own indentation. Reads with indexOf, no regex over
 * the file.
 */
function methodBody(source: string, signature: string): string {
  const start: number = source.indexOf(signature);

  if (start < 0) {
    return "";
  }

  const end: number = source.indexOf("\n  }\n", start);

  return source.slice(start, end < 0 ? source.length : end);
}

describe("AiCommandKillSwitch", () => {
  let projectLookup: jest.SpyInstance;

  beforeEach(() => {
    projectLookup = jest.spyOn(ProjectService, "findOneById");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("isAiOff", () => {
    it("is off when Enable AI is off", async () => {
      projectLookup.mockResolvedValue(project(false));

      expect(await AiCommandKillSwitch.isAiOff(PROJECT_ID)).toBe(true);
    });

    it("is on when Enable AI is on", async () => {
      projectLookup.mockResolvedValue(project(true));

      expect(await AiCommandKillSwitch.isAiOff(PROJECT_ID)).toBe(false);
    });

    it("never reads a value that was not read as off (=== false)", async () => {
      projectLookup.mockResolvedValue(project(undefined));

      expect(await AiCommandKillSwitch.isAiOff(PROJECT_ID)).toBe(false);
    });

    it("is off for a project that is gone: there is nobody left to act for", async () => {
      projectLookup.mockResolvedValue(null);

      expect(await AiCommandKillSwitch.isAiOff(PROJECT_ID)).toBe(true);
    });

    it("reads the one column, as root, for that project", async () => {
      projectLookup.mockResolvedValue(project(true));

      await AiCommandKillSwitch.isAiOff(PROJECT_ID);

      expect(projectLookup).toHaveBeenCalledTimes(1);
      const read: Record<string, unknown> = projectLookup.mock
        .calls[0]![0] as Record<string, unknown>;
      expect((read["id"] as ObjectID).toString()).toBe(PROJECT_ID.toString());
      expect(read["select"]).toEqual({ _id: true, enableAi: true });
      expect(read["props"]).toEqual({ isRoot: true });
    });

    it("lets a read that fails throw, so every caller fails closed", async () => {
      projectLookup.mockRejectedValue(new Error("database is down"));

      await expect(AiCommandKillSwitch.isAiOff(PROJECT_ID)).rejects.toThrow(
        "database is down",
      );
    });
  });

  describe("which jobs it holds", () => {
    it("an access test is the AI-command job with no AI run and no suggestion", () => {
      expect(
        AiCommandKillSwitch.isAccessTestJob({
          origin: RunnerJobOrigin.AiInvestigation,
        }),
      ).toBe(true);
      expect(
        AiCommandKillSwitch.isAccessTestJob({
          origin: RunnerJobOrigin.AiInvestigation,
          aiRunId: RUN_ID,
        }),
      ).toBe(false);
      expect(
        AiCommandKillSwitch.isAccessTestJob({
          origin: RunnerJobOrigin.AiRemediation,
          autoRemediationSuggestionId: SUGGESTION_ID,
        }),
      ).toBe(false);
      expect(
        AiCommandKillSwitch.isAccessTestJob({
          origin: RunnerJobOrigin.AiRemediation,
        }),
      ).toBe(false);
    });

    it("both AI origins are AI commands; a runbook's own step is not", () => {
      expect(
        AiCommandKillSwitch.isAiCommandJob({
          origin: RunnerJobOrigin.AiRemediation,
        }),
      ).toBe(true);
      expect(
        AiCommandKillSwitch.isAiCommandJob({
          origin: RunnerJobOrigin.AiInvestigation,
        }),
      ).toBe(true);
      expect(
        AiCommandKillSwitch.isAiCommandJob({ origin: RunnerJobOrigin.Runbook }),
      ).toBe(false);
      // A row without an origin is a runbook's: the column's backfill.
      expect(AiCommandKillSwitch.isAiCommandJob({})).toBe(false);
    });
  });

  describe("getClaimRefusal", () => {
    it("refuses an AI fix's command once Enable AI is off", async () => {
      projectLookup.mockResolvedValue(project(false));

      expect(
        await AiCommandKillSwitch.getClaimRefusal({
          job: {
            origin: RunnerJobOrigin.AiRemediation,
            autoRemediationSuggestionId: SUGGESTION_ID,
          },
          projectId: PROJECT_ID,
        }),
      ).toBe(AI_COMMANDS_OFF_CLAIM_MESSAGE);
    });

    it("refuses an investigation's read once Enable AI is off", async () => {
      projectLookup.mockResolvedValue(project(false));

      expect(
        await AiCommandKillSwitch.getClaimRefusal({
          job: { origin: RunnerJobOrigin.AiInvestigation, aiRunId: RUN_ID },
          projectId: PROJECT_ID,
        }),
      ).toBe(AI_COMMANDS_OFF_CLAIM_MESSAGE);
    });

    it("serves the same job while Enable AI is on", async () => {
      projectLookup.mockResolvedValue(project(true));

      expect(
        await AiCommandKillSwitch.getClaimRefusal({
          job: {
            origin: RunnerJobOrigin.AiRemediation,
            autoRemediationSuggestionId: SUGGESTION_ID,
          },
          projectId: PROJECT_ID,
        }),
      ).toBeNull();
    });

    it("never holds a runbook's own step, and does not even read the project for it", async () => {
      projectLookup.mockResolvedValue(project(false));

      expect(
        await AiCommandKillSwitch.getClaimRefusal({
          job: { origin: RunnerJobOrigin.Runbook },
          projectId: PROJECT_ID,
        }),
      ).toBeNull();
      expect(projectLookup).not.toHaveBeenCalled();
    });

    it("never holds an access test", async () => {
      projectLookup.mockResolvedValue(project(false));

      expect(
        await AiCommandKillSwitch.getClaimRefusal({
          job: { origin: RunnerJobOrigin.AiInvestigation },
          projectId: PROJECT_ID,
        }),
      ).toBeNull();
      expect(projectLookup).not.toHaveBeenCalled();
    });

    it("reads the claim's project", async () => {
      projectLookup.mockResolvedValue(project(true));

      await AiCommandKillSwitch.getClaimRefusal({
        job: { origin: RunnerJobOrigin.AiInvestigation, aiRunId: RUN_ID },
        projectId: PROJECT_ID,
      });

      const read: Record<string, unknown> = projectLookup.mock
        .calls[0]![0] as Record<string, unknown>;
      expect((read["id"] as ObjectID).toString()).toBe(PROJECT_ID.toString());
    });
  });

  it("says what was stopped and where the switch is", () => {
    expect(AI_COMMANDS_OFF_ENQUEUE_MESSAGE).toContain("Enable AI");
    expect(AI_COMMANDS_OFF_ENQUEUE_MESSAGE).toContain(
      "Project Settings → AI → AI Features",
    );
    expect(AI_COMMANDS_OFF_ENQUEUE_MESSAGE).toContain("not sent");
    expect(AI_COMMANDS_OFF_CLAIM_MESSAGE).toContain("Enable AI");
    expect(AI_COMMANDS_OFF_CLAIM_MESSAGE).toContain("did not run it");
  });
});

describe("the enqueue chokepoints with Enable AI off", () => {
  let created: jest.SpyInstance;
  let isAiOff: jest.SpyInstance;

  beforeEach(() => {
    // @CaptureSpan logs the expected throws at error level.
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    created = jest
      .spyOn(RunnerJobService, "create")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        return (data as { data: RunnerJob }).data;
      });
    jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
      id: RUN_ID,
      runType: AIRunType.Investigation,
    } as unknown as AIRun);
    isAiOff = jest
      .spyOn(AiCommandKillSwitch, "isAiOff")
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("enqueueAiResourceCommand (a resource's AI agent)", () => {
    let resourceLookup: jest.SpyInstance;

    beforeEach(() => {
      resourceLookup = jest
        .spyOn(DockerHostService, "findBy")
        .mockResolvedValue([dockerHostRow()] as never);
      jest
        .spyOn(ResourceAiAgentService, "findOnlineAgentForResource")
        .mockResolvedValue(dockerAgent());
    });

    it("refuses a fix's change with ai_disabled, writes no job and reads no resource", async () => {
      const error: Error = await rejectionOf(
        RunnerJobService.enqueueAiResourceCommand({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
          origin: RunnerJobOrigin.AiRemediation,
          autoRemediationSuggestionId: SUGGESTION_ID,
          resourceType: AiResourceType.DockerHost,
          resourceId: RESOURCE_ID,
          stepId: "ai-approved-1",
          command: "docker restart web",
          timeoutInMs: 30000,
        }),
      );

      expect(error).toBeInstanceOf(ResourceCommandEnqueueRefusedException);
      expect(
        (error as ResourceCommandEnqueueRefusedException).refusalCode,
      ).toBe("ai_disabled");
      expect(error.message).toBe(AI_COMMANDS_OFF_ENQUEUE_MESSAGE);
      expect(created).not.toHaveBeenCalled();
      expect(resourceLookup).not.toHaveBeenCalled();
      expect((isAiOff.mock.calls[0]![0] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
    });

    it("refuses an investigation's read too", async () => {
      const error: Error = await rejectionOf(
        RunnerJobService.enqueueAiResourceCommand({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
          origin: RunnerJobOrigin.AiInvestigation,
          resourceType: AiResourceType.DockerHost,
          resourceId: RESOURCE_ID,
          stepId: "ai-investigation-resource-1",
          command: "docker ps -a",
          timeoutInMs: 30000,
        }),
      );

      expect(
        (error as ResourceCommandEnqueueRefusedException).refusalCode,
      ).toBe("ai_disabled");
      expect(created).not.toHaveBeenCalled();
    });

    it("still runs Test connection: a person checks the agent before turning AI on", async () => {
      const job: RunnerJob = await RunnerJobService.enqueueAiResourceCommand({
        projectId: PROJECT_ID,
        origin: RunnerJobOrigin.AiInvestigation,
        resourceType: AiResourceType.DockerHost,
        resourceId: RESOURCE_ID,
        stepId: "resource-access-test",
        command: "docker version",
        timeoutInMs: 30000,
        isAccessTest: true,
      });

      expect(created).toHaveBeenCalledTimes(1);
      expect(job.origin).toBe(RunnerJobOrigin.AiInvestigation);
      expect(isAiOff).not.toHaveBeenCalled();
    });

    it("enqueues as before once Enable AI is on", async () => {
      isAiOff.mockResolvedValue(false);

      await RunnerJobService.enqueueAiResourceCommand({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        origin: RunnerJobOrigin.AiRemediation,
        autoRemediationSuggestionId: SUGGESTION_ID,
        resourceType: AiResourceType.DockerHost,
        resourceId: RESOURCE_ID,
        stepId: "ai-approved-1",
        command: "docker restart web",
        timeoutInMs: 30000,
      });

      expect(created).toHaveBeenCalledTimes(1);
    });
  });

  describe("enqueueAiKubectlCommand (a cluster)", () => {
    let clusterLookup: jest.SpyInstance;

    beforeEach(() => {
      jest
        .spyOn(KubernetesAiAgentService, "findForCluster")
        .mockResolvedValue(null);
      clusterLookup = jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(cluster());
      jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(inClusterRunner());
    });

    it("refuses a fix's kubectl change, writes no job and reads no cluster", async () => {
      const error: Error = await rejectionOf(
        RunnerJobService.enqueueAiKubectlCommand({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
          origin: RunnerJobOrigin.AiRemediation,
          autoRemediationSuggestionId: SUGGESTION_ID,
          kubernetesClusterId: CLUSTER_ID,
          stepId: "ai-approved-1",
          targetAgentId: RUNNER_ID,
          command: "kubectl rollout restart deployment/web -n web",
          timeoutInMs: 30000,
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(AI_COMMANDS_OFF_ENQUEUE_MESSAGE);
      expect(created).not.toHaveBeenCalled();
      expect(clusterLookup).not.toHaveBeenCalled();
    });

    it("refuses an investigation's kubectl read too", async () => {
      const error: Error = await rejectionOf(
        RunnerJobService.enqueueAiKubectlCommand({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
          origin: RunnerJobOrigin.AiInvestigation,
          kubernetesClusterId: CLUSTER_ID,
          stepId: "ai-investigation-kubectl-1",
          targetAgentId: RUNNER_ID,
          command: "kubectl get pods -n web",
          timeoutInMs: 30000,
        }),
      );

      expect(error.message).toBe(AI_COMMANDS_OFF_ENQUEUE_MESSAGE);
      expect(created).not.toHaveBeenCalled();
    });

    it("still runs Test access", async () => {
      await RunnerJobService.enqueueAiKubectlCommand({
        projectId: PROJECT_ID,
        origin: RunnerJobOrigin.AiInvestigation,
        kubernetesClusterId: CLUSTER_ID,
        stepId: "kubectl-access-test",
        targetAgentId: RUNNER_ID,
        command: "kubectl get namespaces",
        timeoutInMs: 30000,
        isAccessTest: true,
      });

      expect(created).toHaveBeenCalledTimes(1);
      expect(isAiOff).not.toHaveBeenCalled();
    });
  });

  describe("enqueueAiCommand (a Runner's Bash)", () => {
    let runnerLookup: jest.SpyInstance;

    beforeEach(() => {
      runnerLookup = jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(officeRunner());
    });

    it("refuses the command, writes no job and reads no Runner", async () => {
      const error: Error = await rejectionOf(
        RunnerJobService.enqueueAiCommand({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
          autoRemediationSuggestionId: SUGGESTION_ID,
          stepId: "ai-approved-1",
          stepType: RunbookStepType.Bash,
          targetAgentId: RUNNER_ID,
          command: "systemctl restart nginx",
          timeoutInMs: 30000,
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(AI_COMMANDS_OFF_ENQUEUE_MESSAGE);
      expect(created).not.toHaveBeenCalled();
      expect(runnerLookup).not.toHaveBeenCalled();
    });

    it("enqueues as before once Enable AI is on", async () => {
      isAiOff.mockResolvedValue(false);

      await RunnerJobService.enqueueAiCommand({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        autoRemediationSuggestionId: SUGGESTION_ID,
        stepId: "ai-approved-1",
        stepType: RunbookStepType.Bash,
        targetAgentId: RUNNER_ID,
        command: "systemctl restart nginx",
        timeoutInMs: 30000,
      });

      expect(created).toHaveBeenCalledTimes(1);
    });
  });
});

describe("guard: every AI command chokepoint reads Enable AI", () => {
  const source: string = fs.readFileSync(RUNNER_JOB_SERVICE_PATH, "utf-8");

  // Every public enqueueAi* method of the service, by name.
  const chokepoints: Array<string> = source
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("  public async enqueueAi");
    })
    .map((line: string): string => {
      return line.slice("  public async ".length, line.indexOf("("));
    });

  it("finds the three lanes: a Runner's Bash, a cluster's kubectl, a resource's AI agent", () => {
    expect(chokepoints.sort()).toEqual([
      "enqueueAiCommand",
      "enqueueAiKubectlCommand",
      "enqueueAiResourceCommand",
    ]);
  });

  for (const name of [
    "enqueueAiCommand",
    "enqueueAiKubectlCommand",
    "enqueueAiResourceCommand",
  ]) {
    it(`${name} refuses with the kill switch's own message`, () => {
      const body: string = methodBody(source, `public async ${name}(`);

      expect(body.length).toBeGreaterThan(0);
      expect(body).toContain("AiCommandKillSwitch.isAiOff(data.projectId)");
      expect(body).toContain("AI_COMMANDS_OFF_ENQUEUE_MESSAGE");
    });
  }

  it("exempts the access tests and nothing else", () => {
    for (const name of [
      "enqueueAiKubectlCommand",
      "enqueueAiResourceCommand",
    ]) {
      expect(methodBody(source, `public async ${name}(`)).toContain(
        "!isAccessTest && (await AiCommandKillSwitch.isAiOff(data.projectId))",
      );
    }

    // A Runner's Bash has no access test: nothing exempts it.
    expect(methodBody(source, "public async enqueueAiCommand(")).toContain(
      "if (await AiCommandKillSwitch.isAiOff(data.projectId)) {",
    );
  });
});
