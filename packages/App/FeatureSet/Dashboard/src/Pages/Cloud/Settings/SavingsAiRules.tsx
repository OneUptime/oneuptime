import PageComponentProps from "../../PageComponentProps";
import CloudSavingsAiRulesTable from "../../../Components/Cloud/Savings/CloudSavingsAiRulesTable";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Cloud > Settings > Savings AI Rules (#11010): what OneUptime AI does with
 * the savings it could make through a cloud connection - propose them to
 * the resource's owner, or make them without asking up to a monthly
 * limit - beside the Owner and Label Rules that say who owns a resource
 * and what it is.
 */
const CloudSavingsAiRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <CloudSavingsAiRulesTable />;
};

export default CloudSavingsAiRulesPage;
