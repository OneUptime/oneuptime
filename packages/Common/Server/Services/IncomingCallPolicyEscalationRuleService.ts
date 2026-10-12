import ProjectReferencesService from "./ProjectReferencesService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import BadDataException from "../../Types/Exception/BadDataException";
import IncomingCallPolicyEscalationRule from "../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";

/*
 * The two names of who a rule calls - a user or an on-call schedule - and of
 * the policy it belongs to, ID column first. A rule may be written under
 * either name of each, and the two must agree (RelationIdUtil.readConsistent),
 * so a rule sent with the relations is held to the same rules as one sent
 * with the IDs.
 */
const USER_KEYS: Array<string> = ["userId", "user"];
const SCHEDULE_KEYS: Array<string> = [
  "onCallDutyPolicyScheduleId",
  "onCallDutyPolicySchedule",
];
const POLICY_KEYS: Array<string> = [
  "incomingCallPolicyId",
  "incomingCallPolicy",
];

export class Service extends ProjectReferencesService<IncomingCallPolicyEscalationRule> {
  public constructor() {
    super(IncomingCallPolicyEscalationRule);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<IncomingCallPolicyEscalationRule>,
  ): Promise<OnCreate<IncomingCallPolicyEscalationRule>> {
    await super.onBeforeCreate(createBy);

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    // Validate mutual exclusivity: either a user OR an on-call schedule must be set
    const hasUser: boolean = Boolean(
      RelationIdUtil.readConsistent(data, USER_KEYS, "User"),
    );
    const hasSchedule: boolean = Boolean(
      RelationIdUtil.readConsistent(data, SCHEDULE_KEYS, "On-Call Schedule"),
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

    if (
      !RelationIdUtil.readConsistent(data, POLICY_KEYS, "Incoming Call Policy")
    ) {
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
      // The rules the delete removes, and the delete held to them.
      const rules: Array<IncomingCallPolicyEscalationRule> =
        await this.findRowsAndHoldDeleteToThem(deleteBy, {
          _id: true,
        });

      if (rules.length === 0) {
        throw new BadDataException(
          "IncomingCallPolicyEscalationRule with this id not found",
        );
      }
    }

    /*
     * The other rules keep their numbers: the escalation stays in the same
     * order without this one (the model's @ListOrderColumn).
     */
    return {
      deleteBy,
      carryForward: null,
    };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<IncomingCallPolicyEscalationRule>,
  ): Promise<OnUpdate<IncomingCallPolicyEscalationRule>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * Enforce user/schedule mutual exclusivity on update (parity with onBeforeCreate).
     * Only runs when the update actually touches one of the routing-target fields, so
     * internal updates (status/order via isRoot) are unaffected.
     */
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;
    const isTouchingTarget: boolean =
      RelationIdUtil.isPresent(data, USER_KEYS) ||
      RelationIdUtil.isPresent(data, SCHEDULE_KEYS);

    if (isTouchingTarget) {
      const settingUser: boolean = Boolean(
        RelationIdUtil.readConsistent(data, USER_KEYS, "User"),
      );
      const settingSchedule: boolean = Boolean(
        RelationIdUtil.readConsistent(data, SCHEDULE_KEYS, "On-Call Schedule"),
      );

      if (settingUser && settingSchedule) {
        throw new BadDataException(
          "Only one of User or On-Call Schedule can be specified, not both",
        );
      }

      /*
       * Setting one target clears the other, under both of its names, so a
       * rule can never hold both.
       */
      if (settingUser) {
        RelationIdUtil.stamp(data, SCHEDULE_KEYS, null);
      }
      if (settingSchedule) {
        RelationIdUtil.stamp(data, USER_KEYS, null);
      }

      // Every rule the update writes, and the update held to them.
      const existingRules: Array<IncomingCallPolicyEscalationRule> =
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          userId: true,
          onCallDutyPolicyScheduleId: true,
        });

      for (const existing of existingRules) {
        /*
         * Whether each target will be present AFTER this update, accounting
         * for fields left untouched (keep existing) and the opposite-field
         * clearing done above.
         */
        const willHaveUser: boolean = settingUser
          ? true
          : !RelationIdUtil.isPresent(data, USER_KEYS)
            ? Boolean(existing.userId)
            : false;
        const willHaveSchedule: boolean = settingSchedule
          ? true
          : !RelationIdUtil.isPresent(data, SCHEDULE_KEYS)
            ? Boolean(existing.onCallDutyPolicyScheduleId)
            : false;

        if (!willHaveUser && !willHaveSchedule) {
          throw new BadDataException(
            "Either a User or an On-Call Schedule must be specified for the escalation rule",
          );
        }
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
