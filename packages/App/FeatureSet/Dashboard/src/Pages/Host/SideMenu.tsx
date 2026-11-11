import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import Host from "Common/Models/DatabaseModels/Host";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const HostSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Hosts",
      items: [
        {
          link: {
            title: "All Hosts",
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOSTS] as Route),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOST_DOCUMENTATION] as Route,
            ),
          },
          icon: IconProp.Book,
        },
      ],
    },
    /*
     * What OneUptime sends the hosts whose collector it manages: a section
     * of its own, apart from the hosts themselves. Set up once and revisited
     * rarely, so it folds like Settings (SECTION_TITLES_COLLAPSED_BY_DEFAULT),
     * and is open by itself on Collector Configs and on each config's page.
     */
    {
      title: "Configuration",
      items: [
        {
          link: {
            title: "Collector Configs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOST_COLLECTOR_CONFIGS] as Route,
            ),
          },
          icon: IconProp.Code,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOST_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOST_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
    /*
     * The way back to archived hosts, which the list leaves out. Few visits
     * need it, so it waits in Advanced: folded away until opened, and open by
     * itself on the Archived page.
     */
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOST_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: Host,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default HostSideMenu;
