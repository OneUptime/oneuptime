import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import EmailLogsTable from "../../../Components/NotificationLogs/EmailLogsTable";

const ScheduledMaintenanceEmailLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EmailLogsTable
      singularName="scheduled maintenance"
      query={{ scheduledMaintenanceId: modelId }}
    />
  );
};

export default ScheduledMaintenanceEmailLogs;
