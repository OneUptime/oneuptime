import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
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
      <ResellerPlanNotice
        project={props.currentProject}
        product="Security Events"
      />
    );
  }

  return <SecurityAttackCampaigns />;
};

export default SecurityEventsCampaignsPage;
