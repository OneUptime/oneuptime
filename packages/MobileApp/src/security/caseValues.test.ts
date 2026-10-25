import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_CASE_STAGES,
  doesStatusCloseCase,
  findCaseValue,
  getCasePriorityRank,
  getCaseStatusOfStage,
  getCaseStatusStage,
  getCaseValueChoices,
  getCaseValueOrder,
  getClosedCaseStatusIds,
  getOpenCaseStatusIds,
  hasCaseStatusReached,
  isArchivedCaseValue,
  isCasePriorityUrgent,
  isCaseStatusClosed,
  isCaseStatusOpen,
  sortCaseValues,
  type CasePriorityRuleRow,
  type CaseStatusRuleRow,
  type CaseValueChoice,
  type SecurityCaseStage,
} from "./caseValues";
import RULE_CASES from "../__tests__/securityCaseRuleCases.json";

/*
 * The app's copy of what a security case's status and priority mean. The
 * cases are the same file Common's SecurityCaseMobileParity suite runs
 * against Common's own rules, so a case added there for a server change is a
 * case this copy must also pass - and the parity suite generates thousands
 * more. What is pinned here besides is how the app reads the API's shapes:
 * missing columns, ids of any case, places written as text.
 */

interface StatusCase {
  name: string;
  statuses: Array<CaseStatusRuleRow>;
  stages: Record<string, SecurityCaseStage | null>;
  openIds: Array<string>;
  closedIds: Array<string>;
  statusOfStage: Partial<Record<SecurityCaseStage, string>>;
}

interface PriorityCase {
  name: string;
  priorities: Array<CasePriorityRuleRow>;
  sortedIds: Array<string>;
  ranks: Record<string, number | null>;
  urgentIds: Array<string>;
}

const STATUS_CASES: Array<StatusCase> = (
  RULE_CASES as unknown as { statusCases: Array<StatusCase> }
).statusCases;
const PRIORITY_CASES: Array<PriorityCase> = (
  RULE_CASES as unknown as { priorityCases: Array<PriorityCase> }
).priorityCases;

const NEW_PROJECT_STATUSES: Array<CaseStatusRuleRow> =
  STATUS_CASES[0]!.statuses;

describe("the shared status cases", () => {
  test("cover every stage and the project's own statuses", () => {
    expect(STATUS_CASES.length).toBeGreaterThanOrEqual(6);
    const stagesSeen: Set<string> = new Set();
    for (const statusCase of STATUS_CASES) {
      for (const stage of Object.values(statusCase.stages)) {
        if (stage) {
          stagesSeen.add(stage);
        }
      }
    }
    expect([...stagesSeen].sort()).toEqual([...SECURITY_CASE_STAGES].sort());
  });

  describe.each(
    STATUS_CASES.map((statusCase: StatusCase): [string, StatusCase] => {
      return [statusCase.name, statusCase];
    }),
  )("%s", (_name: string, statusCase: StatusCase) => {
    test("each status counts as the stage the rule says", () => {
      for (const [statusId, stage] of Object.entries(statusCase.stages)) {
        expect(getCaseStatusStage(statusCase.statuses, statusId)).toBe(stage);
      }
    });

    test("the open and closed lists are the rule's, top first", () => {
      expect(getOpenCaseStatusIds(statusCase.statuses)).toEqual(
        statusCase.openIds,
      );
      expect(getClosedCaseStatusIds(statusCase.statuses)).toEqual(
        statusCase.closedIds,
      );
    });

    test("every status is open or closed, never both", () => {
      for (const status of statusCase.statuses) {
        expect(
          isCaseStatusOpen(statusCase.statuses, status._id) !==
            isCaseStatusClosed(statusCase.statuses, status._id),
        ).toBe(true);
      }
    });

    test("the built-in status of each stage is the first one flagged", () => {
      for (const [stage, statusId] of Object.entries(
        statusCase.statusOfStage,
      )) {
        expect(
          getCaseStatusOfStage(statusCase.statuses, stage as SecurityCaseStage)
            ?._id,
        ).toBe(statusId);
      }
    });
  });
});

describe("the shared priority cases", () => {
  describe.each(
    PRIORITY_CASES.map((priorityCase: PriorityCase): [string, PriorityCase] => {
      return [priorityCase.name, priorityCase];
    }),
  )("%s", (_name: string, priorityCase: PriorityCase) => {
    test("priorities sort by their place, the most urgent first", () => {
      expect(
        sortCaseValues(priorityCase.priorities).map(
          (priority: CasePriorityRuleRow): string => {
            return priority._id;
          },
        ),
      ).toEqual(priorityCase.sortedIds);
    });

    test("each priority's rank is its place from the top", () => {
      for (const [priorityId, rank] of Object.entries(priorityCase.ranks)) {
        expect(getCasePriorityRank(priorityCase.priorities, priorityId)).toBe(
          rank,
        );
      }
    });

    test("urgent is at or above the project's high priority", () => {
      expect(
        priorityCase.priorities
          .filter((priority: CasePriorityRuleRow): boolean => {
            return isCasePriorityUrgent(priorityCase.priorities, priority._id);
          })
          .map((priority: CasePriorityRuleRow): string => {
            return priority._id;
          })
          .sort(),
      ).toEqual([...priorityCase.urgentIds].sort());
    });
  });
});

describe("reading what the API hands back", () => {
  test("a place is a finite number, or a number written as text", () => {
    expect(getCaseValueOrder({ _id: "a", order: 3 })).toBe(3);
    expect(getCaseValueOrder({ _id: "a", order: " 7 " })).toBe(7);
    expect(getCaseValueOrder({ _id: "a", order: "" })).toBeNull();
    expect(getCaseValueOrder({ _id: "a", order: "three" })).toBeNull();
    expect(getCaseValueOrder({ _id: "a", order: Number.NaN })).toBeNull();
    expect(getCaseValueOrder({ _id: "a", order: Infinity })).toBeNull();
    expect(getCaseValueOrder({ _id: "a", order: null })).toBeNull();
    expect(getCaseValueOrder({ _id: "a" })).toBeNull();
  });

  test("no statuses, or none read yet, leave nothing open and nothing closed", () => {
    expect(getOpenCaseStatusIds([])).toEqual([]);
    expect(getOpenCaseStatusIds(null)).toEqual([]);
    expect(getOpenCaseStatusIds(undefined)).toEqual([]);
    expect(isCaseStatusClosed(undefined, "closed")).toBe(false);
    expect(isCaseStatusOpen(undefined, "new")).toBe(false);
    expect(getCaseStatusStage([], "new")).toBeNull();
  });

  test("an id the API sends in another case finds its status", () => {
    expect(findCaseValue(NEW_PROJECT_STATUSES, "CLOSED")?._id).toBe("closed");
    expect(findCaseValue(NEW_PROJECT_STATUSES, "")).toBeUndefined();
    expect(findCaseValue(NEW_PROJECT_STATUSES, null)).toBeUndefined();
    expect(findCaseValue(NEW_PROJECT_STATUSES, "gone")).toBeUndefined();
  });

  test("a flag that is not exactly true is no flag", () => {
    const statuses: Array<CaseStatusRuleRow> = [
      { _id: "new", order: 1, isNewStatus: true },
      { _id: "maybe", order: 2, isClosedStatus: null },
      {
        _id: "text",
        order: 3,
        isClosedStatus: "true" as unknown as boolean,
      },
    ];

    expect(getCaseStatusStage(statuses, "maybe")).toBe("New");
    expect(getCaseStatusStage(statuses, "text")).toBe("New");
    expect(getCaseStatusOfStage(statuses, "Closed")).toBeUndefined();
  });

  test("sorting copies the list and leaves the original as it came", () => {
    const priorities: Array<CasePriorityRuleRow> = [
      { _id: "low", order: 2 },
      { _id: "high", order: 1 },
    ];

    const sorted: Array<CasePriorityRuleRow> = sortCaseValues(priorities);

    expect(
      sorted.map((row: CasePriorityRuleRow) => {
        return row._id;
      }),
    ).toEqual(["high", "low"]);
    expect(priorities[0]!._id).toBe("low");
  });
});

describe("stages a case has reached", () => {
  test("a contained case has been acknowledged too, and is not closed", () => {
    expect(
      hasCaseStatusReached(NEW_PROJECT_STATUSES, "contained", "Acknowledged"),
    ).toBe(true);
    expect(
      hasCaseStatusReached(NEW_PROJECT_STATUSES, "contained", "Contained"),
    ).toBe(true);
    expect(
      hasCaseStatusReached(NEW_PROJECT_STATUSES, "contained", "Closed"),
    ).toBe(false);
  });

  test("a new case has reached New and nothing after it", () => {
    expect(hasCaseStatusReached(NEW_PROJECT_STATUSES, "new", "New")).toBe(true);
    expect(
      hasCaseStatusReached(NEW_PROJECT_STATUSES, "new", "Acknowledged"),
    ).toBe(false);
  });

  test("a status that is none of the project's has reached nothing", () => {
    expect(hasCaseStatusReached(NEW_PROJECT_STATUSES, "gone", "New")).toBe(
      false,
    );
  });
});

describe("whether a move closes the case, and so asks for a verdict", () => {
  test("an open case going to the closed status closes it", () => {
    expect(
      doesStatusCloseCase({
        statuses: NEW_PROJECT_STATUSES,
        fromStatusId: "investigating",
        toStatusId: "closed",
      }),
    ).toBe(true);
  });

  test("a false positive closed straight from New closes too", () => {
    expect(
      doesStatusCloseCase({
        statuses: NEW_PROJECT_STATUSES,
        fromStatusId: "new",
        toStatusId: "closed",
      }),
    ).toBe(true);
  });

  test("a closed case moving between two closing statuses keeps its verdict", () => {
    const statuses: Array<CaseStatusRuleRow> = STATUS_CASES[1]!.statuses;

    expect(
      doesStatusCloseCase({
        statuses,
        fromStatusId: "closed",
        toStatusId: "closed-duplicate",
      }),
    ).toBe(false);
  });

  test("moving between open statuses, or reopening, asks nothing", () => {
    expect(
      doesStatusCloseCase({
        statuses: NEW_PROJECT_STATUSES,
        fromStatusId: "new",
        toStatusId: "contained",
      }),
    ).toBe(false);
    expect(
      doesStatusCloseCase({
        statuses: NEW_PROJECT_STATUSES,
        fromStatusId: "closed",
        toStatusId: "investigating",
      }),
    ).toBe(false);
  });

  test("a case whose own status is unknown still asks before closing", () => {
    expect(
      doesStatusCloseCase({
        statuses: NEW_PROJECT_STATUSES,
        fromStatusId: null,
        toStatusId: "closed",
      }),
    ).toBe(true);
  });
});

describe("the choices Change Status and Change Priority offer", () => {
  const statuses: Array<CaseStatusRuleRow> = [
    { _id: "closed", order: 4, isClosedStatus: true },
    { _id: "new", order: 1, isNewStatus: true },
    { _id: "retired", order: 2, isArchived: true },
    { _id: "investigating", order: 3, isAcknowledgedStatus: true },
  ];

  function ids(
    choices: Array<CaseValueChoice<CaseStatusRuleRow>>,
  ): Array<string> {
    return choices.map((choice: CaseValueChoice<CaseStatusRuleRow>) => {
      return choice.value._id;
    });
  }

  test("in the project's order, without the archived ones", () => {
    expect(ids(getCaseValueChoices(statuses, "new"))).toEqual([
      "new",
      "investigating",
      "closed",
    ]);
  });

  test("the one the case has is marked Current", () => {
    const choices: Array<CaseValueChoice<CaseStatusRuleRow>> =
      getCaseValueChoices(statuses, "INVESTIGATING");

    expect(
      choices.filter((choice: CaseValueChoice<CaseStatusRuleRow>) => {
        return choice.isCurrent;
      }),
    ).toEqual([{ value: statuses[3], isCurrent: true, isArchived: false }]);
  });

  test("an archived value the case still has stays, marked as archived", () => {
    const choices: Array<CaseValueChoice<CaseStatusRuleRow>> =
      getCaseValueChoices(statuses, "retired");

    expect(ids(choices)).toEqual(["new", "retired", "investigating", "closed"]);
    expect(choices[1]).toEqual({
      value: statuses[2],
      isCurrent: true,
      isArchived: true,
    });
  });

  test("without a current value nothing is marked", () => {
    expect(
      getCaseValueChoices(statuses, null).some(
        (choice: CaseValueChoice<CaseStatusRuleRow>) => {
          return choice.isCurrent;
        },
      ),
    ).toBe(false);
  });

  test("archived means archived: only true counts", () => {
    expect(isArchivedCaseValue({ _id: "a", isArchived: true })).toBe(true);
    expect(isArchivedCaseValue({ _id: "a", isArchived: false })).toBe(false);
    expect(isArchivedCaseValue({ _id: "a", isArchived: null })).toBe(false);
    expect(isArchivedCaseValue({ _id: "a" })).toBe(false);
  });
});
