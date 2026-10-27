import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";
import SecurityAttackCampaigns from "../../Components/SecurityEvents/SecurityAttackCampaigns";

/*
 * Who is attacking the project: every address that sent attack requests,
 * as one row, with whether any of them got through
 * (Components/SecurityEvents/SecurityAttackCampaigns).
 */
const SecurityEventsCampaignsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return <SecurityAttackCampaigns />;
};

export default SecurityEventsCampaignsPage;
