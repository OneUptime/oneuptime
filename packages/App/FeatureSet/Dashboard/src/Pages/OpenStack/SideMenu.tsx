import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const OpenStackSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "OpenStack",
      items: [
        {
          link: {
            title: "All Clouds",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_CLOUDS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_DOCUMENTATION] as Route,
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
              RouteMap[PageMap.OPENSTACK_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.OPENSTACK_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
    /*
     * The way back to archived OpenStack clouds, which the list leaves out. Few
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
              RouteMap[PageMap.OPENSTACK_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: OpenStackCloud,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default OpenStackSideMenu;
