import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Link from "Common/UI/Components/Link/Link";
import { BILLING_ENABLED, getAllEnvVars } from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Honest up-front signposting for the Growth-plan gate on AI features (AI
 * chat, AI agent tasks, code repositories). The server already enforces the
 * plan — this banner just tells the user before their first action fails,
 * instead of after. Renders nothing when billing is disabled (self-hosted),
 * when the plan is unknown (fail open), or when the plan is sufficient.
 */
const AIPlanGate: FunctionComponent = (): ReactElement => {
  if (!BILLING_ENABLED) {
    return <></>;
  }

  const currentPlan: PlanType | null = ProjectUtil.getCurrentPlan();

  if (!currentPlan) {
    return <></>;
  }

  const isAccessible: boolean =
    SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
      PlanType.Growth,
      currentPlan,
      getAllEnvVars(),
    );

  if (isAccessible) {
    return <></>;
  }

  const billingRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_BILLING] as Route,
  );

  return (
    <Alert
      type={AlertType.WARNING}
      strongTitle="Sentinel requires the Growth plan"
      className="mb-5"
      title={
        <span>
          This project is on the {currentPlan} plan, so AI requests will be
          declined.{" "}
          <Link to={billingRoute} className="underline">
            Upgrade your plan in Billing settings
          </Link>{" "}
          to use Sentinel chat, tasks, and code repositories.
        </span>
      }
    />
  );
};

export default AIPlanGate;
