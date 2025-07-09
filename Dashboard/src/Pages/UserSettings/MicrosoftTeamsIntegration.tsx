import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MicrosoftTeamsIntegration from "../../Components/MicrosoftTeams/MicrosoftTeamsIntegration";

const MicrosoftTeamsSettings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <MicrosoftTeamsIntegration onConnected={() => {}} onDisconnected={() => {}} />
  );
};

export default MicrosoftTeamsSettings;
