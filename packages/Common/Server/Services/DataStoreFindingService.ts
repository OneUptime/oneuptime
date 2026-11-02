import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DataStoreFinding";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { queueDataSecurityEvaluation } from "../Utils/DataSecurity/DataSecurityJobs";
import DataConfidence from "../../Types/DataSecurity/DataConfidence";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * Findings are OneUptime's to write. What a person changes is whether a
 * finding is sensitive at all, and whether it holds what the scan - or
 * OneUptime AI - was not sure it holds: both decide the store's
 * sensitivity and so its checks, so either change queues the project's
 * evaluation.
 *
 * A finding a person confirms counts as High confidence: once the update
 * is written its confidence is set to High as OneUptime's own write (a
 * person cannot set a confidence), and to Low when the confirmation is
 * taken back - only a Low finding is offered to confirm, and the next scan
 * says again what a detector is sure of. The finding writer keeps a
 * confirmed finding's High (DataSecurityFindingWriter).
 */

interface FindingUpdateCarry {
  projectIds: Array<ObjectID>;
  // The rows a person confirmed, or took the confirmation back from.
  confirmation?: { ids: Array<ObjectID>; isConfirmed: boolean } | undefined;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: JSONObject = updateBy.data as unknown as JSONObject;
    const isJudged: boolean =
      data["isSuppressed"] !== undefined || data["isConfirmed"] !== undefined;

    if (!isJudged || updateBy.props.isRoot) {
      return { updateBy, carryForward: null };
    }

    if (data["isSuppressed"] === false) {
      data["suppressedReason"] = null;
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      { _id: true, projectId: true },
    );

    const carry: FindingUpdateCarry = {
      projectIds: rows
        .map((row: Model): ObjectID | undefined => {
          return row.projectId;
        })
        .filter((projectId: ObjectID | undefined): projectId is ObjectID => {
          return Boolean(projectId);
        }),
    };

    if (typeof data["isConfirmed"] === "boolean") {
      carry.confirmation = {
        ids: rows
          .map((row: Model): ObjectID | undefined => {
            return row.id || undefined;
          })
          .filter((id: ObjectID | undefined): id is ObjectID => {
            return Boolean(id);
          }),
        isConfirmed: data["isConfirmed"],
      };
    }

    return { updateBy, carryForward: carry };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const carry: FindingUpdateCarry | null =
      (onUpdate.carryForward as FindingUpdateCarry | null) || null;

    if (!carry) {
      return onUpdate;
    }

    for (const id of carry.confirmation?.ids || []) {
      await this.updateColumnsByIdWithoutHooks({
        id,
        data: {
          confidence: carry.confirmation?.isConfirmed
            ? DataConfidence.High
            : DataConfidence.Low,
        },
      });
    }

    const seen: Set<string> = new Set();

    for (const projectId of carry.projectIds) {
      if (!seen.has(projectId.toString())) {
        seen.add(projectId.toString());
        await queueDataSecurityEvaluation(projectId);
      }
    }

    return onUpdate;
  }
}

export default new Service();
