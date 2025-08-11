import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import EmailLogsTable from "../../../Components/NotificationLogs/EmailLogsTable";

const AlertEmailLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <EmailLogsTable singularName="alert" query={{ alertId: modelId }} />;
};

export default AlertEmailLogs;
