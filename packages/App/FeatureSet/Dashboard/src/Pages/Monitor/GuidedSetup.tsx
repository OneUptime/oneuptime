import { WEBSITE_DOWN_COPY } from "../../Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import WebsiteDownGuidedSetup from "../../Components/GuidedSetup/WebsiteDown/WebsiteDownGuidedSetup";
import { getMonitorBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * GUIDED SETUP: KNOW WHEN MY WEBSITE OR API IS DOWN (issue #6804), at
 * /monitors/setup: from an address to a tested notification on one page.
 * A page of its own, with no side menu (Monitors' layout leaves pages it
 * does not list to draw their own frame), so nothing else on screen asks
 * for attention while the job is done. Home's checklist, the Monitors
 * list, Create Monitor and Search lead here.
 */
const MonitorGuidedSetup: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Page
      title={WEBSITE_DOWN_COPY.pageTitle}
      description={WEBSITE_DOWN_COPY.pageDescription}
      breadcrumbLinks={getMonitorBreadcrumbs(
        (
          props.pageRoute || (RouteMap[PageMap.MONITOR_GUIDED_SETUP] as Route)
        ).toString(),
      )}
    >
      <WebsiteDownGuidedSetup />
    </Page>
  );
};

export default MonitorGuidedSetup;
