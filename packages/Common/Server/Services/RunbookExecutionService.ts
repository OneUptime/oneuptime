import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/RunbookExecution";
import { OnFind, OnUpdate } from "../Types/Database/Hooks";
import CountBy from "../Types/Database/CountBy";
import FindBy from "../Types/Database/FindBy";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import OwnChangeRecorder from "../Utils/Telemetry/ChangeDetection/OwnChangeRecorder";
import PrivateRecordReadFilter from "../Utils/Permission/PrivateRecordReadFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A run of a runbook linked to a private incident or alert is read only
   * by those who see that record (PrivateRecordReadFilter): what its steps
   * printed can quote the record, and its relation reads the record
   * itself. A run linked to no private record is read as before.
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = PrivateRecordReadFilter.apply(
      findBy.query,
      findBy.props,
      Model,
    );

    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = PrivateRecordReadFilter.apply(
      countBy.query,
      countBy.props,
      Model,
    );

    return await super.countBy(countBy);
  }

  // The read hook narrows by the records a run is linked to. See onBeforeFind.
  public override getColumnsReadHooksNarrowBy(): Array<string> {
    return PrivateRecordReadFilter.getNamedRecordColumnNames(Model);
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
