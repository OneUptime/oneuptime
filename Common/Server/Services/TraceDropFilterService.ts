import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TraceDropFilter";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import PartialEntity from "../../Types/Database/PartialEntity";
import {
  DropFilterCandidate,
  DropFilterValidationOptions,
  isSqlExpressionValue,
  validateDropFilter,
} from "../Utils/DropFilterValidation";

const VALIDATION_OPTIONS: DropFilterValidationOptions = {
  recordNoun: "spans",
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    validateDropFilter(
      {
        action: createBy.data.action,
        samplePercentage: createBy.data.samplePercentage,
        filterQuery: createBy.data.filterQuery as string | undefined,
      },
      VALIDATION_OPTIONS,
    );

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * An update can make a row invalid without naming every field: flipping
     * `action` to "sample" while the stored `samplePercentage` is null, or
     * blanking `filterQuery` on a row whose action is already "drop". So
     * validate the MERGED row, not the incoming partial.
     *
     * Only pay for the SELECT when the update actually touches one of the
     * three fields that can break the row. Drop-filter edits are rare,
     * human-driven config changes — this is not a hot path.
     */
    const incomingAction: unknown = updateBy.data.action;
    const incomingSamplePercentage: unknown = updateBy.data.samplePercentage;
    const incomingFilterQuery: unknown = updateBy.data.filterQuery;

    const touchesValidatedFields: boolean =
      incomingAction !== undefined ||
      incomingSamplePercentage !== undefined ||
      incomingFilterQuery !== undefined;

    if (!touchesValidatedFields) {
      return { updateBy, carryForward: null };
    }

    if (
      isSqlExpressionValue(incomingAction) ||
      isSqlExpressionValue(incomingSamplePercentage) ||
      isSqlExpressionValue(incomingFilterQuery)
    ) {
      // Cannot evaluate a raw SQL expression here. See isSqlExpressionValue.
      return { updateBy, carryForward: null };
    }

    const existingRows: Array<Model> = await this.findBy({
      query: updateBy.query,
      skip: 0,
      limit: LIMIT_MAX,
      select: {
        _id: true,
        action: true,
        samplePercentage: true,
        filterQuery: true,
      },
      props: {
        isRoot: true,
      },
    });

    for (const existing of existingRows) {
      const merged: DropFilterCandidate = {
        action:
          incomingAction !== undefined
            ? (incomingAction as string | null)
            : existing.action,
        samplePercentage:
          incomingSamplePercentage !== undefined
            ? (incomingSamplePercentage as number | null)
            : existing.samplePercentage,
        filterQuery:
          incomingFilterQuery !== undefined
            ? (incomingFilterQuery as string | null)
            : (existing.filterQuery as string | null),
      };

      validateDropFilter(merged, VALIDATION_OPTIONS);
    }

    return { updateBy, carryForward: null };
  }

  /*
   * Ingest-path counter flush: add `count` drops to this filter's running
   * total and stamp `lastDroppedAt`, in one atomic statement.
   *
   * Called from the telemetry ingest workers on a throttle (many dropped
   * spans batched into one UPDATE), never once per record, and never on the
   * request path. Runs no hooks and does not bump `version`, so it cannot
   * conflict with a human editing the same filter in the dashboard.
   *
   * See App/FeatureSet/Telemetry/Utils/DropFilterDropRecorder.ts.
   */
  public async addToDroppedCount(data: {
    id: ObjectID;
    count: number;
    lastDroppedAt?: Date | undefined;
  }): Promise<void> {
    if (!data.count || data.count <= 0) {
      return;
    }

    await this.atomicAddToColumnsByIdWithoutHooks({
      id: data.id,
      add: { droppedCount: data.count },
      set: {
        lastDroppedAt: data.lastDroppedAt || OneUptimeDate.getCurrentDate(),
      } as PartialEntity<Model>,
    });
  }
}

export default new Service();
