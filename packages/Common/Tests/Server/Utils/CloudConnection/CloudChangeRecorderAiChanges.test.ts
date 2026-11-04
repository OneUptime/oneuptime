import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import ChangeEventService from "../../../../Server/Services/ChangeEventService";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import ResourceAiAgentService from "../../../../Server/Services/ResourceAiAgentService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import { CloudAiChangeJob } from "../../../../Server/Utils/CloudConnection/CloudAiChangeAttribution";
import CloudChangeRecorder, {
  buildCloudChangeEntry,
} from "../../../../Server/Utils/CloudConnection/CloudChangeRecorder";
import { CloudChange } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import logger from "../../../../Server/Utils/Logger";
import TelemetryFanInWriter from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME } from "../../../../Types/ResourceAiAgent/CloudAiAgentNames";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  CloudAiChangeStep,
  RESERVED_CHANGE_ATTRIBUTE_PREFIX,
} from "../../../../Utils/Telemetry/ChangeEventFields";

/*
 * A CHANGE ONEUPTIME AI MADE IN A CLOUD ACCOUNT SAYS SO (#5367's follow-up).
 *
 * The cloud records the change under the Cloud AI agent's role; the change
 * event the cloud connection writes for it now says OneUptime AI made it
 * (oneuptime.change.made_by), with the fix it belongs to - the agent's
 * job, the fix, its AI run, the incident or alert it fixed, and whether it
 * was the fix or its rollback - for the account's Changes page to mark and
 * link. A person's change in the same minutes, on the same resource, is
 * written as it always was. Every key is OneUptime's own (oneuptime.), so
 * a pipeline posting change events can never claim to be OneUptime AI.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000001",
);
const ACCOUNT_ROW_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000003",
);
const SERVICE_ROW_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000010",
);
const JOB_ID: ObjectID = new ObjectID("5e7a1b30-0000-4000-8000-000000000101");
const ROLLBACK_JOB_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000102",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000020",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000021",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000022",
);
const ALERT_ID: ObjectID = new ObjectID("5e7a1b30-0000-4000-8000-000000000023");

const ACCOUNT: string = "123456789012";
const SERVICE_ARN: string = `arn:aws:ecs:us-east-1:${ACCOUNT}:service/prod/checkout-api`;
const SESSION: string = "oneuptime-ai-scale-out-1a2b3c4d";
const AT: Date = new Date("2026-11-03T10:00:00.000Z");
const MINUTE: number = 60 * 1000;

function at(minutes: number): Date {
  return new Date(AT.getTime() + minutes * MINUTE);
}

function agentChange(overrides: Partial<CloudChange> = {}): CloudChange {
  return {
    kind: "change",
    provider: CloudProvider.AWS,
    accountId: ACCOUNT,
    region: "us-east-1",
    time: AT,
    eventId: "evt-ai",
    operation: "ecs:UpdateService",
    actor: SESSION,
    actorIdentity: `arn:aws:sts::${ACCOUNT}:assumed-role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}/${SESSION}`,
    resources: [{ id: SERVICE_ARN }],
    failed: false,
    ...overrides,
  };
}

function personChange(): CloudChange {
  return agentChange({
    eventId: "evt-maya",
    actor: "maya.lopez",
    actorIdentity: `arn:aws:iam::${ACCOUNT}:user/maya.lopez`,
    time: at(0.5),
  });
}

function storedJob(data: {
  id: ObjectID;
  stepId: string;
  args: Array<string>;
  from: Date;
  to: Date;
}): RunnerJob {
  const job: RunnerJob = new RunnerJob();
  job._id = data.id.toString();
  job.stepId = data.stepId;
  job.payload = {
    resourceType: AiResourceType.AwsAccount,
    program: "cloud",
    args: data.args,
    displayCommand: `cloud ${data.args.join(" ")}`,
    tier: "SafeWrite",
  };
  job.status = RunnerJobStatus.Succeeded;
  job.createdAt = data.from;
  job.claimedAt = data.from;
  job.startedAt = data.from;
  job.completedAt = data.to;
  job.autoRemediationSuggestionId = SUGGESTION_ID;
  job.aiRunId = AI_RUN_ID;
  return job;
}

let submitted: Array<JSONObject>;
let suggestion: AutoRemediationSuggestion;
let jobs: Array<RunnerJob>;

function attributesOf(eventId: string): Dictionary<string> {
  const row: JSONObject | undefined = submitted.find(
    (entry: JSONObject): boolean => {
      return (
        (entry["attributes"] as Dictionary<string>)[
          ChangeEventAttribute.CloudEventId
        ] === eventId
      );
    },
  );

  expect(row).toBeDefined();

  return row!["attributes"] as Dictionary<string>;
}

beforeEach(() => {
  submitted = [];
  suggestion = new AutoRemediationSuggestion();
  suggestion._id = SUGGESTION_ID.toString();
  suggestion.incidentId = INCIDENT_ID;
  jobs = [
    storedJob({
      id: JOB_ID,
      stepId: "ai-approved-1",
      args: ["scale-out", SERVICE_ARN, "--count", "8"],
      from: at(-1),
      to: at(1),
    }),
  ];

  jest.spyOn(CloudResourceService, "findBy").mockResolvedValue([
    {
      id: SERVICE_ROW_ID,
      name: "checkout-api",
      providerResourceId: SERVICE_ARN,
      cloudResourceType: "AWS::ECS::Service",
    },
  ] as never);
  jest
    .spyOn(CloudAccountService, "findAccount")
    .mockResolvedValue({ id: ACCOUNT_ROW_ID } as never);
  jest
    .spyOn(ResourceAiAgentService, "findAgentForResource")
    .mockResolvedValue(new ResourceAiAgent() as never);
  jest.spyOn(RunnerJobService, "findBy").mockImplementation((async () => {
    return jobs;
  }) as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockImplementation((async () => {
      return [suggestion];
    }) as never);
  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockResolvedValue(true as never);
  jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined as never);
  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    target: unknown,
    rows: Array<JSONObject>,
  ) => {
    expect(target).toBe(ChangeEventService);
    submitted.push(...rows);
    return { flushed: Promise.resolve() };
  }) as never);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function record(changes: Array<CloudChange>): Promise<void> {
  await CloudChangeRecorder.record({
    projectId: PROJECT_ID,
    provider: CloudProvider.AWS,
    changes,
  });
}

describe("one change as a change event, when OneUptime AI made it", () => {
  const job: CloudAiChangeJob = {
    jobId: JOB_ID,
    step: CloudAiChangeStep.Fix,
    from: at(-1),
    to: at(1),
    targetId: SERVICE_ARN,
    targetRowId: SERVICE_ROW_ID.toString(),
    suggestionId: SUGGESTION_ID,
    aiRunId: AI_RUN_ID,
    incidentId: INCIDENT_ID,
    alertId: null,
  };

  test("says OneUptime AI made it, and names its job, its fix, its AI run and the incident it fixed", () => {
    const attributes: Dictionary<string> = buildCloudChangeEntry({
      change: agentChange(),
      resource: { id: SERVICE_ROW_ID, name: "checkout-api" },
      accountRecordId: ACCOUNT_ROW_ID,
      madeByOneUptimeAi: { job },
    }).attributes;

    expect(attributes[ChangeEventAttribute.MadeBy]).toBe(
      ChangeEventSource.OneUptimeAi,
    );
    expect(attributes[ChangeEventAttribute.RunnerJobId]).toBe(
      JOB_ID.toString(),
    );
    expect(attributes[ChangeEventAttribute.AutoRemediationSuggestionId]).toBe(
      SUGGESTION_ID.toString(),
    );
    expect(attributes[ChangeEventAttribute.AiRunId]).toBe(AI_RUN_ID.toString());
    expect(attributes[ChangeEventAttribute.IncidentId]).toBe(
      INCIDENT_ID.toString(),
    );
    expect(attributes[ChangeEventAttribute.AlertId]).toBeUndefined();
    expect(attributes[ChangeEventAttribute.AiStep]).toBe(CloudAiChangeStep.Fix);

    // Still the cloud's record of it: who the cloud says did it, and where.
    expect(attributes[ChangeEventAttribute.Source]).toBe(
      ChangeEventSource.Cloud,
    );
    expect(attributes[ChangeEventAttribute.CloudActor]).toBe(SESSION);
    expect(attributes[ChangeEventAttribute.CloudAccountRecordId]).toBe(
      ACCOUNT_ROW_ID.toString(),
    );
    expect(attributes[ChangeEventAttribute.ResourceId]).toBe(
      SERVICE_ROW_ID.toString(),
    );
  });

  test("an alert's fix names the alert, and a rollback says it is one", () => {
    const attributes: Dictionary<string> = buildCloudChangeEntry({
      change: agentChange(),
      resource: null,
      accountRecordId: ACCOUNT_ROW_ID,
      madeByOneUptimeAi: {
        job: {
          ...job,
          step: CloudAiChangeStep.Rollback,
          incidentId: null,
          alertId: ALERT_ID,
        },
      },
    }).attributes;

    expect(attributes[ChangeEventAttribute.AlertId]).toBe(ALERT_ID.toString());
    expect(attributes[ChangeEventAttribute.IncidentId]).toBeUndefined();
    expect(attributes[ChangeEventAttribute.AiStep]).toBe(
      CloudAiChangeStep.Rollback,
    );
  });

  test("a change of the agent's no job explains says OneUptime AI made it, and names no fix", () => {
    const attributes: Dictionary<string> = buildCloudChangeEntry({
      change: agentChange(),
      resource: null,
      accountRecordId: ACCOUNT_ROW_ID,
      madeByOneUptimeAi: { job: null },
    }).attributes;

    expect(attributes[ChangeEventAttribute.MadeBy]).toBe(
      ChangeEventSource.OneUptimeAi,
    );
    for (const key of [
      ChangeEventAttribute.RunnerJobId,
      ChangeEventAttribute.AutoRemediationSuggestionId,
      ChangeEventAttribute.AiRunId,
      ChangeEventAttribute.IncidentId,
      ChangeEventAttribute.AlertId,
      ChangeEventAttribute.AiStep,
    ]) {
      expect(attributes[key]).toBeUndefined();
    }
  });

  test("a person's change, or a health event, says nothing of OneUptime AI", () => {
    expect(
      buildCloudChangeEntry({
        change: personChange(),
        resource: null,
        accountRecordId: ACCOUNT_ROW_ID,
      }).attributes[ChangeEventAttribute.MadeBy],
    ).toBeUndefined();
    expect(
      buildCloudChangeEntry({
        change: agentChange({ kind: "health" }),
        resource: null,
        accountRecordId: ACCOUNT_ROW_ID,
        madeByOneUptimeAi: { job },
      }).attributes[ChangeEventAttribute.MadeBy],
    ).toBeUndefined();
  });

  test("every key it writes is OneUptime's own: a pipeline can never claim to be OneUptime AI", () => {
    for (const key of [
      ChangeEventAttribute.MadeBy,
      ChangeEventAttribute.RunnerJobId,
      ChangeEventAttribute.AutoRemediationSuggestionId,
      ChangeEventAttribute.AiStep,
    ]) {
      expect(key.startsWith(RESERVED_CHANGE_ATTRIBUTE_PREFIX)).toBe(true);
    }
    expect(ChangeEventAttribute.MadeBy).toBe("oneuptime.change.made_by");
    expect(ChangeEventAttribute.RunnerJobId).toBe("oneuptime.runner_job.id");
    expect(ChangeEventAttribute.AutoRemediationSuggestionId).toBe(
      "oneuptime.auto_remediation_suggestion.id",
    );
    expect(ChangeEventAttribute.AiStep).toBe("oneuptime.ai.step");
    expect(Object.values(CloudAiChangeStep)).toEqual(["fix", "rollback"]);
  });
});

describe("recording an account's changes", () => {
  test("the change the agent made for the fix is OneUptime AI's, tied to the fix and its incident", async () => {
    await record([agentChange()]);

    const attributes: Dictionary<string> = attributesOf("evt-ai");

    expect(attributes[ChangeEventAttribute.MadeBy]).toBe(
      ChangeEventSource.OneUptimeAi,
    );
    expect(attributes[ChangeEventAttribute.RunnerJobId]).toBe(
      JOB_ID.toString(),
    );
    expect(attributes[ChangeEventAttribute.AutoRemediationSuggestionId]).toBe(
      SUGGESTION_ID.toString(),
    );
    expect(attributes[ChangeEventAttribute.IncidentId]).toBe(
      INCIDENT_ID.toString(),
    );
    expect(attributes[ChangeEventAttribute.AiStep]).toBe(CloudAiChangeStep.Fix);
  });

  test("a person's change on the same service in the same minute is left unmarked", async () => {
    await record([agentChange(), personChange()]);

    const person: Dictionary<string> = attributesOf("evt-maya");

    expect(person[ChangeEventAttribute.MadeBy]).toBeUndefined();
    expect(person[ChangeEventAttribute.RunnerJobId]).toBeUndefined();
    expect(person[ChangeEventAttribute.IncidentId]).toBeUndefined();
    expect(person[ChangeEventAttribute.CloudActor]).toBe("maya.lopez");
    // The agent's, beside it, is still marked.
    expect(attributesOf("evt-ai")[ChangeEventAttribute.MadeBy]).toBe(
      ChangeEventSource.OneUptimeAi,
    );
  });

  test("the rollback that undid the fix is OneUptime AI's too, and says it rolled back", async () => {
    jobs.push(
      storedJob({
        id: ROLLBACK_JOB_ID,
        stepId: "ai-rollback-1",
        args: ["scale-in", SERVICE_ARN, "--count", "4"],
        from: at(20),
        to: at(21),
      }),
    );

    await record([
      agentChange(),
      agentChange({
        eventId: "evt-rollback",
        actor: "oneuptime-ai-scale-in-5e6f7a8b",
        actorIdentity: `arn:aws:sts::${ACCOUNT}:assumed-role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}/oneuptime-ai-scale-in-5e6f7a8b`,
        time: at(20.5),
      }),
    ]);

    expect(attributesOf("evt-ai")[ChangeEventAttribute.AiStep]).toBe(
      CloudAiChangeStep.Fix,
    );

    const rollback: Dictionary<string> = attributesOf("evt-rollback");

    expect(rollback[ChangeEventAttribute.RunnerJobId]).toBe(
      ROLLBACK_JOB_ID.toString(),
    );
    expect(rollback[ChangeEventAttribute.AiStep]).toBe(
      CloudAiChangeStep.Rollback,
    );
  });

  test("an alert's fix names its alert", async () => {
    suggestion = new AutoRemediationSuggestion();
    suggestion._id = SUGGESTION_ID.toString();
    suggestion.alertId = ALERT_ID;

    await record([agentChange()]);

    const attributes: Dictionary<string> = attributesOf("evt-ai");

    expect(attributes[ChangeEventAttribute.AlertId]).toBe(ALERT_ID.toString());
    expect(attributes[ChangeEventAttribute.IncidentId]).toBeUndefined();
  });

  test("a change of the agent's long after its fix is still OneUptime AI's, with no fix named", async () => {
    await record([agentChange({ eventId: "evt-later", time: at(90) })]);

    const attributes: Dictionary<string> = attributesOf("evt-later");

    expect(attributes[ChangeEventAttribute.MadeBy]).toBe(
      ChangeEventSource.OneUptimeAi,
    );
    expect(attributes[ChangeEventAttribute.RunnerJobId]).toBeUndefined();
  });

  test("an account no connection holds a row for is written as the cloud recorded it", async () => {
    jest.spyOn(CloudAccountService, "findAccount").mockResolvedValue(null);

    await record([agentChange()]);

    expect(attributesOf("evt-ai")[ChangeEventAttribute.MadeBy]).toBeUndefined();
    expect(RunnerJobService.findBy).not.toHaveBeenCalled();
  });

  test("reads that fail never fail the recording: the change is written all the same", async () => {
    jest
      .spyOn(ResourceAiAgentService, "findAgentForResource")
      .mockRejectedValue(new Error("Postgres is down") as never);
    jest
      .spyOn(RunnerJobService, "findBy")
      .mockRejectedValue(new Error("Postgres is down") as never);

    await record([agentChange(), personChange()]);

    expect(submitted).toHaveLength(2);
    expect(attributesOf("evt-ai")[ChangeEventAttribute.MadeBy]).toBe(
      ChangeEventSource.OneUptimeAi,
    );
    expect(
      attributesOf("evt-ai")[ChangeEventAttribute.RunnerJobId],
    ).toBeUndefined();
    expect(
      attributesOf("evt-maya")[ChangeEventAttribute.MadeBy],
    ).toBeUndefined();
  });
});
