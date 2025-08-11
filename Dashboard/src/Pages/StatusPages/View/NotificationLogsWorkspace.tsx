import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import WorkspaceLogsTable from "../../../Components/NotificationLogs/WorkspaceLogsTable";

const StatusPageWorkspaceLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <WorkspaceLogsTable
      singularName="status page"
      query={{ statusPageId: modelId }}
    />
  );
};

export default StatusPageWorkspaceLogs;
