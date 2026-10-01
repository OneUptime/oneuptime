import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import TeamModel from "Common/Models/DatabaseModels/Team";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const TeamsSideMenu: FunctionComponent = (): ReactElement => {
  const customFieldsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TEAM_CUSTOM_FIELDS] as Route,
  );

  // Auto-expand Settings when the user is on a page inside it; otherwise collapsed.
  const isOnSettingsPage: boolean = Navigation.isOnThisPage(customFieldsRoute);

  const sections: SideMenuSectionProps[] = [
    {
      title: "Teams",
      items: [
        {
          link: {
            title: "All Teams",
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.TEAMS] as Route),
          },
          icon: IconProp.Team,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: !isOnSettingsPage,
      items: [
        {
          link: {
            title: "Custom Fields",
            to: customFieldsRoute,
          },
          icon: IconProp.TableCells,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: TeamModel,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default TeamsSideMenu;
