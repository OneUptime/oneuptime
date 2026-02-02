import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import NotificationLogsTabs from "../../../Components/NotificationLogs/NotificationLogsTabs";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";

const MonitorNotificationLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <NotificationLogsTabs
      singularName="monitor"
      query={{ monitorId: modelId }}
    />
  );
};

export default MonitorNotificationLogs;
