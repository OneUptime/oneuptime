import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DataStoreFinding";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { queueDataSecurityEvaluation } from "../Utils/DataSecurity/DataSecurityJobs";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * Findings are OneUptime's to write. The one thing a person changes is
 * whether a finding is sensitive at all - and that decides the store's
 * sensitivity and so its checks, so the change queues the project's
 * evaluation.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (data["isSuppressed"] === undefined || updateBy.props.isRoot) {
      return { updateBy, carryForward: [] };
    }

    if (data["isSuppressed"] === false) {
      data["suppressedReason"] = null;
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      { _id: true, projectId: true },
    );

    return {
      updateBy,
      carryForward: rows
        .map((row: Model): ObjectID | undefined => {
          return row.projectId;
        })
        .filter((projectId: ObjectID | undefined): projectId is ObjectID => {
          return Boolean(projectId);
        }),
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const projectIds: Array<ObjectID> =
      (onUpdate.carryForward as Array<ObjectID> | undefined) || [];
    const seen: Set<string> = new Set();

    for (const projectId of projectIds) {
      if (!seen.has(projectId.toString())) {
        seen.add(projectId.toString());
        await queueDataSecurityEvaluation(projectId);
      }
    }

    return onUpdate;
  }
}

export default new Service();
