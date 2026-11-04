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
} from "./DataCheckResults";
import { buildDataCheckStatement, DataCheckStatement } from "./DataCheckSql";

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

// The most checks one collection runs; the rest wait for the next one.
export const MAX_CHECKS_PER_COLLECTION: number = 50;

export interface DataCheckPlan {
  planned: Array<PlannedDataCheck>;
  // Checks that cannot run, with why: recorded as failed runs.
  refused: Array<DataCheckRunResult>;
}

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

async function getCheckLimits(
  projectId: ObjectID,
  engine: DatabaseEngine,
): Promise<DataCheckLimits | undefined> {
  if (!ENGINES_BILLED_BY_BYTES.includes(engine)) {
    return undefined;
  }

  const gigabytes: number =
    (await DataObservabilitySettingService.getOrCreateForProject(projectId))
      .maxGigabytesScannedPerCheck || 10;

  return { maxBytesScanned: gigabytes * BYTES_IN_A_GIGABYTE };
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
        projectId: true,
      },
      limit: MAX_CHECKS_PER_COLLECTION,
      skip: 0,
      props: { isRoot: true },
    });

    if (checks.length === 0) {
      return plan;
    }

    const limits: DataCheckLimits | undefined = await getCheckLimits(
      checks[0]!.projectId!,
      data.engine,
    );
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
        const statement: DataCheckStatement = buildDataCheckStatement(
          data.engine,
          {
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
          },
        );

        plan.planned.push({
          checkId,
          type: check.checkType as DataCheckType,
          isSegmented: statement.isSegmented,
          sql: statement.sql,
          params: statement.params,
          ...(limits ? { limits } : {}),
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
}
