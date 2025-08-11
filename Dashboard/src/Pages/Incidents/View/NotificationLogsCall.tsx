import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import CallLogsTable from "../../../Components/NotificationLogs/CallLogsTable";

const IncidentCallLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <CallLogsTable singularName="incident" query={{ incidentId: modelId }} />;
};

export default IncidentCallLogs;
