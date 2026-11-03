import ProjectReferencesService from "./ProjectReferencesService";
import DataAssetService from "./DataAssetService";
import DataStoreService from "./DataStoreService";
import DataAsset from "../../Models/DatabaseModels/DataAsset";
import Model from "../../Models/DatabaseModels/DataCheck";
import DataStore from "../../Models/DatabaseModels/DataStore";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import {
  DataAssetColumn,
  readDataAssetColumns,
} from "../../Types/DataObservability/DataAssetColumn";
import { getDataTableKey } from "../../Types/DataObservability/DataObservabilityMetric";
import { DataCheckType } from "../../Types/DataObservability/DataCheckType";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { getDatabaseEngineOfKind } from "../Utils/DataSecurity/DataSecurityProbeScan";
import {
  DataCheckDraft,
  validateDataCheck,
} from "../Utils/DataObservability/DataCheckValidation";

/*
 * The checks on a table's values. Every check is validated against the
 * table's catalog as it is saved - its column, its segment column and the
 * table it refers to must be ones the collection saw - and runs at the
 * store's next collection once saved or changed. A dbt test's check is
 * made and kept by its project's uploaded artifacts (DbtIngest): a person
 * turns it off or on, and sets its alert, and nothing else.
 */

// What a person may change of a dbt test's check.
const DBT_TEST_EDITABLE_FIELDS: ReadonlyArray<string> = [
  "isEnabled",
  "alertCondition",
  "alertThreshold",
];

const DBT_TEST_REFUSAL: string =
  "A dbt test is defined in your dbt project and comes from its artifacts: here it is only turned off or on, and alerted on.";

// The fields of a check that decide what it runs.
const RUN_FIELDS: ReadonlyArray<string> = [
  "checkType",
  "columnName",
  "segmentColumn",
  "acceptedValues",
  "pattern",
  "referenceTableKey",
  "referenceColumnName",
  "customSql",
  "intervalInMinutes",
  "alertCondition",
  "alertThreshold",
];

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (
      createBy.data.checkType === DataCheckType.DbtTest &&
      !createBy.props.isRoot
    ) {
      throw new BadDataException(DBT_TEST_REFUSAL);
    }

    const asset: DataAsset = await this.readAsset(
      createBy.data.dataAssetId,
      createBy.props.tenantId || createBy.data.projectId,
    );

    await this.validate(createBy.data as unknown as DataCheckDraft, asset);

    createBy.data.dataStoreId = asset.dataStoreId!;
    // Run at the store's next collection.
    createBy.data.nextRunAt = OneUptimeDate.getCurrentDate();

    return { createBy, carryForward: undefined };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (!updateBy.props.isRoot) {
      await this.refuseDbtTestEdits(updateBy, data);
    }
    const changesRun: boolean = RUN_FIELDS.some((field: string) => {
      return data[field] !== undefined;
    });

    if (!changesRun) {
      return { updateBy, carryForward: undefined };
    }

    const checks: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        projectId: true,
        dataAssetId: true,
        checkType: true,
        columnName: true,
        segmentColumn: true,
        acceptedValues: true,
        pattern: true,
        referenceTableKey: true,
        referenceColumnName: true,
        customSql: true,
        intervalInMinutes: true,
        alertCondition: true,
        alertThreshold: true,
      },
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    for (const check of checks) {
      const asset: DataAsset = await this.readAsset(
        check.dataAssetId,
        check.projectId,
      );
      const merged: DataCheckDraft = {
        ...(check as unknown as DataCheckDraft),
        ...(data as unknown as DataCheckDraft),
      };

      await this.validate(merged, asset);
    }

    // A changed check runs again at the store's next collection.
    (updateBy.data as unknown as JSONObject)["nextRunAt"] =
      OneUptimeDate.getCurrentDate();

    return { updateBy, carryForward: undefined };
  }

  // A person sets only whether a dbt test is recorded, and its alert.
  private async refuseDbtTestEdits(
    updateBy: UpdateBy<Model>,
    data: JSONObject,
  ): Promise<void> {
    if (data["checkType"] === DataCheckType.DbtTest) {
      throw new BadDataException(DBT_TEST_REFUSAL);
    }

    const changesDefinition: boolean = Object.keys(data).some(
      (field: string) => {
        return (
          data[field] !== undefined && !DBT_TEST_EDITABLE_FIELDS.includes(field)
        );
      },
    );

    if (!changesDefinition) {
      return;
    }

    const dbtTests: number = (
      await this.countBy({
        query: { ...updateBy.query, checkType: DataCheckType.DbtTest },
        props: { isRoot: true },
      })
    ).toNumber();

    if (dbtTests > 0) {
      throw new BadDataException(DBT_TEST_REFUSAL);
    }
  }

  private async readAsset(
    dataAssetId: ObjectID | undefined,
    projectId: ObjectID | undefined,
  ): Promise<DataAsset> {
    if (!dataAssetId || !projectId) {
      throw new BadDataException("A check needs the table it reads.");
    }

    const asset: DataAsset | null = await DataAssetService.findOneBy({
      query: { _id: dataAssetId, projectId },
      select: {
        _id: true,
        dataStoreId: true,
        columns: true,
        isDropped: true,
      },
      props: { isRoot: true },
    });

    if (!asset?.id || !asset.dataStoreId) {
      throw new BadDataException("The table was not found.");
    }

    return asset;
  }

  private async validate(
    draft: DataCheckDraft,
    asset: DataAsset,
  ): Promise<void> {
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: asset.dataStoreId! },
      select: { _id: true, kind: true },
      props: { isRoot: true },
    });
    const engine: string = getDatabaseEngineOfKind(store?.kind) || "";
    const referenced: Map<string, Array<DataAssetColumn>> = new Map();

    if (draft.referenceTableKey) {
      const others: Array<DataAsset> = await DataAssetService.findBy({
        query: {
          dataStoreId: asset.dataStoreId!,
          assetKey: draft.referenceTableKey,
        },
        select: { _id: true, schemaName: true, name: true, columns: true },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });

      for (const other of others) {
        referenced.set(
          getDataTableKey(other.schemaName || "", other.name || ""),
          readDataAssetColumns(other.columns),
        );
      }
    }

    validateDataCheck(draft, {
      engine,
      columns: readDataAssetColumns(asset.columns),
      referenceColumns: (tableKey: string) => {
        return referenced.get(tableKey) || null;
      },
    });
  }
}

export default new Service();
