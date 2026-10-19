import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import AIRunService from "../../../../../Server/Services/AIRunService";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import RunbookExecutionService from "../../../../../Server/Services/RunbookExecutionService";
import RunnerJobService from "../../../../../Server/Services/RunnerJobService";
import logger from "../../../../../Server/Utils/Logger";
import OwnChangeRecorder, {
  OWN_CHANGE_RECORDED_NAMESPACE,
} from "../../../../../Server/Utils/Telemetry/ChangeDetection/OwnChangeRecorder";
import TelemetryFanInWriter from "../../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import RunbookExecutionStatus from "../../../../../Types/Runbook/RunbookExecutionStatus";
import RunbookStepType from "../../../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../../Types/Runbook/RunnerJobStatus";

/*
 * OwnChangeRecorder reads the job or the runbook execution OneUptime just
 * finished and records a change event for what it changed - only for a
 * write, only once, and never failing the caller.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000001",
);
const JOB_ID: ObjectID = new ObjectID("5e7a1b30-0000-4000-8000-000000000002");
const RUN_ID: ObjectID = new ObjectID("5e7a1b30-0000-4000-8000-000000000003");
const INCIDENT_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000004",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000005",
);
const HOST_ID: ObjectID = new ObjectID("5e7a1b30-0000-4000-8000-000000000006");
const EXECUTION_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000007",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000008",
);
const STARTED_AT: Date = new Date("2026-10-19T10:02:00.000Z");

interface Submission {
  target: unknown;
  rows: Array<JSONObject>;
  dedupToken: string | undefined;
}

let submissions: Array<Submission>;
let claimed: Set<string>;
let jobLookup: SpyInstance<typeof RunnerJobService.findOneById>;
let runLookup: SpyInstance<typeof AIRunService.findOneById>;
let executionLookup: SpyInstance<typeof RunbookExecutionService.findOneById>;

function kubectlJob(overrides: JSONObject = {}): JSONObject {
  return {
    _id: JOB_ID.toString(),
    projectId: PROJECT_ID,
    origin: RunnerJobOrigin.AiRemediation,
    stepType: RunbookStepType.Kubectl,
    status: RunnerJobStatus.Succeeded,
    payload: {
      args: ["rollout", "restart", "deployment/api", "-n", "web"],
      displayCommand: "kubectl rollout restart deployment/api -n web",
      tier: "SafeWrite",
      kubernetesClusterId: CLUSTER_ID.toString(),
    },
    script: "",
    aiRunId: RUN_ID,
    kubernetesClusterId: CLUSTER_ID,
    startedAt: STARTED_AT,
    ...overrides,
  };
}

function execution(overrides: JSONObject = {}): JSONObject {
  return {
    _id: EXECUTION_ID.toString(),
    projectId: PROJECT_ID,
    runbookId: RUNBOOK_ID,
    runbookNameSnapshot: "Flush cache",
    status: RunbookExecutionStatus.Completed,
    startedAt: STARTED_AT,
    completedAt: new Date("2026-10-19T10:03:00.000Z"),
    incidentId: INCIDENT_ID,
    ...overrides,
  };
}

function rows(): Array<JSONObject> {
  return submissions.flatMap((submission: Submission) => {
    return submission.rows;
  });
}

function attributesOf(row: JSONObject): Dictionary<string> {
  return row["attributes"] as Dictionary<string>;
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  }
}

beforeEach(() => {
  submissions = [];
  claimed = new Set<string>();

  jobLookup = jest
    .spyOn(RunnerJobService, "findOneById")
    .mockResolvedValue(kubectlJob() as never);
  runLookup = jest
    .spyOn(AIRunService, "findOneById")
    .mockResolvedValue({ triggeredByIncidentId: INCIDENT_ID } as never);
  executionLookup = jest
    .spyOn(RunbookExecutionService, "findOneById")
    .mockResolvedValue(execution() as never);

  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(async (namespace: string, key: string) => {
      const full: string = `${namespace}-${key}`;
      if (claimed.has(full)) {
        return false;
      }
      claimed.add(full);
      return true;
    });

  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    target: unknown,
    submitted: Array<JSONObject>,
    options?: { dedupToken?: string | undefined },
  ) => {
    submissions.push({
      target,
      rows: submitted,
      dedupToken: options?.dedupToken,
    });
    return { flushed: Promise.resolve() };
  }) as never);

  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a fix command OneUptime AI ran", () => {
  test("is recorded as a project-wide change for the incident it was for", async () => {
    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(jobLookup).toHaveBeenCalledWith(
      expect.objectContaining({ id: JOB_ID, props: { isRoot: true } }),
    );
    expect(runLookup).toHaveBeenCalledWith(
      expect.objectContaining({ id: RUN_ID }),
    );

    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.target).toBe(ChangeEventService);
    expect(submissions[0]!.dedupToken).toBe(`own-change:job:${JOB_ID}`);

    const row: JSONObject = rows()[0]!;
    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect(row["primaryEntityId"]).toBeUndefined();
    expect(row["eventType"]).toBe("remediation");
    expect(row["title"]).toBe(
      "OneUptime AI ran kubectl rollout restart deployment/api -n web",
    );
    expect(row["time"]).toBe("2026-10-19 10:02:00.000000000");
    expect(attributesOf(row)).toEqual({
      "oneuptime.change.source": "oneuptime-ai",
      "oneuptime.change.status": "succeeded",
      "oneuptime.command": "kubectl rollout restart deployment/api -n web",
      "oneuptime.kubernetes.cluster.id": CLUSTER_ID.toString(),
      "k8s.namespace.name": "web",
      "k8s.deployment.name": "api",
      "oneuptime.ai_run.id": RUN_ID.toString(),
      "oneuptime.incident.id": INCIDENT_ID.toString(),
    });
  });

  test("a failed command is recorded as failed", async () => {
    jobLookup.mockResolvedValue(
      kubectlJob({ status: RunnerJobStatus.Failed }) as never,
    );

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(attributesOf(rows()[0]!)["oneuptime.change.status"]).toBe("failed");
  });

  test("a command on a host names the host", async () => {
    jobLookup.mockResolvedValue(
      kubectlJob({
        stepType: RunbookStepType.ResourceCommand,
        kubernetesClusterId: null,
        resourceType: "Host",
        resourceId: HOST_ID,
        payload: {
          program: "systemctl",
          args: ["restart", "nginx.service"],
          displayCommand: "systemctl restart nginx.service",
          tier: "SafeWrite",
        },
      }) as never,
    );

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(attributesOf(rows()[0]!)).toMatchObject({
      "oneuptime.command": "systemctl restart nginx.service",
      "oneuptime.resource.type": "Host",
      "oneuptime.resource.id": HOST_ID.toString(),
    });
    expect(attributesOf(rows()[0]!)["k8s.namespace.name"]).toBeUndefined();
  });

  test("a Bash command's script is the command", async () => {
    jobLookup.mockResolvedValue(
      kubectlJob({
        stepType: RunbookStepType.Bash,
        payload: null,
        script: "service nginx reload",
        kubernetesClusterId: null,
      }) as never,
    );

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(attributesOf(rows()[0]!)["oneuptime.command"]).toBe(
      "service nginx reload",
    );
  });

  test("an SSH command's payload command is the command", async () => {
    jobLookup.mockResolvedValue(
      kubectlJob({
        stepType: RunbookStepType.SSH,
        payload: { credentialId: "c", command: "sudo systemctl restart app" },
        script: "",
      }) as never,
    );

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(attributesOf(rows()[0]!)["oneuptime.command"]).toBe(
      "sudo systemctl restart app",
    );
  });

  test("a command with no AI run is still recorded, for no incident", async () => {
    jobLookup.mockResolvedValue(kubectlJob({ aiRunId: null }) as never);

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(runLookup).not.toHaveBeenCalled();
    expect(attributesOf(rows()[0]!)["oneuptime.incident.id"]).toBeUndefined();
  });

  test.each([
    ["an investigation's read", { origin: RunnerJobOrigin.AiInvestigation }],
    ["a runbook step", { origin: RunnerJobOrigin.Runbook }],
    [
      "a read in a fix",
      {
        payload: {
          args: ["get", "pods"],
          displayCommand: "kubectl get pods",
          tier: "Read",
        },
      },
    ],
    ["a job still running", { status: RunnerJobStatus.Running }],
    ["a job that timed out", { status: RunnerJobStatus.TimedOut }],
    ["a job of no project", { projectId: null }],
  ])("%s is not recorded", async (_name: string, overrides: JSONObject) => {
    jobLookup.mockResolvedValue(kubectlJob(overrides) as never);

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(submissions).toEqual([]);
  });

  test("a job that is gone is not recorded", async () => {
    jobLookup.mockResolvedValue(null as never);

    await OwnChangeRecorder.recordAiCommand(JOB_ID);

    expect(submissions).toEqual([]);
  });

  test("recordAiCommandResult never throws, and logs what went wrong", async () => {
    jobLookup.mockRejectedValue(new Error("Postgres is down") as never);

    expect(() => {
      OwnChangeRecorder.recordAiCommandResult(JOB_ID);
    }).not.toThrow();
    await settle();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Postgres is down"),
    );
  });
});

describe("a runbook OneUptime ran", () => {
  test("is recorded once it finished", async () => {
    await OwnChangeRecorder.recordRunbookExecution(EXECUTION_ID);

    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.dedupToken).toBe(
      `own-change:runbook-execution:${EXECUTION_ID}`,
    );

    const row: JSONObject = rows()[0]!;
    expect(row["eventType"]).toBe("runbook");
    expect(row["title"]).toBe('Runbook "Flush cache" ran');
    expect(row["time"]).toBe("2026-10-19 10:02:00.000000000");
    expect(row["primaryEntityId"]).toBeUndefined();
    expect(attributesOf(row)).toEqual({
      "oneuptime.change.source": "runbook",
      "oneuptime.change.status": "succeeded",
      "oneuptime.runbook_execution.id": EXECUTION_ID.toString(),
      "oneuptime.runbook.id": RUNBOOK_ID.toString(),
      "oneuptime.incident.id": INCIDENT_ID.toString(),
    });
  });

  test("is recorded once, however many updates follow", async () => {
    await OwnChangeRecorder.recordRunbookExecution(EXECUTION_ID);
    await OwnChangeRecorder.recordRunbookExecution(EXECUTION_ID);

    expect(submissions).toHaveLength(1);
    expect(
      claimed.has(
        `${OWN_CHANGE_RECORDED_NAMESPACE}-runbook-execution:${EXECUTION_ID}`,
      ),
    ).toBe(true);
  });

  test("a failed runbook is recorded with why", async () => {
    executionLookup.mockResolvedValue(
      execution({
        status: RunbookExecutionStatus.Failed,
        failureReason: 'Step "Flush" failed: timeout',
      }) as never,
    );

    await OwnChangeRecorder.recordRunbookExecution(EXECUTION_ID);

    expect(rows()[0]!["title"]).toBe('Runbook "Flush cache" failed');
    expect(String(rows()[0]!["description"])).toContain(
      'Step "Flush" failed: timeout',
    );
  });

  test("a runbook cancelled after it started is recorded", async () => {
    executionLookup.mockResolvedValue(
      execution({ status: RunbookExecutionStatus.Cancelled }) as never,
    );

    await OwnChangeRecorder.recordRunbookExecution(EXECUTION_ID);

    expect(rows()[0]!["title"]).toBe('Runbook "Flush cache" was cancelled');
  });

  test.each([
    ["one still running", { status: RunbookExecutionStatus.Running }],
    [
      "one waiting for a person",
      {
        status: RunbookExecutionStatus.WaitingForManualStep,
      },
    ],
    ["one only scheduled", { status: RunbookExecutionStatus.Scheduled }],
    [
      "one cancelled before it started",
      { status: RunbookExecutionStatus.Cancelled, startedAt: null },
    ],
    ["one of no project", { projectId: null }],
  ])("%s is not recorded", async (_name: string, overrides: JSONObject) => {
    executionLookup.mockResolvedValue(execution(overrides) as never);

    await OwnChangeRecorder.recordRunbookExecution(EXECUTION_ID);

    expect(submissions).toEqual([]);
  });

  test("recordRunbookExecutions records each and never throws", async () => {
    const other: ObjectID = ObjectID.generate();
    executionLookup.mockImplementation((async (data: { id: ObjectID }) => {
      if (data.id.toString() === other.toString()) {
        throw new Error("gone");
      }
      return execution();
    }) as never);

    expect(() => {
      OwnChangeRecorder.recordRunbookExecutions([EXECUTION_ID, other]);
    }).not.toThrow();
    await settle();

    expect(submissions).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("gone"));
  });

  test("isTerminalRunbookStatus says which statuses finish an execution", () => {
    expect(
      OwnChangeRecorder.isTerminalRunbookStatus(
        RunbookExecutionStatus.Completed,
      ),
    ).toBe(true);
    expect(
      OwnChangeRecorder.isTerminalRunbookStatus(RunbookExecutionStatus.Failed),
    ).toBe(true);
    expect(
      OwnChangeRecorder.isTerminalRunbookStatus(
        RunbookExecutionStatus.Cancelled,
      ),
    ).toBe(true);
    expect(
      OwnChangeRecorder.isTerminalRunbookStatus(RunbookExecutionStatus.Running),
    ).toBe(false);
    expect(OwnChangeRecorder.isTerminalRunbookStatus(undefined)).toBe(false);
  });
});
