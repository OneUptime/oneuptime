import PageComponentProps from "../../PageComponentProps";
import ResourceDataSecurityPage from "../../../Components/ResourceDataSecurity/ResourceDataSecurityPage";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One service's Data Security (#9547): its telemetry - the logs, traces,
 * exceptions, replays and AI conversations it sends - as Data Security
 * reads it, and the open issues on it, the riskiest first
 * (ResourceDataSecurityPage).
 */
const ServiceDataSecurity: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceDataSecurityPage {...props} kind={DataStoreResourceKind.Service} />
  );
};

export default ServiceDataSecurity;
