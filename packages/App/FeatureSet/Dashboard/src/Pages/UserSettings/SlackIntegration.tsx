import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import SlackIntegration from "../../Components/Slack/SlackIntegration";
import { ConnectStartPage } from "Common/Types/Workspace/ConnectCallback";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <SlackIntegration
      onConnected={() => {}}
      onDisconnected={() => {}}
      hideProjectCards={true}
      startPage={ConnectStartPage.UserSettings}
    />
  );
};

export default Settings;
