import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Includes from "../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataAssetColumn,
  readDataAssetColumns,
} from "../../../Types/DataObservability/DataAssetColumn";
import { getFormatPattern } from "../../../Types/DataObservability/DataCheckFormats";
import { DataObservabilityCheckApplyResult } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import DataStoreService from "../../Services/DataStoreService";
import DataCheckAlerts from "./DataCheckAlerts";
import {
  DataCheckManifest,
  DataCheckManifestEntry,
  readDataCheckManifest,
} from "./DataCheckManifest";
import { validateDataCheck } from "./DataCheckValidation";
import { getCollectorEngineOfKind } from "./DataObservabilityEngines";

/*
 * MAKES A PROJECT'S CHECKS MATCH ITS FILE.
 *
 * Every check in the file is judged before any is written, so a mistake in the
 * fortieth check does not leave thirty-nine applied. A dry run stops there. A
 * check is the same check if it has the same name on the same table, and only
 * what differs is written, so applying the same file twice changes nothing.
 * With prune, a check an earlier apply made that the file no longer names is
 * deleted; a check a person added by hand never is.
 */

const MAX_CHECKS_READ: number = 5000;

// The fields a file says, as the check's own columns.
function toCheckFields(entry: DataCheckManifestEntry): JSONObject {
  return {
    checkType: entry.checkType,
    columnName: entry.columnName,
    segmentColumn: entry.segmentColumn,
    acceptedValues: entry.acceptedValues,
    formatPreset: entry.formatPreset,
    pattern: getFormatPattern(entry.formatPreset) || entry.pattern,
    referenceTableKey: entry.referenceTableKey,
    referenceColumnName: entry.referenceColumnName,
    customSql: entry.customSql,
    samplePercent: entry.samplePercent,
    intervalInMinutes: entry.intervalInMinutes,
    alertCondition: entry.alertCondition,
    alertThreshold: entry.alertThreshold,
    description: entry.description,
    isEnabled: entry.isEnabled,
  } as unknown as JSONObject;
}

// What differs between a check and what the file says of it.
export function getCheckChanges(
  check: DataCheck,
  fields: JSONObject,
): JSONObject {
  const changes: JSONObject = {};
  const current: JSONObject = check as unknown as JSONObject;

  for (const [field, value] of Object.entries(fields)) {
    const was: unknown = current[field] ?? null;
    const isSame: boolean =
      typeof value === "number"
        ? Number(was) === value && was !== null
        : JSON.stringify(was) === JSON.stringify(value ?? null);

    if (!isSame) {
      changes[field] = value;
    }
  }

  return changes;
}

export default class DataCheckApply {
  public static async apply(data: {
    projectId: ObjectID;
    manifest: unknown;
    isDryRun: boolean;
    shouldPrune: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataObservabilityCheckApplyResult> {
    const result: DataObservabilityCheckApplyResult = {
      isDryRun: data.isDryRun,
      created: [],
      updated: [],
      unchanged: [],
      removed: [],
      errors: [],
      warnings: [],
    };
    const manifest: DataCheckManifest = readDataCheckManifest(data.manifest);

    result.errors.push(...manifest.errors);

    if (result.errors.length > 0) {
      return result;
    }

    const assets: Array<DataAsset> = await this.readAssets(
      data.projectId,
      manifest.checks,
    );
    const engines: Map<string, string> = await this.readEngines(assets);
    const checks: Array<DataCheck> = await this.readChecks(
      data.projectId,
      assets,
    );
    const assetsByKey: Map<string, Array<DataAsset>> = new Map();

    for (const asset of assets) {
      const key: string = asset.assetKey || "";

      assetsByKey.set(key, [...(assetsByKey.get(key) || []), asset]);
    }

    const creates: Array<{ entry: DataCheckManifestEntry; asset: DataAsset }> =
      [];
    const updates: Array<{ check: DataCheck; changes: JSONObject }> = [];
    const kept: Set<string> = new Set();

    for (const entry of manifest.checks) {
      const label: string = `${entry.table}: ${entry.name}`;
      const matching: Array<DataAsset> = (
        assetsByKey.get(entry.table) || []
      ).filter((asset: DataAsset): boolean => {
        return !entry.database || asset.dataStoreName === entry.database;
      });

      if (matching.length === 0) {
        result.errors.push(
          `${label}: no watched table is called ${entry.table}${entry.database ? ` in ${entry.database}` : ""}.`,
        );
        continue;
      }

      if (matching.length > 1) {
        result.errors.push(
          `${label}: more than one database has ${entry.table}. Name one with "database".`,
        );
        continue;
      }

      const asset: DataAsset = matching[0]!;
      const fields: JSONObject = toCheckFields(entry);

      try {
        validateDataCheck(fields as never, {
          engine: engines.get(asset.dataStoreId?.toString() || "") || "",
          columns: readDataAssetColumns(asset.columns),
          // A reference's table is judged by the save: it may be in another batch of the file.
          referenceColumns: (tableKey: string) => {
            return this.findReferenceColumns(assets, asset, tableKey);
          },
        });
      } catch (error) {
        result.errors.push(
          `${label}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      const existing: DataCheck | undefined = checks.find(
        (check: DataCheck): boolean => {
          return (
            check.name === entry.name &&
            check.dataAssetId?.toString() === asset.id?.toString()
          );
        },
      );

      if (!existing) {
        creates.push({ entry, asset });
        result.created.push(label);
        continue;
      }

      kept.add(existing.id!.toString());

      const changes: JSONObject = getCheckChanges(existing, fields);

      if (Object.keys(changes).length > 0) {
        updates.push({ check: existing, changes });
        result.updated.push(label);
      } else {
        result.unchanged.push(label);
      }
    }

    // Nothing is written unless everything can be.
    if (result.errors.length > 0) {
      result.created = [];
      result.updated = [];
      result.unchanged = [];
      return result;
    }

    const toRemove: Array<DataCheck> = data.shouldPrune
      ? await this.readChecksToPrune(data.projectId, kept)
      : [];

    result.removed = toRemove.map((check: DataCheck): string => {
      return `${check.dataAsset?.assetKey || ""}: ${check.name || ""}`;
    });

    if (data.isDryRun) {
      return result;
    }

    for (const { entry, asset } of creates) {
      const check: DataCheck = new DataCheck();

      Object.assign(check, toCheckFields(entry));
      check.name = entry.name;
      check.projectId = data.projectId;
      check.dataAssetId = asset.id!;

      const created: DataCheck = await DataCheckService.create({
        data: check,
        props: data.props,
      });

      await this.markManagedByFile(created.id!);
      await this.syncAlert(data, created.id!, entry.name, result);
    }

    for (const { check, changes } of updates) {
      await DataCheckService.updateOneById({
        id: check.id!,
        data: changes as never,
        props: data.props,
      });
      await this.markManagedByFile(check.id!);
      await this.syncAlert(data, check.id!, check.name || "", result);
    }

    for (const check of toRemove) {
      await DataCheckService.deleteOneById({
        id: check.id!,
        props: data.props,
      });
    }

    return result;
  }

  // A check saved stays saved when its alert cannot be set up: the build says so, and carries on.
  private static async syncAlert(
    data: { projectId: ObjectID; props: DatabaseCommonInteractionProps },
    checkId: ObjectID,
    name: string,
    result: DataObservabilityCheckApplyResult,
  ): Promise<void> {
    try {
      await DataCheckAlerts.sync({
        projectId: data.projectId,
        checkId,
        props: data.props,
      });
    } catch (error) {
      result.warnings.push(
        `${name}: saved, but its alert could not be set up: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Which of a project's checks came from a file: pruning touches nothing else.
  private static async markManagedByFile(checkId: ObjectID): Promise<void> {
    await DataCheckService.updateColumnsByIdWithoutHooks({
      id: checkId,
      data: { isManagedByFile: true } as never,
    });
  }

  private static findReferenceColumns(
    assets: Array<DataAsset>,
    asset: DataAsset,
    tableKey: string,
  ): Array<DataAssetColumn> | null {
    const referenced: DataAsset | undefined = assets.find(
      (other: DataAsset): boolean => {
        return (
          other.assetKey === tableKey &&
          other.dataStoreId?.toString() === asset.dataStoreId?.toString()
        );
      },
    );

    return referenced ? readDataAssetColumns(referenced.columns) : null;
  }

  private static async readAssets(
    projectId: ObjectID,
    entries: Array<DataCheckManifestEntry>,
  ): Promise<Array<DataAsset>> {
    const keys: Array<string> = Array.from(
      new Set(
        entries.flatMap((entry: DataCheckManifestEntry): Array<string> => {
          return [
            entry.table,
            ...(entry.referenceTableKey ? [entry.referenceTableKey] : []),
          ];
        }),
      ),
    );

    return await DataAssetService.findBy({
      query: { projectId, isDropped: false, assetKey: new Includes(keys) },
      select: {
        _id: true,
        assetKey: true,
        columns: true,
        dataStoreId: true,
        dataStoreName: true,
      },
      limit: MAX_CHECKS_READ,
      skip: 0,
      props: { isRoot: true },
    });
  }

  private static async readEngines(
    assets: Array<DataAsset>,
  ): Promise<Map<string, string>> {
    const ids: Array<ObjectID> = assets
      .map((asset: DataAsset): ObjectID | undefined => {
        return asset.dataStoreId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    if (ids.length === 0) {
      return new Map();
    }

    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { _id: new Includes(ids) },
      select: { _id: true, kind: true },
      limit: ids.length,
      skip: 0,
      props: { isRoot: true },
    });

    return new Map(
      stores.map((store: DataStore): [string, string] => {
        return [
          store.id!.toString(),
          getCollectorEngineOfKind(store.kind) || "",
        ];
      }),
    );
  }

  private static async readChecks(
    projectId: ObjectID,
    assets: Array<DataAsset>,
  ): Promise<Array<DataCheck>> {
    if (assets.length === 0) {
      return [];
    }

    return await DataCheckService.findBy({
      query: {
        projectId,
        dataAssetId: new Includes(
          assets.map((asset: DataAsset): ObjectID => {
            return asset.id!;
          }),
        ),
      },
      select: {
        _id: true,
        name: true,
        dataAssetId: true,
        checkType: true,
        columnName: true,
        segmentColumn: true,
        acceptedValues: true,
        formatPreset: true,
        pattern: true,
        referenceTableKey: true,
        referenceColumnName: true,
        customSql: true,
        samplePercent: true,
        intervalInMinutes: true,
        alertCondition: true,
        alertThreshold: true,
        description: true,
        isEnabled: true,
      },
      limit: MAX_CHECKS_READ,
      skip: 0,
      props: { isRoot: true },
    });
  }

  private static async readChecksToPrune(
    projectId: ObjectID,
    kept: Set<string>,
  ): Promise<Array<DataCheck>> {
    const managed: Array<DataCheck> = await DataCheckService.findBy({
      query: { projectId, isManagedByFile: true },
      select: { _id: true, name: true, dataAsset: { assetKey: true } },
      limit: MAX_CHECKS_READ,
      skip: 0,
      props: { isRoot: true },
    });

    return managed.filter((check: DataCheck): boolean => {
      return !kept.has(check.id!.toString());
    });
  }
}
