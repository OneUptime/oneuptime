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
        /*
         * Announcements are written most weeks, so they sit beside the
         * status pages they go out on, not in a section called "More" that
         * said nothing of what it held (#9126).
         */
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
    /*
     * Rules run by themselves once written, so they fold away under a
     * section of their own, as Incidents and Alerts file theirs. Their
     * addresses did not move (settings/owner-rules), so bookmarks keep
     * working.
     */
    {
      title: "Rules",
      defaultCollapsed: true,
      items: [
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
        /*
         * Who changed the rules above, what and when (#10462): most of them
         * have no page of their own to hold their history.
         */
        {
          link: {
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGES_SETTINGS_RULES_AUDIT_LOGS] as Route,
            ),
          },
          icon: IconProp.List,
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
