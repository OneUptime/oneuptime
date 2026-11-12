import { STATUS_PAGE_SETUP_COPY } from "../../Components/GuidedSetup/StatusPage/StatusPageSetup";
import StatusPageGuidedSetup from "../../Components/GuidedSetup/StatusPage/StatusPageGuidedSetup";
import { getStatusPagesBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * GUIDED SETUP: PUBLISH A STATUS PAGE (issue #6806), at
 * /status-pages/setup: from a name and the monitors it shows to a public
 * page whose owner has seen what customers see, on one page. A page of its
 * own, with no side menu (it is routed beside Status Pages' layout, as
 * Create Announcement is), like the website-down setup at /monitors/setup.
 * Home's checklist and Search lead here.
 */
const StatusPagesGuidedSetup: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Page
      title={STATUS_PAGE_SETUP_COPY.setupTitle}
      description={STATUS_PAGE_SETUP_COPY.setupDescription}
      breadcrumbLinks={getStatusPagesBreadcrumbs(
        (
          props.pageRoute ||
          (RouteMap[PageMap.STATUS_PAGES_GUIDED_SETUP] as Route)
        ).toString(),
      )}
    >
      <StatusPageGuidedSetup />
    </Page>
  );
};

export default StatusPagesGuidedSetup;
