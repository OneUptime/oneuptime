import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import {
  DRY_RUN_COMMAND_STEP_ID_PREFIX,
  ROLLBACK_COMMAND_STEP_ID_PREFIX,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudIndexEntry,
  CloudResourceIndex,
} from "../../../Types/Cloud/CloudResourceIndex";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME,
  AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
  GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID,
} from "../../../Types/ResourceAiAgent/CloudAiAgentNames";
import {
  ResourceAiAgentPosture,
  ResourceCommandTier,
  parseResourceAiAgentPosture,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import {
  CloudCatalogProvider,
  CloudCommandParse,
  CLOUD_PROGRAM,
  isSameCloudResourceId,
  parseCloudCommand,
} from "../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import { CloudAiChangeStep } from "../../../Utils/Telemetry/ChangeEventFields";
import AutoRemediationSuggestionService from "../../Services/AutoRemediationSuggestionService";
import ResourceAiAgentService from "../../Services/ResourceAiAgentService";
import RunnerJobService from "../../Services/RunnerJobService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import { CloudChange } from "./CloudConnectorTypes";

/*
 * WHICH OF A CLOUD ACCOUNT'S CHANGES ONEUPTIME AI MADE, AND FOR WHICH FIX.
 *
 * A change OneUptime AI makes in a cloud account is made by the account's
 * Cloud AI agent, under the agent's own role, and the cloud's activity log
 * records it under that role like any other change: on the account's
 * Changes page it read as "oneuptime-ai-scale-out-1a2b3c4d ran
 * ecs:UpdateService", and nobody could tell it from a person's. Here a
 * change is told to be OneUptime AI's by WHO made it - the agent's own
 * identity, never a name a person could also give a session:
 *
 *   - AWS: an assumed-role session of the agent's write role or its task
 *     role, in this account (CloudTrail's userIdentity.arn), by the names
 *     its setup command gives them (OneUptimeAiAgentWrite,
 *     OneUptimeAiAgentTask) and the roles the agent reports it runs with;
 *   - Azure: the agent's managed identity, by the object id the agent
 *     reports (the Activity Log's caller);
 *   - Google Cloud: the agent's service account, by its setup's name in
 *     this project and the account the agent reports.
 *
 * And it is tied to the fix it belongs to by WHEN and WHAT: the agent's
 * change job (a RunnerJob of the account, a fix's or its rollback's, never
 * a dry run) that was running when the cloud recorded the change, on the
 * resource the change names when two were. A change of the agent's that no
 * job explains (its job is gone, or two jobs ran at once on resources the
 * change does not name) is still marked as OneUptime AI's, without a fix:
 * a link to the wrong fix would be worse than none.
 *
 * Every read here fails soft: a change that cannot be attributed is
 * written as the cloud recorded it, and the read that brought it in never
 * fails.
 */

// The account's AI resource type, by its cloud.
const AI_RESOURCE_TYPES: Readonly<Record<CloudProvider, AiResourceType>> = {
  [CloudProvider.AWS]: AiResourceType.AwsAccount,
  [CloudProvider.Azure]: AiResourceType.AzureSubscription,
  [CloudProvider.GCP]: AiResourceType.GoogleCloudProject,
};

/*
 * How far a change may fall outside its job's own times and still be the
 * job's: the cloud's clock and OneUptime's, and a job reported done a
 * moment before the cloud stamped its call.
 */
export const CLOUD_AI_CHANGE_CLOCK_SLACK_MS: number = 2 * 60 * 1000;

/*
 * The jobs read around a batch of changes: created this long before the
 * earliest change at most (a job is claimed seconds after it is created,
 * and runs minutes at most) and up to the slack after the latest.
 */
export const CLOUD_AI_CHANGE_JOB_LOOK_BACK_MS: number = 2 * 60 * 60 * 1000;

// The most jobs read for one account's batch.
export const CLOUD_AI_CHANGE_JOB_LIMIT: number = 200;

// The statuses of a job that may have made its call.
const RAN_STATUSES: ReadonlyArray<RunnerJobStatus> = [
  RunnerJobStatus.Claimed,
  RunnerJobStatus.Running,
  RunnerJobStatus.Succeeded,
  RunnerJobStatus.Failed,
];

const ASSUMED_ROLE_ARN: RegExp =
  /^arn:aws[a-z-]*:sts::([0-9]{12}):assumed-role\/([^/]+)\/[^/]+$/;

// Who the account's Cloud AI agent is, as its cloud names it.
export interface CloudAiAgentPrincipals {
  provider: CloudProvider;
  // The cloud's own id of the account.
  accountId: string;
  // AWS: the roles whose sessions are the agent's, lowercased.
  awsRoleNames: Array<string>;
  // Azure: the agent's managed identity's object ids, lowercased.
  azurePrincipalIds: Array<string>;
  // Google Cloud: the agent's service accounts, lowercased.
  gcpServiceAccounts: Array<string>;
}

function readDetail(
  posture: ResourceAiAgentPosture | null | undefined,
  key: string,
): string {
  const value: unknown = posture?.details ? posture.details[key] : undefined;

  return typeof value === "string" ? value.trim() : "";
}

// The role a role's ARN names (arn:aws:iam::123:role/path/Name), or "".
function roleNameOfRoleArn(arn: string): string {
  const marker: number = arn.indexOf(":role/");

  if (marker < 0) {
    return "";
  }

  const path: string = arn.slice(marker + ":role/".length);

  return path.slice(path.lastIndexOf("/") + 1);
}

function unique(values: Array<string>): Array<string> {
  return Array.from(
    new Set(
      values
        .map((value: string): string => {
          return value.trim().toLowerCase();
        })
        .filter((value: string): boolean => {
          return value.length > 0;
        }),
    ),
  );
}

/*
 * The agent's identities in its cloud: the names its setup command gives
 * them, and what the agent reports it runs as (its posture), so an agent a
 * team deployed its own way is known too.
 */
export function getCloudAiAgentPrincipals(data: {
  provider: CloudProvider;
  accountId: string;
  posture?: ResourceAiAgentPosture | null | undefined;
}): CloudAiAgentPrincipals {
  const principals: CloudAiAgentPrincipals = {
    provider: data.provider,
    accountId: data.accountId.trim(),
    awsRoleNames: [],
    azurePrincipalIds: [],
    gcpServiceAccounts: [],
  };

  if (data.provider === CloudProvider.AWS) {
    const reported: Array<string> = [
      roleNameOfRoleArn(readDetail(data.posture, "awsWriteRoleArn")),
    ];
    const principal: RegExpExecArray | null = ASSUMED_ROLE_ARN.exec(
      readDetail(data.posture, "awsPrincipalArn"),
    );

    if (principal) {
      reported.push(principal[2] || "");
    }

    principals.awsRoleNames = unique([
      AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
      AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME,
      ...reported,
    ]);
  }

  if (data.provider === CloudProvider.Azure) {
    principals.azurePrincipalIds = unique([
      readDetail(data.posture, "azurePrincipalId"),
    ]);
  }

  if (data.provider === CloudProvider.GCP) {
    principals.gcpServiceAccounts = unique([
      principals.accountId
        ? `${GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID}@${principals.accountId}.iam.gserviceaccount.com`
        : "",
      readDetail(data.posture, "gcpServiceAccount"),
    ]);
  }

  return principals;
}

/*
 * Whether the account's Cloud AI agent made this change: who the cloud
 * says made it is one of the agent's identities. A health event, or a
 * change by anyone else, is not.
 */
export function isCloudAiAgentChange(
  change: CloudChange,
  principals: CloudAiAgentPrincipals,
): boolean {
  if (change.kind !== "change" || change.provider !== principals.provider) {
    return false;
  }

  // AWS names a session by its role's ARN; Azure and Google Cloud name the caller exactly.
  const identity: string = (
    change.provider === CloudProvider.AWS
      ? change.actorIdentity || ""
      : change.actor || ""
  ).trim();

  if (!identity) {
    return false;
  }

  if (change.provider === CloudProvider.AWS) {
    const session: RegExpExecArray | null = ASSUMED_ROLE_ARN.exec(identity);

    return Boolean(
      session &&
        session[1] === principals.accountId &&
        principals.awsRoleNames.includes((session[2] || "").toLowerCase()),
    );
  }

  if (change.provider === CloudProvider.Azure) {
    return principals.azurePrincipalIds.includes(identity.toLowerCase());
  }

  return principals.gcpServiceAccounts.includes(identity.toLowerCase());
}

// One change job of the agent's, as a change is matched to it.
export interface CloudAiChangeJob {
  jobId: ObjectID;
  step: CloudAiChangeStep;
  // When the job could have made its call: claimed (or started) until done.
  from: Date;
  // Null while it still runs.
  to: Date | null;
  // The resource the command names: the cloud's id, and its Cloud Resource's row.
  targetId: string | null;
  targetRowId: string | null;
  suggestionId: ObjectID | null;
  aiRunId: ObjectID | null;
  incidentId: ObjectID | null;
  alertId: ObjectID | null;
}

// A change of the agent's, and the job it belongs to when one explains it.
export interface CloudAiChangeMatch {
  job: CloudAiChangeJob | null;
}

/*
 * The job that made this change of the agent's, or null: among the jobs
 * whose time holds the change's (with the clock's slack), the one whose
 * command names the resource the change names when several do - the
 * latest to start, should two still - and the only one when the change
 * names nothing the jobs do. Two jobs at once on resources the change does
 * not name are no answer: null.
 */
export function pickCloudAiChangeJob(data: {
  change: CloudChange;
  // The Cloud Resource the change is tied to, when the account holds it.
  resourceRowId: string | null;
  jobs: Array<CloudAiChangeJob>;
  now: Date;
}): CloudAiChangeJob | null {
  const time: number = data.change.time.getTime();
  const running: Array<CloudAiChangeJob> = data.jobs.filter(
    (job: CloudAiChangeJob): boolean => {
      const to: number = job.to ? job.to.getTime() : data.now.getTime();

      return (
        time >= job.from.getTime() - CLOUD_AI_CHANGE_CLOCK_SLACK_MS &&
        time <= to + CLOUD_AI_CHANGE_CLOCK_SLACK_MS
      );
    },
  );

  if (running.length === 0) {
    return null;
  }

  const namesTarget: (job: CloudAiChangeJob) => boolean = (
    job: CloudAiChangeJob,
  ): boolean => {
    if (data.resourceRowId && job.targetRowId === data.resourceRowId) {
      return true;
    }

    return data.change.resources.some((resource: { id: string }): boolean => {
      return Boolean(
        job.targetId &&
          isSameCloudResourceId(
            data.change.provider as string as CloudCatalogProvider,
            resource.id,
            job.targetId,
          ),
      );
    });
  };

  const onTarget: Array<CloudAiChangeJob> = running.filter(namesTarget);
  const candidates: Array<CloudAiChangeJob> =
    onTarget.length > 0 ? onTarget : running.length === 1 ? running : [];

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce(
    (latest: CloudAiChangeJob, job: CloudAiChangeJob): CloudAiChangeJob => {
      return job.from.getTime() > latest.from.getTime() ? job : latest;
    },
  );
}

/*
 * One stored job as a change is matched to it, or null for a job that
 * changed nothing: a dry run, a read, a job that never ran.
 */
export function toCloudAiChangeJob(data: {
  job: RunnerJob;
  provider: CloudProvider;
  index: CloudResourceIndex;
  suggestion: AutoRemediationSuggestion | null;
}): CloudAiChangeJob | null {
  const job: RunnerJob = data.job;
  const stepId: string = job.stepId || "";
  const payload: JSONObject = (job.payload as JSONObject) || {};
  const from: Date | undefined =
    job.startedAt || job.claimedAt || job.createdAt;

  if (
    !job.id ||
    !from ||
    stepId.startsWith(DRY_RUN_COMMAND_STEP_ID_PREFIX) ||
    payload["tier"] === ResourceCommandTier.Read ||
    !job.status ||
    !RAN_STATUSES.includes(job.status)
  ) {
    return null;
  }

  const args: unknown = payload["args"];
  const parsed: CloudCommandParse | null = Array.isArray(args)
    ? parseCloudCommand(data.provider as string as CloudCatalogProvider, [
        CLOUD_PROGRAM,
        ...(args as Array<unknown>),
      ])
    : null;
  const targetId: string | null =
    parsed && parsed.ok ? parsed.command.resource?.id || null : null;
  const target: CloudIndexEntry | null = targetId
    ? data.index.find({ id: targetId })
    : null;

  return {
    jobId: job.id,
    step: stepId.startsWith(ROLLBACK_COMMAND_STEP_ID_PREFIX)
      ? CloudAiChangeStep.Rollback
      : CloudAiChangeStep.Fix,
    from: new Date(from),
    to: job.completedAt ? new Date(job.completedAt) : null,
    targetId,
    targetRowId: target ? target.id.toString() : null,
    suggestionId: job.autoRemediationSuggestionId || null,
    aiRunId: job.aiRunId || null,
    incidentId: data.suggestion?.incidentId || null,
    alertId: data.suggestion?.alertId || null,
  };
}

// What a batch of one account's changes is attributed with.
export interface CloudAiChangeAttribution {
  // The change's match when the agent made it, else null.
  match: (data: {
    change: CloudChange;
    resourceRowId: string | null;
  }) => CloudAiChangeMatch | null;
}

const NOTHING_ATTRIBUTED: CloudAiChangeAttribution = {
  match: (): null => {
    return null;
  },
};

export default class CloudAiChangeAttributionReader {
  /*
   * What one account's batch of changes is attributed with: who its agent
   * is (its row's posture), and - only when some change is the agent's -
   * its change jobs around those changes and the fixes they belong to.
   * Never throws: what cannot be read attributes nothing it needed.
   */
  public static async read(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    // The Cloud Account row the changes belong to.
    accountRecordId: ObjectID;
    // The cloud's own id of the account.
    accountId: string;
    changes: Array<CloudChange>;
    index: CloudResourceIndex;
    now?: Date | undefined;
  }): Promise<CloudAiChangeAttribution> {
    const resourceType: AiResourceType | undefined =
      AI_RESOURCE_TYPES[data.provider];

    if (
      !resourceType ||
      !data.changes.some((change: CloudChange): boolean => {
        return (
          change.kind === "change" &&
          Boolean(
            data.provider === CloudProvider.AWS
              ? change.actorIdentity
              : change.actor,
          )
        );
      })
    ) {
      return NOTHING_ATTRIBUTED;
    }

    let agent: ResourceAiAgent | null = null;

    try {
      agent = await ResourceAiAgentService.findAgentForResource({
        projectId: data.projectId,
        resourceType,
        resourceId: data.accountRecordId,
      });
    } catch (error) {
      // The setup's own names still tell the agent's changes.
      logger.debug(
        `Cloud changes of account ${data.accountRecordId.toString()}: its AI agent could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const principals: CloudAiAgentPrincipals = getCloudAiAgentPrincipals({
      provider: data.provider,
      accountId: data.accountId,
      posture: parseResourceAiAgentPosture(agent?.posture),
    });
    const agentChanges: Array<CloudChange> = data.changes.filter(
      (change: CloudChange): boolean => {
        return isCloudAiAgentChange(change, principals);
      },
    );

    if (agentChanges.length === 0) {
      return NOTHING_ATTRIBUTED;
    }

    const jobs: Array<CloudAiChangeJob> =
      await CloudAiChangeAttributionReader.readJobs({
        projectId: data.projectId,
        provider: data.provider,
        resourceType,
        accountRecordId: data.accountRecordId,
        changes: agentChanges,
        index: data.index,
      });
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    return {
      match: (match: {
        change: CloudChange;
        resourceRowId: string | null;
      }): CloudAiChangeMatch | null => {
        if (!isCloudAiAgentChange(match.change, principals)) {
          return null;
        }

        return {
          job: pickCloudAiChangeJob({
            change: match.change,
            resourceRowId: match.resourceRowId,
            jobs,
            now,
          }),
        };
      },
    };
  }

  // The agent's change jobs around these changes, with their fixes; [] when they cannot be read.
  private static async readJobs(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    resourceType: AiResourceType;
    accountRecordId: ObjectID;
    changes: Array<CloudChange>;
    index: CloudResourceIndex;
  }): Promise<Array<CloudAiChangeJob>> {
    const times: Array<number> = data.changes.map(
      (change: CloudChange): number => {
        return change.time.getTime();
      },
    );
    const since: Date = new Date(
      Math.min(...times) - CLOUD_AI_CHANGE_JOB_LOOK_BACK_MS,
    );
    const until: Date = new Date(
      Math.max(...times) + CLOUD_AI_CHANGE_CLOCK_SLACK_MS,
    );

    try {
      const rows: Array<RunnerJob> = await RunnerJobService.findBy({
        query: {
          projectId: data.projectId,
          resourceType: data.resourceType,
          resourceId: data.accountRecordId,
          origin: RunnerJobOrigin.AiRemediation,
          stepType: RunbookStepType.ResourceCommand,
          createdAt: new InBetween<Date>(since, until),
        },
        select: {
          _id: true,
          stepId: true,
          payload: true,
          status: true,
          aiRunId: true,
          autoRemediationSuggestionId: true,
          createdAt: true,
          claimedAt: true,
          startedAt: true,
          completedAt: true,
        },
        sort: { createdAt: SortOrder.Descending },
        limit: CLOUD_AI_CHANGE_JOB_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

      const suggestionIds: Array<ObjectID> = [];

      for (const row of rows) {
        if (
          row.autoRemediationSuggestionId &&
          !suggestionIds.some((id: ObjectID): boolean => {
            return (
              id.toString() === row.autoRemediationSuggestionId!.toString()
            );
          })
        ) {
          suggestionIds.push(row.autoRemediationSuggestionId);
        }
      }

      const suggestions: Array<AutoRemediationSuggestion> =
        suggestionIds.length > 0
          ? await AutoRemediationSuggestionService.findBy({
              query: {
                projectId: data.projectId,
                _id: QueryHelper.any(suggestionIds),
              },
              select: { _id: true, incidentId: true, alertId: true },
              limit: suggestionIds.length,
              skip: 0,
              props: { isRoot: true },
            })
          : [];

      const jobs: Array<CloudAiChangeJob> = [];

      for (const row of rows) {
        const suggestion: AutoRemediationSuggestion | null =
          suggestions.find((entry: AutoRemediationSuggestion): boolean => {
            return Boolean(
              entry.id &&
                row.autoRemediationSuggestionId &&
                entry.id.toString() ===
                  row.autoRemediationSuggestionId.toString(),
            );
          }) || null;
        const job: CloudAiChangeJob | null = toCloudAiChangeJob({
          job: row,
          provider: data.provider,
          index: data.index,
          suggestion,
        });

        if (job) {
          jobs.push(job);
        }
      }

      return jobs;
    } catch (error) {
      logger.error(
        `Cloud changes of account ${data.accountRecordId.toString()}: OneUptime AI's jobs could not be read, so its changes are marked without their fix: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }
}
