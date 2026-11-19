import PageComponentProps from "../../PageComponentProps";
import ResourceDataSecurityPage from "../../../Components/ResourceDataSecurity/ResourceDataSecurityPage";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One Podman host's Data Security (#9547): the databases running on
 * it, as Data Security reads them - the sensitive data they hold, how
 * exposed they are - and the open issues on them, the riskiest first
 * (ResourceDataSecurityPage).
 */
const PodmanHostDataSecurity: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceDataSecurityPage
      {...props}
      kind={DataStoreResourceKind.PodmanHost}
    />
  );
};

export default PodmanHostDataSecurity;
