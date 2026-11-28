import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

/*
 * The XCP-ng product's menu: every pool, the connections a probe reads and
 * how to connect one, open; the owner and label rules (set up once) folded
 * under Settings; the archived pools folded under Advanced; and the
 * Developer pages.
 * Common/Tests/App/Dashboard/XcpNgSideMenus.test.tsx pins it.
 */
const XcpNgSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "XCP-ng",
      items: [
        {
          link: {
            title: "All Pools",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.XCP_NG_POOLS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        /*
         * The Xen Orchestras and pools a probe reads, with no agent to run
         * (#10996, #10999).
         */
        {
          link: {
            title: "Connections",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.XCP_NG_CONNECTIONS] as Route,
            ),
          },
          icon: IconProp.Link,
        },
        {
          link: {
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.XCP_NG_DOCUMENTATION] as Route,
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
              RouteMap[PageMap.XCP_NG_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.XCP_NG_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
        /*
         * Who changed the rules above, what and when (#10462): most of them
         * have no page of their own to hold their history.
         */
        {
          link: {
            title: "Rule Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.XCP_NG_SETTINGS_RULES_AUDIT_LOGS] as Route,
            ),
          },
          icon: IconProp.List,
        },
      ],
    },
    /*
     * The way back to archived XCP-ng pools, which the list leaves out. Few
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
              RouteMap[PageMap.XCP_NG_POOLS_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: XcpNgPool,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default XcpNgSideMenu;
