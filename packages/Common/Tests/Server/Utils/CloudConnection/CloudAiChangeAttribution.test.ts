import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import ResourceAiAgentService from "../../../../Server/Services/ResourceAiAgentService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import CloudAiChangeAttributionReader, {
  CLOUD_AI_CHANGE_CLOCK_SLACK_MS,
  CLOUD_AI_CHANGE_JOB_LIMIT,
  CLOUD_AI_CHANGE_JOB_LOOK_BACK_MS,
  CloudAiAgentPrincipals,
  CloudAiChangeAttribution,
  CloudAiChangeJob,
  CloudAiChangeMatch,
  getCloudAiAgentPrincipals,
  isCloudAiAgentChange,
  pickCloudAiChangeJob,
  toCloudAiChangeJob,
} from "../../../../Server/Utils/CloudConnection/CloudAiChangeAttribution";
import { CloudChange } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import logger from "../../../../Server/Utils/Logger";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudResourceIndex } from "../../../../Types/Cloud/CloudResourceIndex";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME,
  AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
} from "../../../../Types/ResourceAiAgent/CloudAiAgentNames";
import { ResourceAiAgentPosture } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { CloudAiChangeStep } from "../../../../Utils/Telemetry/ChangeEventFields";

/*
 * WHICH OF A CLOUD ACCOUNT'S CHANGES ONEUPTIME AI MADE, AND FOR WHICH FIX.
 *
 * The cloud records a change OneUptime AI made under the Cloud AI agent's
 * own role, so on the account's Changes page it read like anyone's. These
 * tests hold how such a change is told apart and tied to its fix:
 *
 *   - by WHO made it: the agent's own identity in its cloud - an AWS
 *     session of its write or task role in this account, its Azure managed
 *     identity, its Google Cloud service account - never a name a person
 *     could give a session of their own, never another account's role;
 *   - by WHEN and WHAT: the agent's change job that ran when the cloud
 *     stamped the change (a fix or its rollback, never a dry run or a
 *     read), on the resource the change names when two jobs ran at once;
 *   - a change of the agent's no job explains is still OneUptime AI's,
 *     with no fix named; and nothing read here can fail the recording.
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
const QUEUE_ROW_ID: ObjectID = new ObjectID(
  "5e7a1b30-0000-4000-8000-000000000011",
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

function jobId(index: number): ObjectID {
  return new ObjectID(
    `5e7a1b30-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
  );
}

const ACCOUNT: string = "123456789012";
const SERVICE_ARN: string = `arn:aws:ecs:us-east-1:${ACCOUNT}:service/prod/checkout-api`;
const QUEUE_ARN: string = `arn:aws:sqs:us-east-1:${ACCOUNT}:orders`;
const WRITE_SESSION: string = `arn:aws:sts::${ACCOUNT}:assumed-role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}/oneuptime-ai-scale-out-1a2b3c4d`;
const MAYA_ARN: string = `arn:aws:iam::${ACCOUNT}:user/maya.lopez`;

const AZURE_SUB: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const AZURE_AGENT_OID: string = "9f3c2b1a-0d4e-4f5a-8b6c-7d8e9f0a1b2c";
const GCP_PROJECT: string = "acme-prod";

const AT: Date = new Date("2026-11-03T10:00:00.000Z");
const MINUTE: number = 60 * 1000;

function at(minutes: number): Date {
  return new Date(AT.getTime() + minutes * MINUTE);
}

function awsChange(overrides: Partial<CloudChange> = {}): CloudChange {
  return {
    kind: "change",
    provider: CloudProvider.AWS,
    accountId: ACCOUNT,
    region: "us-east-1",
    time: AT,
    eventId: "evt-1",
    operation: "ecs:UpdateService",
    actor: "oneuptime-ai-scale-out-1a2b3c4d",
    actorIdentity: WRITE_SESSION,
    resources: [{ id: SERVICE_ARN }],
    failed: false,
    ...overrides,
  };
}

function posture(details: JSONObject): ResourceAiAgentPosture {
  return {
    resourceType: AiResourceType.AwsAccount,
    resourceIdentifier: ACCOUNT,
    allowWrites: true,
    writeTargets: [],
    protectedTargets: [],
    reachable: true,
    details: details as ResourceAiAgentPosture["details"],
  } as ResourceAiAgentPosture;
}

const INDEX: CloudResourceIndex = new CloudResourceIndex([
  {
    id: SERVICE_ROW_ID,
    name: "checkout-api",
    providerResourceId: SERVICE_ARN,
    type: "AWS::ECS::Service",
  },
  {
    id: QUEUE_ROW_ID,
    name: "orders",
    providerResourceId: QUEUE_ARN,
    type: "AWS::SQS::Queue",
  },
]);

// One stored job of the agent's, as the reader reads it.
function storedJob(
  index: number,
  overrides: Partial<{
    stepId: string;
    args: Array<string>;
    tier: string;
    status: RunnerJobStatus;
    startedAt: Date | undefined;
    claimedAt: Date | undefined;
    completedAt: Date | undefined;
    suggestionId: ObjectID | undefined;
    aiRunId: ObjectID | undefined;
  }> = {},
): RunnerJob {
  const job: RunnerJob = new RunnerJob();
  job._id = jobId(index).toString();
  job.stepId = overrides.stepId ?? "ai-approved-1";
  job.payload = {
    resourceType: AiResourceType.AwsAccount,
    program: "cloud",
    args: overrides.args ?? ["scale-out", SERVICE_ARN, "--count", "8"],
    displayCommand: "cloud scale-out ...",
    tier: overrides.tier ?? "SafeWrite",
  };
  job.status = overrides.status ?? RunnerJobStatus.Succeeded;
  job.createdAt = at(-2);
  if ("claimedAt" in overrides) {
    if (overrides.claimedAt) {
      job.claimedAt = overrides.claimedAt;
    }
  } else {
    job.claimedAt = at(-1);
  }
  if ("startedAt" in overrides) {
    if (overrides.startedAt) {
      job.startedAt = overrides.startedAt;
    }
  } else {
    job.startedAt = at(-1);
  }
  if ("completedAt" in overrides) {
    if (overrides.completedAt) {
      job.completedAt = overrides.completedAt;
    }
  } else {
    job.completedAt = at(1);
  }
  const suggestionId: ObjectID | undefined =
    "suggestionId" in overrides ? overrides.suggestionId : SUGGESTION_ID;
  if (suggestionId) {
    job.autoRemediationSuggestionId = suggestionId;
  }
  const aiRunId: ObjectID | undefined =
    "aiRunId" in overrides ? overrides.aiRunId : AI_RUN_ID;
  if (aiRunId) {
    job.aiRunId = aiRunId;
  }
  return job;
}

function suggestionFor(subject: {
  incidentId?: ObjectID;
  alertId?: ObjectID;
}): AutoRemediationSuggestion {
  const suggestion: AutoRemediationSuggestion = new AutoRemediationSuggestion();
  suggestion._id = SUGGESTION_ID.toString();
  if (subject.incidentId) {
    suggestion.incidentId = subject.incidentId;
  }
  if (subject.alertId) {
    suggestion.alertId = subject.alertId;
  }
  return suggestion;
}

function job(overrides: Partial<CloudAiChangeJob> = {}): CloudAiChangeJob {
  return {
    jobId: jobId(1),
    step: CloudAiChangeStep.Fix,
    from: at(-1),
    to: at(1),
    targetId: SERVICE_ARN,
    targetRowId: SERVICE_ROW_ID.toString(),
    suggestionId: SUGGESTION_ID,
    aiRunId: AI_RUN_ID,
    incidentId: INCIDENT_ID,
    alertId: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who the account's Cloud AI agent is", () => {
  test("AWS: the write and task roles its setup command makes, and those it reports it runs with", () => {
    const principals: CloudAiAgentPrincipals = getCloudAiAgentPrincipals({
      provider: CloudProvider.AWS,
      accountId: ACCOUNT,
      posture: posture({
        awsWriteRoleArn: `arn:aws:iam::${ACCOUNT}:role/platform/TeamAiWrite`,
        awsPrincipalArn: `arn:aws:sts::${ACCOUNT}:assumed-role/TeamAiTask/2f9c0e1d`,
      }),
    });

    expect(principals.awsRoleNames).toEqual([
      AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME.toLowerCase(),
      AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME.toLowerCase(),
      "teamaiwrite",
      "teamaitask",
    ]);
    expect(principals.azurePrincipalIds).toEqual([]);
    expect(principals.gcpServiceAccounts).toEqual([]);
  });

  test("AWS without a posture: the setup command's roles alone, each once", () => {
    expect(
      getCloudAiAgentPrincipals({
        provider: CloudProvider.AWS,
        accountId: ACCOUNT,
        posture: posture({
          awsWriteRoleArn: `arn:aws:iam::${ACCOUNT}:role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}`,
        }),
      }).awsRoleNames,
    ).toEqual([
      AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME.toLowerCase(),
      AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME.toLowerCase(),
    ]);
    expect(
      getCloudAiAgentPrincipals({
        provider: CloudProvider.AWS,
        accountId: ACCOUNT,
        posture: null,
      }).awsRoleNames,
    ).toHaveLength(2);
  });

  test("Azure: the object id its managed identity reports; none until it reports one", () => {
    expect(
      getCloudAiAgentPrincipals({
        provider: CloudProvider.Azure,
        accountId: AZURE_SUB,
        posture: posture({ azurePrincipalId: AZURE_AGENT_OID.toUpperCase() }),
      }).azurePrincipalIds,
    ).toEqual([AZURE_AGENT_OID]);
    expect(
      getCloudAiAgentPrincipals({
        provider: CloudProvider.Azure,
        accountId: AZURE_SUB,
        posture: posture({ azurePrincipalId: null }),
      }).azurePrincipalIds,
    ).toEqual([]);
  });

  test("Google Cloud: its setup's service account in this project, and the one it reports", () => {
    expect(
      getCloudAiAgentPrincipals({
        provider: CloudProvider.GCP,
        accountId: GCP_PROJECT,
        posture: posture({
          gcpServiceAccount: "Team-AI@acme-prod.iam.gserviceaccount.com",
        }),
      }).gcpServiceAccounts,
    ).toEqual([
      "oneuptime-ai-agent@acme-prod.iam.gserviceaccount.com",
      "team-ai@acme-prod.iam.gserviceaccount.com",
    ]);
  });
});

describe("whether the agent made a change", () => {
  const aws: CloudAiAgentPrincipals = getCloudAiAgentPrincipals({
    provider: CloudProvider.AWS,
    accountId: ACCOUNT,
  });

  test("AWS: a session of its write role, or of its task role, in this account", () => {
    expect(isCloudAiAgentChange(awsChange(), aws)).toBe(true);
    expect(
      isCloudAiAgentChange(
        awsChange({
          actor: "a1b2c3d4e5f6",
          actorIdentity: `arn:aws:sts::${ACCOUNT}:assumed-role/${AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME}/a1b2c3d4e5f6`,
        }),
        aws,
      ),
    ).toBe(true);
    // Another partition writes its ARNs its own way.
    expect(
      isCloudAiAgentChange(
        awsChange({
          actorIdentity: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}/oneuptime-ai-restart-service-0f0f0f0f`,
        }),
        aws,
      ),
    ).toBe(true);
  });

  test("AWS: a person, or a session a person named like the agent's, never is", () => {
    // An IAM user.
    expect(
      isCloudAiAgentChange(
        awsChange({ actor: "maya.lopez", actorIdentity: MAYA_ARN }),
        aws,
      ),
    ).toBe(false);
    // A session named like the agent's, of a role that is not the agent's.
    expect(
      isCloudAiAgentChange(
        awsChange({
          actor: "oneuptime-ai-scale-out-1a2b3c4d",
          actorIdentity: `arn:aws:sts::${ACCOUNT}:assumed-role/Admins/oneuptime-ai-scale-out-1a2b3c4d`,
        }),
        aws,
      ),
    ).toBe(false);
    // The agent's role name, in another account.
    expect(
      isCloudAiAgentChange(
        awsChange({
          actorIdentity: `arn:aws:sts::999999999999:assumed-role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}/oneuptime-ai-scale-out-1a2b3c4d`,
        }),
        aws,
      ),
    ).toBe(false);
    // The role itself is no session.
    expect(
      isCloudAiAgentChange(
        awsChange({
          actorIdentity: `arn:aws:iam::${ACCOUNT}:role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}`,
        }),
        aws,
      ),
    ).toBe(false);
    // The session's name alone is not who did it.
    expect(
      isCloudAiAgentChange(awsChange({ actorIdentity: undefined }), aws),
    ).toBe(false);
  });

  test("AWS: a role the agent reports it runs with counts too", () => {
    const team: CloudAiAgentPrincipals = getCloudAiAgentPrincipals({
      provider: CloudProvider.AWS,
      accountId: ACCOUNT,
      posture: posture({
        awsWriteRoleArn: `arn:aws:iam::${ACCOUNT}:role/platform/TeamAiWrite`,
      }),
    });

    expect(
      isCloudAiAgentChange(
        awsChange({
          actorIdentity: `arn:aws:sts::${ACCOUNT}:assumed-role/TeamAiWrite/oneuptime-ai-scale-in-77777777`,
        }),
        team,
      ),
    ).toBe(true);
    expect(
      isCloudAiAgentChange(
        awsChange({
          actorIdentity: `arn:aws:sts::${ACCOUNT}:assumed-role/TeamAiWrite/oneuptime-ai-scale-in-77777777`,
        }),
        aws,
      ),
    ).toBe(false);
  });

  test("a health event is the provider's, never the agent's", () => {
    expect(
      isCloudAiAgentChange(
        awsChange({ kind: "health", operation: "AWS_EC2_OPERATIONAL_ISSUE" }),
        aws,
      ),
    ).toBe(false);
  });

  test("Azure: the caller is the agent's managed identity, by its object id", () => {
    const azure: CloudAiAgentPrincipals = getCloudAiAgentPrincipals({
      provider: CloudProvider.Azure,
      accountId: AZURE_SUB,
      posture: posture({ azurePrincipalId: AZURE_AGENT_OID }),
    });
    const azureChange: (actor: string) => CloudChange = (
      actor: string,
    ): CloudChange => {
      return awsChange({
        provider: CloudProvider.Azure,
        accountId: AZURE_SUB,
        actor,
        actorIdentity: undefined,
        operation: "Microsoft.Web/sites/restart/action",
      });
    };

    expect(isCloudAiAgentChange(azureChange(AZURE_AGENT_OID), azure)).toBe(
      true,
    );
    expect(
      isCloudAiAgentChange(azureChange(AZURE_AGENT_OID.toUpperCase()), azure),
    ).toBe(true);
    expect(
      isCloudAiAgentChange(azureChange("deployer@contoso.com"), azure),
    ).toBe(false);
    expect(
      isCloudAiAgentChange(
        azureChange("11111111-2222-4333-8444-555555555555"),
        azure,
      ),
    ).toBe(false);
    // An agent that reported no object id makes nothing the agent's.
    expect(
      isCloudAiAgentChange(
        azureChange(AZURE_AGENT_OID),
        getCloudAiAgentPrincipals({
          provider: CloudProvider.Azure,
          accountId: AZURE_SUB,
        }),
      ),
    ).toBe(false);
  });

  test("Google Cloud: the principal is the agent's service account", () => {
    const gcp: CloudAiAgentPrincipals = getCloudAiAgentPrincipals({
      provider: CloudProvider.GCP,
      accountId: GCP_PROJECT,
    });
    const gcpChange: (actor: string) => CloudChange = (
      actor: string,
    ): CloudChange => {
      return awsChange({
        provider: CloudProvider.GCP,
        accountId: GCP_PROJECT,
        actor,
        actorIdentity: undefined,
        operation: "google.cloud.run.v2.Services.UpdateService",
      });
    };

    expect(
      isCloudAiAgentChange(
        gcpChange("oneuptime-ai-agent@acme-prod.iam.gserviceaccount.com"),
        gcp,
      ),
    ).toBe(true);
    expect(
      isCloudAiAgentChange(
        gcpChange("oneuptime-ai-agent@other-project.iam.gserviceaccount.com"),
        gcp,
      ),
    ).toBe(false);
    expect(isCloudAiAgentChange(gcpChange("deployer@acme.com"), gcp)).toBe(
      false,
    );
    expect(isCloudAiAgentChange(gcpChange(""), gcp)).toBe(false);
  });

  test("another cloud's principals never match", () => {
    expect(
      isCloudAiAgentChange(
        awsChange(),
        getCloudAiAgentPrincipals({
          provider: CloudProvider.GCP,
          accountId: GCP_PROJECT,
        }),
      ),
    ).toBe(false);
  });

  /*
   * The caller's ARN is what CloudTrail says, and the agent's principal ARN
   * what the agent reports: text from outside, read in time in line with
   * its length - 400,000 characters of the reader's worst cases, each
   * almost an assumed-role session ARN.
   */
  test("a caller's ARN of 400,000 characters is read in time", () => {
    const principals: CloudAiAgentPrincipals = getCloudAiAgentPrincipals({
      provider: CloudProvider.AWS,
      accountId: ACCOUNT,
    });
    const worstCases: Array<string> = [
      `arn:aws${"-".repeat(400000)}`,
      `arn:aws:sts::${ACCOUNT}:assumed-role/${"a".repeat(400000)}`,
      `arn:aws:sts::${ACCOUNT}:assumed-role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}/${"/".repeat(400000)}`,
    ];

    for (const identity of worstCases) {
      const timed: FastestRun<Array<boolean>> = fastestRun({
        run: (): Array<boolean> => {
          return [
            isCloudAiAgentChange(
              awsChange({ actorIdentity: `${identity}x` }),
              principals,
            ),
            getCloudAiAgentPrincipals({
              provider: CloudProvider.AWS,
              accountId: ACCOUNT,
              posture: posture({ awsPrincipalArn: `${identity}y` }),
            }).awsRoleNames.length > 2,
          ];
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
      expect(timed.result).toEqual([false, false]);
    }
  });
});

describe("which job made it", () => {
  test("the one job that ran when the cloud stamped the change", () => {
    expect(
      pickCloudAiChangeJob({
        change: awsChange(),
        resourceRowId: SERVICE_ROW_ID.toString(),
        jobs: [job()],
        now: at(30),
      })?.jobId.toString(),
    ).toBe(jobId(1).toString());
  });

  test("the clock's slack on both sides, and no further", () => {
    const slackMinutes: number = CLOUD_AI_CHANGE_CLOCK_SLACK_MS / MINUTE;
    const pick: (minutes: number) => CloudAiChangeJob | null = (
      minutes: number,
    ): CloudAiChangeJob | null => {
      return pickCloudAiChangeJob({
        change: awsChange({ time: at(minutes) }),
        resourceRowId: SERVICE_ROW_ID.toString(),
        jobs: [job({ from: at(0), to: at(1) })],
        now: at(60),
      });
    };

    expect(slackMinutes).toBe(2);
    expect(pick(-2)).not.toBeNull();
    expect(pick(3)).not.toBeNull();
    expect(pick(-2.1)).toBeNull();
    expect(pick(3.1)).toBeNull();
  });

  test("a job still running holds every change until now", () => {
    expect(
      pickCloudAiChangeJob({
        change: awsChange({ time: at(9) }),
        resourceRowId: SERVICE_ROW_ID.toString(),
        jobs: [job({ to: null })],
        now: at(10),
      }),
    ).not.toBeNull();
    expect(
      pickCloudAiChangeJob({
        change: awsChange({ time: at(15) }),
        resourceRowId: SERVICE_ROW_ID.toString(),
        jobs: [job({ to: null })],
        now: at(10),
      }),
    ).toBeNull();
  });

  test("two jobs at once: the one on the resource the change names, by its row or by its id", () => {
    const service: CloudAiChangeJob = job({ jobId: jobId(1) });
    const queue: CloudAiChangeJob = job({
      jobId: jobId(2),
      targetId: QUEUE_ARN,
      targetRowId: QUEUE_ROW_ID.toString(),
      from: at(-0.5),
    });

    expect(
      pickCloudAiChangeJob({
        change: awsChange(),
        resourceRowId: SERVICE_ROW_ID.toString(),
        jobs: [service, queue],
        now: at(30),
      })?.jobId.toString(),
    ).toBe(jobId(1).toString());
    // Not held as a Cloud Resource: its id still names the job's target.
    expect(
      pickCloudAiChangeJob({
        change: awsChange({ resources: [{ id: QUEUE_ARN }] }),
        resourceRowId: null,
        jobs: [service, queue],
        now: at(30),
      })?.jobId.toString(),
    ).toBe(jobId(2).toString());
  });

  test("two jobs at once on resources the change does not name: no answer, rather than the wrong fix", () => {
    expect(
      pickCloudAiChangeJob({
        change: awsChange({ resources: [] }),
        resourceRowId: null,
        jobs: [
          job({ jobId: jobId(1) }),
          job({
            jobId: jobId(2),
            targetId: QUEUE_ARN,
            targetRowId: QUEUE_ROW_ID.toString(),
          }),
        ],
        now: at(30),
      }),
    ).toBeNull();
  });

  test("the only job running explains a change on a resource its command does not name (a change's second target)", () => {
    expect(
      pickCloudAiChangeJob({
        change: awsChange({ resources: [{ id: QUEUE_ARN }] }),
        resourceRowId: QUEUE_ROW_ID.toString(),
        jobs: [job()],
        now: at(30),
      })?.jobId.toString(),
    ).toBe(jobId(1).toString());
  });

  test("two jobs on the same resource: the latest to start before the change", () => {
    expect(
      pickCloudAiChangeJob({
        change: awsChange(),
        resourceRowId: SERVICE_ROW_ID.toString(),
        jobs: [
          job({ jobId: jobId(1), from: at(-1.5) }),
          job({ jobId: jobId(2), from: at(-0.5) }),
        ],
        now: at(30),
      })?.jobId.toString(),
    ).toBe(jobId(2).toString());
  });

  test("no job running: nothing", () => {
    expect(
      pickCloudAiChangeJob({
        change: awsChange({ time: at(30) }),
        resourceRowId: SERVICE_ROW_ID.toString(),
        jobs: [job()],
        now: at(40),
      }),
    ).toBeNull();
    expect(
      pickCloudAiChangeJob({
        change: awsChange(),
        resourceRowId: null,
        jobs: [],
        now: at(40),
      }),
    ).toBeNull();
  });
});

describe("a stored job, as a change is matched to it", () => {
  test("a fix's: its times, the resource its command names, its fix and the incident it fixed", () => {
    expect(
      toCloudAiChangeJob({
        job: storedJob(1),
        provider: CloudProvider.AWS,
        index: INDEX,
        suggestion: suggestionFor({ incidentId: INCIDENT_ID }),
      }),
    ).toEqual({
      jobId: jobId(1),
      step: CloudAiChangeStep.Fix,
      from: at(-1),
      to: at(1),
      targetId: SERVICE_ARN,
      targetRowId: SERVICE_ROW_ID.toString(),
      suggestionId: SUGGESTION_ID,
      aiRunId: AI_RUN_ID,
      incidentId: INCIDENT_ID,
      alertId: null,
    });
  });

  test("an alert's fix names the alert", () => {
    const matched: CloudAiChangeJob | null = toCloudAiChangeJob({
      job: storedJob(1),
      provider: CloudProvider.AWS,
      index: INDEX,
      suggestion: suggestionFor({ alertId: ALERT_ID }),
    });

    expect(matched?.alertId?.toString()).toBe(ALERT_ID.toString());
    expect(matched?.incidentId).toBeNull();
  });

  test("a rollback's job is the fix's rollback", () => {
    expect(
      toCloudAiChangeJob({
        job: storedJob(1, {
          stepId: "ai-rollback-1",
          args: ["scale-in", SERVICE_ARN, "--count", "4"],
        }),
        provider: CloudProvider.AWS,
        index: INDEX,
        suggestion: null,
      })?.step,
    ).toBe(CloudAiChangeStep.Rollback);
  });

  test("a dry run, a read and a job that never ran changed nothing", () => {
    for (const changedNothing of [
      storedJob(1, {
        stepId: "ai-dry-run-1",
        args: ["dry-run", "scale-out", SERVICE_ARN, "--count", "8"],
        tier: "Read",
      }),
      // A dry run's job, whatever its tier said.
      storedJob(2, { stepId: "ai-dry-run-2" }),
      storedJob(3, { tier: "Read" }),
      storedJob(4, { status: RunnerJobStatus.Pending }),
      storedJob(5, { status: RunnerJobStatus.TimedOut }),
      storedJob(6, { status: RunnerJobStatus.Cancelled }),
    ]) {
      expect(
        toCloudAiChangeJob({
          job: changedNothing,
          provider: CloudProvider.AWS,
          index: INDEX,
          suggestion: null,
        }),
      ).toBeNull();
    }
  });

  test("still running: from when it was claimed, with no end", () => {
    const running: CloudAiChangeJob | null = toCloudAiChangeJob({
      job: storedJob(1, {
        status: RunnerJobStatus.Claimed,
        startedAt: undefined,
        completedAt: undefined,
      }),
      provider: CloudProvider.AWS,
      index: INDEX,
      suggestion: null,
    });

    expect(running?.from).toEqual(at(-1));
    expect(running?.to).toBeNull();
  });

  test("a command whose resource the account does not hold keeps its id; one the catalog cannot read names none", () => {
    expect(
      toCloudAiChangeJob({
        job: storedJob(1, {
          args: [
            "restart-service",
            `arn:aws:ecs:us-east-1:${ACCOUNT}:service/prod/billing`,
          ],
        }),
        provider: CloudProvider.AWS,
        index: INDEX,
        suggestion: null,
      }),
    ).toMatchObject({
      targetId: `arn:aws:ecs:us-east-1:${ACCOUNT}:service/prod/billing`,
      targetRowId: null,
    });
    expect(
      toCloudAiChangeJob({
        job: storedJob(1, { args: ["no-such-operation"] }),
        provider: CloudProvider.AWS,
        index: INDEX,
        suggestion: null,
      }),
    ).toMatchObject({ targetId: null, targetRowId: null });
  });
});

describe("reading what a batch of one account's changes is attributed with", () => {
  let findAgent: SpyInstance<
    typeof ResourceAiAgentService.findAgentForResource
  >;
  let findJobs: SpyInstance<typeof RunnerJobService.findBy>;
  let findSuggestions: SpyInstance<
    typeof AutoRemediationSuggestionService.findBy
  >;

  function agentRow(details: JSONObject = {}): ResourceAiAgent {
    const row: ResourceAiAgent = new ResourceAiAgent();
    row.posture = posture(details) as unknown as JSONObject;
    return row;
  }

  beforeEach(() => {
    findAgent = jest
      .spyOn(ResourceAiAgentService, "findAgentForResource")
      .mockResolvedValue(agentRow() as never);
    findJobs = jest
      .spyOn(RunnerJobService, "findBy")
      .mockResolvedValue([storedJob(1)] as never);
    findSuggestions = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([suggestionFor({ incidentId: INCIDENT_ID })] as never);
  });

  function read(
    changes: Array<CloudChange>,
  ): Promise<CloudAiChangeAttribution> {
    return CloudAiChangeAttributionReader.read({
      projectId: PROJECT_ID,
      provider: CloudProvider.AWS,
      accountRecordId: ACCOUNT_ROW_ID,
      accountId: ACCOUNT,
      changes,
      index: INDEX,
      now: at(30),
    });
  }

  test("reads the account's agent as OneUptime, then its change jobs around the agent's changes, then their fixes", async () => {
    const attribution: CloudAiChangeAttribution = await read([awsChange()]);

    expect(findAgent).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      resourceId: ACCOUNT_ROW_ID,
    });

    const jobs: {
      query: JSONObject;
      sort: JSONObject;
      limit: number;
      props: JSONObject;
    } = findJobs.mock.calls[0]![0] as never;

    expect(jobs.query["projectId"]).toBe(PROJECT_ID);
    expect(jobs.query["resourceType"]).toBe(AiResourceType.AwsAccount);
    expect(jobs.query["resourceId"]).toBe(ACCOUNT_ROW_ID);
    expect(jobs.query["origin"]).toBe(RunnerJobOrigin.AiRemediation);
    expect(jobs.query["stepType"]).toBe(RunbookStepType.ResourceCommand);
    const window: InBetween<Date> = jobs.query["createdAt"] as never;
    expect(window).toBeInstanceOf(InBetween);
    expect(window.startValue).toEqual(
      new Date(AT.getTime() - CLOUD_AI_CHANGE_JOB_LOOK_BACK_MS),
    );
    expect(window.endValue).toEqual(
      new Date(AT.getTime() + CLOUD_AI_CHANGE_CLOCK_SLACK_MS),
    );
    expect(jobs.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(jobs.limit).toBe(CLOUD_AI_CHANGE_JOB_LIMIT);
    expect(jobs.props).toEqual({ isRoot: true });

    expect(findSuggestions.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });

    const match: CloudAiChangeMatch | null = attribution.match({
      change: awsChange(),
      resourceRowId: SERVICE_ROW_ID.toString(),
    });

    expect(match?.job).toMatchObject({
      jobId: jobId(1),
      suggestionId: SUGGESTION_ID,
      aiRunId: AI_RUN_ID,
      incidentId: INCIDENT_ID,
      step: CloudAiChangeStep.Fix,
    });
  });

  test("a person's change on the same resource while the fix ran is nobody's but theirs", async () => {
    const person: CloudChange = awsChange({
      eventId: "evt-maya",
      actor: "maya.lopez",
      actorIdentity: MAYA_ARN,
    });
    const attribution: CloudAiChangeAttribution = await read([
      awsChange(),
      person,
    ]);

    expect(
      attribution.match({
        change: person,
        resourceRowId: SERVICE_ROW_ID.toString(),
      }),
    ).toBeNull();
  });

  test("a batch with no change of the agent's reads no job at all", async () => {
    const attribution: CloudAiChangeAttribution = await read([
      awsChange({ actor: "maya.lopez", actorIdentity: MAYA_ARN }),
      awsChange({ kind: "health", eventId: "health-1" }),
    ]);

    expect(findJobs).not.toHaveBeenCalled();
    expect(findSuggestions).not.toHaveBeenCalled();
    expect(
      attribution.match({ change: awsChange(), resourceRowId: null }),
    ).toBeNull();
  });

  test("a batch whose changes name no one reads not even the agent", async () => {
    await read([awsChange({ actorIdentity: undefined })]);

    expect(findAgent).not.toHaveBeenCalled();
    expect(findJobs).not.toHaveBeenCalled();
  });

  test("an agent whose row cannot be read is still known by its setup's names", async () => {
    findAgent.mockRejectedValue(new Error("Postgres is down") as never);

    const attribution: CloudAiChangeAttribution = await read([awsChange()]);

    expect(
      attribution
        .match({
          change: awsChange(),
          resourceRowId: SERVICE_ROW_ID.toString(),
        })
        ?.job?.jobId.toString(),
    ).toBe(jobId(1).toString());
  });

  test("jobs that cannot be read leave the agent's changes OneUptime AI's, without their fix", async () => {
    findJobs.mockRejectedValue(new Error("Postgres is down") as never);

    const attribution: CloudAiChangeAttribution = await read([awsChange()]);

    expect(
      attribution.match({
        change: awsChange(),
        resourceRowId: SERVICE_ROW_ID.toString(),
      }),
    ).toEqual({ job: null });
    expect(logger.error).toHaveBeenCalled();
  });

  test("a job without a fix reads no fixes, and names none", async () => {
    findJobs.mockResolvedValue([
      storedJob(1, { suggestionId: undefined }),
    ] as never);

    const attribution: CloudAiChangeAttribution = await read([awsChange()]);

    expect(findSuggestions).not.toHaveBeenCalled();
    expect(
      attribution.match({
        change: awsChange(),
        resourceRowId: SERVICE_ROW_ID.toString(),
      })?.job,
    ).toMatchObject({ suggestionId: null, incidentId: null, alertId: null });
  });

  test("a dry run while the change happened is not what made it", async () => {
    findJobs.mockResolvedValue([
      storedJob(1, { stepId: "ai-dry-run-1", tier: "Read" }),
    ] as never);

    const attribution: CloudAiChangeAttribution = await read([awsChange()]);

    expect(
      attribution.match({
        change: awsChange(),
        resourceRowId: SERVICE_ROW_ID.toString(),
      }),
    ).toEqual({ job: null });
  });
});
