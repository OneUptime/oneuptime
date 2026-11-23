import Queue, { QueueName } from "../../Infrastructure/Queue";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE QUEUE JOBS DATA SECURITY'S WORK IS SPLIT INTO.
 *
 * The Workers run them (Jobs/DataSecurity/*): discovering one project's
 * stores, scanning one project's telemetry, evaluating a project's stores
 * again after something that decides their checks changed, scanning one
 * store's content, asking OneUptime AI about the fields a store's scan
 * could not place, having OneUptime AI work on an issue that opened, and
 * reading one cloud connection's configuration. The
 * schedules only queue them, one per project, store or connection, so a
 * large installation is spread over every worker instead of one loop.
 * Each is deduplicated by what it is about, keeping the latest asked for,
 * so a person saving five settings in a row queues one evaluation.
 * Queueing is best effort: the scheduled runs reach everything anyway.
 */

export const DATA_SECURITY_DISCOVER_PROJECT_JOB: string =
  "DataSecurity:DiscoverProject";
// Not the hourly cron's "DataSecurity:ScanTelemetry": a job's function is found by its name.
export const DATA_SECURITY_SCAN_TELEMETRY_JOB: string =
  "DataSecurity:ScanProjectTelemetry";
export const DATA_SECURITY_EVALUATE_PROJECT_JOB: string =
  "DataSecurity:EvaluateProject";
export const DATA_SECURITY_SCAN_STORE_JOB: string = "DataSecurity:ScanStore";
export const DATA_SECURITY_READ_CONNECTION_JOB: string =
  "DataSecurity:ReadConnection";
export const DATA_SECURITY_SUGGEST_FIELD_TYPES_JOB: string =
  "DataSecurity:SuggestFieldTypes";
export const DATA_SECURITY_AI_EVALUATE_ISSUE_JOB: string =
  "DataSecurity:AiEvaluateIssue";
export const DATA_SECURITY_NOTIFY_OWNERS_JOB: string =
  "DataSecurity:NotifyOwners";
export const DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB: string =
  "DataSecurity:ProposeStoreOwners";
export const DATA_SECURITY_PROPOSE_OWNER_RULES_JOB: string =
  "DataSecurity:ProposeOwnerRules";
export const DATA_SECURITY_GROUP_ISSUES_JOB: string =
  "DataSecurity:GroupIssues";
export const DATA_SECURITY_DRAFT_RECORDS_JOB: string =
  "DataSecurity:DraftRecords";

/*
 * How long the grouping waits after an evaluation: a connection's read
 * evaluates the project, then its scans do again, and one look after them
 * groups what all of them opened.
 */
export const GROUP_ISSUES_DELAY_IN_MS: number = 30 * 1000;

/*
 * How long the owner rules wait after a store's owners are proposed: a
 * connection's first read proposes many at once, and one look over all of
 * them finds the rules they share.
 */
export const OWNER_RULES_DELAY_IN_MS: number = 3 * 60 * 1000;

// Whether it was queued: a caller with somewhere else to go can go there.
async function queue(data: {
  jobName: string;
  key: string;
  payload: Record<string, string>;
  description: string;
  // How long it waits before it runs.
  delayInMs?: number | undefined;
}): Promise<boolean> {
  try {
    await Queue.addJob(
      QueueName.Worker,
      `${data.key}-${ObjectID.generate().toString()}`,
      data.jobName,
      data.payload,
      {
        deduplication: {
          id: data.key,
          keepLastIfActive: true,
        },
        removeWhenDone: true,
        ...(data.delayInMs ? { delayInMs: data.delayInMs } : {}),
      },
    );

    return true;
  } catch (error) {
    logger.error(`DataSecurity: could not queue ${data.description}:`);
    logger.error(error);
    return false;
  }
}

// Finds a project's stores in inventory, the Database product and the service map.
export async function queueDataSecurityDiscovery(
  projectId: ObjectID,
): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_DISCOVER_PROJECT_JOB,
    key: `data-security-discover-${projectId.toString()}`,
    payload: { projectId: projectId.toString() },
    description: `the discovery of project ${projectId.toString()}`,
  });
}

// Samples a project's recent logs, traces and exceptions for sensitive data.
export async function queueDataSecurityTelemetryScan(
  projectId: ObjectID,
): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_SCAN_TELEMETRY_JOB,
    key: `data-security-telemetry-${projectId.toString()}`,
    payload: { projectId: projectId.toString() },
    description: `the telemetry scan of project ${projectId.toString()}`,
  });
}

// Evaluates a project's stores again: sensitivity, checks, issues, risk.
export async function queueDataSecurityEvaluation(
  projectId: ObjectID,
): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_EVALUATE_PROJECT_JOB,
    key: `data-security-evaluate-${projectId.toString()}`,
    payload: { projectId: projectId.toString() },
    description: `the evaluation of project ${projectId.toString()}`,
  });
}

// Samples one store's content now, instead of at its next scheduled scan.
export async function queueDataStoreScan(data: {
  projectId: ObjectID;
  dataStoreId: ObjectID;
}): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_SCAN_STORE_JOB,
    key: `data-security-scan-${data.dataStoreId.toString()}`,
    payload: {
      projectId: data.projectId.toString(),
      dataStoreId: data.dataStoreId.toString(),
    },
    description: `the scan of store ${data.dataStoreId.toString()}`,
  });
}

/*
 * Asks OneUptime AI which data type each field a store's last content scan
 * could not place holds (Server/Utils/AI/DataSecurity/FieldSuggestion).
 */
export async function queueDataSecurityFieldSuggestions(data: {
  projectId: ObjectID;
  dataStoreId: ObjectID;
}): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_SUGGEST_FIELD_TYPES_JOB,
    key: `data-security-suggest-${data.dataStoreId.toString()}`,
    payload: {
      projectId: data.projectId.toString(),
      dataStoreId: data.dataStoreId.toString(),
    },
    description: `the field suggestions of store ${data.dataStoreId.toString()}`,
  });
}

/*
 * Has OneUptime AI work on a Data Security issue that opened, or opened
 * again (Server/Utils/AI/DataSecurity/DataSecurityAiEngine, #10364): one
 * job per issue, so an issue that flaps while its job waits is worked on
 * once.
 */
export async function queueDataSecurityAiEvaluation(data: {
  projectId: ObjectID;
  dataSecurityIssueId: ObjectID;
}): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_AI_EVALUATE_ISSUE_JOB,
    key: `data-security-ai-${data.dataSecurityIssueId.toString()}`,
    payload: {
      projectId: data.projectId.toString(),
      dataSecurityIssueId: data.dataSecurityIssueId.toString(),
    },
    description: `OneUptime AI's work on issue ${data.dataSecurityIssueId.toString()}`,
  });
}

/*
 * How long a store's owners' email waits, at a time, for OneUptime AI's
 * work on the issues it is about (#10369), and how long at most since the
 * issues opened: then it goes, with whatever analysis there is.
 */
export const OWNER_NOTICE_WAIT_IN_MS: number = 60 * 1000;
export const OWNER_NOTICE_MAX_WAIT_IN_MS: number = 10 * 60 * 1000;

export interface HeldOwnerNotice {
  projectId: ObjectID;
  dataStoreId: ObjectID;
  issueIds: Array<ObjectID>;
  // When the issues opened: what the longest wait is counted from.
  openedAt: Date;
  // How many times it waited already.
  attempt: number;
}

/*
 * The email a store's owners get about issues that opened on it, held while
 * OneUptime AI works on them (#10369), so it carries each one's analysis:
 * one job per store and batch of issues, and one per wait. False when it
 * could not be queued - the caller sends the email now instead.
 */
export async function queueDataSecurityOwnerNotice(
  notice: HeldOwnerNotice,
): Promise<boolean> {
  const batch: string = `${notice.dataStoreId.toString()}-${notice.openedAt.getTime()}`;

  return await queue({
    jobName: DATA_SECURITY_NOTIFY_OWNERS_JOB,
    key: `data-security-owner-notice-${batch}-${notice.attempt}`,
    payload: {
      projectId: notice.projectId.toString(),
      dataStoreId: notice.dataStoreId.toString(),
      issueIds: notice.issueIds
        .map((issueId: ObjectID): string => {
          return issueId.toString();
        })
        .join(","),
      openedAt: notice.openedAt.toISOString(),
      attempt: String(notice.attempt),
    },
    description: `the owners' email of store ${notice.dataStoreId.toString()}`,
    delayInMs: OWNER_NOTICE_WAIT_IN_MS,
  });
}

// A held notice, as its job's payload carries it, or null for one that does not read.
export function readHeldOwnerNotice(
  payload: Record<string, unknown> | undefined,
): HeldOwnerNotice | null {
  const read: (key: string) => string = (key: string): string => {
    const value: unknown = payload?.[key];

    return typeof value === "string" ? value.trim() : "";
  };

  const projectId: string = read("projectId");
  const dataStoreId: string = read("dataStoreId");
  const issueIds: Array<string> = read("issueIds")
    .split(",")
    .map((id: string): string => {
      return id.trim();
    })
    .filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });
  const openedAt: Date = new Date(read("openedAt"));
  const attempt: number = Number(read("attempt"));

  if (
    !ObjectID.isValidUUID(projectId) ||
    !ObjectID.isValidUUID(dataStoreId) ||
    issueIds.length === 0 ||
    Number.isNaN(openedAt.getTime())
  ) {
    return null;
  }

  return {
    projectId: new ObjectID(projectId),
    dataStoreId: new ObjectID(dataStoreId),
    issueIds: issueIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    openedAt,
    attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
  };
}

/*
 * Has OneUptime AI propose owners for a project's stores that have none
 * (Server/Utils/AI/DataSecurity/DataStoreOwnerProposalRun, #10374): the
 * stores new today, or those of a cloud connection read for the first
 * time. One job per project a day, and one per connection's first read.
 */
export async function queueDataStoreOwnerProposals(data: {
  projectId: ObjectID;
  cloudConnectionId?: ObjectID | undefined;
}): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB,
    key: data.cloudConnectionId
      ? `data-security-owners-${data.cloudConnectionId.toString()}`
      : `data-security-owners-${data.projectId.toString()}`,
    payload: {
      projectId: data.projectId.toString(),
      ...(data.cloudConnectionId
        ? { cloudConnectionId: data.cloudConnectionId.toString() }
        : {}),
    },
    description: `OneUptime AI's owners for the stores of project ${data.projectId.toString()}`,
  });
}

/*
 * Has OneUptime AI draft the record of processing of a project's stores
 * with personal data (Server/Utils/AI/DataSecurity/
 * RecordOfProcessingDraftRun, #10375): one job per project a day.
 */
export async function queueDataSecurityRecordDrafts(
  projectId: ObjectID,
): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_DRAFT_RECORDS_JOB,
    key: `data-security-record-drafts-${projectId.toString()}`,
    payload: { projectId: projectId.toString() },
    description: `OneUptime AI's record of processing drafts for project ${projectId.toString()}`,
  });
}

/*
 * Has OneUptime AI propose the owner rules the project's proposed owners
 * share (Server/Utils/AI/DataSecurity/DataStoreOwnerRuleProposals): a few
 * minutes after a store's owners are proposed, once for all of them.
 */
export async function queueDataStoreOwnerRuleProposals(
  projectId: ObjectID,
): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_PROPOSE_OWNER_RULES_JOB,
    key: `data-security-owner-rules-${projectId.toString()}`,
    payload: { projectId: projectId.toString() },
    description: `OneUptime AI's owner rules for project ${projectId.toString()}`,
    delayInMs: OWNER_RULES_DELAY_IN_MS,
  });
}

/*
 * Groups a project's issues by what made them (#10370): queued by each
 * evaluation, a little after it, so the issues one mistake made are one
 * group, and the group counts them as they resolve
 * (Utils/DataSecurity/DataSecurityIssueGrouper).
 */
export async function queueDataSecurityIssueGrouping(
  projectId: ObjectID,
): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_GROUP_ISSUES_JOB,
    key: `data-security-group-issues-${projectId.toString()}`,
    payload: { projectId: projectId.toString() },
    description: `the grouping of the issues of project ${projectId.toString()}`,
    delayInMs: GROUP_ISSUES_DELAY_IN_MS,
  });
}

// Reads one cloud connection's stores' configuration and access now.
export async function queueDataSecurityConnectionRead(data: {
  projectId: ObjectID;
  cloudConnectionId: ObjectID;
}): Promise<void> {
  await queue({
    jobName: DATA_SECURITY_READ_CONNECTION_JOB,
    key: `data-security-read-${data.cloudConnectionId.toString()}`,
    payload: {
      projectId: data.projectId.toString(),
      cloudConnectionId: data.cloudConnectionId.toString(),
    },
    description: `the read of connection ${data.cloudConnectionId.toString()}`,
  });
}
