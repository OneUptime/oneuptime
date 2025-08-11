import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import EmailLogsTable from "../../../Components/NotificationLogs/EmailLogsTable";

const StatusPageEmailLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <EmailLogsTable singularName="status page" query={{ statusPageId: modelId }} />;
};

export default StatusPageEmailLogs;
