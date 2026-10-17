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

  // A role's own page keeps Roles marked: it is one of the roles listed there.
  const roleViewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TEAM_ROLE_VIEW] as Route,
  );
  const isOnRolePage: boolean = Navigation.isOnThisPage(roleViewRoute);

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
        /*
         * The project's custom roles, and the built-in ones: named sets of
         * permissions given to teams. A role's own page sits under it.
         */
        {
          link: {
            title: "Roles",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TEAM_ROLES] as Route,
            ),
          },
          activeRoute: isOnRolePage ? roleViewRoute : undefined,
          icon: IconProp.Identification,
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
