import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

const DockerSwarmClusterAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Docker Swarm Cluster Audit Logs"
      description="All changes made to this Docker Swarm cluster."
      resourceType="Docker Swarm Cluster"
      resourceId={modelId}
    />
  );
};

export default DockerSwarmClusterAuditLogs;
