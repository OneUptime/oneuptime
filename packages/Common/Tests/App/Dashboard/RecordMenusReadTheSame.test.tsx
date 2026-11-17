import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import React, { ReactElement } from "react";
import AlertSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/SideMenu";
import AlertEpisodeSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/SideMenu";
import IncidentSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/SideMenu";
import IncidentEpisodeSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/SideMenu";
import ScheduledMaintenanceSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/SideMenu";
import SecurityCaseSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  renderMenu,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";
import { refuseRequestsTo } from "../../Helpers/RealNetworkRequests";

/*
 * Reads the page makes that these tests leave unanswered: refused at
 * once, as the network refused them, and taken as reads it could not
 * make (Tests/Helpers/RealNetworkRequests.ts).
 */
refuseRequestsTo(["/security-case-task/count", "/security-playbook-run/count"]);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * An incident, an alert, their two kinds of episode and a scheduled
 * maintenance event each have a page of their own with a side menu. The
 * alert's, the alert episode's and the event's used to be laid out their own
 * way - "Basic", "On Call", "Logs", "Alert Notes", "Ownership", "Timeline",
 * "Episode Notes" - so the same page (Owners, State Timeline, the
 * notification logs, the notes) sat in a different place on each, under a
 * different heading. They now have an incident's sections, where they have
 * pages for them, in an incident's order, folded as an incident's are.
 *
 * Since #9216 a menu has no section for a single entry whose heading only
 * repeats it: an episode's members sit in its Overview, and where a record
 * has only Owners for a Team, or only Private Notes for its Notes, that one
 * page sits in the neighbouring section instead (each record's movedPages).
 */

const MODEL_ID: ObjectID = new ObjectID("0193c0de-4444-4aaa-8bbb-000000000004");

// An incident's sections, in its order: the shape every record menu takes.
const INCIDENT_SECTION_ORDER: ReadonlyArray<string> = [
  "Overview",
  "Investigation",
  "Team",
  "Notifications",
  "Notes",
  "Developer",
  "Advanced",
];

// The sections that start open on a record's Overview page.
const OPEN_SECTIONS: ReadonlyArray<string> = [
  "Overview",
  "Investigation",
  "Team",
  "Notes",
];

interface RecordMenu {
  name: string;
  menu: ReactElement;
  overviewPage: PageMap;
  sections: Array<string>;
  /*
   * Pages this record keeps somewhere other than PAGE_SECTIONS says, because
   * it has no section of that name: the section each one is in instead.
   */
  movedPages?: Readonly<Record<string, string>>;
}

const RECORD_MENUS: ReadonlyArray<RecordMenu> = [
  {
    name: "incident",
    menu: <IncidentSideMenu modelId={MODEL_ID} />,
    overviewPage: PageMap.INCIDENT_VIEW,
    sections: [
      "Overview",
      "Investigation",
      "Team",
      "Notifications",
      "Notes",
      "Developer",
      "Advanced",
    ],
  },
  {
    name: "alert",
    menu: <AlertSideMenu modelId={MODEL_ID} />,
    overviewPage: PageMap.ALERT_VIEW,
    // Private Notes was a Notes section of its own (#9216).
    sections: [
      "Overview",
      "Investigation",
      "Team",
      "Notifications",
      "Developer",
      "Advanced",
    ],
    movedPages: { "Private Notes": "Investigation" },
  },
  {
    name: "incident episode",
    menu: <IncidentEpisodeSideMenu modelId={MODEL_ID} />,
    overviewPage: PageMap.INCIDENT_EPISODE_VIEW,
    // Member Incidents was an Incidents section of its own (#9216).
    sections: [
      "Overview",
      "Investigation",
      "Team",
      "Notes",
      "Developer",
      "Advanced",
    ],
  },
  {
    name: "alert episode",
    menu: <AlertEpisodeSideMenu modelId={MODEL_ID} />,
    overviewPage: PageMap.ALERT_EPISODE_VIEW,
    /*
     * Member Alerts, Owners and Private Notes were each a section of their
     * own - Alerts, Team and Notes (#9216).
     */
    sections: ["Overview", "Investigation", "Developer", "Advanced"],
    movedPages: { Owners: "Overview", "Private Notes": "Investigation" },
  },
  {
    name: "scheduled maintenance event",
    menu: <ScheduledMaintenanceSideMenu modelId={MODEL_ID} />,
    overviewPage: PageMap.SCHEDULED_MAINTENANCE_VIEW,
    /*
     * An event is planned, not investigated: no Investigation section, so its
     * Description and Runbooks are under Overview. Its Owners were a Team
     * section of their own until #9216.
     */
    sections: ["Overview", "Notifications", "Notes", "Developer", "Advanced"],
    movedPages: {
      Description: "Overview",
      Runbooks: "Overview",
      Owners: "Overview",
    },
  },
  {
    /*
     * A security case: its assignee and team are in its header, it notifies
     * through its timeline, and it is opened by detections rather than set
     * up as code - so no Team, Notifications or Developer section.
     */
    name: "security case",
    menu: <SecurityCaseSideMenu modelId={MODEL_ID} />,
    overviewPage: PageMap.SECURITY_CASE_VIEW,
    sections: ["Overview", "Investigation", "Notes", "Advanced"],
  },
];

/*
 * Where each page sits, on every record that has it, unless the record lists
 * it in its movedPages.
 */
const PAGE_SECTIONS: Readonly<Record<string, string>> = {
  Overview: "Overview",
  "State Timeline": "Overview",
  // A security case's timeline: everything that happened to it.
  Timeline: "Overview",
  SLA: "Overview",
  Description: "Investigation",
  "Root Cause": "Investigation",
  Remediation: "Investigation",
  "Remediation Notes": "Investigation",
  Runbooks: "Investigation",
  Postmortem: "Investigation",
  "Linked Alerts": "Investigation",
  "Linked Incidents": "Investigation",
  // A security case's story: what happened, in order, across OneUptime.
  Story: "Investigation",
  // What a security case is made of, and what was done about it.
  Detections: "Investigation",
  Entities: "Investigation",
  // What those entities are in the rest of OneUptime.
  "Connected Signals": "Investigation",
  // What is kept on a security case, and what is left to do on it.
  Evidence: "Investigation",
  Tasks: "Investigation",
  Playbooks: "Investigation",
  Roles: "Team",
  "On-Call Executions": "Team",
  Owners: "Team",
  // An episode's own members, next to its overview (#9216).
  "Member Incidents": "Overview",
  "Member Alerts": "Overview",
  "Notification Logs": "Notifications",
  "AI Logs": "Notifications",
  "Private Notes": "Notes",
  "Public Notes": "Notes",
  "Custom Fields": "Advanced",
  Settings: "Advanced",
  "Audit Logs": "Advanced",
  "Delete Incident": "Advanced",
  "Delete Alert": "Advanced",
  "Delete Episode": "Advanced",
  "Delete Maintenance Event": "Advanced",
  "Delete Case": "Advanced",
};

function pageRoute(page: PageMap): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: MODEL_ID,
  }).toString();
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("every record's side menu has an incident's sections", () => {
  test.each(
    RECORD_MENUS.map((record: RecordMenu): [string, RecordMenu] => {
      return [record.name, record];
    }),
  )(
    "the %s menu has its sections in an incident's order",
    async (_name: string, record: RecordMenu) => {
      goTo(pageRoute(record.overviewPage));
      await renderMenu(record.menu);

      const titles: Array<string> = sectionTitlesInOrder();

      expect(titles).toEqual(record.sections);

      // Each section is one of an incident's, in the incident's order.
      const positions: Array<number> = titles.map((title: string): number => {
        return INCIDENT_SECTION_ORDER.indexOf(title);
      });

      expect(positions).not.toContain(-1);
      expect(
        [...positions].sort((a: number, b: number): number => {
          return a - b;
        }),
      ).toEqual(positions);
    },
  );

  test.each(
    RECORD_MENUS.map((record: RecordMenu): [string, RecordMenu] => {
      return [record.name, record];
    }),
  )(
    "the %s menu puts each page where every other record puts it",
    async (_name: string, record: RecordMenu) => {
      goTo(pageRoute(record.overviewPage));
      await renderMenu(record.menu);

      for (const section of sectionTitlesInOrder()) {
        if (section === "Developer") {
          // Terraform, API, CLI and AI Assistants: the same shared section on each.
          continue;
        }

        for (const link of linksIn(section)) {
          const expected: string | undefined =
            record.movedPages?.[link.title] ?? PAGE_SECTIONS[link.title];

          expect({ page: link.title, section }).toEqual({
            page: link.title,
            section: expected,
          });
        }
      }
    },
  );

  test.each(
    RECORD_MENUS.map((record: RecordMenu): [string, RecordMenu] => {
      return [record.name, record];
    }),
  )(
    "the %s menu opens and folds the sections an incident's does",
    async (_name: string, record: RecordMenu) => {
      goTo(pageRoute(record.overviewPage));
      await renderMenu(record.menu);

      for (const section of sectionTitlesInOrder()) {
        expect({ section, open: isExpanded(section) }).toEqual({
          section,
          open: OPEN_SECTIONS.includes(section),
        });
      }
    },
  );
});

describe("pages they share are named the same", () => {
  test("an alert's on-call page is On-Call Executions, as an incident's is", async () => {
    goTo(pageRoute(PageMap.ALERT_VIEW));
    await renderMenu(<AlertSideMenu modelId={MODEL_ID} />);

    const alertTeam: Array<MenuLink> = linksIn("Team");

    cleanup();
    goTo(pageRoute(PageMap.INCIDENT_VIEW));
    await renderMenu(<IncidentSideMenu modelId={MODEL_ID} />);

    const incidentTeam: Array<string> = linksIn("Team").map(
      (link: MenuLink): string => {
        return link.title;
      },
    );

    expect(alertTeam).toEqual([
      {
        title: "On-Call Executions",
        href: pageRoute(PageMap.ALERT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS),
      },
      { title: "Owners", href: pageRoute(PageMap.ALERT_VIEW_OWNERS) },
    ]);
    expect(incidentTeam).toContain("On-Call Executions");
  });

  test("an alert keeps every page it had, each linked once", async () => {
    goTo(pageRoute(PageMap.ALERT_VIEW));
    await renderMenu(<AlertSideMenu modelId={MODEL_ID} />);

    const titles: Array<string> = sectionTitlesInOrder()
      .filter((section: string): boolean => {
        return section !== "Developer";
      })
      .flatMap((section: string): Array<string> => {
        return linksIn(section).map((link: MenuLink): string => {
          return link.title;
        });
      });

    expect([...titles].sort()).toEqual(
      [
        "Overview",
        "State Timeline",
        "Description",
        "Root Cause",
        "Remediation",
        "Runbooks",
        "Linked Incidents",
        "On-Call Executions",
        "Owners",
        "Notification Logs",
        "AI Logs",
        "Private Notes",
        "Custom Fields",
        "Settings",
        "Audit Logs",
        "Delete Alert",
      ].sort(),
    );
  });

  test("an alert episode keeps every page it had", async () => {
    goTo(pageRoute(PageMap.ALERT_EPISODE_VIEW));
    await renderMenu(<AlertEpisodeSideMenu modelId={MODEL_ID} />);

    expect(linksIn("Overview")).toEqual([
      { title: "Overview", href: pageRoute(PageMap.ALERT_EPISODE_VIEW) },
      {
        title: "State Timeline",
        href: pageRoute(PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE),
      },
      {
        title: "Member Alerts",
        href: pageRoute(PageMap.ALERT_EPISODE_VIEW_ALERTS),
      },
      { title: "Owners", href: pageRoute(PageMap.ALERT_EPISODE_VIEW_OWNERS) },
    ]);
    expect(linksIn("Investigation")).toEqual([
      {
        title: "Description",
        href: pageRoute(PageMap.ALERT_EPISODE_VIEW_DESCRIPTION),
      },
      {
        title: "Root Cause",
        href: pageRoute(PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE),
      },
      {
        title: "Remediation Notes",
        href: pageRoute(PageMap.ALERT_EPISODE_VIEW_REMEDIATION),
      },
      {
        title: "Private Notes",
        href: pageRoute(PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE),
      },
    ]);
    expect(linksIn("Advanced")).toEqual([
      {
        title: "Audit Logs",
        href: pageRoute(PageMap.ALERT_EPISODE_VIEW_AUDIT_LOGS),
      },
      {
        title: "Delete Episode",
        href: pageRoute(PageMap.ALERT_EPISODE_VIEW_DELETE),
      },
    ]);
  });

  test("a maintenance event keeps every page it had", async () => {
    goTo(pageRoute(PageMap.SCHEDULED_MAINTENANCE_VIEW));
    await renderMenu(<ScheduledMaintenanceSideMenu modelId={MODEL_ID} />);

    expect(linksIn("Overview")).toEqual([
      {
        title: "Overview",
        href: pageRoute(PageMap.SCHEDULED_MAINTENANCE_VIEW),
      },
      {
        title: "State Timeline",
        href: pageRoute(PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE),
      },
      {
        title: "Description",
        href: pageRoute(PageMap.SCHEDULED_MAINTENANCE_VIEW_DESCRIPTION),
      },
      {
        title: "Runbooks",
        href: pageRoute(PageMap.SCHEDULED_MAINTENANCE_VIEW_RUNBOOKS),
      },
      {
        title: "Owners",
        href: pageRoute(PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS),
      },
    ]);
    expect(linksIn("Notes")).toEqual([
      {
        title: "Private Notes",
        href: pageRoute(PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE),
      },
      {
        title: "Public Notes",
        href: pageRoute(PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE),
      },
    ]);
  });
});

describe("a page opens the section it is in", () => {
  test.each([
    [
      "an alert's Owners",
      PageMap.ALERT_VIEW_OWNERS,
      <AlertSideMenu key="alert" modelId={MODEL_ID} />,
      "Team",
      "Owners",
    ],
    [
      "an alert's AI Logs",
      PageMap.ALERT_VIEW_AI_LOGS,
      <AlertSideMenu key="alert" modelId={MODEL_ID} />,
      "Notifications",
      "AI Logs",
    ],
    [
      "an alert episode's Owners",
      PageMap.ALERT_EPISODE_VIEW_OWNERS,
      <AlertEpisodeSideMenu key="alert-episode" modelId={MODEL_ID} />,
      "Overview",
      "Owners",
    ],
    [
      "a maintenance event's Notification Logs",
      PageMap.SCHEDULED_MAINTENANCE_VIEW_NOTIFICATION_LOGS,
      <ScheduledMaintenanceSideMenu key="maintenance" modelId={MODEL_ID} />,
      "Notifications",
      "Notification Logs",
    ],
  ] as Array<[string, PageMap, ReactElement, string, string]>)(
    "%s opens the section it is in",
    async (
      _name: string,
      page: PageMap,
      menu: ReactElement,
      section: string,
      entry: string,
    ) => {
      goTo(pageRoute(page));
      await renderMenu(menu);

      expect(isExpanded(section)).toBe(true);
      expect(activeLinkTitles()).toEqual([entry]);
    },
  );
});
