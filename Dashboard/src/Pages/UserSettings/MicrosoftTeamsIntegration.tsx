import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MicrosoftTeamsIntegration from "../../Components/MicrosoftTeams/MicrosoftTeamsIntegration";
import WorkspaceModel from "Common/Models/DatabaseModels/Model";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";

const MicrosoftTeamsIntegrationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const integratedModels: Array<WorkspaceModel> = [];

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