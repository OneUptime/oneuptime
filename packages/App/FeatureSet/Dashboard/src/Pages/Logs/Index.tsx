import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DashboardLogsViewer from "../../Components/Logs/LogsViewer";
import { EXPLORER_SAVED_VIEW_SCOPE } from "Common/Utils/Telemetry/SavedViewScope";
import TelemetryFirstRunShowcase from "../../Components/ProductOnboarding/TelemetryFirstRunShowcase";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const LogsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return <ResellerPlanNotice project={props.currentProject} product="Logs" />;
  }

  return (
    <Fragment>
      {/*
       * Until the project's first telemetry, while the explorer is empty:
       * what the product does, and its setup guide.
       */}
      <TelemetryFirstRunShowcase product={ProductKey.Logs}>
        <DashboardLogsViewer
          showFilters={true}
          serviceIds={[]}
          limit={100}
          enableRealtime={true}
          id="logs"
          // The Logs page's own saved views, none saved on a resource's Logs tab.
          savedViewScope={EXPLORER_SAVED_VIEW_SCOPE}
          syncUrlState={true}
          // The product page: an empty explorer offers the setup guide.
          offersSetupWhenEmpty={true}
          // ...and a monitor watching what it shows.
          offersCreateMonitor={true}
        />
      </TelemetryFirstRunShowcase>
    </Fragment>
  );
};

export default LogsPage;
