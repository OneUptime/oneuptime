import PageComponentProps from "../../PageComponentProps";
import DashboardSignInOnlySettings from "../../../Components/Dashboard/SignIn/DashboardSignInOnlySettings";
import { DashboardSignInOnlyPage } from "../../../Components/Dashboard/SignIn/DashboardSignInOnlyCopy";
import PrivateUsersTable from "../../../Components/PrivateAccess/PrivateUsersTable";
import { DASHBOARD_PRIVATE_ACCESS } from "../../../Components/PrivateAccess/PrivateAccessKinds";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Dashboards -> a dashboard -> Public Link -> Private Users (#10250): the
 * people who may sign in to the dashboard's public link when only people
 * who sign in can view it. Each is added by their email address and
 * emailed an invitation that sets their first password; Remove ends every
 * session they hold. The same list a form's sign-in has
 * (Components/PrivateAccess/PrivateUsersTable).
 *
 * While the dashboard is shared another way the page says first that the
 * list does nothing yet, with the way to Sharing, and folds it under the
 * notice (DashboardSignInOnlySettings).
 */
const DashboardPrivateUsers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <DashboardSignInOnlySettings
      dashboardId={modelId}
      page={DashboardSignInOnlyPage.PrivateUsers}
    >
      <PrivateUsersTable kind={DASHBOARD_PRIVATE_ACCESS} parentId={modelId} />
    </DashboardSignInOnlySettings>
  );
};

export default DashboardPrivateUsers;
