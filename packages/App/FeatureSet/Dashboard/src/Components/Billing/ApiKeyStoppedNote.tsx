import PlanLeftoverCopy, {
  API_KEY_STOPPED_NOTE_TEST_ID,
} from "./PlanLeftoverCopy";
import { API_KEY_REQUIRED_PLAN } from "./PlanCutoff";
import { isKnownToBeBelowPlan } from "../../Enterprise/EnterpriseEligibility";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * At the top of an API key's own page, for a project KNOWN to be below the
 * plan API keys need (isKnownToBeBelowPlan: billing on, the plan loaded and
 * short of it): this key stopped working - every request made with it is
 * refused (Common/Types/Billing/PlanCutoffCredentials) - an upgrade turns it
 * back on as it is, and it can still be deleted. Nothing for a project on
 * the plan, every self-hosted install, or while the plan loads.
 */
const ApiKeyStoppedNote: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  if (!isKnownToBeBelowPlan(API_KEY_REQUIRED_PLAN)) {
    return <></>;
  }

  const billingRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_BILLING] as Route,
  );

  return (
    <Alert
      type={AlertType.WARNING}
      className="mb-5"
      dataTestId={API_KEY_STOPPED_NOTE_TEST_ID}
      strongTitle={PlanLeftoverCopy.apiKeyStoppedTitle}
      title={
        <span>
          {translator.translateTemplate(
            PlanLeftoverCopy.apiKeyStoppedDescription,
            { planName: API_KEY_REQUIRED_PLAN },
          )}{" "}
          <Link to={billingRoute} className="underline">
            {translator.translateText(PlanLeftoverCopy.upgradeLink)}
          </Link>
        </span>
      }
    />
  );
};

export default ApiKeyStoppedNote;
