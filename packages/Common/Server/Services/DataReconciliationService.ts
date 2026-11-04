import ProjectReferencesService from "./ProjectReferencesService";
import DataCheckService from "./DataCheckService";
import MonitorService from "./MonitorService";
import Model from "../../Models/DatabaseModels/DataReconciliation";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import {
  DATA_CHECK_INTERVALS_IN_MINUTES,
  DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
} from "../../Types/DataObservability/DataCheckType";
import { getDataReconciliationError } from "../../Types/DataObservability/DataReconciliation";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * Reconciliations: one measure of two tables, compared with a tolerance.
 * Each is checked as it is saved - its tolerance, each side's measure with
 * the column or query it needs, an interval checks run at - and its two
 * checks and its monitor are made and kept by DataReconciliationSync, as
 * the person who saved it. Deleting one deletes them.
 */

// The fields that decide what a reconciliation compares and how.
const DEFINITION_FIELDS: ReadonlyArray<string> = [
  "toleranceType",
  "tolerance",
  "intervalInMinutes",
  "sourceMeasure",
  "sourceColumnName",
  "sourceCustomSql",
  "targetMeasure",
  "targetColumnName",
  "targetCustomSql",
];

interface DeletedReconciliations {
  reconciliations: Array<Model>;
}

// Each side's table, under either of its names, kept in its ID column.
function readSideTables(data: Record<string, unknown>): void {
  RelationIdUtil.readIntoIdColumn(
    data,
    ["sourceDataAssetId", "sourceDataAsset"],
    "Source Table",
  );
  RelationIdUtil.readIntoIdColumn(
    data,
    ["targetDataAssetId", "targetDataAsset"],
    "Target Table",
  );
}

function checkInterval(value: unknown): void {
  if (
    value !== undefined &&
    value !== null &&
    !DATA_CHECK_INTERVALS_IN_MINUTES.includes(Number(value))
  ) {
    throw new BadDataException(
      "A reconciliation runs every 15 minutes, hour, 6 hours or day: its interval is 15, 60, 360 or 1440.",
    );
  }
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    readSideTables(createBy.data as unknown as Record<string, unknown>);

    if (!createBy.data.sourceDataAssetId || !createBy.data.targetDataAssetId) {
      throw new BadDataException(
        "A reconciliation needs its two tables: a source and a target.",
      );
    }

    const error: string | null = getDataReconciliationError(
      createBy.data as unknown as JSONObject,
    );

    if (error) {
      throw new BadDataException(error);
    }

    checkInterval(createBy.data.intervalInMinutes);

    if (!createBy.data.intervalInMinutes) {
      createBy.data.intervalInMinutes = DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES;
    }

    return { createBy, carryForward: undefined };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    readSideTables(updateBy.data as unknown as Record<string, unknown>);

    const data: JSONObject = updateBy.data as unknown as JSONObject;
    const changesDefinition: boolean = DEFINITION_FIELDS.some(
      (field: string) => {
        return data[field] !== undefined;
      },
    );

    if (!changesDefinition) {
      return { updateBy, carryForward: undefined };
    }

    checkInterval(data["intervalInMinutes"]);

    const reconciliations: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        toleranceType: true,
        tolerance: true,
        sourceMeasure: true,
        sourceColumnName: true,
        sourceCustomSql: true,
        targetMeasure: true,
        targetColumnName: true,
        targetCustomSql: true,
      },
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    for (const reconciliation of reconciliations) {
      const error: string | null = getDataReconciliationError({
        ...(reconciliation as unknown as JSONObject),
        ...Object.fromEntries(
          DEFINITION_FIELDS.filter((field: string) => {
            return data[field] !== undefined;
          }).map((field: string) => {
            return [field, data[field]];
          }),
        ),
      });

      if (error) {
        throw new BadDataException(error);
      }
    }

    return { updateBy, carryForward: undefined };
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const reconciliations: Array<Model> =
      await this.findRowsAndHoldDeleteToThem(deleteBy, {
        _id: true,
        projectId: true,
        sourceDataCheckId: true,
        targetDataCheckId: true,
        monitorId: true,
      });
    const carryForward: DeletedReconciliations = { reconciliations };

    return { deleteBy, carryForward };
  }

  // A deleted reconciliation's checks and monitor go with it.
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    deletedIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const carried: DeletedReconciliations | undefined =
      onDelete.carryForward as DeletedReconciliations | undefined;

    if (!carried) {
      return onDelete;
    }

    for (const reconciliation of Service.getRowsDeleted<Model>({
      rows: carried.reconciliations,
      deletedIds,
    })) {
      try {
        const checkIds: Array<ObjectID> = [
          reconciliation.sourceDataCheckId,
          reconciliation.targetDataCheckId,
        ].filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        });

        if (checkIds.length > 0) {
          await DataCheckService.deleteBy({
            query: {
              _id: QueryHelper.any(checkIds),
              projectId: reconciliation.projectId!,
            },
            limit: checkIds.length,
            skip: 0,
            props: { isRoot: true },
          });
        }

        if (reconciliation.monitorId) {
          await MonitorService.deleteBy({
            query: {
              _id: reconciliation.monitorId,
              projectId: reconciliation.projectId!,
            },
            limit: 1,
            skip: 0,
            props: { isRoot: true },
          });
        }
      } catch (error) {
        logger.error(
          `Data Observability: could not delete the checks and monitor of reconciliation ${reconciliation.id?.toString()}`,
        );
        logger.error(error);
      }
    }

    return onDelete;
  }
}

export default new Service();
