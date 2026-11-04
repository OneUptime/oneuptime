import RunCron from "../../Utils/Cron";
import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import DataObservabilityRunner from "Common/Server/Utils/DataObservability/DataObservabilityRunner";
import DataPipelineScheduleCheck from "Common/Server/Utils/DataObservability/DataPipelineScheduleCheck";
import DataProductCheck from "Common/Server/Utils/DataObservability/DataProductCheck";
import DataBiSync from "Common/Server/Utils/DataObservability/Bi/DataBiSync";
import DataReconciliationCompare from "Common/Server/Utils/DataObservability/DataReconciliationCompare";
import {
  DATA_OBSERVABILITY_COLLECT_STORE_JOB,
  DATA_OBSERVABILITY_DISCOVER_TABLE_USAGE_JOB,
  queueTableHealthCollection,
  queueTableUsageDiscovery,
} from "Common/Server/Utils/DataObservability/DataObservabilityJobs";
import TableUsageDiscovery from "Common/Server/Utils/DataObservability/TableUsageDiscovery";
import TraceJobDiscovery from "Common/Server/Utils/DataObservability/TraceJobDiscovery";
import OneUptimeDate from "Common/Types/Date";
import {
  EVERY_DAY,
  EVERY_FIFTEEN_MINUTE,
  EVERY_FIVE_MINUTE,
  EVERY_HOUR,
} from "Common/Utils/CronTime";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import DataAssetService from "Common/Server/Services/DataAssetService";
import logger from "Common/Server/Utils/Logger";
import { WatchedTableMeteredPlan } from "Common/Server/Types/Billing/MeteredPlan/AllMeteredPlans";
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
 *
 * Every five minutes, check every data product's tables against its SLA:
 * which are late, and what its data is as of (DataProductCheck).
 *
 * Every fifteen minutes, reconcile every reconciliation's two sides - also
 * done as each side is recorded - so a side that stopped being read is
 * noticed (DataReconciliationCompare).
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

/*
 * The tables each project has under watch, counted for the bill, which charges
 * nothing for them until the plan has a price (WatchedTableMeteredPlan).
 */
RunCron(
  "DataObservability:CountWatchedTables",
  {
    schedule: EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: 30 * 60 * 1000,
  },
  async () => {
    if (!IsBillingEnabled) {
      return;
    }

    const projectIds: Map<string, ObjectID> = new Map();

    for (const asset of await DataAssetService.findBy({
      query: { isDropped: false },
      select: { projectId: true },
      skip: 0,
      limit: 50_000,
      props: { isRoot: true },
    })) {
      const projectId: ObjectID | undefined = (asset as DataAsset).projectId;

      if (projectId) {
        projectIds.set(projectId.toString(), projectId);
      }
    }

    for (const projectId of projectIds.values()) {
      try {
        await WatchedTableMeteredPlan.reportQuantityToBillingProvider(
          projectId,
        );
      } catch (error) {
        logger.error(
          `Data Observability: could not count the watched tables of project ${projectId.toString()}.`,
        );
        logger.error(error);
      }
    }
  },
);

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
      await TraceJobDiscovery.discoverProject({
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

RunCron(
  "DataObservability:CheckDataProducts",
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: 4 * 60 * 1000,
  },
  async () => {
    await DataProductCheck.checkAll(OneUptimeDate.getCurrentDate());
  },
);

RunCron(
  "DataObservability:CompareReconciliations",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await DataReconciliationCompare.compareAll(OneUptimeDate.getCurrentDate());
  },
);

// Every BI tool's dashboards, and the tables behind them, once an hour.
RunCron(
  "DataObservability:SyncBiDashboards",
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: 50 * 60 * 1000,
  },
  async () => {
    await DataBiSync.syncAll();
  },
);
