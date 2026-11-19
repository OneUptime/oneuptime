import PageComponentProps from "../../PageComponentProps";
import ResourceCompliancePage from "../../../Components/ResourceDataSecurity/ResourceCompliancePage";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One service's Compliance (#9555): how its telemetry stands against each
 * framework Data Security scores, and the switches that turn a framework,
 * or one of its requirements, off for this service (ResourceCompliancePage).
 */
const ServiceCompliance: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceCompliancePage {...props} kind={DataStoreResourceKind.Service} />
  );
};

export default ServiceCompliance;
