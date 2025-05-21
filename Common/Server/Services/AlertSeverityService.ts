import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/AlertSeverity";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.order) {
      throw new BadDataException("Alert severity order is required");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Alert severity projectId is required");
    }

    await this.rearrangeOrder(
      createBy.data.order,
      createBy.data.projectId,
      true,
    );

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
        "_id should be present when deleting alert states. Please try the delete with objectId",
      );
    }

    let alertSeverity: Model | null = null;

    if (!deleteBy.props.isRoot) {
      alertSeverity = await this.findOneBy({
        query: deleteBy.query,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          projectId: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: alertSeverity,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const alertSeverity: Model | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && alertSeverity) {
      if (alertSeverity && alertSeverity.order && alertSeverity.projectId) {
        await this.rearrangeOrder(
          alertSeverity.order,
          alertSeverity.projectId,
          false,
        );
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.order && !updateBy.props.isRoot) {
      throw new BadDataException(
        "Alert Severity order should not be updated. Delete this alert state and create a new state with the right order.",
      );
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangeOrder(
    currentOrder: number,
    projectId: ObjectID,
    increaseOrder: boolean = true,
  ): Promise<void> {
    // get alert with this order.
    const alertSeverities: Array<Model> = await this.findBy({
      query: {
        order: QueryHelper.greaterThanEqualTo(currentOrder),
        projectId: projectId,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
    });

    let newOrder: number = currentOrder;

    for (const alertSeverity of alertSeverities) {
      if (increaseOrder) {
        newOrder = alertSeverity.order! + 1;
      } else {
        newOrder = alertSeverity.order! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: alertSeverity._id!,
        },
        data: {
          order: newOrder,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }
}
export default new Service();
