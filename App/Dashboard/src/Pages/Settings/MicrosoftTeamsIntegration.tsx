import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MicrosoftTeamsIntegration from "../../Components/MicrosoftTeams/MicrosoftTeamsIntegration";

const MicrosoftTeamsIntegrationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <MicrosoftTeamsIntegration
      onConnected={() => {
        // Handle connected state if needed
      }}
      onDisconnected={() => {
        // Handle disconnected state if needed
      }}
    />
  );
};

export default MicrosoftTeamsIntegrationPage;
