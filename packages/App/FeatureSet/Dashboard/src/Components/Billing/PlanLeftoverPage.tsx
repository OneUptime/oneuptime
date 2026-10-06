import PlanLeftoverCopy, { PLAN_LEFTOVER_NOTE_TEST_ID } from "./PlanLeftoverCopy";
import { isKnownToBeBelowPlan } from "../../Enterprise/EnterpriseEligibility";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * A page OneUptime Cloud sells on a plan its lower plans used to see only as
 * a refusal - API keys and on-call schedules (Growth), Slack and Microsoft
 * Teams rules and summaries (Growth).
 *
 * For a project KNOWN to be below `requiredPlan` (billing on, its plan
 * loaded and short of it: isKnownToBeBelowPlan), the page is a short note -
 * what the plan includes, and where to upgrade - with what the project
 * still has under it (`leftovers`: PlanLeftoverTable), to switch off and
 * delete. Configuration a lower plan cannot use can still be seen, switched
 * off and removed (Common/Types/Billing/PlanGatedTable).
 *
 * Everyone else gets the page itself: a project on the plan, every
 * self-hosted install (billing off), and a project whose plan is not known
 * yet - the page then works as it did, and the server has the last word.
 * That differs from PlanGatedPage, which shows its upsell while the plan is
 * unknown: these pages were always reachable, and a guess must not hide
 * them from the people who pay for them.
 */

export interface ComponentProps {
  // The plan the page's feature is sold at.
  requiredPlan: PlanType;
  // Below the plan: what the project still has, under the note.
  leftovers: ReactNode;
  // The page, for everyone else.
  children: ReactNode;
}

const PlanLeftoverPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!isKnownToBeBelowPlan(props.requiredPlan)) {
    return <>{props.children}</>;
  }

  const billingRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_BILLING] as Route,
  );

  return (
    <>
      <Alert
        type={AlertType.WARNING}
        className="mb-5"
        dataTestId={PLAN_LEFTOVER_NOTE_TEST_ID}
        strongTitle={translator.translateTemplate(PlanLeftoverCopy.noteTitle, {
          planName: props.requiredPlan,
        })}
        title={
          <span>
            {translator.translateText(PlanLeftoverCopy.noteDescription)}{" "}
            <Link to={billingRoute} className="underline">
              {translator.translateText(PlanLeftoverCopy.upgradeLink)}
            </Link>
          </span>
        }
      />
      {props.leftovers}
    </>
  );
};

export default PlanLeftoverPage;
