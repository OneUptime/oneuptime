import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import ProjectUtil from "Common/UI/Utils/Project";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const project: Project | null = ProjectUtil.getCurrentProject();

  return (
    <SideMenu>
      {/*
       * "Overview", as an incident's, an alert's, a maintenance event's and
       * a monitor's menus open (it said "Basic" until #9130).
       */}
      <SideMenuSection title="Overview">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />

        <SideMenuItem
          link={{
            title: "Announcements",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Announcement}
        />
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>

      {/*
       * Groups used to have a page of their own beside the resources one; the
       * hierarchy and the monitors inside it are now the same screen, so
       * splitting them in the menu would be sending people to two halves of
       * something that no longer has halves.
       */}
      <SideMenuSection title="Resources">
        <SideMenuItem
          link={{
            title: project?.isFeatureFlagMonitorGroupsEnabled
              ? "Resources"
              : "Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_RESOURCES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.AltGlobe}
        />
      </SideMenuSection>

      {/*
       * What the page shows (Overview, Resources) is what this menu is opened
       * for, so those two start open. Every section after them folds down to
       * its title until opened, and opens by itself on its own pages:
       *
       *  - Rules: the monitor rules that fill the page. A rule is written
       *    once and then runs by itself, putting every monitor that matches
       *    into its group as monitors are created or relabelled, and the Add
       *    Monitors dialog writes one when a group is filled from a label
       *    (#3418). So it is set up rather than visited, and has a section of
       *    its own, as an SLO's rules do, right below the resources it
       *    writes: not three sections down under Advanced, where the person
       *    who filed #3418 never found it.
       *  - Subscribers sign themselves up and are managed now and then.
       *  - Branding, security and AI are set up once or checked when
       *    something needs checking, as the notification logs under
       *    Subscribers are.
       *
       * Subscribers says so itself; the others fold by their titles (see
       * SideMenuSectionState.ts).
       */}
      <SideMenuSection title="Rules">
        <SideMenuItem
          link={{
            title: "Monitor Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_MONITOR_RULES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Filter}
        />
      </SideMenuSection>

      {/*
       * Subscribers are one page with a tab per channel (Email, SMS, Slack,
       * Microsoft Teams, Webhook): one kind of record is one page
       * (Docs/ux/README.md#side-menus). They were five entries, a page each,
       * until #9125, and their old addresses forward to the tabs. The
       * notifications sent to them are logged beside them, not in a
       * section of their own.
       */}
      <SideMenuSection title="Subscribers" defaultCollapsed={true}>
        <SideMenuItem
          link={{
            title: "Subscribers",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.UserGroup}
        />

        <SideMenuItem
          link={{
            title: "Subscriber Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />

        <SideMenuItem
          link={{
            title: "Notification Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_NOTIFICATION_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Bell}
        />
      </SideMenuSection>

      {/*
       * Three entries, as on a dashboard's menu: the one Branding page (the
       * logo, title, favicon, links, footer, colors and languages, which
       * were five screens), the page's own domain, and the custom code that
       * goes past what the Branding page offers.
       */}
      <SideMenuSection title="Branding">
        <SideMenuItem
          link={{
            title: "Branding",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_BRANDING] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Image}
        />

        <SideMenuItem
          link={{
            title: "Custom Domains",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Globe}
        />

        <SideMenuItem
          link={{
            title: "HTML, CSS & JavaScript",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Code}
        />
      </SideMenuSection>

      {/*
       * Access first: who can see the page is one choice there (anyone with
       * the link, only people who sign in, anyone with the password). The
       * entries after it set up the sign-in that the second choice uses. It
       * is the old "Authentication Settings" page, at the same address.
       * Private Users, Single Sign-On and SCIM do nothing while the page is
       * public, and each of their pages says so then
       * (Components/StatusPage/StatusPagePrivateOnlySettings).
       */}
      <SideMenuSection title="Security">
        <SideMenuItem
          link={{
            title: "Access",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Eye}
        />

        <SideMenuItem
          link={{
            title: "Private Users",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.User}
        />

        {/*
         * One page for the page's sign-on providers, a tab per protocol
         * (SAML, OIDC): they were two entries, "SSO" and "OIDC", with the
         * same icon, until #9130. The old OIDC address opens its tab.
         */}
        <SideMenuItem
          link={{
            title: "Single Sign-On",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_SSO] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Lock}
        />

        <SideMenuItem
          link={{
            title: "SCIM",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_SCIM] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Refresh}
        />
      </SideMenuSection>

      <SideMenuSection title="AI">
        <SideMenuItem
          link={{
            title: "MCP",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_MCP] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Terminal}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: StatusPage,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Embedded Status",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_EMBEDDED] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Circle}
        />

        <SideMenuItem
          link={{
            title: "Reports",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_REPORTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.TextFile}
        />

        <SideMenuItem
          link={{
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.TableCells}
        />

        {/* Settings, as other records' menus say (it was Advanced Settings until #9130). */}
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />

        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />

        <SideMenuItem
          link={{
            title: "Delete Status Page",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
