import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  ProductionReviewDataStagingCheckJSON,
  ProductionReviewDataStagingJSON,
} from "../../../Types/CodeRepository/ProductionReview";
import {
  DataAssetColumn,
  DataAssetColumnChange,
  DataAssetColumnChangeKind,
  diffDataAssetColumns,
  readDataAssetColumns,
} from "../../../Types/DataObservability/DataAssetColumn";
import {
  DataCheckType,
  isQueryCheckType,
} from "../../../Types/DataObservability/DataCheckType";
import DataStoreEnvironment from "../../../Types/DataSecurity/DataStoreEnvironment";
import ObjectID from "../../../Types/ObjectID";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import DataStoreService from "../../Services/DataStoreService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import { DatabaseEngine } from "../DataSecurity/Content/DatabaseSampler";
import { assertDatabaseConnectionAllowed } from "./DatabaseConnectionGuard";
import { DataCheckRunResult, PlannedDataCheck } from "./DataCheckResults";
import { buildDataCheckStatement, DataCheckStatement } from "./DataCheckSql";
import { getCollectorEngineOfKind } from "./DataObservabilityEngines";
import { readCheckValues } from "./TableHealthCollector";

/*
 * HOW A TABLE LOOKS ON STAGING, BEFORE A CHANGE IS MERGED.
 *
 * When a pull request changes a watched table, its copy on staging is where the
 * change can be seen first, if it has already been deployed there. This says how
 * the copy differs from production: its rows, its columns, and what the table's
 * checks read there, run now against the copy with the same statements they run
 * in production.
 *
 * A copy is a table of the same name in a store marked as staging. A store only
 * a probe can reach cannot be read from here: its catalog is compared from its
 * last collection, and its checks are left out and said to be.
 *
 * A check written as a query reads whatever tables its query names, which need
 * not be this one, so it runs too: it is the person's own read, and it is read
 * only, as anywhere. Every part is extra to the review: one that fails leaves
 * only itself out.
 */

const MAX_CHECKS_COMPARED: number = 10;
const MAX_COLUMN_DIFFERENCES: number = 10;

// How a column differs on staging, in words.
export function describeColumnDifference(
  change: DataAssetColumnChange,
): string {
  switch (change.kind) {
    case DataAssetColumnChangeKind.Added:
      return `${change.column} is only on staging`;
    case DataAssetColumnChangeKind.Removed:
      return `${change.column} is only in production`;
    case DataAssetColumnChangeKind.Renamed:
      return `${change.previousName || ""} is ${change.column} on staging`;
    case DataAssetColumnChangeKind.TypeChanged:
      return `${change.column} is ${change.dataType || ""} on staging, ${change.previousDataType || ""} in production`;
    default:
      return `${change.column} allows empty values differently on staging`;
  }
}

export function compareColumns(
  production: Array<DataAssetColumn>,
  staging: Array<DataAssetColumn>,
): Array<string> {
  return diffDataAssetColumns(production, staging)
    .slice(0, MAX_COLUMN_DIFFERENCES)
    .map(describeColumnDifference);
}

export default class StagingTableComparison {
  public static async compare(data: {
    projectId: ObjectID;
    asset: DataAsset;
  }): Promise<ProductionReviewDataStagingJSON | null> {
    try {
      return await this.read(data);
    } catch (error) {
      logger.debug(error);
      return null;
    }
  }

  private static async read(data: {
    projectId: ObjectID;
    asset: DataAsset;
  }): Promise<ProductionReviewDataStagingJSON | null> {
    if (!data.asset.assetKey || !data.asset.id) {
      return null;
    }

    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId: data.projectId,
        isArchived: false,
        environment: DataStoreEnvironment.Staging,
      },
      select: {
        _id: true,
        name: true,
        kind: true,
        connectionString: true,
        scanProbeId: true,
      },
      limit: 50,
      skip: 0,
      props: { isRoot: true },
    });

    if (stores.length === 0) {
      return null;
    }

    const copy: DataAsset | null = await DataAssetService.findOneBy({
      query: {
        projectId: data.projectId,
        assetKey: data.asset.assetKey,
        isDropped: false,
        dataStoreId: new Includes(
          stores.map((store: DataStore): ObjectID => {
            return store.id!;
          }),
        ),
      },
      select: { _id: true, dataStoreId: true, rowCount: true, columns: true },
      props: { isRoot: true },
    });

    if (!copy?.dataStoreId) {
      return null;
    }

    const store: DataStore | undefined = stores.find((item: DataStore) => {
      return item.id!.toString() === copy.dataStoreId!.toString();
    });

    if (!store) {
      return null;
    }

    const production: DataAsset | null = await DataAssetService.findOneById({
      id: data.asset.id,
      select: { rowCount: true, columns: true },
      props: { isRoot: true },
    });
    const canRunChecks: boolean = Boolean(
      store.connectionString && !store.scanProbeId,
    );

    return {
      storeName: store.name || "",
      productionRows: production?.rowCount ?? null,
      stagingRows: copy.rowCount ?? null,
      columnDifferences: compareColumns(
        readDataAssetColumns(production?.columns),
        readDataAssetColumns(copy.columns),
      ),
      areChecksRun: canRunChecks,
      checks: canRunChecks
        ? await this.runChecks({
            projectId: data.projectId,
            assetId: data.asset.id,
            copyName: data.asset.name || "",
            copySchema: data.asset.schemaName || "",
            store,
          })
        : [],
    };
  }

  private static async runChecks(data: {
    projectId: ObjectID;
    assetId: ObjectID;
    copyName: string;
    copySchema: string;
    store: DataStore;
  }): Promise<Array<ProductionReviewDataStagingCheckJSON>> {
    const engine: DatabaseEngine | null = getCollectorEngineOfKind(
      data.store.kind,
    );

    if (!engine || !data.store.connectionString) {
      return [];
    }

    const checks: Array<DataCheck> = await DataCheckService.findBy({
      query: {
        projectId: data.projectId,
        dataAssetId: data.assetId,
        isEnabled: true,
        // dbt runs its own tests, and a check of a reconciliation reads its own two sides.
        checkType: QueryHelper.notEquals(DataCheckType.DbtTest),
        dataReconciliationId: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        name: true,
        checkType: true,
        columnName: true,
        acceptedValues: true,
        pattern: true,
        referenceTableKey: true,
        referenceColumnName: true,
        customSql: true,
        lastValue: true,
      },
      limit: MAX_CHECKS_COMPARED,
      skip: 0,
      props: { isRoot: true },
    });

    if (checks.length === 0) {
      return [];
    }

    await assertDatabaseConnectionAllowed({
      engine,
      connectionString: data.store.connectionString,
    });

    const planned: Array<PlannedDataCheck> = [];
    const answers: Map<string, ProductionReviewDataStagingCheckJSON> =
      new Map();

    for (const check of checks) {
      const answer: ProductionReviewDataStagingCheckJSON = {
        name: check.name || "",
        production: check.lastValue ?? null,
        staging: null,
      };

      answers.set(check.id!.toString(), answer);

      try {
        const dot: number = (check.referenceTableKey || "").indexOf(".");
        const type: DataCheckType = check.checkType as DataCheckType;
        // Segments are left out: the comparison is of one number per check.
        const statement: DataCheckStatement = buildDataCheckStatement(engine, {
          type,
          schemaName: data.copySchema,
          tableName: data.copyName,
          columnName: check.columnName,
          acceptedValues: check.acceptedValues,
          pattern: check.pattern,
          referenceSchemaName:
            dot > 0 ? check.referenceTableKey!.slice(0, dot) : "",
          referenceTableName:
            dot > 0
              ? check.referenceTableKey!.slice(dot + 1)
              : check.referenceTableKey,
          referenceColumnName: check.referenceColumnName,
          customSql: isQueryCheckType(type) ? check.customSql : null,
        });

        planned.push({
          checkId: check.id!.toString(),
          type,
          isSegmented: false,
          sql: statement.sql,
          params: statement.params,
        });
      } catch (error) {
        answer.error =
          error instanceof Error ? error.message : "It could not be built.";
      }
    }

    const results: Array<DataCheckRunResult> = await readCheckValues(
      { engine, connectionString: data.store.connectionString },
      planned,
    );

    for (const result of results) {
      const answer: ProductionReviewDataStagingCheckJSON | undefined =
        answers.get(result.checkId);

      if (answer) {
        answer.staging = result.values[0]?.value ?? null;

        if (result.error) {
          answer.error = result.error;
        }
      }
    }

    return Array.from(answers.values());
  }
}
