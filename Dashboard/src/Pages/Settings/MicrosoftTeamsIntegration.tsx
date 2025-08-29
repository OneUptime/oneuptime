import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MicrosoftTeamsIntegration from "../../Components/MicrosoftTeams/MicrosoftTeamsIntegration";

const MicrosoftTeamsIntegrationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <div>
      <MicrosoftTeamsIntegration
        onConnected={() => {}}
        onDisconnected={() => {}}
      />
    </div>
  );
};

export default MicrosoftTeamsIntegrationPage;
