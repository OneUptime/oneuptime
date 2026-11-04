import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MattermostIntegration from "../../Components/Mattermost/MattermostIntegration";

const MattermostIntegrationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <MattermostIntegration onConnected={() => {}} onDisconnected={() => {}} />
  );
};

export default MattermostIntegrationPage;
