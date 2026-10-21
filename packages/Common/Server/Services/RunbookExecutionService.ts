import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/RunbookExecution";
import { OnUpdate } from "../Types/Database/Hooks";
import ObjectID from "../../Types/ObjectID";
import OwnChangeRecorder from "../Utils/Telemetry/ChangeDetection/OwnChangeRecorder";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A runbook OneUptime ran is a change: once an execution finishes it is
   * recorded, so the investigations that follow it can see it
   * (OwnChangeRecorder). Started and not awaited.
   */
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const status: unknown = (
      onUpdate.updateBy.data as unknown as Record<string, unknown>
    )["status"];

    if (OwnChangeRecorder.isTerminalRunbookStatus(status)) {
      OwnChangeRecorder.recordRunbookExecutions(updatedItemIds);
    }

    return onUpdate;
  }
}

export default new Service();
