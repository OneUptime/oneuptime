import PageComponentProps from "../../PageComponentProps";
import ResourceDataSecurityPage from "../../../Components/ResourceDataSecurity/ResourceDataSecurityPage";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One cluster's Data Security (#9547): the databases running on it, as Data
 * Security reads them - the sensitive data each holds, how exposed it is -
 * and the open issues on them, the riskiest first
 * (ResourceDataSecurityPage).
 */
const KubernetesClusterDataSecurity: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceDataSecurityPage
      {...props}
      kind={DataStoreResourceKind.KubernetesCluster}
    />
  );
};

export default KubernetesClusterDataSecurity;
