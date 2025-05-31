import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MicrosoftTeamsIntegrationComponent from "../../Components/MicrosoftTeams/MicrosoftTeamsIntegration"; // Renamed import for clarity

const MicrosoftTeamsIntegrationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <div>
      <MicrosoftTeamsIntegrationComponent
        onConnected={() => { /* Placeholder for onConnected */ }}
        onDisconnected={() => { /* Placeholder for onDisconnected */ }}
      />
    </div>
  );
};

export default MicrosoftTeamsIntegrationPage;
