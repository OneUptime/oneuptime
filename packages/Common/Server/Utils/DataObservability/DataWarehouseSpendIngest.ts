import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataWarehouseJob from "../../../Models/DatabaseModels/DataWarehouseJob";
import Includes from "../../../Types/BaseDatabase/Includes";
import { UNUSED_AFTER_DAYS } from "../../../Types/DataObservability/DataAssetReads";
import { getDataTableKey } from "../../../Types/DataObservability/DataObservabilityMetric";
import {
  CollectedJobSpend,
  MAX_SPEND_JOBS,
} from "../../../Types/DataObservability/DataWarehouseSpend";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DataAssetService from "../../Services/DataAssetService";
import DataWarehouseJobService from "../../Services/DataWarehouseJobService";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * A WAREHOUSE'S SPEND, KEPT.
 *
 * An hourly collection that read spend says what each job spent over the
 * last day. Its jobs are made to match (a job that did not run in the last
 * day is gone), each job's written tables are tied to watched ones, a job
 * whose every table has gone unread for 90 days is marked - spend nobody
 * uses - and each table's write spend over the last day is its jobs'
 * spend, a job's shared evenly among the tables it writes.
 */

export interface PlannedWarehouseJob {
  job: CollectedJobSpend;
  writtenTables: Array<{ dataAssetId: string; table: string }>;
  writesOnlyUnusedTables: boolean;
  lastRunAt: Date | null;
}

export interface WarehouseSpendPlan {
  jobs: Array<PlannedWarehouseJob>;
  // Each watched table's write spend over the last day, by its id.
  tableSpend: Map<string, { credits: number; bytesBilled: number }>;
}

export function planWarehouseSpend(data: {
  spend: Array<CollectedJobSpend>;
  assetIdByKey: Map<string, ObjectID>;
  unusedAssetIds: Set<string>;
  collectedAt: Date;
}): WarehouseSpendPlan {
  const tableSpend: Map<string, { credits: number; bytesBilled: number }> =
    new Map();
  const jobs: Array<PlannedWarehouseJob> = [];
  const seen: Set<string> = new Set();

  for (const job of data.spend.slice(0, MAX_SPEND_JOBS)) {
    if (seen.has(job.jobKey)) {
      continue;
    }

    seen.add(job.jobKey);

    const writtenTables: Array<{ dataAssetId: string; table: string }> = [];

    for (const table of job.writtenTables) {
      const id: ObjectID | undefined = data.assetIdByKey.get(
        getDataTableKey(table.schema, table.table),
      );

      if (
        id &&
        !writtenTables.some((written: { dataAssetId: string }) => {
          return written.dataAssetId === id.toString();
        })
      ) {
        writtenTables.push({
          dataAssetId: id.toString(),
          table: table.schema ? `${table.schema}.${table.table}` : table.table,
        });
      }
    }

    for (const written of writtenTables) {
      const share: { credits: number; bytesBilled: number } = tableSpend.get(
        written.dataAssetId,
      ) || { credits: 0, bytesBilled: 0 };

      share.credits += (job.credits || 0) / writtenTables.length;
      share.bytesBilled += Math.floor(
        (job.bytesBilled || 0) / writtenTables.length,
      );
      tableSpend.set(written.dataAssetId, share);
    }

    jobs.push({
      job,
      writtenTables,
      writesOnlyUnusedTables:
        writtenTables.length > 0 &&
        writtenTables.every((written: { dataAssetId: string }) => {
          return data.unusedAssetIds.has(written.dataAssetId);
        }),
      lastRunAt:
        job.secondsSinceLastRun !== null
          ? new Date(
              data.collectedAt.getTime() - job.secondsSinceLastRun * 1000,
            )
          : null,
    });
  }

  return { jobs, tableSpend };
}

export default class DataWarehouseSpendIngest {
  public static async record(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    spend: Array<CollectedJobSpend>;
    assetIdByKey: Map<string, ObjectID>;
    collectedAt: Date;
  }): Promise<void> {
    const writtenIds: Array<ObjectID> = [];

    for (const job of data.spend) {
      for (const table of job.writtenTables) {
        const id: ObjectID | undefined = data.assetIdByKey.get(
          getDataTableKey(table.schema, table.table),
        );

        if (id) {
          writtenIds.push(id);
        }
      }
    }

    const cutoff: Date = new Date(
      data.collectedAt.getTime() - UNUSED_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );
    const unused: Array<DataAsset> =
      writtenIds.length > 0
        ? await DataAssetService.findBy({
            query: {
              projectId: data.projectId,
              _id: new Includes(writtenIds),
              unreadSince: QueryHelper.lessThanEqualTo(cutoff),
            },
            select: { _id: true },
            limit: writtenIds.length,
            skip: 0,
            props: { isRoot: true },
          })
        : [];
    const plan: WarehouseSpendPlan = planWarehouseSpend({
      spend: data.spend,
      assetIdByKey: data.assetIdByKey,
      unusedAssetIds: new Set(
        unused.map((asset: DataAsset): string => {
          return asset.id!.toString();
        }),
      ),
      collectedAt: data.collectedAt,
    });

    await DataWarehouseSpendIngest.keepJobs({ ...data, plan });
    await DataWarehouseSpendIngest.keepTableSpend({ ...data, plan });
  }

  private static async keepJobs(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    plan: WarehouseSpendPlan;
  }): Promise<void> {
    const existing: Array<DataWarehouseJob> =
      await DataWarehouseJobService.findBy({
        query: { dataStoreId: data.dataStoreId },
        select: { _id: true, jobKey: true },
        limit: MAX_SPEND_JOBS * 4,
        skip: 0,
        props: { isRoot: true },
      });
    const byKey: Map<string, DataWarehouseJob> = new Map(
      existing.map((job: DataWarehouseJob): [string, DataWarehouseJob] => {
        return [job.jobKey || "", job];
      }),
    );
    const seen: Set<string> = new Set();

    for (const planned of data.plan.jobs) {
      const job: CollectedJobSpend = planned.job;
      const fields: {
        name: string;
        userName: string | undefined;
        warehouseName: string | undefined;
        team: string | undefined;
        runCount: number;
        failedRunCount: number;
        credits: number | undefined;
        bytesBilled: number | undefined;
        writtenTables: Array<JSONObject>;
        writesOnlyUnusedTables: boolean;
        lastRunAt: Date | undefined;
      } = {
        name: job.name,
        userName: job.user || undefined,
        warehouseName: job.warehouse || undefined,
        team: job.team || undefined,
        runCount: job.runs,
        failedRunCount: job.failedRuns,
        credits: job.credits ?? undefined,
        bytesBilled: job.bytesBilled ?? undefined,
        writtenTables: planned.writtenTables as unknown as Array<JSONObject>,
        writesOnlyUnusedTables: planned.writesOnlyUnusedTables,
        lastRunAt: planned.lastRunAt || undefined,
      };

      seen.add(job.jobKey);

      const known: DataWarehouseJob | undefined = byKey.get(job.jobKey);

      if (known?.id) {
        await DataWarehouseJobService.updateOneById({
          id: known.id,
          data: fields as never,
          props: { isRoot: true },
        });
        continue;
      }

      const model: DataWarehouseJob = new DataWarehouseJob();

      model.projectId = data.projectId;
      model.dataStoreId = data.dataStoreId;
      model.jobKey = job.jobKey;
      Object.assign(model, fields);

      await DataWarehouseJobService.create({
        data: model,
        props: { isRoot: true },
      });
    }

    // A job that ran in none of the last day is no longer one of the warehouse's.
    for (const job of existing) {
      if (job.id && !seen.has(job.jobKey || "")) {
        await DataWarehouseJobService.deleteOneById({
          id: job.id,
          props: { isRoot: true },
        });
      }
    }
  }

  private static async keepTableSpend(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    plan: WarehouseSpendPlan;
  }): Promise<void> {
    // The tables spend was kept on last time: those it is no longer on go back to none.
    const before: Array<DataAsset> = await DataAssetService.findBy({
      query: {
        projectId: data.projectId,
        dataStoreId: data.dataStoreId,
        writeCredits: QueryHelper.notNull(),
      },
      select: { _id: true },
      limit: 10_000,
      skip: 0,
      props: { isRoot: true },
    });
    const beforeBytes: Array<DataAsset> = await DataAssetService.findBy({
      query: {
        projectId: data.projectId,
        dataStoreId: data.dataStoreId,
        writeBytesBilled: QueryHelper.notNull(),
      },
      select: { _id: true },
      limit: 10_000,
      skip: 0,
      props: { isRoot: true },
    });

    for (const asset of [...before, ...beforeBytes]) {
      if (asset.id && !data.plan.tableSpend.has(asset.id.toString())) {
        await DataAssetService.updateColumnsByIdWithoutHooks({
          id: asset.id,
          data: { writeCredits: null, writeBytesBilled: null } as never,
        });
      }
    }

    for (const [id, spend] of data.plan.tableSpend) {
      await DataAssetService.updateColumnsByIdWithoutHooks({
        id: new ObjectID(id),
        data: {
          writeCredits: spend.credits > 0 ? spend.credits : null,
          writeBytesBilled: spend.bytesBilled > 0 ? spend.bytesBilled : null,
        } as never,
      });
    }
  }
}
