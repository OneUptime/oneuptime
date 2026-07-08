import DatabaseService from "./DatabaseService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import BadDataException from "../../Types/Exception/BadDataException";
import PositiveNumber from "../../Types/PositiveNumber";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import IncomingCallPolicyEscalationRule from "../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";

export class Service extends DatabaseService<IncomingCallPolicyEscalationRule> {
  public constructor() {
    super(IncomingCallPolicyEscalationRule);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<IncomingCallPolicyEscalationRule>,
  ): Promise<OnCreate<IncomingCallPolicyEscalationRule>> {
    // Validate mutual exclusivity: either userId OR onCallDutyPolicyScheduleId must be set
    const hasUser: boolean = Boolean(createBy.data.userId);
    const hasSchedule: boolean = Boolean(
      createBy.data.onCallDutyPolicyScheduleId,
    );

    if (!hasUser && !hasSchedule) {
      throw new BadDataException(
        "Either a User or an On-Call Schedule must be specified for the escalation rule",
      );
    }

    if (hasUser && hasSchedule) {
      throw new BadDataException(
        "Only one of User or On-Call Schedule can be specified, not both",
      );
    }

    if (!createBy.data.incomingCallPolicyId) {
      throw new BadDataException("incomingCallPolicyId is required");
    }

    // Auto-generate order if not provided
    if (!createBy.data.order) {
      const query: Query<IncomingCallPolicyEscalationRule> = {
        incomingCallPolicyId: createBy.data.incomingCallPolicyId,
      };

      const count: PositiveNumber = await this.countBy({
        query: query,
        props: {
          isRoot: true,
        },
      });

      createBy.data.order = count.toNumber() + 1;
    }

    await this.rearrangeOrder(
      createBy.data.order,
      createBy.data.incomingCallPolicyId,
      true,
    );

    return {
      createBy,
      carryForward: null,
    };
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<IncomingCallPolicyEscalationRule>,
  ): Promise<OnDelete<IncomingCallPolicyEscalationRule>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting escalation rule. Please try the delete with objectId",
      );
    }

    let resource: IncomingCallPolicyEscalationRule | null = null;

    if (!deleteBy.props.isRoot) {
      resource = await this.findOneBy({
        query: deleteBy.query,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          incomingCallPolicyId: true,
          projectId: true,
        },
      });

      if (!resource) {
        throw new BadDataException(
          "IncomingCallPolicyEscalationRule with this id not found",
        );
      }
    }

    return {
      deleteBy,
      carryForward: resource,
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<IncomingCallPolicyEscalationRule>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<IncomingCallPolicyEscalationRule>> {
    const deleteBy: DeleteBy<IncomingCallPolicyEscalationRule> =
      onDelete.deleteBy;
    const resource: IncomingCallPolicyEscalationRule | null =
      onDelete.carryForward;

    if (!deleteBy.props.isRoot && resource) {
      if (resource && resource.order && resource.incomingCallPolicyId) {
        await this.rearrangeOrder(
          resource.order,
          resource.incomingCallPolicyId,
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
    updateBy: UpdateBy<IncomingCallPolicyEscalationRule>,
  ): Promise<OnUpdate<IncomingCallPolicyEscalationRule>> {
    /*
     * Enforce user/schedule mutual exclusivity on update (parity with onBeforeCreate).
     * Only runs when the update actually touches one of the routing-target fields, so
     * internal updates (status/order via isRoot) are unaffected.
     */
    const data: UpdateBy<IncomingCallPolicyEscalationRule>["data"] =
      updateBy.data;
    const isTouchingTarget: boolean =
      data.userId !== undefined ||
      data.onCallDutyPolicyScheduleId !== undefined;

    if (isTouchingTarget && updateBy.query._id) {
      const settingUser: boolean = Boolean(data.userId);
      const settingSchedule: boolean = Boolean(data.onCallDutyPolicyScheduleId);

      if (settingUser && settingSchedule) {
        throw new BadDataException(
          "Only one of User or On-Call Schedule can be specified, not both",
        );
      }

      // Setting one target clears the other so a rule can never hold both.
      const nullableData: {
        userId?: ObjectID | null;
        onCallDutyPolicyScheduleId?: ObjectID | null;
      } = data as {
        userId?: ObjectID | null;
        onCallDutyPolicyScheduleId?: ObjectID | null;
      };
      if (settingUser) {
        nullableData.onCallDutyPolicyScheduleId = null;
      }
      if (settingSchedule) {
        nullableData.userId = null;
      }

      const existing: IncomingCallPolicyEscalationRule | null =
        await this.findOneBy({
          query: {
            _id: updateBy.query._id!,
          },
          select: {
            userId: true,
            onCallDutyPolicyScheduleId: true,
          },
          props: {
            isRoot: true,
          },
        });

      /*
       * Whether each target will be present AFTER this update, accounting for
       * fields left untouched (keep existing) and the opposite-field clearing
       * done above.
       */
      const willHaveUser: boolean = settingUser
        ? true
        : data.userId === undefined
          ? Boolean(existing?.userId)
          : false;
      const willHaveSchedule: boolean = settingSchedule
        ? true
        : data.onCallDutyPolicyScheduleId === undefined
          ? Boolean(existing?.onCallDutyPolicyScheduleId)
          : false;

      if (!willHaveUser && !willHaveSchedule) {
        throw new BadDataException(
          "Either a User or an On-Call Schedule must be specified for the escalation rule",
        );
      }
    }

    if (updateBy.data.order && !updateBy.props.isRoot && updateBy.query._id) {
      const resource: IncomingCallPolicyEscalationRule | null =
        await this.findOneBy({
          query: {
            _id: updateBy.query._id!,
          },
          props: {
            isRoot: true,
          },
          select: {
            order: true,
            incomingCallPolicyId: true,
            _id: true,
          },
        });

      const currentOrder: number = resource?.order as number;
      const newOrder: number = updateBy.data.order as number;

      const resources: Array<IncomingCallPolicyEscalationRule> =
        await this.findBy({
          query: {
            incomingCallPolicyId: resource?.incomingCallPolicyId as ObjectID,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
          select: {
            order: true,
            incomingCallPolicyId: true,
            _id: true,
          },
        });

      if (currentOrder > newOrder) {
        // moving up.
        for (const resource of resources) {
          if (resource.order! >= newOrder && resource.order! < currentOrder) {
            // increment order.
            await this.updateOneBy({
              query: {
                _id: resource._id!,
              },
              data: {
                order: resource.order! + 1,
              },
              props: {
                isRoot: true,
              },
            });
          }
        }
      }

      if (newOrder > currentOrder) {
        // moving down.
        for (const resource of resources) {
          if (resource.order! > currentOrder && resource.order! <= newOrder) {
            // decrement order to fill the gap left by the moved rule.
            await this.updateOneBy({
              query: {
                _id: resource._id!,
              },
              data: {
                order: resource.order! - 1,
              },
              props: {
                isRoot: true,
              },
            });
          }
        }
      }
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangeOrder(
    currentOrder: number,
    incomingCallPolicyId: ObjectID,
    increaseOrder: boolean = true,
  ): Promise<void> {
    const resources: Array<IncomingCallPolicyEscalationRule> =
      await this.findBy({
        query: {
          order: QueryHelper.greaterThanEqualTo(currentOrder),
          incomingCallPolicyId: incomingCallPolicyId,
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

    for (const resource of resources) {
      if (increaseOrder) {
        newOrder = resource.order! + 1;
      } else {
        newOrder = resource.order! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: resource._id!,
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
