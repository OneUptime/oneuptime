import DashboardSignInOnlyCopy, {
  DASHBOARD_SIGN_IN_ONLY_FOLD_TEST_ID,
  DASHBOARD_SIGN_IN_ONLY_NOTICE_TEST_ID,
  DashboardSignInOnlyPage,
  isDashboardSignInOnlyNoticeShown,
} from "./DashboardSignInOnlyCopy";
import useDashboardAccess from "./useDashboardAccess";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { DashboardAccess } from "Common/Types/Dashboard/DashboardAccess";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Navigation from "Common/UI/Utils/Navigation";
import { getPageAnchor } from "Common/UI/Utils/PageAnchor";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A page of settings that only Only people who sign in reads: a dashboard's
 * Private Users and Single Sign-On (DashboardSignInOnlyCopy says why).
 * While the dashboard is shared some other way, it opens on one notice that
 * says these settings do nothing yet, with the way to Sharing, and folds the
 * settings under it: they can still be set up first. A link that names a
 * place on the page opens the fold, so it never lands on a setting it hides.
 *
 * Once the dashboard asks its visitors to sign in, or until it is read, the
 * settings are drawn as they are.
 */
export interface ComponentProps {
  dashboardId: ObjectID;
  page: DashboardSignInOnlyPage;
  children: ReactElement;
}

const DashboardSignInOnlySettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const access: DashboardAccess | undefined = useDashboardAccess(
    props.dashboardId,
  );

  if (!isDashboardSignInOnlyNoticeShown(access)) {
    return props.children;
  }

  return (
    <Fragment>
      <Alert
        className="mb-5"
        type={AlertType.INFO}
        title={DashboardSignInOnlyCopy.notice}
        textOnRight={DashboardSignInOnlyCopy.noticeAction}
        dataTestId={DASHBOARD_SIGN_IN_ONLY_NOTICE_TEST_ID}
        onClick={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS] as Route,
              { modelId: props.dashboardId },
            ),
          );
        }}
      />

      <div data-testid={DASHBOARD_SIGN_IN_ONLY_FOLD_TEST_ID}>
        <CollapsibleSection
          title={DashboardSignInOnlyCopy.foldTitle}
          description={DashboardSignInOnlyCopy.foldDescription}
          collapsedDescription={DashboardSignInOnlyCopy.foldSummary[props.page]}
          defaultCollapsed={!getPageAnchor()}
        >
          <div>{props.children}</div>
        </CollapsibleSection>
      </div>
    </Fragment>
  );
};

export default DashboardSignInOnlySettings;
