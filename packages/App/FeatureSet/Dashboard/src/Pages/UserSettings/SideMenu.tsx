import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Navigation from "Common/UI/Utils/Navigation";
import React, { ReactElement } from "react";
import { useWorkspaceSideMenuSection } from "../../Components/Workspace/WorkspaceSideMenuSection";

const DashboardSideMenu: () => ReactElement = (): ReactElement => {
  let subItemMenuLink: Link | undefined = undefined;

  if (
    Navigation.isOnThisPage(
      RouteMap[PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE]!,
    )
  ) {
    subItemMenuLink = {
      title: "Timeline",
      to: Navigation.getCurrentRoute(),
    };
  }

  /*
   * Your own Slack and Microsoft Teams accounts are linked here, which only
   * means something once the project has connected that workspace. So the
   * Workspace section lists the connected ones, and is left out when the
   * project has none (WorkspaceSideMenuSection.ts).
   */
  const workspaceSection: SideMenuSectionProps | null =
    useWorkspaceSideMenuSection({
      slack: PageMap.USER_SETTINGS_SLACK_INTEGRATION,
      microsoftTeams: PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
    });

  /*
   * Get Started and Alerts & Notifications start open: the checklist that
   * walks through everything below, and the four pages people come here
   * for (how they are reached, how they are paged when on call, about what,
   * and how much email). Everything after them is set up once and folds down
   * to its title, an index of what else can be set, until it is opened or one
   * of its pages is the one open.
   */
  const sections: SideMenuSectionProps[] = [
    /*
     * First, because it is the page that explains the other twelve. Somebody
     * who lands here without knowing the difference between a notification
     * method, a notification rule and a notification setting reaches this
     * before any of the pages that assume they already know.
     */
    {
      title: "Get Started",
      items: [
        {
          link: {
            title: "Setup Checklist",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_SETUP] as Route,
            ),
          },
          icon: IconProp.ClipboardDocumentCheck,
        },
      ],
    },
    {
      title: "Alerts & Notifications",
      items: [
        {
          link: {
            title: "Notification Methods",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_METHODS] as Route,
            ),
          },
          icon: IconProp.Bell,
        },
        /*
         * Right after the methods, because a rule is which of those methods
         * to try, and after how long, when you are paged on call. One page
         * with a tab per kind (incidents, incident episodes, alerts, alert
         * episodes): it was four pages in two sections of their own, and
         * most people come here to change one delay.
         */
        {
          link: {
            title: "On-Call Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_ON_CALL_RULES] as Route,
            ),
          },
          icon: IconProp.BellRinging,
        },
        {
          link: {
            title: "Notification Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS] as Route,
            ),
          },
          icon: IconProp.Settings,
        },
        /*
         * Last, because it is the only one that answers "how much", and
         * that question follows "on what channel" and "about what". Inside
         * this section rather than in one of its own: the two controls it
         * holds are email-volume controls, and a reader who has just set up
         * their notifications is exactly the reader who needs to find them.
         */
        {
          link: {
            title: "Email Preferences",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_EMAIL_PREFERENCES] as Route,
            ),
          },
          icon: IconProp.Envelope,
        },
      ],
    },
    {
      title: "On-Call Logs",
      items: [
        {
          link: {
            title: "On-Call Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_ON_CALL_LOGS] as Route,
            ),
          },
          icon: IconProp.Logs,
          subItemIcon: IconProp.Clock,
          subItemLink: subItemMenuLink,
        },
      ],
    },
    {
      title: "Incoming Call Policy",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Incoming Phone Numbers",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS
              ] as Route,
            ),
          },
          icon: IconProp.Call,
        },
      ],
    },
    /*
     * Before Workspace: the calendar link is something everybody on a rota
     * wants, while the workspace links only matter in projects that use them.
     */
    {
      title: "Calendar",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Calendar Feed",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route,
            ),
          },
          icon: IconProp.Calendar,
        },
      ],
    },
    {
      title: "Profile",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
    /*
     * Last: it is there only in projects with a workspace connected, and at
     * the bottom it can come and go (on a first visit, before the answer is
     * in) without moving any section above it.
     */
    ...(workspaceSection ? [workspaceSection] : []),
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
