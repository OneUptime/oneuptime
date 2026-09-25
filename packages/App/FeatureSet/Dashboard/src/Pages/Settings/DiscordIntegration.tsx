import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../PageComponentProps";
import DiscordIntegration from "../../Components/Discord/DiscordIntegration";

const DiscordIntegrationPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <DiscordIntegration
      key={props.currentProject?.id?.toString() || "no-project"}
    />
  );
};

export default DiscordIntegrationPage;
