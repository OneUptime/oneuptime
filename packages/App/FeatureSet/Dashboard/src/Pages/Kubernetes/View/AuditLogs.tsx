import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

const KubernetesClusterAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Kubernetes Cluster Audit Logs"
      description="All changes made to this Kubernetes cluster."
      resourceType="Kubernetes Cluster"
      resourceId={modelId}
    />
  );
};

export default KubernetesClusterAuditLogs;
