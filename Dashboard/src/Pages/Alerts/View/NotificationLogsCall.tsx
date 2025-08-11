import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import CallLogsTable from "../../../Components/NotificationLogs/CallLogsTable";

const AlertCallLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CallLogsTable
      id="alert-call-logs-table"
      userPreferencesKey="alert-call-logs-table"
      showViewIdButton
      query={{ alertId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{ title: "Call Logs", description: "Calls made for this alert." }}
      noItemsMessage="No call logs for this alert."
    />
  );
};

export default AlertCallLogs;
