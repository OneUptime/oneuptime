import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import { BILLING_ENABLED } from "Common/UI/Config";
import React, { ReactElement } from "react";

const DashboardSideMenu: () => JSX.Element = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Basic",
      items: [
        {
          link: {
            title: "Project",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS] as Route,
            ),
          },
          icon: IconProp.Folder,
        },
        {
          link: {
            title: "Labels",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_LABELS] as Route,
            ),
          },
          icon: IconProp.Label,
        },
      ],
    },
    {
      title: "Workspace Connections",
      items: [
        {
          link: {
            title: "Slack",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SLACK_INTEGRATION] as Route,
            ),
          },
          icon: IconProp.Slack,
        },
        {
          link: {
            title: "Microsoft Teams",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION] as Route,
            ),
          },
          icon: IconProp.MicrosoftTeams,
        },
      ],
    },
    {
      title: "Monitors",
      items: [
        {
          link: {
            title: "Monitor Status",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_MONITORS_STATUS] as Route,
            ),
          },
          icon: IconProp.AltGlobe,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_MONITOR_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
        {
          link: {
            title: "Secrets",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_MONITOR_SECRETS] as Route,
            ),
          },
          icon: IconProp.Lock,
        },
      ],
    },
    {
      title: "Status Pages",
      items: [
        {
          link: {
            title: "Announcement Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SETTINGS_STATUS_PAGE_ANNOUNCEMENT_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Template,
        },
        {
          link: {
            title: "Subscriber Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SETTINGS_STATUS_PAGE_SUBSCRIBER_NOTIFICATION_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Bell,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_STATUS_PAGE_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
    {
      title: "On-Call Policy",
      items: [
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SETTINGS_ON_CALL_DUTY_POLICY_CUSTOM_FIELDS
              ] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
    {
      title: "Incidents",
      items: [
        {
          link: {
            title: "Incident State",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INCIDENTS_STATE] as Route,
            ),
          },
          icon: IconProp.ArrowCircleRight,
        },
        {
          link: {
            title: "Incident Severity",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INCIDENTS_SEVERITY] as Route,
            ),
          },
          icon: IconProp.Alert,
        },
        {
          link: {
            title: "Incident Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INCIDENT_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.Template,
        },
        {
          link: {
            title: "Note Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.Pencil,
        },
        {
          link: {
            title: "Postmortem Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INCIDENT_POSTMORTEM_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.Book,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_INCIDENT_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
    {
      title: "Alerts",
      items: [
        {
          link: {
            title: "Alert State",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_ALERTS_STATE] as Route,
            ),
          },
          icon: IconProp.ArrowCircleRight,
        },
        {
          link: {
            title: "Alert Severity",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_ALERTS_SEVERITY] as Route,
            ),
          },
          icon: IconProp.Alert,
        },
        {
          link: {
            title: "Note Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_ALERT_NOTE_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.Pencil,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_ALERT_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
    {
      title: "Telemetry & APM",
      items: [
        {
          link: {
            title: "Ingestion Keys",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS] as Route,
            ),
          },
          icon: IconProp.Terminal,
        },
      ],
    },
    {
      title: "Scheduled Maintenance",
      items: [
        {
          link: {
            title: "Event State",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE] as Route,
            ),
          },
          icon: IconProp.Clock,
        },
        {
          link: {
            title: "Event Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SETTINGS_SCHEDULED_MAINTENANCE_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Template,
        },
        {
          link: {
            title: "Note Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Pencil,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.SETTINGS_SCHEDULED_MAINTENANCE_CUSTOM_FIELDS
              ] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
    {
      title: "Users and Teams",
      items: [
        {
          link: {
            title: "Users",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_USERS] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Teams",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TEAMS] as Route,
            ),
          },
          icon: IconProp.Team,
        },
      ],
    },
    {
      title: "Notifications",
      items: [
        {
          link: {
            title: "Notification Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route,
            ),
          },
          icon: IconProp.Settings,
        },
        {
          link: {
            title: "Notification Logs",
            to: RouteUtil.populateRouteParams(
              // Unified Notification Logs route renders tabs
              RouteMap[PageMap.SETTINGS_NOTIFICATION_LOGS] as Route,
            ),
          },
          icon: IconProp.Bell,
        },
      ],
    },
    {
      title: "AI",
      items: [
        {
          link: {
            title: "LLM Providers",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_LLM_PROVIDERS] as Route,
            ),
          },
          icon: IconProp.Brain,
        },
      ],
    },
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "Probes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_PROBES] as Route,
            ),
          },
          icon: IconProp.Signal,
        },
        {
          link: {
            title: "Domains",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_DOMAINS] as Route,
            ),
          },
          icon: IconProp.Globe,
        },
        {
          link: {
            title: "API Keys",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_APIKEYS] as Route,
            ),
          },
          icon: IconProp.Terminal,
        },
        {
          link: {
            title: "Feature Flags",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_FEATURE_FLAGS] as Route,
            ),
          },
          icon: IconProp.Flag,
        },
      ],
    },
    {
      title: "Authentication Security",
      items: [
        {
          link: {
            title: "SSO",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SSO] as Route,
            ),
          },
          icon: IconProp.Lock,
        },
        {
          link: {
            title: "SCIM",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SCIM] as Route,
            ),
          },
          icon: IconProp.Refresh,
        },
      ],
    },
    {
      title: "Danger Zone",
      items: [
        {
          link: {
            title: "Danger Zone",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_DANGERZONE] as Route,
            ),
          },
          icon: IconProp.Error,
          className: "danger-on-hover",
        },
      ],
    },
  ];

  // Conditionally add Billing section
  if (BILLING_ENABLED) {
    // Insert Billing section before Authentication Security (second to last)
    sections.splice(-2, 0, {
      title: "Billing and Invoices",
      items: [
        {
          link: {
            title: "Billing",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_BILLING] as Route,
            ),
          },
          icon: IconProp.Billing,
        },
        {
          link: {
            title: "Usage History",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_USAGE_HISTORY] as Route,
            ),
          },
          icon: IconProp.ChartBar,
        },
        {
          link: {
            title: "Invoices",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_BILLING_INVOICES] as Route,
            ),
          },
          icon: IconProp.TextFile,
        },
      ],
    });
  }

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
