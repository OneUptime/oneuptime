import StatusPagePrivateOnlyCopy, {
  isStatusPagePublicNoticeShown,
  STATUS_PAGE_PRIVATE_ONLY_FOLD_TEST_ID,
  STATUS_PAGE_PUBLIC_NOTICE_TEST_ID,
  StatusPagePrivateOnlyPage,
} from "./StatusPagePrivateOnlyCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { StatusPageAccess } from "Common/Types/StatusPage/StatusPageAccess";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Navigation from "Common/UI/Utils/Navigation";
import { getPageAnchor } from "Common/UI/Utils/PageAnchor";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A page of settings that only a private status page reads: Private Users,
 * Single Sign-On and SCIM (StatusPagePrivateOnlyCopy says why). While the
 * page is public it opens on one notice that says these settings do nothing
 * until the page is private, with the way to Access, and folds the settings
 * under it: they can still be set up first, so nobody is locked out when the
 * page goes private. A link that names a place on the page (#sign-in-links)
 * opens the fold, so it never lands on a setting it hides.
 *
 * On a private page, or until the page is read, the settings are drawn as
 * they are.
 */
export interface ComponentProps {
  statusPageId: ObjectID;
  // Who can see the page, once read (useStatusPageAccess).
  access: StatusPageAccess | undefined;
  page: StatusPagePrivateOnlyPage;
  children: ReactElement;
}

const StatusPagePrivateOnlySettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!isStatusPagePublicNoticeShown(props.access)) {
    return props.children;
  }

  return (
    <Fragment>
      <Alert
        className="mb-5"
        type={AlertType.WARNING}
        title={StatusPagePrivateOnlyCopy.publicNotice}
        textOnRight={StatusPagePrivateOnlyCopy.publicNoticeAction}
        dataTestId={STATUS_PAGE_PUBLIC_NOTICE_TEST_ID}
        onClick={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS
              ] as Route,
              { modelId: props.statusPageId },
            ),
          );
        }}
      />

      <div data-testid={STATUS_PAGE_PRIVATE_ONLY_FOLD_TEST_ID}>
        <CollapsibleSection
          title={StatusPagePrivateOnlyCopy.foldTitle}
          description={StatusPagePrivateOnlyCopy.foldDescription}
          collapsedDescription={
            StatusPagePrivateOnlyCopy.foldSummary[props.page]
          }
          defaultCollapsed={!getPageAnchor()}
        >
          <div>{props.children}</div>
        </CollapsibleSection>
      </div>
    </Fragment>
  );
};

export default StatusPagePrivateOnlySettings;
