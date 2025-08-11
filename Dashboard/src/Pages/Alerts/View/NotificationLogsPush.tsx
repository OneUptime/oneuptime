import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import PushLogsTable from "../../../Components/NotificationLogs/PushLogsTable";

const AlertPushLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <PushLogsTable singularName="alert" query={{ alertId: modelId }} />;
};

export default AlertPushLogs;
