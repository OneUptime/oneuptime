import PageComponentProps from "../../PageComponentProps";
import ResourceCompliancePage from "../../../Components/ResourceDataSecurity/ResourceCompliancePage";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One cloud resource's Compliance (#9555): how it stands against each
 * framework Data Security scores, and the switches that turn a framework,
 * or one of its requirements, off for this resource
 * (ResourceCompliancePage).
 */
const CloudResourceCompliance: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceCompliancePage
      {...props}
      kind={DataStoreResourceKind.CloudResource}
    />
  );
};

export default CloudResourceCompliance;
