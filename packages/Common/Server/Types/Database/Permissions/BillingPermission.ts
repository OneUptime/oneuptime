import {
  IsBillingEnabled,
  getAllEnvVars,
} from "../../../../Server/EnvironmentConfig";
import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  canDeletePlanGatedTableBelowPlan,
  canReadPlanGatedTableBelowPlan,
  isPlanGatedTableSwitchOff,
} from "../../../../Types/Billing/PlanGatedTable";
import SubscriptionPlan, {
  PlanType,
} from "../../../../Types/Billing/SubscriptionPlan";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import CallerPlan from "../../../Utils/Billing/CallerPlan";
import PlanGates from "./PlanGates";

export default class BillingPermissions {
  /*
   * The table-level plan check (@TableBillingAccessControl), on OneUptime
   * Cloud (billing on). A caller in a project whose props carry no plan is
   * refused wherever a plan is at stake, never read as being on any plan
   * (CallerPlan); OneUptime itself and server admins need none.
   *
   * Each operation needs the plan the table names for it, refused with that
   * plan's name - except what a project may always do with the records it
   * already has, whatever its plan (Types/Billing/PlanGatedTable): delete
   * them (unless deleting one gives more than the plan allows), switch one
   * off, and read them where they are configuration that keeps working
   * after a downgrade. So what a trial left behind, or a move to a lower
   * plan left over, can always be removed - and seen and switched off where
   * it would otherwise go on working unseen - while creating it, switching
   * it back on and changing it still need the plan.
   *
   * `updateData` is what an update writes, before a service's hooks or
   * after them: the switch-off can only be recognised in it. Callers that
   * have it pass it; without it, an update below the plan is refused (fail
   * closed).
   */
  @CaptureSpan()
  public static checkBillingPermissions(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
    updateData?: unknown,
  ): void {
    BillingPermissions.check(modelType, props, type, {
      allowLeftovers: true,
      updateData: updateData,
    });
  }

  /*
   * The plan check without what a project may still do with its leftovers,
   * for a route that uses a feature rather than manages its records. The
   * Schedule Timeline works out who is on call over time from schedules a
   * project below Growth may still read - to find and delete them - and
   * that working-out is what the plan sells. Refused with the plan's name;
   * nothing is asked where billing is off, and a caller whose plan is not
   * known is refused, as in the check above.
   */
  @CaptureSpan()
  public static checkFeatureIsOnPlan(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): void {
    BillingPermissions.check(modelType, props, type, {
      allowLeftovers: false,
    });
  }

  private static check(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
    options: { allowLeftovers: boolean; updateData?: unknown },
  ): void {
    if (!IsBillingEnabled) {
      return;
    }

    const model: BaseModel = new modelType();

    /*
     * Props that act in a project but carry no plan are never read as "any
     * plan" (CallerPlan): where the table names a plan for this operation,
     * the request is refused, unless what it does is allowed below that
     * plan anyway (a project's leftovers, see isAllowedBelowPlan).
     * DatabaseService and ModelPermission give the props their project's
     * plan before they get here, so this refuses only a caller that built
     * its props without one. Props of OneUptime itself or of a server admin
     * need no plan.
     */
    if (!props.currentPlan) {
      if (
        CallerPlan.isPlanMissing(props) &&
        !PlanGates.isMetByEveryPlan(
          BillingPermissions.getRequiredPlan(model, type),
        ) &&
        !(
          options.allowLeftovers &&
          BillingPermissions.isAllowedBelowPlan(model, type, options.updateData)
        )
      ) {
        CallerPlan.assertPlanKnown(props);
      }

      return;
    }

    if (props.isSubscriptionUnpaid && !model.allowAccessIfSubscriptionIsUnpaid) {
      throw new PaymentRequiredException(
        "Your current subscription is in an unpaid state. Looks like your payment method failed. Please add a new payment method in Project Settings > Invoices to pay unpaid invoices.",
      );
    }

    const requiredPlan: PlanType | null = BillingPermissions.getMissingPlan(
      model,
      type,
      props.currentPlan,
    );

    if (!requiredPlan) {
      return;
    }

    if (
      options.allowLeftovers &&
      BillingPermissions.isAllowedBelowPlan(model, type, options.updateData)
    ) {
      return;
    }

    throw new PaymentRequiredException(
      "Please upgrade your plan to " + requiredPlan + " to access this feature",
    );
  }

  /*
   * What a project below the table's plan for this operation may still do
   * with the records it has (see Types/Billing/PlanGatedTable): read them,
   * where the table is configuration that keeps working after a downgrade;
   * delete them, unless deleting one gives more than the plan allows; and
   * an update that only switches them off. Never a create.
   */
  public static isAllowedBelowPlan(
    model: BaseModel,
    type: DatabaseRequestType,
    updateData?: unknown,
  ): boolean {
    if (type === DatabaseRequestType.Read) {
      return canReadPlanGatedTableBelowPlan(model);
    }

    if (type === DatabaseRequestType.Delete) {
      return canDeletePlanGatedTableBelowPlan(model);
    }

    if (type === DatabaseRequestType.Update) {
      return isPlanGatedTableSwitchOff(model, updateData);
    }

    return false;
  }

  /*
   * The plan the table names for this operation when `currentPlan` does not
   * reach it, or null when it does (or the table names none): the one
   * comparison every plan check makes. Used on its own where something
   * other than a record's access is held to a table's plan - an API key or
   * a SCIM connection, when it authenticates (PlanCutoffCredentialAccess).
   */
  public static getMissingPlan(
    model: BaseModel,
    type: DatabaseRequestType,
    currentPlan: PlanType,
  ): PlanType | null {
    const requiredPlan: PlanType | null = BillingPermissions.getRequiredPlan(
      model,
      type,
    );

    if (!requiredPlan) {
      return null;
    }

    if (
      SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
        requiredPlan,
        currentPlan,
        getAllEnvVars(),
      )
    ) {
      return null;
    }

    return requiredPlan;
  }

  // The plan the table names for this operation, or null when none.
  public static getRequiredPlan(
    model: BaseModel,
    type: DatabaseRequestType,
  ): PlanType | null {
    return PlanGates.getTablePlan(model, type);
  }
}
