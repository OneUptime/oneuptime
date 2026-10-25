import PageMap from "./PageMap";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * A security case's own side menu, as data.
 *
 * "When I open the case, can I have a side menu (on the similar lines that
 * we do for incidents / alerts / scheduled maintenance)" (the maintainer).
 * A case was one long page; it now has a page for each of its parts, under
 * an incident's sections, in an incident's order:
 *
 *   Overview        the case at a glance: what it is, where it stands, who
 *                   has it and since when, OneUptime AI's read and the
 *                   ATT&CK tactics its detections map to (Overview), and
 *                   everything that happened to it (Timeline), as an
 *                   incident has its State Timeline here
 *   Investigation   what it is made of and what was done about it: the
 *                   Detections that opened it or joined it, the Entities it
 *                   is about, its Connected Signals - those entities as the
 *                   rest of OneUptime knows them: the hosts, clusters,
 *                   services and users, their logs, traces and metrics
 *                   around the case, the incidents and alerts on them and
 *                   what changed - and the Playbooks that ran on it,
 *                   counted beside their entry while a run waits for an
 *                   approval
 *   Notes           what the team wrote (Private Notes, as an incident's
 *                   and an alert's are named: a case has no public side)
 *   Advanced        what most visits never need, folded: the case's Audit
 *                   Logs, and Delete Case
 *
 * Every page keeps the case's header on top - its number, priority, status
 * and title, and Assign to Me, Run Playbook, Declare Incident, Close Case
 * and the ⋯ - so a case can be worked from any of its pages.
 *
 * A case's address (cases/:id) stays its Overview, and its other pages sit
 * one level under it, as an incident's do: every link to a case - in an
 * email, a Slack message, a run, the queue - lands where it always did.
 *
 * Kept free of React so the menu - its sections, their order, the pages and
 * their names - is pinned in a plain test, and the routes, breadcrumbs and
 * docs that name the pages are held to it.
 */

/*
 * A live count beside an entry: what on this case is waiting for somebody
 * (SecurityCaseMenuBadgeCount.ts).
 */
export type SecurityCaseMenuBadge = "runsWaitingForApproval";

export interface SecurityCaseMenuItem {
  page: PageMap;
  title: string;
  icon: IconProp;
  badge?: SecurityCaseMenuBadge | undefined;
  // Drawn red on hover, as every record's Delete entry is.
  isDestructive?: boolean | undefined;
}

export interface SecurityCaseMenuSection {
  title: string;
  items: Array<SecurityCaseMenuItem>;
}

export const SECURITY_CASE_MENU: Array<SecurityCaseMenuSection> = [
  {
    title: "Overview",
    items: [
      {
        page: PageMap.SECURITY_CASE_VIEW,
        title: "Overview",
        icon: IconProp.Info,
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_TIMELINE,
        title: "Timeline",
        icon: IconProp.Timeline,
      },
    ],
  },
  {
    title: "Investigation",
    items: [
      {
        page: PageMap.SECURITY_CASE_VIEW_DETECTIONS,
        title: "Detections",
        icon: IconProp.Bolt,
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_ENTITIES,
        title: "Entities",
        icon: IconProp.Fingerprint,
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_CONNECTED_SIGNALS,
        title: "Connected Signals",
        icon: IconProp.Link,
      },
      {
        /*
         * "Playbooks": the playbooks that ran on the case, as Google SecOps
         * SOAR names a case's tab of them. "Playbook Runs" with its count
         * was cut short in German, French, Spanish, Italian and Portuguese
         * at every width, and in five more languages beside a tablet's
         * menu; Security Events > Playbooks > Playbook Runs keeps its name.
         */
        page: PageMap.SECURITY_CASE_VIEW_PLAYBOOK_RUNS,
        title: "Playbooks",
        icon: IconProp.Play,
        badge: "runsWaitingForApproval",
      },
    ],
  },
  {
    title: "Notes",
    items: [
      {
        page: PageMap.SECURITY_CASE_VIEW_NOTES,
        title: "Private Notes",
        icon: IconProp.Lock,
      },
    ],
  },
  {
    // Folded by its title, as every record's Advanced section is.
    title: "Advanced",
    items: [
      {
        page: PageMap.SECURITY_CASE_VIEW_AUDIT_LOGS,
        title: "Audit Logs",
        icon: IconProp.List,
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_DELETE,
        title: "Delete Case",
        icon: IconProp.Trash,
        isDestructive: true,
      },
    ],
  },
];

// Every page of a case, in menu order: its Overview first.
export function getSecurityCasePages(): Array<PageMap> {
  return SECURITY_CASE_MENU.flatMap(
    (section: SecurityCaseMenuSection): Array<PageMap> => {
      return section.items.map((item: SecurityCaseMenuItem): PageMap => {
        return item.page;
      });
    },
  );
}

// Whether a page is one of a case's own.
export function isSecurityCasePage(page: PageMap | undefined): boolean {
  return Boolean(page && getSecurityCasePages().includes(page));
}

// A case page's entry in the menu, if it has one.
export function getSecurityCaseMenuItemFor(
  page: PageMap | undefined,
): SecurityCaseMenuItem | undefined {
  if (!page) {
    return undefined;
  }

  for (const section of SECURITY_CASE_MENU) {
    for (const item of section.items) {
      if (item.page === page) {
        return item;
      }
    }
  }

  return undefined;
}

/*
 * Where a case page is, after Security Cases, as its breadcrumbs say it:
 * the case, then the page - "View Case", "Detections". The case's crumb is
 * named for the case once it is read (its number), as an incident's is.
 * The Overview is the case's own page, so it is not named twice.
 */
export const SECURITY_CASE_CRUMB: string = "View Case";

export function getSecurityCasePageTrail(
  page: PageMap,
): Array<string> | undefined {
  const item: SecurityCaseMenuItem | undefined =
    getSecurityCaseMenuItemFor(page);

  if (!item) {
    return undefined;
  }

  return page === PageMap.SECURITY_CASE_VIEW
    ? [SECURITY_CASE_CRUMB]
    : [SECURITY_CASE_CRUMB, item.title];
}
