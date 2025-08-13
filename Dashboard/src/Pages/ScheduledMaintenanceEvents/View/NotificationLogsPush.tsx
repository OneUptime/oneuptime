import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import PushLogsTable from "../../../Components/NotificationLogs/PushLogsTable";

const ScheduledMaintenancePushLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <PushLogsTable
      singularName="scheduled maintenance"
      query={{ scheduledMaintenanceId: modelId }}
    />
  );
};

export default ScheduledMaintenancePushLogs;
