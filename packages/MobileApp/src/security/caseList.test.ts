import { describe, expect, test } from "@jest/globals";
import {
  CASE_LIST_FILTERS,
  filterCases,
  getCaseActivityTime,
  isCaseAwaitingApproval,
  isCaseListFilter,
  matchesCaseSearch,
  sortCasesForTriage,
} from "./caseList";
import type {
  ProjectSecurityCaseItem,
  SecurityCaseItem,
  SecurityCasePriorityItem,
} from "../api/types";

/*
 * The open cases in the order a paged analyst works them: a case held by a
 * playbook waiting for an approval first - nothing happens until somebody
 * decides - then the most urgent by the project's own ranking, then the
 * latest detection. And the three questions the filters ask, the dashboard's
 * own: every open case, mine, and nobody's.
 */

const ME: string = "4c0b0b7e-0001-4000-8000-000000000001";
const PRIYA: string = "4c0b0b7e-0002-4000-8000-000000000002";

const PRIORITIES: Array<SecurityCasePriorityItem> = [
  { _id: "low", name: "Low", order: 4, isLowPriority: true },
  { _id: "critical", name: "Critical", order: 1, isCriticalPriority: true },
  { _id: "high", name: "High", order: 2, isHighPriority: true },
  { _id: "medium", name: "Medium", order: 3, isMediumPriority: true },
];

function makeCase(
  overrides: Partial<SecurityCaseItem>,
): ProjectSecurityCaseItem {
  return {
    projectId: "project-1",
    projectName: "Acme",
    item: {
      _id: "case",
      title: "A case",
      createdAt: "2026-09-10T06:00:00.000Z",
      ...overrides,
    },
  };
}

function ids(items: Array<ProjectSecurityCaseItem>): Array<string> {
  return items.map((wrapped: ProjectSecurityCaseItem) => {
    return wrapped.item._id;
  });
}

describe("the order of the open cases", () => {
  const cases: Array<ProjectSecurityCaseItem> = [
    makeCase({
      _id: "low-new",
      securityCasePriorityId: "low",
      lastDetectedAt: "2026-09-10T09:59:00.000Z",
    }),
    makeCase({
      _id: "high-old",
      securityCasePriorityId: "high",
      lastDetectedAt: "2026-09-10T07:00:00.000Z",
    }),
    makeCase({
      _id: "critical",
      securityCasePriorityId: "critical",
      lastDetectedAt: "2026-09-10T08:00:00.000Z",
    }),
    makeCase({
      _id: "high-new",
      securityCasePriorityId: "high",
      lastDetectedAt: "2026-09-10T09:00:00.000Z",
    }),
    makeCase({
      _id: "medium-waiting",
      securityCasePriorityId: "medium",
      lastDetectedAt: "2026-09-10T06:30:00.000Z",
    }),
  ];

  test("the most urgent first, then the latest detection", () => {
    expect(ids(sortCasesForTriage(cases, PRIORITIES, new Set()))).toEqual([
      "critical",
      "high-new",
      "high-old",
      "medium-waiting",
      "low-new",
    ]);
  });

  test("a case waiting for an approval comes before every other, whatever its priority", () => {
    expect(
      ids(sortCasesForTriage(cases, PRIORITIES, new Set(["medium-waiting"]))),
    ).toEqual([
      "medium-waiting",
      "critical",
      "high-new",
      "high-old",
      "low-new",
    ]);
  });

  test("cases waiting for approvals keep the same order among themselves", () => {
    expect(
      ids(
        sortCasesForTriage(cases, PRIORITIES, new Set(["low-new", "critical"])),
      ),
    ).toEqual([
      "critical",
      "low-new",
      "high-new",
      "high-old",
      "medium-waiting",
    ]);
  });

  test("a priority that is none of the project's goes after every known one", () => {
    const withUnknown: Array<ProjectSecurityCaseItem> = [
      makeCase({ _id: "unknown", securityCasePriorityId: "retired-elsewhere" }),
      makeCase({ _id: "low", securityCasePriorityId: "low" }),
    ];

    expect(ids(sortCasesForTriage(withUnknown, PRIORITIES, new Set()))).toEqual(
      ["low", "unknown"],
    );
  });

  test("a case's priority is read from its relation when the id column is missing", () => {
    const fromRelation: Array<ProjectSecurityCaseItem> = [
      makeCase({
        _id: "low",
        securityCasePriority: { _id: "low", name: "Low" },
      }),
      makeCase({
        _id: "critical",
        securityCasePriority: { _id: "CRITICAL", name: "Critical" },
      }),
    ];

    expect(
      ids(sortCasesForTriage(fromRelation, PRIORITIES, new Set())),
    ).toEqual(["critical", "low"]);
  });

  test("a case opened by hand, with no detection, is placed by when it opened", () => {
    const manual: ProjectSecurityCaseItem = makeCase({
      _id: "manual",
      securityCasePriorityId: "high",
      createdAt: "2026-09-10T09:30:00.000Z",
    });

    expect(getCaseActivityTime(manual.item)).toBe(
      new Date("2026-09-10T09:30:00.000Z").getTime(),
    );
    expect(
      ids(sortCasesForTriage([...cases, manual], PRIORITIES, new Set())).slice(
        0,
        4,
      ),
    ).toEqual(["critical", "manual", "high-new", "high-old"]);
  });

  test("ties keep the server's order, and the list given is left as it came", () => {
    const tied: Array<ProjectSecurityCaseItem> = [
      makeCase({ _id: "first", securityCasePriorityId: "high" }),
      makeCase({ _id: "second", securityCasePriorityId: "high" }),
    ];

    expect(ids(sortCasesForTriage(tied, PRIORITIES, new Set()))).toEqual([
      "first",
      "second",
    ]);
    expect(ids(tied)).toEqual(["first", "second"]);
  });

  test("the waiting set is matched whatever the id's case", () => {
    expect(
      isCaseAwaitingApproval(
        makeCase({ _id: "ABC-1" }).item,
        new Set(["abc-1"]),
      ),
    ).toBe(true);
  });

  test("a case with no readable time at all still sorts", () => {
    expect(getCaseActivityTime({ _id: "x", title: "x", createdAt: "" })).toBe(
      0,
    );
  });
});

describe("the filters", () => {
  const cases: Array<ProjectSecurityCaseItem> = [
    makeCase({ _id: "mine", assignedToUserId: ME }),
    makeCase({ _id: "priyas", assignedToUserId: PRIYA }),
    makeCase({
      _id: "teams",
      assignedToUserId: null,
      assignedToTeamId: "team-1",
      assignedToTeam: { _id: "team-1", name: "Security Operations" },
    }),
    makeCase({ _id: "nobodys" }),
  ];

  test("are Open, Mine and Unassigned, in that order", () => {
    expect(
      CASE_LIST_FILTERS.map((filter: { key: string; label: string }) => {
        return [filter.key, filter.label];
      }),
    ).toEqual([
      ["open", "Open"],
      ["mine", "Mine"],
      ["unassigned", "Unassigned"],
    ]);
    expect(isCaseListFilter("mine")).toBe(true);
    expect(isCaseListFilter("closed")).toBe(false);
  });

  test("Open is every open case", () => {
    expect(
      ids(filterCases(cases, { filter: "open", userId: ME, search: "" })),
    ).toEqual(["mine", "priyas", "teams", "nobodys"]);
  });

  test("Mine is the ones assigned to me", () => {
    expect(
      ids(filterCases(cases, { filter: "mine", userId: ME, search: "" })),
    ).toEqual(["mine"]);
  });

  test("Mine is empty while the app does not know who is signed in", () => {
    expect(
      ids(filterCases(cases, { filter: "mine", userId: null, search: "" })),
    ).toEqual([]);
  });

  test("Unassigned is the ones nobody has picked up, a team's queue among them", () => {
    expect(
      ids(filterCases(cases, { filter: "unassigned", userId: ME, search: "" })),
    ).toEqual(["teams", "nobodys"]);
  });
});

describe("search", () => {
  const securityCase: SecurityCaseItem = {
    _id: "case",
    title: "Password spray against the VPN",
    caseNumber: 142,
    caseNumberWithPrefix: "CASE-142",
    createdAt: "2026-09-10T09:00:00.000Z",
    assignedToUser: {
      _id: PRIYA,
      name: "Priya Shah",
      email: "priya@example.test",
    },
    assignedToTeam: { _id: "team-1", name: "Security Operations" },
    entities: [
      { type: "User", value: "alice@acme.test" },
      { type: "IP Address", value: "203.0.113.24" },
    ],
  };

  test.each([
    ["the title", "password spray"],
    ["the number", "CASE-142"],
    ["the number without its prefix", "142"],
    ["who has it", "priya"],
    ["their email", "priya@example"],
    ["the team", "operations"],
    ["a user it is about", "alice@"],
    ["an address it is about", "203.0.113"],
    ["two words from different fields", "vpn alice"],
  ])("finds a case by %s", (_what: string, search: string) => {
    expect(matchesCaseSearch(securityCase, search)).toBe(true);
  });

  test("an empty search matches every case", () => {
    expect(matchesCaseSearch(securityCase, "   ")).toBe(true);
  });

  test("a word the case does not hold anywhere misses it", () => {
    expect(matchesCaseSearch(securityCase, "ransomware")).toBe(false);
    expect(matchesCaseSearch(securityCase, "vpn ransomware")).toBe(false);
  });

  test("search narrows a filter, and a filter narrows search", () => {
    const cases: Array<ProjectSecurityCaseItem> = [
      makeCase({ _id: "mine-spray", title: "Spray", assignedToUserId: ME }),
      makeCase({ _id: "nobody-spray", title: "Spray" }),
      makeCase({ _id: "mine-scan", title: "Scan", assignedToUserId: ME }),
    ];

    expect(
      ids(filterCases(cases, { filter: "mine", userId: ME, search: "spray" })),
    ).toEqual(["mine-spray"]);
  });
});
