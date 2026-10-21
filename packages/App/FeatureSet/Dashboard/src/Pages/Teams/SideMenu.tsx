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

/*
 * THE TEAMS MENU: the teams themselves, and - folded under Settings - what
 * they are set up with.
 *
 * Teams holds the one page people come here for, All Teams. Roles moved
 * from beside it into Settings (the maintainer: "Move the roles page to the
 * settings side menu"): naming sets of permissions is set up once and
 * revisited rarely, like a team's custom fields, so it waits in the folded
 * section rather than adding a row to every visit.
 */
const TeamsSideMenu: FunctionComponent = (): ReactElement => {
  const rolesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TEAM_ROLES] as Route,
  );

  const customFieldsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TEAM_CUSTOM_FIELDS] as Route,
  );

  // A role's own page keeps Roles marked: it is one of the roles listed there.
  const roleViewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TEAM_ROLE_VIEW] as Route,
  );
  const isOnRolePage: boolean = Navigation.isOnThisPage(roleViewRoute);

  /*
   * Settings starts folded on All Teams, and opens by itself on every page
   * inside it - Roles, a role's own page and Custom Fields - so the marked
   * entry is never hidden in a folded section.
   */
  const isOnSettingsPage: boolean =
    Navigation.isOnThisPage(rolesRoute) ||
    isOnRolePage ||
    Navigation.isOnThisPage(customFieldsRoute);

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
        /*
         * The project's custom roles, and the built-in ones: named sets of
         * permissions given to teams. A role's own page sits under it.
         *
         * First in Settings: it decides what teams can do, the setting most
         * people open this section for. Custom Fields, which only adds
         * fields to a team's details, comes after it.
         */
        {
          link: {
            title: "Roles",
            to: rolesRoute,
          },
          activeRoute: isOnRolePage ? roleViewRoute : undefined,
          icon: IconProp.Identification,
        },
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
