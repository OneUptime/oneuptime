import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import ColumnBillingAccessControl from "../../../../Types/BaseDatabase/ColumnBillingAccessControl";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";

/*
 * WHETHER A READ OR WRITE REACHES SOMETHING A PLAN SELLS.
 *
 * A table names the plan each operation on it needs
 * (@TableBillingAccessControl), and a column the plan writing it needs
 * (@ColumnBillingAccessControl). An operation is "plan-gated" when the table
 * names a plan for it, or - for a create or an update - when it writes a
 * column that names one. Those are the operations whose check needs the
 * project's plan: the props are given it first (CallerPlan.withPlanFor), and
 * a check that still meets none refuses (BillingPermissions,
 * ColumnPermissions, the analytics ModelPermission). Every other operation
 * needs no plan, so nothing is read for it.
 *
 * Shared by the checks and by what fills the plan in, so the two never
 * disagree about which operations a plan decides.
 */
export default class PlanGates {
  /*
   * Whether every project meets a plan requirement: none at all, or the Free
   * plan - the lowest, which every plan includes. Such a requirement decides
   * nothing, so it needs no plan read and refuses no one.
   */
  public static isMetByEveryPlan(plan: PlanType | null | undefined): boolean {
    return !plan || plan === PlanType.Free;
  }

  // The plan a column names for this operation, if it names one.
  public static getColumnPlan(
    billingAccessControl: ColumnBillingAccessControl | null | undefined,
    type: DatabaseRequestType,
  ): PlanType | undefined {
    if (!billingAccessControl) {
      return undefined;
    }

    if (type === DatabaseRequestType.Create) {
      return billingAccessControl.create;
    }

    if (type === DatabaseRequestType.Read) {
      return billingAccessControl.read;
    }

    if (type === DatabaseRequestType.Update) {
      return billingAccessControl.update;
    }

    return undefined;
  }

  // The plan a database table names for this operation, or null when none.
  public static getTablePlan(
    model: BaseModel,
    type: DatabaseRequestType,
  ): PlanType | null {
    if (type === DatabaseRequestType.Create) {
      return model.createBillingPlan || null;
    }

    if (type === DatabaseRequestType.Read) {
      return model.readBillingPlan || null;
    }

    if (type === DatabaseRequestType.Update) {
      return model.updateBillingPlan || null;
    }

    if (type === DatabaseRequestType.Delete) {
      return model.deleteBillingPlan || null;
    }

    return null;
  }

  // The plan an analytics table names for this operation, if it names one.
  public static getAnalyticsTablePlan(
    model: AnalyticsBaseModel,
    type: DatabaseRequestType,
  ): PlanType | undefined {
    if (type === DatabaseRequestType.Create) {
      return model.tableBillingAccessControl?.create;
    }

    if (type === DatabaseRequestType.Read) {
      return model.tableBillingAccessControl?.read;
    }

    if (type === DatabaseRequestType.Update) {
      return model.tableBillingAccessControl?.update;
    }

    if (type === DatabaseRequestType.Delete) {
      return model.tableBillingAccessControl?.delete;
    }

    return undefined;
  }

  /*
   * Whether an operation on a database model is plan-gated: the table names
   * a plan for it, or a create or update writes a column that names one.
   * `data` is what the create or update writes; a column it leaves undefined
   * is not written.
   */
  public static isPlanAtStake(
    model: BaseModel,
    type: DatabaseRequestType,
    data?: unknown,
  ): boolean {
    if (!PlanGates.isMetByEveryPlan(PlanGates.getTablePlan(model, type))) {
      return true;
    }

    if (
      (type !== DatabaseRequestType.Create &&
        type !== DatabaseRequestType.Update) ||
      !data ||
      typeof data !== "object"
    ) {
      return false;
    }

    const values: Record<string, unknown> = data as Record<string, unknown>;

    return Object.keys(values).some((key: string): boolean => {
      return (
        values[key] !== undefined &&
        !PlanGates.isMetByEveryPlan(
          PlanGates.getColumnPlan(
            model.getColumnBillingAccessControl(key),
            type,
          ),
        )
      );
    });
  }

  // isPlanAtStake, for an analytics model.
  public static isAnalyticsPlanAtStake(
    model: AnalyticsBaseModel,
    type: DatabaseRequestType,
    data?: unknown,
  ): boolean {
    if (
      !PlanGates.isMetByEveryPlan(PlanGates.getAnalyticsTablePlan(model, type))
    ) {
      return true;
    }

    if (
      (type !== DatabaseRequestType.Create &&
        type !== DatabaseRequestType.Update) ||
      !data ||
      typeof data !== "object"
    ) {
      return false;
    }

    const values: Record<string, unknown> = data as Record<string, unknown>;

    return model
      .getTableColumns()
      .some((column: AnalyticsTableColumn): boolean => {
        return (
          values[column.key] !== undefined &&
          !PlanGates.isMetByEveryPlan(
            PlanGates.getColumnPlan(column.billingAccessControl, type),
          )
        );
      });
  }
}
