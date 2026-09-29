import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import SlackIntegration from "../../Components/Slack/SlackIntegration";

const SlackIntegrationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <div>
      <SlackIntegration onConnected={() => {}} onDisconnected={() => {}} />
    </div>
  );
};

export default SlackIntegrationPage;
