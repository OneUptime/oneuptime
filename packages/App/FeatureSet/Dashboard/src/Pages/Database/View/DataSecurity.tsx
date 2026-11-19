import PageComponentProps from "../../PageComponentProps";
import ResourceDataSecurityPage from "../../../Components/ResourceDataSecurity/ResourceDataSecurityPage";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One database's Data Security (#9547): its data store, as Data Security
 * reads it - the sensitive data it holds, how exposed it is - and the open
 * issues on it, the riskiest first (ResourceDataSecurityPage).
 */
const DatabaseServerDataSecurity: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceDataSecurityPage
      {...props}
      kind={DataStoreResourceKind.DatabaseServer}
    />
  );
};

export default DatabaseServerDataSecurity;
