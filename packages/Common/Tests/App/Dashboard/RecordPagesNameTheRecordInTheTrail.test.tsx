import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import Navigation from "../../../UI/Utils/Navigation";
import { nameRecordInTrail } from "../../../UI/Components/Page/RecordNameInTrail";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getAlertsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AlertBreadcrumbs";
import { getIncidentsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IncidentBreadcrumbs";
import { getMonitorBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorBreadcrumbs";
import {
  getIncomingCallPolicyBreadcrumbs,
  getOnCallDutyBreadcrumbs,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/OnCallDutyBreadcrumbs";
import { getScheduleMaintenanceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ScheduledMaintenanceBreadcrumbs";
import { getSecurityEventsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SecurityEventsBreadcrumbs";
import { getStatusPagesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/StatusPagesBreadcrumbs";
import { getTeamsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/TeamsBreadcrumbs";
import { getUsersBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/UsersBreadcrumbs";
import { getWorkflowsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/WorkflowsBreadcrumbs";

/*
 * ModelPage names the crumb that stands for the record it shows - the one
 * whose address ends at the record's id - so "Project > Monitors > View
 * Monitor > Criteria" reads "Project > Monitors > Website: acme.com >
 * Criteria" (RecordNameInTrail). That only works if the Dashboard's trails
 * have such a crumb. These are the trails the Dashboard really builds, for
 * every page of the records people open most, in the place the reader is
 * (the router's location and the address bar): each has exactly one crumb
 * for the record, and it is the "View ..." crumb.
 */

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: (): string => {
            return "65f00000000000000000aaaa";
          },
        };
      },
    },
  };
});

const PROJECT_ID: string = "65f00000000000000000aaaa";
const RECORD_ID: string = "65f00000000000000000bbbb";
const OTHER_ID: string = "65f00000000000000000cccc";
const RECORD_NAME: string = "Checkout API";

type TrailBuilder = (path: string) => Array<Link> | undefined;

interface RecordKind {
  // The record's own page; every page under it shares the key as a prefix.
  viewKey: string;
  // The crumb the record's name takes the place of.
  viewTitle: string;
  builder: TrailBuilder;
}

const RECORD_KINDS: Array<RecordKind> = [
  {
    viewKey: "MONITOR_VIEW",
    viewTitle: "View Monitor",
    builder: getMonitorBreadcrumbs,
  },
  {
    viewKey: "INCIDENT_VIEW",
    viewTitle: "View Incident",
    builder: getIncidentsBreadcrumbs,
  },
  {
    viewKey: "ALERT_VIEW",
    viewTitle: "View Alert",
    builder: getAlertsBreadcrumbs,
  },
  {
    viewKey: "STATUS_PAGE_VIEW",
    viewTitle: "View Status Page",
    builder: getStatusPagesBreadcrumbs,
  },
  {
    viewKey: "SCHEDULED_MAINTENANCE_VIEW",
    viewTitle: "View Scheduled Maintenance Event",
    builder: getScheduleMaintenanceBreadcrumbs,
  },
  {
    viewKey: "TEAM_VIEW",
    viewTitle: "View Team",
    builder: getTeamsBreadcrumbs,
  },
  {
    viewKey: "WORKFLOW_VIEW",
    viewTitle: "View Workflow",
    builder: getWorkflowsBreadcrumbs,
  },
  {
    viewKey: "USER_VIEW",
    viewTitle: "View User",
    builder: getUsersBreadcrumbs,
  },
  {
    viewKey: "ON_CALL_DUTY_POLICY_VIEW",
    viewTitle: "View On-Call Policy",
    builder: getOnCallDutyBreadcrumbs,
  },
  {
    viewKey: "ON_CALL_DUTY_SCHEDULE_VIEW",
    viewTitle: "View On-Call Schedule",
    builder: getOnCallDutyBreadcrumbs,
  },
  {
    viewKey: "ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW",
    viewTitle: "View Policy",
    builder: getIncomingCallPolicyBreadcrumbs,
  },
  // A security case's pages, under its side menu: named by its number.
  {
    viewKey: "SECURITY_CASE_VIEW",
    viewTitle: "View Case",
    builder: getSecurityEventsBreadcrumbs,
  },
];

/*
 * Pages whose trail has no crumb for the record, left as they were: an
 * alert's Description reads "Project > Alerts > Description".
 */
const PAGES_WITHOUT_A_RECORD_CRUMB: Array<string> = ["ALERT_VIEW_DESCRIPTION"];

interface RecordPage {
  key: string;
  pattern: string;
}

function pagesOf(kind: RecordKind): Array<RecordPage> {
  return Object.keys(RouteMap)
    .filter((key: string): boolean => {
      return key === kind.viewKey || key.startsWith(`${kind.viewKey}_`);
    })
    .map((key: string): RecordPage => {
      return { key, pattern: (RouteMap[key] as Route).toString() };
    })
    .filter((page: RecordPage): boolean => {
      return !page.pattern.endsWith("/*");
    });
}

// The trail the Dashboard builds on this page, as the reader is on it.
function trailOn(kind: RecordKind, page: RecordPage): Array<Link> | undefined {
  const address: string = page.pattern
    .replace(":projectId", PROJECT_ID)
    .replace(":id", RECORD_ID)
    .replace(/:[A-Za-z]+/g, OTHER_ID);

  Navigation.setLocation({
    pathname: address,
    search: "",
    hash: "",
    state: null,
    key: "record-trail",
  });
  window.history.replaceState(null, "", address);

  return kind.builder(page.pattern);
}

afterEach(() => {
  (Navigation as unknown as { location: unknown }).location = undefined;
  window.history.replaceState(null, "", "/");
});

describe("every page of a record names it in the trail", () => {
  test("the walk covers well over a hundred pages", () => {
    const count: number = RECORD_KINDS.reduce(
      (total: number, kind: RecordKind): number => {
        return total + pagesOf(kind).length;
      },
      0,
    );

    expect(count).toBeGreaterThan(100);
  });

  test.each(
    RECORD_KINDS.map((kind: RecordKind): [string, RecordKind] => {
      return [kind.viewKey, kind];
    }),
  )("%s and every page under it", (_key: string, kind: RecordKind) => {
    const pages: Array<RecordPage> = pagesOf(kind);
    expect(pages.length).toBeGreaterThan(0);

    for (const page of pages) {
      const trail: Array<Link> | undefined = trailOn(kind, page);
      expect({ page: page.key, hasTrail: Boolean(trail) }).toEqual({
        page: page.key,
        hasTrail: true,
      });

      const named: Array<Link> = nameRecordInTrail({
        links: trail,
        recordId: RECORD_ID,
        recordName: RECORD_NAME,
      })!;

      const namedCrumbs: Array<string> = named
        .filter((link: Link): boolean => {
          return Boolean(link.recordName);
        })
        .map((link: Link): string => {
          return link.title;
        });

      if (PAGES_WITHOUT_A_RECORD_CRUMB.includes(page.key)) {
        expect({ page: page.key, namedCrumbs }).toEqual({
          page: page.key,
          namedCrumbs: [],
        });
        continue;
      }

      expect({ page: page.key, namedCrumbs }).toEqual({
        page: page.key,
        namedCrumbs: [kind.viewTitle],
      });
    }
  });

  test("on the record's own page, the named crumb is the last one", () => {
    for (const kind of RECORD_KINDS) {
      const ownPage: RecordPage = {
        key: kind.viewKey,
        pattern: (RouteMap[kind.viewKey] as Route).toString(),
      };
      const named: Array<Link> = nameRecordInTrail({
        links: trailOn(kind, ownPage),
        recordId: RECORD_ID,
        recordName: RECORD_NAME,
      })!;

      expect({
        kind: kind.viewKey,
        last: named[named.length - 1]!.recordName,
      }).toEqual({ kind: kind.viewKey, last: RECORD_NAME });
    }
  });
});

/*
 * An on-call policy's and schedule's pages sit one segment deeper than their
 * trails used to have crumbs for (/on-call-duty/policies/:id/...), so the
 * "View On-Call Policy" crumb opened the list of policies, not the policy -
 * and no crumb could take the policy's name. Their trails now name the list
 * as well, as Incoming Call Policies' always did.
 */
describe("an on-call policy's and schedule's pages lead back to it", () => {
  test.each([
    ["ON_CALL_DUTY_POLICY_VIEW", "View On-Call Policy", "Policies", "policies"],
    [
      "ON_CALL_DUTY_SCHEDULE_VIEW",
      "View On-Call Schedule",
      "Schedules",
      "schedules",
    ],
  ])(
    "below %s, its crumb opens it and the list's crumb opens the list",
    (viewKey: string, viewTitle: string, listTitle: string, list: string) => {
      const kind: RecordKind = RECORD_KINDS.find(
        (candidate: RecordKind): boolean => {
          return candidate.viewKey === viewKey;
        },
      )!;
      const recordPage: string = `/dashboard/${PROJECT_ID}/on-call-duty/${list}/${RECORD_ID}`;
      const listPage: string = `/dashboard/${PROJECT_ID}/on-call-duty/${list}`;

      const pagesBelow: Array<RecordPage> = pagesOf(kind).filter(
        (page: RecordPage): boolean => {
          return page.key !== viewKey;
        },
      );
      expect(pagesBelow.length).toBeGreaterThan(5);

      for (const page of pagesBelow) {
        const trail: Array<Link> = trailOn(kind, page)!;
        const crumbTo: (title: string) => string | undefined = (
          title: string,
        ): string | undefined => {
          return trail
            .find((link: Link): boolean => {
              return link.title === title;
            })
            ?.to.toString();
        };

        expect({
          page: page.key,
          record: crumbTo(viewTitle),
          list: crumbTo(listTitle),
        }).toEqual({ page: page.key, record: recordPage, list: listPage });
      }
    },
  );

  test("on its own page, the list's crumb opens the list", () => {
    const kind: RecordKind = RECORD_KINDS.find(
      (candidate: RecordKind): boolean => {
        return candidate.viewKey === "ON_CALL_DUTY_POLICY_VIEW";
      },
    )!;
    const trail: Array<Link> = trailOn(kind, {
      key: kind.viewKey,
      pattern: (RouteMap[kind.viewKey] as Route).toString(),
    })!;

    expect(
      trail.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "On-Call Duty", "Policies", "View On-Call Policy"]);
    expect(trail[2]!.to.toString()).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/policies`,
    );
  });
});
