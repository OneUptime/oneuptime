import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

const IoTFleetAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="IoT Fleet Audit Logs"
      description="All changes made to this IoT fleet."
      resourceType="IoT Fleet"
      resourceId={modelId}
    />
  );
};

export default IoTFleetAuditLogs;
