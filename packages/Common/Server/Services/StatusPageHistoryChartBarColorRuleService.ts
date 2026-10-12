import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
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
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * 0 is an uptime. "At least 0%" is the rule at the bottom of a list that
   * every day reaches - the recommended rules end with it - and the
   * required-column check reads 0 as missing: a rule made with 0 was refused
   * as "uptimePercentGreaterThanOrEqualTo is required", from the dashboard's
   * form as from the API. Any number is a value of it; anything else is
   * still read as the check reads it.
   */
  protected override isRequiredColumnValueGiven(
    column: string,
    value: unknown,
  ): boolean {
    if (
      column === "uptimePercentGreaterThanOrEqualTo" &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      return true;
    }

    return super.isRequiredColumnValueGiven(column, value);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

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
