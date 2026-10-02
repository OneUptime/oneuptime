import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const SloSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Service Level Objectives",
      items: [
        {
          link: {
            title: "SLOs",
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.SLOS] as Route),
          },
          icon: IconProp.Gauge,
        },
      ],
    },
    /*
     * Collapsed like every other product's Settings section. Written as a
     * `sections` entry rather than a hand-rolled <SideMenuSection> so the
     * menu works out which section holds the current page and reopens this
     * one on Owner Rules and Label Rules, instead of hiding the page you are
     * on.
     */
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLOS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLOS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
    /*
     * The way back to archived SLOs, which the list leaves out. Few
     * visits need it, so it waits in Advanced: folded away until opened,
     * and open by itself on the Archived page.
     */
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLOS_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: ServiceLevelObjective,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default SloSideMenu;
