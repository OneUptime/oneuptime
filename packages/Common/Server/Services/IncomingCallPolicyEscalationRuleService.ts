import DatabaseService from "./DatabaseService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
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

    /*
     * Where the rule goes in the escalation - the end, unless the caller
     * asked for a place - is kept by the model's @ListOrderColumn.
     */
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

    if (!deleteBy.props.isRoot) {
      const resource: IncomingCallPolicyEscalationRule | null =
        await this.findOneBy({
          query: deleteBy.query,
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
          },
        });

      if (!resource) {
        throw new BadDataException(
          "IncomingCallPolicyEscalationRule with this id not found",
        );
      }
    }

    /*
     * The rules after it close the gap through the model's @ListOrderColumn.
     */
    return {
      deleteBy,
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

    /*
     * A new `order` moves the rule to that place in the escalation, and the
     * rules in between shift - kept by the model's @ListOrderColumn.
     */
    return { updateBy, carryForward: null };
  }
}

export default new Service();
