import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ExceptionsViewer from "../../Components/Exceptions/ExceptionsViewer";
import TelemetryFirstRunShowcase from "../../Components/ProductOnboarding/TelemetryFirstRunShowcase";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const UnresolvedExceptionsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ResellerPlanNotice project={props.currentProject} product="Exceptions" />
    );
  }

  // A product page: a project with no exception yet is offered the setup guide.
  return (
    <Fragment>
      {/*
       * Until the project's first telemetry, while the explorer is empty:
       * what the product does, and its setup guide.
       */}
      <TelemetryFirstRunShowcase product={ProductKey.Exceptions}>
        <ExceptionsViewer
          defaultStatus="unresolved"
          offersSetupWhenEmpty={true}
        />
      </TelemetryFirstRunShowcase>
    </Fragment>
  );
};

export default UnresolvedExceptionsPage;
