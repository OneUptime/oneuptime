import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import SlackIntegration from "../../Components/Slack/SlackIntegration";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return <SlackIntegration onConnected={() => {}} onDisconnected={() => {}} />;
};

export default Settings;
