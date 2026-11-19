import PageComponentProps from "../../PageComponentProps";
import ResourceCompliancePage from "../../../Components/ResourceDataSecurity/ResourceCompliancePage";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One Podman host's Compliance (#9555): how the databases running on
 * it stand against each framework Data Security scores, and the
 * switches that turn a framework, or one of its requirements, off for
 * every database on this host (ResourceCompliancePage).
 */
const PodmanHostCompliance: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceCompliancePage
      {...props}
      kind={DataStoreResourceKind.PodmanHost}
    />
  );
};

export default PodmanHostCompliance;
