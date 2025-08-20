import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MicrosoftTeamsIntegration from "../../Components/MicrosoftTeams/MicrosoftTeamsIntegration";
import WorkspaceModel from "Common/Models/DatabaseModels/Model";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";

const MicrosoftTeamsIntegrationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const integratedModels: Array<WorkspaceModel> = [
    new Monitor(),
    new Alert(),
    new Incident(),
    new ScheduledMaintenance(),
    new OnCallDutyPolicy(),
  ];

  return (
    <div>
      <MicrosoftTeamsIntegration
        integratedModels={integratedModels}
        workspaceType={WorkspaceType.MicrosoftTeams}
      />
    </div>
  );
};

export default MicrosoftTeamsIntegrationPage;