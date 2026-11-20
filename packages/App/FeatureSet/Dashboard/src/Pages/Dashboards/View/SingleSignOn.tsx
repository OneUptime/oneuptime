import PageComponentProps from "../../PageComponentProps";
import DashboardSignInOnlySettings from "../../../Components/Dashboard/SignIn/DashboardSignInOnlySettings";
import { DashboardSignInOnlyPage } from "../../../Components/Dashboard/SignIn/DashboardSignInOnlyCopy";
import { DASHBOARD_PRIVATE_ACCESS } from "../../../Components/PrivateAccess/PrivateAccessKinds";
import SingleSignOnProviders from "../../../Components/PrivateAccess/SingleSignOnProviders";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Dashboards -> a dashboard -> Public Link -> Single Sign-On (#10250): the
 * SAML and OIDC providers that sign people in to the dashboard's public
 * link when only people who sign in can view it, a tab per protocol, and
 * Require SSO to Sign In. The same page a form's sign-in has
 * (Components/PrivateAccess/SingleSignOnProviders); the values each
 * provider gives its identity provider are the dashboard's own
 * (PrivateAccessKinds).
 *
 * While the dashboard is shared another way the page says first that its
 * providers do nothing yet, with the way to Sharing, and folds them under
 * the notice (DashboardSignInOnlySettings).
 */
const DashboardSingleSignOn: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <DashboardSignInOnlySettings
      dashboardId={modelId}
      page={DashboardSignInOnlyPage.SingleSignOn}
    >
      <SingleSignOnProviders
        kind={DASHBOARD_PRIVATE_ACCESS}
        parentId={modelId}
      />
    </DashboardSignInOnlySettings>
  );
};

export default DashboardSingleSignOn;
