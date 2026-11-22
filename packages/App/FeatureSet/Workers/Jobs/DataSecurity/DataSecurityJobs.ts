import RunCron from "../../Utils/Cron";
import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import DataSecurityDiscovery from "Common/Server/Utils/DataSecurity/DataSecurityDiscovery";
import DataSecurityEvaluator from "Common/Server/Utils/DataSecurity/DataSecurityEvaluator";
import DataSecurityRunner, {
  DATA_SECURITY_TURN_TIME_LIMIT_IN_MS,
} from "Common/Server/Utils/DataSecurity/DataSecurityRunner";
import DataSecurityFieldSuggestion from "Common/Server/Utils/AI/DataSecurity/FieldSuggestion";
import DataSecurityAiEngine from "Common/Server/Utils/AI/DataSecurity/DataSecurityAiEngine";
import DataSecurityOwnerNotice from "Common/Server/Utils/AI/DataSecurity/DataSecurityOwnerNotice";
import DataStoreOwnerProposalRun from "Common/Server/Utils/AI/DataSecurity/DataStoreOwnerProposalRun";
import DataStoreOwnerRuleProposals from "Common/Server/Utils/AI/DataSecurity/DataStoreOwnerRuleProposals";
import DataSecurityIssueGrouper from "Common/Server/Utils/DataSecurity/DataSecurityIssueGrouper";
import {
  DATA_SECURITY_AI_EVALUATE_ISSUE_JOB,
  DATA_SECURITY_NOTIFY_OWNERS_JOB,
  HeldOwnerNotice,
  readHeldOwnerNotice,
  DATA_SECURITY_DISCOVER_PROJECT_JOB,
  DATA_SECURITY_PROPOSE_OWNER_RULES_JOB,
  DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB,
  DATA_SECURITY_EVALUATE_PROJECT_JOB,
  DATA_SECURITY_GROUP_ISSUES_JOB,
  DATA_SECURITY_READ_CONNECTION_JOB,
  DATA_SECURITY_SCAN_STORE_JOB,
  DATA_SECURITY_SCAN_TELEMETRY_JOB,
  DATA_SECURITY_SUGGEST_FIELD_TYPES_JOB,
  queueDataSecurityConnectionRead,
  queueDataSecurityDiscovery,
  queueDataSecurityEvaluation,
  queueDataSecurityTelemetryScan,
  queueDataStoreOwnerProposals,
  queueDataStoreScan,
} from "Common/Server/Utils/DataSecurity/DataSecurityJobs";
import {
  EVERY_DAY,
  EVERY_FIFTEEN_MINUTE,
  EVERY_HOUR,
  EVERY_FIVE_MINUTE,
} from "Common/Utils/CronTime";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * DATA SECURITY'S SCHEDULE.
 *
 *  - Every 15 minutes, discover each project's stores from inventory, the
 *    Database product and the service map.
 *  - Every hour, read the configuration of the cloud connections that are
 *    due (a day since the last read, or a cloud change since), and scan
 *    each project's telemetry.
 *  - Every 5 minutes, claim the stores whose content is due and sample
 *    them.
 *  - Every day, evaluate every project, so accepted risks expire and stale
 *    data ages into its check on time even when nothing was scanned.
 *  - After a store's content scan that left fields no detector placed, ask
 *    OneUptime AI what they hold (queued by the scan, not by a schedule).
 *  - When an issue opens, or opens again, have OneUptime AI work on it as
 *    the project's Data Security AI rules say (queued by the evaluation,
 *    one job per issue), and - while it does - email the store's owners once
 *    its analysis is there (one job per store, waiting a minute at a time,
 *    #10369).
 *  - Every day, and when a cloud connection is first read (queued by the
 *    read), have OneUptime AI propose owners for the stores that have
 *    none (#10374); a few minutes after a store's owners are proposed, the
 *    owner rules they share.
 *  - After each evaluation (queued by it, a little after), group the
 *    project's issues by what made them, so the issues one mistake made are
 *    one group, fixed once (#10370).
 *
 * The crons only decide what is due; each piece of work - one project, one
 * store, one connection - is its own queue job, deduplicated by what it is
 * about (Utils/DataSecurity/DataSecurityJobs), so the work spreads over
 * every worker and a slow scan never holds the schedule.
 */

// The most stores claimed for content scans per run.
const STORES_CLAIMED_PER_RUN: number = 50;

function readId(job: QueueJob | undefined, key: string): ObjectID | null {
  const data: JSONObject = (job?.data || {}) as JSONObject;
  const value: unknown = data[key];

  return typeof value === "string" && ObjectID.isValidUUID(value)
    ? new ObjectID(value)
    : null;
}

RunCron(
  "DataSecurity:Discover",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: 14 * 60 * 1000,
  },
  async () => {
    for (const projectId of await DataSecurityRunner.listProjectIds()) {
      await queueDataSecurityDiscovery(projectId);
    }
  },
);

RunCron(
  "DataSecurity:ReadDueConnections",
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    for (const due of await DataSecurityRunner.dueConnections()) {
      await queueDataSecurityConnectionRead(due);
    }
  },
);

RunCron(
  "DataSecurity:ScanDueStores",
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: 4 * 60 * 1000,
  },
  async () => {
    for (const due of await DataSecurityRunner.claimDueStores(
      STORES_CLAIMED_PER_RUN,
    )) {
      await queueDataStoreScan(due);
    }
  },
);

RunCron(
  "DataSecurity:ScanTelemetry",
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    for (const projectId of await DataSecurityRunner.listProjectIds()) {
      await queueDataSecurityTelemetryScan(projectId);
    }
  },
);

RunCron(
  "DataSecurity:EvaluateAll",
  {
    schedule: EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    for (const projectId of await DataSecurityRunner.listProjectIds()) {
      await queueDataSecurityEvaluation(projectId);
    }
  },
);

RunCron(
  "DataSecurity:ProposeStoreOwners",
  {
    schedule: EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    for (const projectId of await DataSecurityRunner.listProjectIds()) {
      await queueDataStoreOwnerProposals({ projectId });
    }
  },
);

JobDictionary.setJobFunction(
  DATA_SECURITY_DISCOVER_PROJECT_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");

    if (projectId) {
      await DataSecurityDiscovery.discoverProject(projectId);
    }
  },
);
JobDictionary.setTimeoutInMs(
  DATA_SECURITY_DISCOVER_PROJECT_JOB,
  10 * 60 * 1000,
);

JobDictionary.setJobFunction(
  DATA_SECURITY_SCAN_TELEMETRY_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");

    if (projectId) {
      await DataSecurityRunner.scanTelemetry(projectId);
    }
  },
);
JobDictionary.setTimeoutInMs(
  DATA_SECURITY_SCAN_TELEMETRY_JOB,
  DATA_SECURITY_TURN_TIME_LIMIT_IN_MS + 60 * 1000,
);

JobDictionary.setJobFunction(
  DATA_SECURITY_EVALUATE_PROJECT_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");

    if (projectId) {
      await DataSecurityEvaluator.evaluateProject(projectId);
    }
  },
);
JobDictionary.setTimeoutInMs(
  DATA_SECURITY_EVALUATE_PROJECT_JOB,
  10 * 60 * 1000,
);

JobDictionary.setJobFunction(
  DATA_SECURITY_SCAN_STORE_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");
    const dataStoreId: ObjectID | null = readId(job, "dataStoreId");

    if (projectId && dataStoreId) {
      await DataSecurityRunner.scanStore(projectId, dataStoreId);
    }
  },
);
JobDictionary.setTimeoutInMs(
  DATA_SECURITY_SCAN_STORE_JOB,
  DATA_SECURITY_TURN_TIME_LIMIT_IN_MS + 60 * 1000,
);

JobDictionary.setJobFunction(
  DATA_SECURITY_READ_CONNECTION_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");
    const cloudConnectionId: ObjectID | null = readId(job, "cloudConnectionId");

    if (projectId && cloudConnectionId) {
      await DataSecurityRunner.readConnection(projectId, cloudConnectionId);
    }
  },
);
JobDictionary.setTimeoutInMs(
  DATA_SECURITY_READ_CONNECTION_JOB,
  DATA_SECURITY_TURN_TIME_LIMIT_IN_MS + 60 * 1000,
);

JobDictionary.setJobFunction(
  DATA_SECURITY_SUGGEST_FIELD_TYPES_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");
    const dataStoreId: ObjectID | null = readId(job, "dataStoreId");

    if (projectId && dataStoreId) {
      await DataSecurityFieldSuggestion.suggestForStore({
        projectId,
        dataStoreId,
      });
    }
  },
);
JobDictionary.setTimeoutInMs(
  DATA_SECURITY_SUGGEST_FIELD_TYPES_JOB,
  5 * 60 * 1000,
);

// OneUptime AI's work on one issue that opened, or opened again (#10364).
JobDictionary.setJobFunction(
  DATA_SECURITY_AI_EVALUATE_ISSUE_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");
    const dataSecurityIssueId: ObjectID | null = readId(
      job,
      "dataSecurityIssueId",
    );

    if (projectId && dataSecurityIssueId) {
      await DataSecurityAiEngine.evaluateIssue({
        projectId,
        dataSecurityIssueId,
      });
    }
  },
);
JobDictionary.setTimeoutInMs(
  DATA_SECURITY_AI_EVALUATE_ISSUE_JOB,
  5 * 60 * 1000,
);

/*
 * The email a store's owners get about its new issues, held while OneUptime
 * AI analyzes them (#10369): sent once its work is done, or after ten
 * minutes, with each analyzed issue's verdict and shortest path.
 */
JobDictionary.setJobFunction(
  DATA_SECURITY_NOTIFY_OWNERS_JOB,
  async (job?: QueueJob): Promise<void> => {
    const notice: HeldOwnerNotice | null = readHeldOwnerNotice(
      (job?.data || {}) as JSONObject,
    );

    if (notice) {
      await DataSecurityOwnerNotice.send(notice);
    }
  },
);
JobDictionary.setTimeoutInMs(DATA_SECURITY_NOTIFY_OWNERS_JOB, 5 * 60 * 1000);

// OneUptime AI's owners for a project's stores that have none (#10374).
JobDictionary.setJobFunction(
  DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");

    if (projectId) {
      await DataStoreOwnerProposalRun.run({
        projectId,
        cloudConnectionId: readId(job, "cloudConnectionId") || undefined,
      });
    }
  },
);
JobDictionary.setTimeoutInMs(
  DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB,
  15 * 60 * 1000,
);

// The owner rules the project's proposed owners share (#10374).
JobDictionary.setJobFunction(
  DATA_SECURITY_PROPOSE_OWNER_RULES_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");

    if (projectId) {
      await DataStoreOwnerRuleProposals.proposeForProject({ projectId });
    }
  },
);
JobDictionary.setTimeoutInMs(
  DATA_SECURITY_PROPOSE_OWNER_RULES_JOB,
  5 * 60 * 1000,
);

// The issues one mistake made, grouped by what made them (#10370).
JobDictionary.setJobFunction(
  DATA_SECURITY_GROUP_ISSUES_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");

    if (projectId) {
      await DataSecurityIssueGrouper.groupProject({ projectId });
    }
  },
);
JobDictionary.setTimeoutInMs(DATA_SECURITY_GROUP_ISSUES_JOB, 10 * 60 * 1000);
