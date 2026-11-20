import PageComponentProps from "../../PageComponentProps";
import ResourceDataSecurityPage from "../../../Components/ResourceDataSecurity/ResourceDataSecurityPage";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One cloud resource's Data Security (#9547): the bucket, database or
 * warehouse it is, as Data Security reads it - the sensitive data it holds,
 * how exposed it is - and the open issues on it, the riskiest first
 * (ResourceDataSecurityPage).
 */
const CloudResourceDataSecurity: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceDataSecurityPage
      {...props}
      kind={DataStoreResourceKind.CloudResource}
    />
  );
};

export default CloudResourceDataSecurity;
