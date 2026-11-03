import RunCron from "../../Utils/Cron";
import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import DataObservabilityRunner from "Common/Server/Utils/DataObservability/DataObservabilityRunner";
import DataPipelineScheduleCheck from "Common/Server/Utils/DataObservability/DataPipelineScheduleCheck";
import {
  DATA_OBSERVABILITY_COLLECT_STORE_JOB,
  DATA_OBSERVABILITY_DISCOVER_TABLE_USAGE_JOB,
  queueTableHealthCollection,
  queueTableUsageDiscovery,
} from "Common/Server/Utils/DataObservability/DataObservabilityJobs";
import TableUsageDiscovery from "Common/Server/Utils/DataObservability/TableUsageDiscovery";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIFTEEN_MINUTE, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * DATA OBSERVABILITY'S SCHEDULE.
 *
 * Every five minutes, claim the stores whose table health is due on a
 * worker and queue one collection per store. Stores a probe collects are
 * claimed by their probe's own poll instead (ProbeIngest/DataObservability).
 *
 * Every fifteen minutes, queue one table usage discovery per project whose
 * databases are read: which services read and write each table, from the
 * last hour of their database spans (TableUsageDiscovery).
 *
 * Every five minutes, check every pipeline's schedule: how late its next
 * run is, and how long its running run has taken (DataPipelineScheduleCheck).
 */

// The most stores claimed for collection per run.
const STORES_CLAIMED_PER_RUN: number = 100;

// How long one store's collection may run: a handful of catalog statements, each bounded.
const COLLECT_STORE_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

function readId(job: QueueJob | undefined, key: string): ObjectID | null {
  const data: JSONObject = (job?.data || {}) as JSONObject;
  const value: unknown = data[key];

  return typeof value === "string" && ObjectID.isValidUUID(value)
    ? new ObjectID(value)
    : null;
}

RunCron(
  "DataObservability:CollectDueStores",
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: 4 * 60 * 1000,
  },
  async () => {
    for (const due of await DataObservabilityRunner.claimDueStores(
      STORES_CLAIMED_PER_RUN,
    )) {
      await queueTableHealthCollection(due);
    }
  },
);

JobDictionary.setJobFunction(
  DATA_OBSERVABILITY_COLLECT_STORE_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");
    const dataStoreId: ObjectID | null = readId(job, "dataStoreId");

    if (projectId && dataStoreId) {
      await DataObservabilityRunner.collectStore(projectId, dataStoreId);
    }
  },
);
JobDictionary.setTimeoutInMs(
  DATA_OBSERVABILITY_COLLECT_STORE_JOB,
  COLLECT_STORE_TIMEOUT_IN_MS,
);

// How long one project's discovery may run: one ClickHouse read, then its writes.
const DISCOVER_TABLE_USAGE_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

RunCron(
  "DataObservability:DiscoverTableUsageForProjects",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: 4 * 60 * 1000,
  },
  async () => {
    for (const projectId of await TableUsageDiscovery.getProjectIds()) {
      await queueTableUsageDiscovery(projectId);
    }
  },
);

JobDictionary.setJobFunction(
  DATA_OBSERVABILITY_DISCOVER_TABLE_USAGE_JOB,
  async (job?: QueueJob): Promise<void> => {
    const projectId: ObjectID | null = readId(job, "projectId");

    if (projectId) {
      await TableUsageDiscovery.discoverProject({
        projectId,
        now: OneUptimeDate.getCurrentDate(),
      });
    }
  },
);
JobDictionary.setTimeoutInMs(
  DATA_OBSERVABILITY_DISCOVER_TABLE_USAGE_JOB,
  DISCOVER_TABLE_USAGE_TIMEOUT_IN_MS,
);

RunCron(
  "DataObservability:CheckPipelineSchedules",
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: 4 * 60 * 1000,
  },
  async () => {
    await DataPipelineScheduleCheck.checkAll(OneUptimeDate.getCurrentDate());
  },
);
