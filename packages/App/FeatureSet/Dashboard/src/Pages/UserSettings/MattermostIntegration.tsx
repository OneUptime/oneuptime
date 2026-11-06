import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MattermostIntegration from "../../Components/Mattermost/MattermostIntegration";
import { ConnectStartPage } from "Common/Types/Workspace/ConnectCallback";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <MattermostIntegration
      onConnected={() => {}}
      onDisconnected={() => {}}
      hideProjectCards={true}
      startPage={ConnectStartPage.UserSettings}
    />
  );
};

export default Settings;
