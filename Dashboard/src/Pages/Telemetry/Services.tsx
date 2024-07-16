import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import SideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import Page from "CommonUI/src/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";
import TelemetryServiceTable from "../../Components/TelemetryService/TelemetryServiceTable";

const Services: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage error="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return (
    <Page
      title={"Telemetry"}
      breadcrumbLinks={[
        {
          title: "Project",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Telemetry",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.TELEMETRY] as Route,
          ),
        },
        {
          title: "Services",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.TELEMETRY_SERVICES] as Route,
          ),
        },
      ]}
      sideMenu={<SideMenu />}
    >
      <TelemetryServiceTable />
    </Page>
  );
};

export default Services;
