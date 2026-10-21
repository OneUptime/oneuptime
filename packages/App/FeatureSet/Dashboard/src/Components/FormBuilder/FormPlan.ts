import Form from "Common/Models/DatabaseModels/Form";
import ColumnBillingAccessControl from "Common/Types/BaseDatabase/ColumnBillingAccessControl";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import { getAllEnvVars } from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * The plan a form's IP allowlist needs before it can be changed. Read off the
 * column's own billing rule (Form.ipWhitelist) rather than written
 * out here, so the note on the form's page can never disagree with what the
 * server enforces - the same rule as a public dashboard's IP allowlist.
 */
export const getFormIpAllowlistPlan: () => PlanType | null =
  (): PlanType | null => {
    const billingAccessControl: ColumnBillingAccessControl | undefined =
      new Form().getColumnBillingAccessControl("ipWhitelist");

    return billingAccessControl?.update || null;
  };

/*
 * Whether this project's plan lets it change a form's IP allowlist. Fails
 * open, like the dashboard's other plan notes: with billing off (every
 * self-hosted install) or a plan it cannot tell, it says yes, and the
 * server - which refuses the change below the plan anyway - has the last
 * word. A note that guessed wrong would put people off a setting they have.
 */
export const isFormIpAllowlistEditableOnCurrentPlan: () => boolean =
  (): boolean => {
    const requiredPlan: PlanType | null = getFormIpAllowlistPlan();
    const currentPlan: PlanType | null = ProjectUtil.getCurrentPlan();

    if (!requiredPlan || !currentPlan) {
      return true;
    }

    try {
      return SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
        requiredPlan,
        currentPlan,
        getAllEnvVars(),
      );
    } catch {
      // A plan the environment does not describe: not an answer either way.
      return true;
    }
  };
