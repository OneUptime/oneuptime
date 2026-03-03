import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MicrosoftTeamsIntegration from "../../Components/MicrosoftTeams/MicrosoftTeamsIntegration";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <MicrosoftTeamsIntegration
      onConnected={() => {}}
      onDisconnected={() => {}}
    />
  );
};

export default Settings;
