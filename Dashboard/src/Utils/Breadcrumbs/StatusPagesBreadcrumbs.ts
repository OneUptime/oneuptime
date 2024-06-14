import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getStatusPagesBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW, [
      "Project",
      "Status Pages",
      "View Status Page",
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
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_GROUPS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Resource Groups",
    ]),
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
      "Essential Branding",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Custom HTML, CSS & JavaScript",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_DOMAINS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Domains",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_HEADER_STYLE, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Header",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Footer",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGE_VIEW_OVERVIEW_PAGE_BRANDING,
      ["Project", "Status Pages", "View Status Page", "Overview Page Branding"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Navbar",
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
    ...BuildBreadcrumbLinksByTitles(
      PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS,
      [
        "Project",
        "Status Pages",
        "View Status Page",
        "Authentication Settings",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_SETTINGS, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.STATUS_PAGE_VIEW_DELETE, [
      "Project",
      "Status Pages",
      "View Status Page",
      "Delete Status Page",
    ]),
  };
  return breadcrumpLinksMap[path];
}
