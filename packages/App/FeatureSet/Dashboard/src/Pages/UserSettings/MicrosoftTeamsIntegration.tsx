import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MicrosoftTeamsIntegration from "../../Components/MicrosoftTeams/MicrosoftTeamsIntegration";
import { ConnectStartPage } from "Common/Types/Workspace/ConnectCallback";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <MicrosoftTeamsIntegration
      onConnected={() => {}}
      onDisconnected={() => {}}
      hideProjectCards={true}
      startPage={ConnectStartPage.UserSettings}
    />
  );
};

export default Settings;
