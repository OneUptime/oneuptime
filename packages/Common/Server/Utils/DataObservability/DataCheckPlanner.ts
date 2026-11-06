import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { DataCheckType } from "../../../Types/DataObservability/DataCheckType";
import ObjectID from "../../../Types/ObjectID";
import { DatabaseEngine } from "../DataSecurity/Content/DatabaseSampler";
import DataObservabilitySettingService, {
  BYTES_IN_A_GIGABYTE,
} from "../../Services/DataObservabilitySettingService";
import {
  DataCheckLimits,
  DataCheckRunResult,
  PlannedDataCheck,
  PlannedFreshnessRead,
} from "./DataCheckResults";
import {
  buildDataCheckSampleStatement,
  buildDataCheckStatement,
  buildFreshnessStatement,
  DataCheckStatement,
  DataCheckTarget,
} from "./DataCheckSql";
import DataTableSensitivity from "./DataTableSensitivity";
import DataObservabilitySetting from "../../../Models/DatabaseModels/DataObservabilitySetting";
import { MaskedColumns } from "../../../Types/DataObservability/DataCheckFailingRows";
import { getDataTableKey } from "../../../Types/DataObservability/DataObservabilityMetric";

/*
 * THE CHECKS A STORE'S COLLECTION RUNS.
 *
 * Checks run with their store's table health - the same claim, the same
 * session, by OneUptime or by the store's probe - when they are due. Each
 * statement is built here, on the server, from the check and its table as
 * the catalog has them; the probe only runs what it is sent. A check whose
 * statement cannot be built (its table is gone, its column dropped) fails
 * here, with the reason, and never reaches the database.
 */

// How long into an hour a collection still counts as that hour's first.
const FIRST_COLLECTION_OF_THE_HOUR_IN_MINUTES: number = 5;

// The most checks one collection runs; the rest wait for the next one.
export const MAX_CHECKS_PER_COLLECTION: number = 50;

export interface DataCheckPlan {
  planned: Array<PlannedDataCheck>;
  // Checks that cannot run, with why: recorded as failed runs.
  refused: Array<DataCheckRunResult>;
  // Tables whose change time comes from a column of their own.
  freshnessReads?: Array<PlannedFreshnessRead> | undefined;
  // Leave the checks for the next collection when the database is busy.
  waitWhenBusy?: boolean | undefined;
}

// The most freshness columns one collection reads.
export const MAX_FRESHNESS_READS_PER_COLLECTION: number = 50;

function splitTableKey(key: string): { schema: string; table: string } {
  const dot: number = key.indexOf(".");

  return dot > 0
    ? { schema: key.slice(0, dot), table: key.slice(dot + 1) }
    : { schema: "", table: key };
}

// The engines that bill by what a query reads: a check there runs under the project's limit.
const ENGINES_BILLED_BY_BYTES: ReadonlyArray<DatabaseEngine> = [
  "bigquery",
  "athena",
];

function getCheckLimits(
  setting: DataObservabilitySetting,
  engine: DatabaseEngine,
): DataCheckLimits | undefined {
  if (!ENGINES_BILLED_BY_BYTES.includes(engine)) {
    return undefined;
  }

  return {
    maxBytesScanned:
      (setting.maxGigabytesScannedPerCheck || 10) * BYTES_IN_A_GIGABYTE,
  };
}

// Which columns of a table to mask in a sample of its failing rows: the ones the scans found.
async function readMaskedColumns(data: {
  projectId: ObjectID;
  dataAssetId: ObjectID;
}): Promise<MaskedColumns> {
  const masked: Record<string, string> = {};

  for (const item of await DataTableSensitivity.read(data)) {
    if (item.dataTypeId) {
      masked[item.column.toLowerCase()] = item.dataTypeId;
    }
  }

  return masked;
}

export default class DataCheckPlanner {
  public static async planDueChecks(data: {
    dataStoreId: ObjectID;
    engine: DatabaseEngine;
    now: Date;
  }): Promise<DataCheckPlan> {
    const plan: DataCheckPlan = { planned: [], refused: [] };
    const checks: Array<DataCheck> = await DataCheckService.findBy({
      query: {
        dataStoreId: data.dataStoreId,
        isEnabled: true,
        nextRunAt: QueryHelper.lessThanEqualToOrNull(data.now),
        // dbt runs its own tests: OneUptime only reads their results (DbtIngest).
        checkType: QueryHelper.notEquals(DataCheckType.DbtTest),
      },
      select: {
        _id: true,
        dataAssetId: true,
        checkType: true,
        columnName: true,
        segmentColumn: true,
        acceptedValues: true,
        pattern: true,
        referenceTableKey: true,
        referenceColumnName: true,
        customSql: true,
        samplePercent: true,
        projectId: true,
      },
      limit: MAX_CHECKS_PER_COLLECTION,
      skip: 0,
      props: { isRoot: true },
    });

    const freshnessAssets: Array<DataAsset> = await DataAssetService.findBy({
      query: {
        dataStoreId: data.dataStoreId,
        isDropped: false,
        freshnessColumn: QueryHelper.notNull(),
      },
      select: {
        schemaName: true,
        name: true,
        freshnessColumn: true,
        projectId: true,
      },
      limit: MAX_FRESHNESS_READS_PER_COLLECTION,
      skip: 0,
      props: { isRoot: true },
    });

    if (checks.length === 0 && freshnessAssets.length === 0) {
      return plan;
    }

    const projectId: ObjectID = (checks[0]?.projectId ||
      freshnessAssets[0]?.projectId)!;
    const setting: DataObservabilitySetting =
      await DataObservabilitySettingService.getOrCreateForProject(projectId);
    const limits: DataCheckLimits | undefined = getCheckLimits(
      setting,
      data.engine,
    );
    const keepsFailingRows: boolean = setting.keepFailingRows === true;

    plan.waitWhenBusy = setting.waitWhenDatabaseIsBusy !== false;
    plan.freshnessReads = this.planFreshnessReads({
      assets: freshnessAssets,
      engine: data.engine,
      limits,
      now: data.now,
    });

    if (checks.length === 0) {
      return plan;
    }

    const assetIds: Array<string> = Array.from(
      new Set(
        checks
          .map((check: DataCheck): string => {
            return check.dataAssetId?.toString() || "";
          })
          .filter(Boolean),
      ),
    );
    const assets: Array<DataAsset> = await DataAssetService.findBy({
      query: { _id: QueryHelper.any(assetIds) },
      select: { _id: true, schemaName: true, name: true, isDropped: true },
      limit: assetIds.length,
      skip: 0,
      props: { isRoot: true },
    });
    const assetById: Map<string, DataAsset> = new Map(
      assets.map((asset: DataAsset): [string, DataAsset] => {
        return [asset.id!.toString(), asset];
      }),
    );

    for (const check of checks) {
      const checkId: string = check.id!.toString();
      const asset: DataAsset | undefined = assetById.get(
        check.dataAssetId?.toString() || "",
      );

      if (!asset || asset.isDropped || !asset.name) {
        plan.refused.push({
          checkId,
          values: [],
          error: "The table is no longer in its database.",
        });
        continue;
      }

      const reference: { schema: string; table: string } | null =
        check.referenceTableKey ? splitTableKey(check.referenceTableKey) : null;

      try {
        const target: DataCheckTarget = {
          type: check.checkType as DataCheckType,
          schemaName: asset.schemaName || "",
          tableName: asset.name,
          columnName: check.columnName,
          segmentColumn: check.segmentColumn,
          acceptedValues: check.acceptedValues,
          pattern: check.pattern,
          referenceSchemaName: reference?.schema,
          referenceTableName: reference?.table,
          referenceColumnName: check.referenceColumnName,
          customSql: check.customSql,
          samplePercent: check.samplePercent,
        };
        const statement: DataCheckStatement = buildDataCheckStatement(
          data.engine,
          target,
        );
        const sample: { sql: string; params: Array<string> } | null =
          keepsFailingRows
            ? buildDataCheckSampleStatement(data.engine, target)
            : null;

        plan.planned.push({
          checkId,
          type: check.checkType as DataCheckType,
          isSegmented: statement.isSegmented,
          sql: statement.sql,
          params: statement.params,
          ...(limits ? { limits } : {}),
          ...(sample
            ? {
                sample: {
                  ...sample,
                  maskedColumns: await readMaskedColumns({
                    projectId,
                    dataAssetId: check.dataAssetId!,
                  }),
                },
              }
            : {}),
        });
      } catch (error) {
        plan.refused.push({
          checkId,
          values: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return plan;
  }

  /*
   * A table's freshness column is read at every collection, unless reading it
   * costs money by what it scans: there, in the first collection of each hour.
   */
  private static planFreshnessReads(data: {
    assets: Array<DataAsset>;
    engine: DatabaseEngine;
    limits: DataCheckLimits | undefined;
    now: Date;
  }): Array<PlannedFreshnessRead> {
    const isRead: boolean =
      !ENGINES_BILLED_BY_BYTES.includes(data.engine) ||
      data.now.getUTCMinutes() < FIRST_COLLECTION_OF_THE_HOUR_IN_MINUTES;

    return data.assets
      .filter((asset: DataAsset): boolean => {
        return Boolean(asset.name && asset.freshnessColumn);
      })
      .map((asset: DataAsset): PlannedFreshnessRead => {
        const statement: { sql: string; params: Array<string> } | null = isRead
          ? buildFreshnessStatement(data.engine, {
              schemaName: asset.schemaName || "",
              tableName: asset.name!,
              columnName: asset.freshnessColumn!,
            })
          : null;

        return {
          tableKey: getDataTableKey(asset.schemaName || "", asset.name!),
          sql: statement?.sql || null,
          params: statement?.params || [],
          ...(data.limits ? { limits: data.limits } : {}),
        };
      });
  }
}
