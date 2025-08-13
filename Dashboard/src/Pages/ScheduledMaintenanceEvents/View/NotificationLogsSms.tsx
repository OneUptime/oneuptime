import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import SmsLogsTable from "../../../Components/NotificationLogs/SmsLogsTable";

const ScheduledMaintenanceSmsLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <SmsLogsTable
      singularName="scheduled maintenance"
      query={{ scheduledMaintenanceId: modelId }}
    />
  );
};

export default ScheduledMaintenanceSmsLogs;
