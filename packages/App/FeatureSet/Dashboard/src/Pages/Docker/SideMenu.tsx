import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const DockerSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Docker",
      items: [
        {
          link: {
            title: "All Hosts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DOCKER_HOSTS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DOCKER_DOCUMENTATION] as Route,
            ),
          },
          icon: IconProp.Book,
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
              RouteMap[PageMap.DOCKER_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DOCKER_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
    /*
     * The way back to archived Docker hosts, which the list leaves out. Few
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
              RouteMap[PageMap.DOCKER_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: DockerHost,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default DockerSideMenu;
