import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const RumSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Real User Monitoring",
      items: [
        {
          link: {
            title: "All Applications",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATIONS] as Route,
            ),
          },
          icon: IconProp.List,
        },
      ],
    },
    /*
     * Starts collapsed, like the Settings section of every other product's
     * menu: the project-wide replay switch here is set once, not visited
     * every day. It was kept open for a while (settings-setup-5) because the
     * replay copy points at "Real User Monitoring > Settings > Session
     * Replay"; that path still reads true, since the folded section shows
     * its title, and it opens by itself on each of these pages.
     */
    {
      title: "Settings",
      items: [
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
        {
          link: {
            title: "Session Replay",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_SETTINGS_SESSION_REPLAY] as Route,
            ),
          },
          icon: IconProp.Film,
        },
      ],
    },
    /*
     * The way back to archived applications, which the list leaves out. Few
     * visits need it, so it waits in Advanced: folded away until opened, and
     * open by itself on the Archived page.
     */
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: RumApplication,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default RumSideMenu;
