import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * The trail over every Status Pages page. Each page's last crumb is the name
 * its side menu gives it - Custom Domains, Advanced Settings, Subscriber
 * Templates - so the trail and the menu never call one page two things, and
 * every page the menus open has a trail (Embedded Status, Reports, SCIM and
 * the Slack and Microsoft Teams subscribers had none).
 * StatusPageBreadcrumbsMatchMenus (Common/Tests/App/Dashboard) holds both.
 */
export function getStatusPagesBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW, [
      "Project",
      "Status Pages",
      "View Status Page",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ANNOUNCEMENT_VIEW, [
      "Project",
      "Status Pages",
      "Announcements",
      "View Announcement",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ANNOUNCEMENT_VIEW_NOTIFICATION_LOGS,
      [
        "Project",
        "Status Pages",
        "Announcements",
        "View Announcement",
        "Notification Logs",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ANNOUNCEMENT_VIEW_DELETE, [
      "Project",
      "Status Pages",
      "Announcements",
      "View Announcement",
      "Delete Announcement",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_ANNOUNCEMENTS, [
      "Project",
      "Status Pages",
      "Announcements",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGES, [
      "Project",
      "Status Pages",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGES_ARCHIVED, [
      "Project",
      "Status Pages",
      "Archived",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Announcements",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_OWNERS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_RESOURCES, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Resources",
    ]),
    /* The groups route now redirects into Resources, which is where they live. */
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_GROUPS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Resources",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_MONITOR_RULES, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Monitor Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGE_VIEW_MONITOR_RULE_VIEW,
      [
        "Project",
        "Status Pages",
        "View Status Page",
        "Monitor Rules",
        "View Monitor Rule",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS,
      ["Project", "Status Pages", "View Status Page", "Email Subscribers"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "SMS Subscribers",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGE_VIEW_SLACK_SUBSCRIBERS,
      ["Project", "Status Pages", "View Status Page", "Slack Subscribers"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGE_VIEW_MICROSOFT_TEAMS_SUBSCRIBERS,
      [
        "Project",
        "Status Pages",
        "View Status Page",
        "Microsoft Teams Subscribers",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS,
      ["Project", "Status Pages", "View Status Page", "Webhook Subscribers"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS,
      ["Project", "Status Pages", "View Status Page", "Subscriber Settings"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_BRANDING, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Branding",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "HTML, CSS & JavaScript",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_DOMAINS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Custom Domains",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Private Users",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_SSO, [
      "Project",
      "Status Pages",
      "View Status Page",
      "SSO",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_OIDC, [
      "Project",
      "Status Pages",
      "View Status Page",
      "OIDC",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_SCIM, [
      "Project",
      "Status Pages",
      "View Status Page",
      "SCIM",
    ]),
    // "Access": who can see the page (the old Authentication Settings).
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS,
      ["Project", "Status Pages", "View Status Page", "Access"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_EMBEDDED, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Embedded Status",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_REPORTS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Reports",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_SETTINGS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Advanced Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_AUDIT_LOGS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_MCP, [
      "Project",
      "Status Pages",
      "View Status Page",
      "MCP",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGE_VIEW_NOTIFICATION_LOGS,
      ["Project", "Status Pages", "View Status Page", "Notification Logs"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_DELETE, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Delete Status Page",
    ]),

    // Status Pages Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES,
      ["Project", "Status Pages", "Settings", "Announcement Templates"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES_VIEW,
      [
        "Project",
        "Status Pages",
        "Settings",
        "Announcement Templates",
        "View Template",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES,
      ["Project", "Status Pages", "Settings", "Subscriber Templates"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES_VIEW,
      [
        "Project",
        "Status Pages",
        "Settings",
        "Subscriber Templates",
        "View Template",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGES_SETTINGS_CUSTOM_FIELDS,
      ["Project", "Status Pages", "Settings", "Custom Fields"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGES_SETTINGS_OWNER_RULES, [
      "Project",
      "Status Pages",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGES_SETTINGS_OWNER_RULE_VIEW,
      ["Project", "Status Pages", "Settings", "Owner Rules", "View Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGES_SETTINGS_LABEL_RULES, [
      "Project",
      "Status Pages",
      "Settings",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGES_SETTINGS_LABEL_RULE_VIEW,
      ["Project", "Status Pages", "Settings", "Label Rules", "View Rule"],
    ),
  };
  return breadcrumpLinksMap[path];
}
