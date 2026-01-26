import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import AlertsTable from "../../../Components/Alert/AlertsTable";

const EpisodeAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AlertsTable
      query={{
        alertEpisodeId: modelId,
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      title="Member Alerts"
      description="Alerts that are part of this episode."
      noItemsMessage="No alerts in this episode."
      saveFilterProps={{
        tableId: "episode-alerts-table",
      }}
    />
  );
};

export default EpisodeAlerts;
