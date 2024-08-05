import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";

export class Service extends DatabaseService<IncidentState> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(IncidentState, postgresDatabase);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<IncidentState>,
  ): Promise<OnCreate<IncidentState>> {
    if (!createBy.data.order) {
      throw new BadDataException("Incident State order is required");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Incident State projectId is required");
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

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<IncidentState>,
  ): Promise<OnDelete<IncidentState>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting incident states. Please try the delete with objectId",
      );
    }

    let incidentState: IncidentState | null = null;

    if (!deleteBy.props.isRoot) {
      incidentState = await this.findOneBy({
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
      carryForward: incidentState,
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<IncidentState>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<IncidentState>> {
    const deleteBy: DeleteBy<IncidentState> = onDelete.deleteBy;
    const incidentState: IncidentState | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && incidentState) {
      if (incidentState && incidentState.order && incidentState.projectId) {
        await this.rearrangeOrder(
          incidentState.order,
          incidentState.projectId,
          false,
        );
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<IncidentState>,
  ): Promise<OnUpdate<IncidentState>> {
    if (updateBy.data.order && !updateBy.props.isRoot) {
      throw new BadDataException(
        "Incident State order should not be updated. Delete this incident state and create a new state with the right order.",
      );
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangeOrder(
    currentOrder: number,
    projectId: ObjectID,
    increaseOrder: boolean = true,
  ): Promise<void> {
    // get incident with this order.
    const incidentStates: Array<IncidentState> = await this.findBy({
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

    for (const incidentState of incidentStates) {
      if (increaseOrder) {
        newOrder = incidentState.order! + 1;
      } else {
        newOrder = incidentState.order! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: incidentState._id!,
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

  public async getUnresolvedIncidentStates(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<IncidentState[]> {
    const incidentStates: Array<IncidentState> = await this.findBy({
      query: {
        projectId: projectId,
      },
      skip: 0,
      limit: LIMIT_MAX,
      sort: {
        order: SortOrder.Ascending,
      },
      select: {
        _id: true,
        isResolvedState: true,
      },
      props: props,
    });

    const unresolvedIncidentStates: Array<IncidentState> = [];

    for (const state of incidentStates) {
      if (!state.isResolvedState) {
        unresolvedIncidentStates.push(state);
      } else {
        break; // everything after resolved state is resolved
      }
    }

    return unresolvedIncidentStates;
  }
}
export default new Service();
