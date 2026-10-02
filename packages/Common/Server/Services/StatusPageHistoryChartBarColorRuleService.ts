import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * The history chart's bar color rules are evaluated from the top of their
 * list down, and the list is put in order by dragging. The model's
 * @ListOrderColumn keeps their `order` for every caller (DatabaseService): a
 * new rule goes to the end, a moved one takes the place of the rule it was
 * dropped on, and the others keep their order when one is deleted.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.statusPageId) {
      throw new BadDataException(
        "Status Page Resource statusPageId is required",
      );
    }

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting status page resource. Please try the delete with objectId",
      );
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }
}

export default new Service();
