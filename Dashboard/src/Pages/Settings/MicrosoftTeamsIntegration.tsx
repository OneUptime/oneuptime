import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MicrosoftTeamsIntegration from "../../Components/MicrosoftTeams/MicrosoftTeamsIntegration";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import RouteUtil from "../../Utils/RouteUtil";

const MicrosoftTeamsIntegrationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <Page
      title="Microsoft Teams Integration"
      breadcrumbLinks={[
        {
          title: "Project Settings",
          to: RouteUtil.getRouteURL("/dashboard/project-settings"),
        },
        {
          title: "Microsoft Teams Integration",
          to: RouteUtil.getRouteURL("/dashboard/project-settings/microsoft-teams-integration"),
        },
      ]}
      sideMenu={<SideMenu />}
    >
      <MicrosoftTeamsIntegration
        onConnected={() => {
          // Handle connected state if needed
        }}
        onDisconnected={() => {
          // Handle disconnected state if needed
        }}
      />
    </Page>
  );
};

export default MicrosoftTeamsIntegrationPage;
