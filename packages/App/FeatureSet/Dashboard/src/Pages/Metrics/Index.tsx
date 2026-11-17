import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import MetricsViewer from "../../Components/Metrics/MetricsViewer";
import TelemetryFirstRunShowcase from "../../Components/ProductOnboarding/TelemetryFirstRunShowcase";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const MetricsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ResellerPlanNotice project={props.currentProject} product="Metrics" />
    );
  }

  // The product page: an empty explorer offers the setup guide.
  return (
    <Fragment>
      {/*
       * Until the project's first telemetry, while the explorer is empty:
       * what the product does, and its setup guide.
       */}
      <TelemetryFirstRunShowcase product={ProductKey.Metrics}>
        <MetricsViewer offersSetupWhenEmpty={true} />
      </TelemetryFirstRunShowcase>
    </Fragment>
  );
};

export default MetricsPage;
