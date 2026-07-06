import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AIConversation";
import { pinQueryToRequestingUser } from "../Utils/AI/AIChatPrivacyFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = pinQueryToRequestingUser(
      findBy.query,
      findBy.props,
      "createdByUserId",
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = pinQueryToRequestingUser(
      countBy.query,
      countBy.props,
      "createdByUserId",
    );
    return super.countBy(countBy);
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    updateBy.query = pinQueryToRequestingUser(
      updateBy.query,
      updateBy.props,
      "createdByUserId",
    );
    return { updateBy, carryForward: null };
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = pinQueryToRequestingUser(
      deleteBy.query,
      deleteBy.props,
      "createdByUserId",
    );
    return { deleteBy, carryForward: null };
  }
}

export default new Service();
