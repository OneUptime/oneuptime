import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ColumnBillingAccessControl from "../../../Types/BaseDatabase/ColumnBillingAccessControl";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { getAllEnvVars } from "../../Config";
import ProjectUtil from "../../Utils/Project";

/*
 * What a settings switch needs to know about the column it saves, worked out
 * without React so the row, the card and their tests share one answer:
 * which plan a project would need to change it, what it holds before anyone
 * set it, and whether the switch is on for a value.
 *
 * See ModelSwitchRow for the switch itself.
 */

/*
 * The boolean columns of a model, by name: what a switch can save. A model's
 * columns are declared `public isEnabled?: boolean = undefined`, so the
 * value type is `boolean | undefined`.
 */
export type ModelSwitchColumn<TBaseModel extends BaseModel> = {
  [K in keyof TBaseModel]-?: NonNullable<TBaseModel[K]> extends boolean
    ? K
    : never;
}[keyof TBaseModel] &
  string;

/*
 * The plan this project would need to change the column, or null when it
 * can. Fails open, like the dashboard's other plan notes: with billing off
 * (getCurrentPlan is null on every self-hosted install and outside a
 * project, as in the admin dashboard), or a plan it cannot tell, it says
 * nothing, and the server - which refuses the change below the plan anyway
 * - has the last word.
 */
export const getPlanNeededToChangeColumn: (
  model: BaseModel,
  column: string,
) => PlanType | null = (model: BaseModel, column: string): PlanType | null => {
  const currentPlan: PlanType | null = ProjectUtil.getCurrentPlan();

  if (!currentPlan) {
    return null;
  }

  const billing: ColumnBillingAccessControl | undefined =
    model.getColumnBillingAccessControl(column);

  if (!billing || !billing.update) {
    return null;
  }

  try {
    return SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
      billing.update,
      currentPlan,
      getAllEnvVars(),
    )
      ? null
      : billing.update;
  } catch {
    // A plan this dashboard cannot read is no reason to say anything.
    return null;
  }
};

/*
 * What a boolean column holds when nothing was ever written to it: the
 * default its model declares, or false when it declares none (a nullable
 * column the server leaves empty reads as off everywhere else, too).
 */
export const getColumnBooleanDefault: (
  model: BaseModel,
  column: string,
) => boolean = (model: BaseModel, column: string): boolean => {
  let metadata: TableColumnMetadata | undefined;

  try {
    metadata = model.getTableColumnMetadata(column);
  } catch {
    metadata = undefined;
  }

  return metadata?.defaultValue === true;
};

/*
 * Whether the switch is on for what the column holds. An inverted switch is
 * on while its column is false: a column that stores what to turn off
 * ("Disable Monitoring", "Do not add global probes") behind a switch that
 * reads on = happening. Nothing stored reads as the column's default.
 */
export const isModelSwitchOn: (data: {
  stored: unknown;
  defaultValue: boolean;
  isInverted?: boolean | undefined;
}) => boolean = (data: {
  stored: unknown;
  defaultValue: boolean;
  isInverted?: boolean | undefined;
}): boolean => {
  const value: boolean =
    typeof data.stored === "boolean" ? data.stored : data.defaultValue;

  return data.isInverted ? !value : value;
};

// What the column stores for a switch that is on or off.
export const getStoredValueForSwitch: (data: {
  isOn: boolean;
  isInverted?: boolean | undefined;
}) => boolean = (data: {
  isOn: boolean;
  isInverted?: boolean | undefined;
}): boolean => {
  return data.isInverted ? !data.isOn : data.isOn;
};
