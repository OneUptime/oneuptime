import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { FunctionComponent, ReactElement } from "react";
import LlmCallsTable from "../../Components/AI/LlmCallsTable";

const LlmCallsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ResellerPlanNotice project={props.currentProject} product="AI / LLM" />
    );
  }

  return <LlmCallsTable />;
};

export default LlmCallsPage;
