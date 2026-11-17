import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { FunctionComponent, ReactElement } from "react";
import ExceptionsViewer from "../../Components/Exceptions/ExceptionsViewer";

const ResolvedExceptionsPage: FunctionComponent<PageComponentProps> = (
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
    <ExceptionsViewer defaultStatus="resolved" offersSetupWhenEmpty={true} />
  );
};

export default ResolvedExceptionsPage;
