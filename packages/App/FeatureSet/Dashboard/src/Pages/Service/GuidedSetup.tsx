import { TELEMETRY_SETUP_COPY } from "../../Components/GuidedSetup/Telemetry/TelemetrySetup";
import TelemetryGuidedSetup from "../../Components/GuidedSetup/Telemetry/TelemetryGuidedSetup";
import { getServiceBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * GUIDED SETUP: SEND LOGS, METRICS AND TRACES, THEN GET ALERTED ON THEM
 * (issue #6806), at /service/setup: from the setup guide to the first data
 * and recommended alerts on the service that sent it, on one page. Under
 * Services, where telemetry lands, as a page of its own with no side menu
 * (routed beside Services' layout), like /monitors/setup. Home's checklist
 * and Search lead here.
 */
const ServicesGuidedSetup: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Page
      title={TELEMETRY_SETUP_COPY.pageTitle}
      description={TELEMETRY_SETUP_COPY.pageDescription}
      breadcrumbLinks={getServiceBreadcrumbs(
        (
          props.pageRoute || (RouteMap[PageMap.SERVICES_GUIDED_SETUP] as Route)
        ).toString(),
      )}
    >
      <TelemetryGuidedSetup />
    </Page>
  );
};

export default ServicesGuidedSetup;
