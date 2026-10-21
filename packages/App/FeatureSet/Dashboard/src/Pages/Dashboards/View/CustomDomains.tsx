import PageComponentProps from "../../PageComponentProps";
import { DASHBOARD_CUSTOM_DOMAINS } from "../../../Components/CustomDomain/CustomDomainKinds";
import CustomDomainsTable from "../../../Components/CustomDomain/CustomDomainsTable";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Dashboards -> a dashboard -> Branding -> Custom Domains: serve the
 * dashboard on your own domain. The same table as a status page's Custom
 * Domains page (CustomDomainsTable): add the domain on one page, add the
 * record from DNS Setup - Check now orders the free certificate the moment
 * the record is found - and there is no "Order Free SSL" button to find.
 */
const DashboardCustomDomains: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CustomDomainsTable
      kind={DASHBOARD_CUSTOM_DOMAINS}
      parentId={modelId}
      currentProject={props.currentProject}
    />
  );
};

export default DashboardCustomDomains;
