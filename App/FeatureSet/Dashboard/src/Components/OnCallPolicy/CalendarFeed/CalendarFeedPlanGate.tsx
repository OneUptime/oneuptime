import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Link from "Common/UI/Components/Link/Link";
import { BILLING_ENABLED, getAllEnvVars } from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The plan behind calendar feeds, mirrored from the server.
 *
 * All three feed models carry @TableBillingAccessControl(Growth) and the
 * public render path re-checks the project's plan imperatively (decision 1.3:
 * a below-plan project renders an EMPTY calendar, never a 404). Without a
 * client-side gate the page happily mints a link that will always be blank,
 * and the settings card answers a save with the server's bare
 * "upgrade your plan" 402 and no way to act on it.
 *
 * Fails OPEN, like AIPlanGate: billing disabled (every self-hosted install)
 * or an unknown plan both count as accessible. A gate that guessed wrong here
 * would hide the whole feature from people entitled to it.
 */
export const CALENDAR_FEED_PLAN: PlanType = PlanType.Growth;

export function isCalendarFeedAccessibleOnCurrentPlan(): boolean {
  if (!BILLING_ENABLED) {
    return true;
  }

  const currentPlan: PlanType | null = ProjectUtil.getCurrentPlan();

  if (!currentPlan) {
    return true;
  }

  try {
    return SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
      CALENDAR_FEED_PLAN,
      currentPlan,
      getAllEnvVars(),
    );
  } catch {
    /*
     * A plan name the env does not describe throws ("Invalid Plan"). That is a
     * misconfiguration, not an entitlement answer, and it must not white-screen
     * the page - so it counts as accessible and the server has the last word.
     */
    return true;
  }
}

export interface ComponentProps {
  /** Prefix for the data-testid, so two cards on one page stay distinct. */
  idPrefix?: string | undefined;
}

/*
 * Says the feature needs a higher plan, before the reader's first action
 * fails, and points at the one page where they can do something about it.
 * Renders nothing when the plan is sufficient (or unknown).
 */
const CalendarFeedPlanGate: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  if (isCalendarFeedAccessibleOnCurrentPlan()) {
    return <></>;
  }

  const idPrefix: string = props.idPrefix || "calendar-feed";

  const billingRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_BILLING] as Route,
  );

  return (
    <Alert
      type={AlertType.WARNING}
      dataTestId={`${idPrefix}-plan-gate`}
      strongTitle={
        translateString("Calendar feeds require the Growth plan") ||
        "Calendar feeds require the Growth plan"
      }
      title={
        <span>
          {translateString(
            "This project's plan does not include calendar feeds, so a link generated here would always show an empty calendar.",
          )}{" "}
          <Link to={billingRoute} className="underline">
            {translateString("Upgrade your plan in Billing settings")}
          </Link>
        </span>
      }
    />
  );
};

export default CalendarFeedPlanGate;
