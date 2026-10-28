import RunCron from "../../Utils/Cron";
import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import DataSecurityDiscovery from "Common/Server/Utils/DataSecurity/DataSecurityDiscovery";
import DataSecurityEvaluator from "Common/Server/Utils/DataSecurity/DataSecurityEvaluator";
import DataSecurityRunner, {
  DATA_SECURITY_TURN_TIME_LIMIT_IN_MS,
} from "Common/Server/Utils/DataSecurity/DataSecurityRunner";
import {
  DATA_SECURITY_DISCOVER_PROJECT_JOB,
  DATA_SECURITY_EVALUATE_PROJECT_JOB,
  DATA_SECURITY_READ_CONNECTION_JOB,
  DATA_SECURITY_SCAN_STORE_JOB,
  DATA_SECURITY_SCAN_TELEMETRY_JOB,
  queueDataSecurityConnectionRead,
  queueDataSecurityDiscovery,
  queueDataSecurityEvaluation,
  queueDataSecurityTelemetryScan,
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

JobDictionary.setJobFunction(
  DATA_SECURITY_DISCOVER_PROJECT_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");

    if (projectId) {
      await DataSecurityDiscovery.discoverProject(projectId);
    }
  },
);
JobDictionary.setTimeoutInMs(DATA_SECURITY_DISCOVER_PROJECT_JOB, 10 * 60 * 1000);

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
JobDictionary.setTimeoutInMs(DATA_SECURITY_EVALUATE_PROJECT_JOB, 10 * 60 * 1000);

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
