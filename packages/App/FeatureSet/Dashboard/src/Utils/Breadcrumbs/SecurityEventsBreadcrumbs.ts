import PageMap from "../PageMap";
import {
  SecurityEventsMenuItem,
  getSecurityEventsMenuItems,
  getSecurityEventsPageTrail,
} from "../SecurityEventsNavigation";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * Each Security Events page's trail names it as the side menu does: the
 * product, the page's section, and the page - Project > Security Events >
 * Security Cases > Assigned to Me. A page named like its section (Overview,
 * Events, Playbooks, Connections) is not named twice. The trails are read
 * from the menu (SecurityEventsNavigation.ts), so a page renamed or moved
 * there is named the same here.
 */
export function getSecurityEventsBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {};

  for (const item of getSecurityEventsMenuItems()) {
    Object.assign(
      breadcrumpLinksMap,
      BuildBreadcrumbLinksByTitles(item.page, [
        "Project",
        ...(getSecurityEventsPageTrail(item.page) as Array<string>),
      ]),
    );
  }

  // A case and a playbook, under the section their lists are in.
  Object.assign(
    breadcrumpLinksMap,
    BuildBreadcrumbLinksByTitles(PageMap.SECURITY_CASE_VIEW, [
      "Project",
      "Security Events",
      "Security Cases",
      "View Case",
    ]),
    BuildBreadcrumbLinksByTitles(PageMap.SECURITY_PLAYBOOK_VIEW, [
      "Project",
      "Security Events",
      "Playbooks",
      "View Playbook",
    ]),
  );

  return breadcrumpLinksMap[path];
}

// The pages with a trail of their own: every menu page, a case and a playbook.
export function getSecurityEventsBreadcrumbPages(): Array<PageMap> {
  return [
    ...getSecurityEventsMenuItems().map(
      (item: SecurityEventsMenuItem): PageMap => {
        return item.page;
      },
    ),
    PageMap.SECURITY_CASE_VIEW,
    PageMap.SECURITY_PLAYBOOK_VIEW,
  ];
}
