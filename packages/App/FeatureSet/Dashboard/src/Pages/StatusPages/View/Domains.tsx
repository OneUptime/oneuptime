import PageComponentProps from "../../PageComponentProps";
import { STATUS_PAGE_CUSTOM_DOMAINS } from "../../../Components/CustomDomain/CustomDomainKinds";
import CustomDomainsTable from "../../../Components/CustomDomain/CustomDomainsTable";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Status Pages -> a page -> Branding -> Custom Domains: put the status page
 * on your own domain. The same table as a dashboard's Custom Domains page
 * (CustomDomainsTable): add the domain on one page, add the record from DNS
 * Setup, and the free certificate is issued without a button.
 */
const StatusPageDomains: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CustomDomainsTable
      kind={STATUS_PAGE_CUSTOM_DOMAINS}
      parentId={modelId}
      currentProject={props.currentProject}
    />
  );
};

export default StatusPageDomains;
