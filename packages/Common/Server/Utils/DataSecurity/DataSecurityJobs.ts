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
export const DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB: string =
  "DataSecurity:ProposeStoreOwners";
export const DATA_SECURITY_PROPOSE_OWNER_RULES_JOB: string =
  "DataSecurity:ProposeOwnerRules";

/*
 * How long the owner rules wait after a store's owners are proposed: a
 * connection's first read proposes many at once, and one look over all of
 * them finds the rules they share.
 */
export const OWNER_RULES_DELAY_IN_MS: number = 3 * 60 * 1000;

async function queue(data: {
  jobName: string;
  key: string;
  payload: Record<string, string>;
  description: string;
  delayInMs?: number | undefined;
}): Promise<void> {
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
  } catch (error) {
    logger.error(`DataSecurity: could not queue ${data.description}:`);
    logger.error(error);
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
