import { IsBillingEnabled } from "../EnvironmentConfig";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/PushNotificationLog";
import FindBy from "../Types/Database/FindBy";
import CountBy from "../Types/Database/CountBy";
import { OnFind } from "../Types/Database/Hooks";
import PositiveNumber from "../../Types/PositiveNumber";
import PrivateRecordReadFilter from "../Utils/Permission/PrivateRecordReadFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3);
    }
  }

  /*
   * A push notification log about a private incident, alert or episode is read only by
   * those who see that record (PrivateRecordReadFilter, #8913): its title and body are about the record, and its relation reads the record itself.
   * One about no private record is read as before.
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

  // The read hook narrows by the records it names. See onBeforeFind.
  public override getColumnsReadHooksNarrowBy(): Array<string> {
    return PrivateRecordReadFilter.getNamedRecordColumnNames(Model);
  }

  /*
   * Delivery logs are written by OneUptime as it sends each message, naming the
   * records it sends about, and some are written before the message goes out -
   * refusing one would stop the message. A log row written by a workflow is
   * checked like any other write.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
