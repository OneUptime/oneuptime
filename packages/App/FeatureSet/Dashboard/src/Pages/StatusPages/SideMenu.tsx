import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Status Pages",
      items: [
        {
          link: {
            title: "All Status Pages",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGES] as Route,
            ),
          },
          icon: IconProp.CheckCircle,
        },
      ],
    },
    {
      title: "More",
      items: [
        {
          link: {
            title: "Announcements",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route,
            ),
          },
          icon: IconProp.Announcement,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Announcement Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Announcement,
        },
        {
          link: {
            title: "Subscriber Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Email,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGES_SETTINGS_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGES_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGES_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
    /*
     * The way back to archived status pages, which the list leaves out. Few
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
              RouteMap[PageMap.STATUS_PAGES_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: StatusPage,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
