import PageComponentProps from "../../PageComponentProps";
import ResourceCompliancePage from "../../../Components/ResourceDataSecurity/ResourceCompliancePage";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One database's Compliance (#9555): how it stands against each framework
 * Data Security scores. A database running on a Kubernetes cluster or a
 * container host is scored with that cluster's or host's switches, and
 * says so (ResourceCompliancePage).
 */
const DatabaseServerCompliance: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceCompliancePage
      {...props}
      kind={DataStoreResourceKind.DatabaseServer}
    />
  );
};

export default DatabaseServerCompliance;
