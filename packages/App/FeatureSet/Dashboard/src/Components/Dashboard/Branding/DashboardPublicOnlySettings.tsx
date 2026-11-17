import DashboardPublicOnlyCopy, {
  DASHBOARD_PRIVATE_NOTICE_TEST_ID,
  DASHBOARD_PUBLIC_ONLY_FOLD_TEST_ID,
  DashboardPublicOnlyPage,
  isDashboardPrivateNoticeShown,
} from "./DashboardPublicOnlyCopy";
import useDashboardIsPublic from "./useDashboardIsPublic";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Navigation from "Common/UI/Utils/Navigation";
import { getPageAnchor } from "Common/UI/Utils/PageAnchor";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A page of settings that only a dashboard's public link reads: Branding
 * and Custom Domains (DashboardPublicOnlyCopy says why). While only people
 * in the project can view the dashboard, it opens on one notice that says
 * these settings do nothing until the dashboard is shared with a public
 * link, with the way to Sharing, and folds the settings under it: they can
 * still be set up first. A link that names a place on the page opens the
 * fold, so it never lands on a setting it hides.
 *
 * On a public dashboard, or until the dashboard is read, the settings are
 * drawn as they are.
 */
export interface ComponentProps {
  dashboardId: ObjectID;
  page: DashboardPublicOnlyPage;
  children: ReactElement;
}

const DashboardPublicOnlySettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isPublic: boolean | undefined = useDashboardIsPublic(props.dashboardId);

  if (!isDashboardPrivateNoticeShown(isPublic)) {
    return props.children;
  }

  return (
    <Fragment>
      <Alert
        className="mb-5"
        type={AlertType.INFO}
        title={DashboardPublicOnlyCopy.privateNotice}
        textOnRight={DashboardPublicOnlyCopy.privateNoticeAction}
        dataTestId={DASHBOARD_PRIVATE_NOTICE_TEST_ID}
        onClick={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS] as Route,
              { modelId: props.dashboardId },
            ),
          );
        }}
      />

      <div data-testid={DASHBOARD_PUBLIC_ONLY_FOLD_TEST_ID}>
        <CollapsibleSection
          title={DashboardPublicOnlyCopy.foldTitle}
          description={DashboardPublicOnlyCopy.foldDescription}
          collapsedDescription={DashboardPublicOnlyCopy.foldSummary[props.page]}
          defaultCollapsed={!getPageAnchor()}
        >
          <div>{props.children}</div>
        </CollapsibleSection>
      </div>
    </Fragment>
  );
};

export default DashboardPublicOnlySettings;
