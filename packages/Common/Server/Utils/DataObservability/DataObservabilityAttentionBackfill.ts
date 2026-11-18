import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import { getDataAssetLateAt } from "../../../Types/DataObservability/DataAssetFreshness";
import { getDataPipelineLateAt } from "../../../Types/DataObservability/DataPipelineSchedule";
import ObjectID from "../../../Types/ObjectID";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import DataPipelineService from "../../Services/DataPipelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataCheckHealthSync from "./DataCheckHealthSync";

/*
 * THE ROWS THAT WERE THERE BEFORE THE COLUMNS (#6550, #6552, #6554).
 *
 * DataAsset.lateAt, DataPipeline.lateAt and DataCheck.health are written as
 * tables are collected, pipelines run and checks run or alert. These pages
 * give every row that already exists its value, by the same rules
 * (getDataAssetLateAt, getDataPipelineLateAt, DataCheckHealthSync), for the
 * data migration BackfillDataObservabilityAttentionColumns - a page at a
 * time by id, so no statement holds many rows, and safe to run twice: each
 * page writes what the row's own columns say now.
 */

export interface AttentionBackfillPage {
  read: number;
  written: number;
  // Where the next page starts; undefined when this one read nothing.
  lastId?: string | undefined;
}

// A row's id and the time it is late at, as one page's UPDATE writes them.
export interface LateAtRow {
  id: string;
  lateAt: Date | null;
}

/*
 * One UPDATE for a page of rows: each row's lateAt from a VALUES list, so a
 * page of 500 tables is one statement, not 500.
 */
export function buildLateAtUpdate(
  tableName: "DataAsset" | "DataPipeline",
  rows: Array<LateAtRow>,
): { sql: string; params: Array<string | null> } {
  const params: Array<string | null> = [];
  const values: Array<string> = rows.map((row: LateAtRow): string => {
    params.push(row.id);
    params.push(row.lateAt ? row.lateAt.toISOString() : null);
    return `($${params.length - 1}::uuid, $${params.length}::timestamptz)`;
  });

  return {
    sql: `UPDATE "${tableName}" AS target_row
      SET "lateAt" = page_row."lateAt"
      FROM (VALUES ${values.join(", ")}) AS page_row("id", "lateAt")
      WHERE target_row."_id" = page_row."id"`,
    params,
  };
}

export default class DataObservabilityAttentionBackfill {
  // Each table's lateAt, from its last change and its usual interval.
  public static async backfillAssetPage(data: {
    afterId?: string | undefined;
    limit: number;
  }): Promise<AttentionBackfillPage> {
    const assets: Array<DataAsset> = await DataAssetService.findBy({
      query: data.afterId ? { _id: QueryHelper.greaterThan(new ObjectID(data.afterId)) } : {},
      select: {
        _id: true,
        assetKind: true,
        lastChangedAt: true,
        updateIntervalInSeconds: true,
      },
      sort: { _id: SortOrder.Ascending },
      skip: 0,
      limit: data.limit,
      props: { isRoot: true },
    });

    const rows: Array<LateAtRow> = assets
      .filter((asset: DataAsset): boolean => {
        return Boolean(asset.id);
      })
      .map((asset: DataAsset): LateAtRow => {
        return {
          id: asset.id!.toString(),
          lateAt: getDataAssetLateAt({
            kind: asset.assetKind as DataAssetKind | undefined,
            lastChangedAt: asset.lastChangedAt,
            updateIntervalInSeconds: asset.updateIntervalInSeconds,
          }),
        };
      });

    return await this.writeLateAt({
      tableName: "DataAsset",
      rows,
      read: assets.length,
      query: async (sql: string, params: Array<string | null>) => {
        return await DataAssetService.getRepository().manager.query(
          sql,
          params,
        );
      },
    });
  }

  // Each pipeline's lateAt, from its last start and its expected interval.
  public static async backfillPipelinePage(data: {
    afterId?: string | undefined;
    limit: number;
  }): Promise<AttentionBackfillPage> {
    const pipelines: Array<DataPipeline> = await DataPipelineService.findBy({
      query: data.afterId ? { _id: QueryHelper.greaterThan(new ObjectID(data.afterId)) } : {},
      select: {
        _id: true,
        lastRunStartedAt: true,
        expectedRunIntervalInSeconds: true,
      },
      sort: { _id: SortOrder.Ascending },
      skip: 0,
      limit: data.limit,
      props: { isRoot: true },
    });

    const rows: Array<LateAtRow> = pipelines
      .filter((pipeline: DataPipeline): boolean => {
        return Boolean(pipeline.id);
      })
      .map((pipeline: DataPipeline): LateAtRow => {
        return {
          id: pipeline.id!.toString(),
          lateAt: getDataPipelineLateAt({
            lastRunStartedAt: pipeline.lastRunStartedAt,
            expectedRunIntervalInSeconds: pipeline.expectedRunIntervalInSeconds,
          }),
        };
      });

    return await this.writeLateAt({
      tableName: "DataPipeline",
      rows,
      read: pipelines.length,
      query: async (sql: string, params: Array<string | null>) => {
        return await DataPipelineService.getRepository().manager.query(
          sql,
          params,
        );
      },
    });
  }

  // Each check's health, from its last run and its monitor's open alerts.
  public static async backfillCheckPage(data: {
    afterId?: string | undefined;
    limit: number;
  }): Promise<AttentionBackfillPage> {
    const checks: Array<DataCheck> = await DataCheckService.findBy({
      query: data.afterId ? { _id: QueryHelper.greaterThan(new ObjectID(data.afterId)) } : {},
      select: DataCheckHealthSync.SELECT,
      sort: { _id: SortOrder.Ascending },
      skip: 0,
      limit: data.limit,
      props: { isRoot: true },
    });

    const written: number = await DataCheckHealthSync.writeHealthOf(checks);
    const last: DataCheck | undefined = checks[checks.length - 1];

    return {
      read: checks.length,
      written,
      lastId: last?.id ? last.id.toString() : undefined,
    };
  }

  private static async writeLateAt(data: {
    tableName: "DataAsset" | "DataPipeline";
    rows: Array<LateAtRow>;
    read: number;
    query: (sql: string, params: Array<string | null>) => Promise<unknown>;
  }): Promise<AttentionBackfillPage> {
    const last: LateAtRow | undefined = data.rows[data.rows.length - 1];
    // A row with nothing to say is null already: only the rest are written.
    const toWrite: Array<LateAtRow> = data.rows.filter(
      (row: LateAtRow): boolean => {
        return row.lateAt !== null && ObjectID.isValidUUID(row.id);
      },
    );

    if (toWrite.length > 0) {
      const update: { sql: string; params: Array<string | null> } =
        buildLateAtUpdate(data.tableName, toWrite);

      await data.query(update.sql, update.params);
    }

    return {
      read: data.read,
      written: toWrite.length,
      lastId: last?.id,
    };
  }
}
