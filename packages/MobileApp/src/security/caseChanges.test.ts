import { describe, expect, test } from "@jest/globals";
import {
  getAssignWrite,
  getPriorityWrite,
  getStatusWrite,
  isAssignToMeOffered,
  isAssignToSomeoneElseOffered,
  isCaseAssignedTo,
} from "./caseChanges";
import type { CaseStatusRuleRow } from "./caseValues";

/*
 * What working a case from the phone writes, and when each move is offered.
 * The dashboard's Components/SecurityCase/SecurityCaseChanges holds the same
 * rules (App's SecurityCaseMobileChangesParity runs both side by side); what
 * is pinned here is the app's own reading of them: a closed case is not
 * taken, closing always carries a verdict, and ids match whatever their case.
 */

const STATUSES: Array<CaseStatusRuleRow> = [
  { _id: "new", order: 1, isNewStatus: true },
  { _id: "investigating", order: 2, isAcknowledgedStatus: true },
  { _id: "contained", order: 3, isContainedStatus: true },
  { _id: "closed", order: 4, isClosedStatus: true },
  { _id: "closed-duplicate", order: 5 },
];

const ME: string = "4c0b0b7e-0001-4000-8000-000000000001";
const SOMEONE: string = "4c0b0b7e-0002-4000-8000-000000000002";

describe("whose case it is", () => {
  test("the person signed in, matched whatever the id's case", () => {
    expect(isCaseAssignedTo(ME, ME)).toBe(true);
    expect(isCaseAssignedTo(ME.toUpperCase(), ME)).toBe(true);
  });

  test("nobody, or somebody else, is not the reader", () => {
    expect(isCaseAssignedTo(null, ME)).toBe(false);
    expect(isCaseAssignedTo(undefined, ME)).toBe(false);
    expect(isCaseAssignedTo(SOMEONE, ME)).toBe(false);
  });

  test("a reader whose id is not known yet has no cases", () => {
    expect(isCaseAssignedTo(ME, null)).toBe(false);
    expect(isCaseAssignedTo(ME, "")).toBe(false);
  });
});

describe("Assign to me", () => {
  test("is offered on an open case nobody has", () => {
    expect(
      isAssignToMeOffered({
        statuses: STATUSES,
        statusId: "new",
        assignedToUserId: null,
        userId: ME,
      }),
    ).toBe(true);
  });

  test("is offered to take over somebody else's open case", () => {
    expect(
      isAssignToMeOffered({
        statuses: STATUSES,
        statusId: "investigating",
        assignedToUserId: SOMEONE,
        userId: ME,
      }),
    ).toBe(true);
  });

  test("is not offered on a case that is mine already", () => {
    expect(
      isAssignToMeOffered({
        statuses: STATUSES,
        statusId: "investigating",
        assignedToUserId: ME,
        userId: ME,
      }),
    ).toBe(false);
  });

  test.each([["closed"], ["closed-duplicate"]])(
    "is not offered on a case closed in %s: nobody takes a closed case",
    (statusId: string) => {
      expect(
        isAssignToMeOffered({
          statuses: STATUSES,
          statusId,
          assignedToUserId: null,
          userId: ME,
        }),
      ).toBe(false);
    },
  );

  test("is not offered before the app knows who is signed in", () => {
    expect(
      isAssignToMeOffered({
        statuses: STATUSES,
        statusId: "new",
        assignedToUserId: null,
        userId: null,
      }),
    ).toBe(false);
  });

  test("writes the reader as the person working it, and leaves the team alone", () => {
    expect(getAssignWrite(ME)).toEqual({ assignedToUserId: ME });
  });
});

describe("Assign to someone else", () => {
  test("is offered on an open case, whoever has it", () => {
    for (const statusId of ["new", "investigating", "contained"]) {
      expect(
        isAssignToSomeoneElseOffered({ statuses: STATUSES, statusId }),
      ).toBe(true);
    }
  });

  test("is not offered on a closed case: it is reopened first", () => {
    expect(
      isAssignToSomeoneElseOffered({ statuses: STATUSES, statusId: "closed" }),
    ).toBe(false);
  });
});

describe("what a status change writes", () => {
  test("a move between open statuses writes the status alone", () => {
    expect(
      getStatusWrite({
        statuses: STATUSES,
        fromStatusId: "new",
        pick: { statusId: "contained", verdict: "True Positive" },
      }),
    ).toEqual({ securityCaseStatusId: "contained" });
  });

  test("closing writes the verdict picked and the closing note, trimmed", () => {
    expect(
      getStatusWrite({
        statuses: STATUSES,
        fromStatusId: "investigating",
        pick: {
          statusId: "closed",
          verdict: "False Positive",
          closingNote: "  The scanner is ours.  ",
        },
      }),
    ).toEqual({
      securityCaseStatusId: "closed",
      verdict: "False Positive",
      closingNote: "The scanner is ours.",
    });
  });

  test("closing without a verdict closes as Undetermined, never with none", () => {
    expect(
      getStatusWrite({
        statuses: STATUSES,
        fromStatusId: "new",
        pick: { statusId: "closed" },
      }),
    ).toEqual({ securityCaseStatusId: "closed", verdict: "Undetermined" });
  });

  test("a verdict the server does not know closes as Undetermined", () => {
    expect(
      getStatusWrite({
        statuses: STATUSES,
        fromStatusId: "new",
        pick: { statusId: "closed", verdict: "Probably fine" },
      })["verdict"],
    ).toBe("Undetermined");
  });

  test("an empty closing note is left out rather than written blank", () => {
    expect(
      getStatusWrite({
        statuses: STATUSES,
        fromStatusId: "new",
        pick: {
          statusId: "closed",
          verdict: "True Positive",
          closingNote: " ",
        },
      }),
    ).toEqual({ securityCaseStatusId: "closed", verdict: "True Positive" });
  });

  test("a closed case moving to another closing status keeps its verdict", () => {
    expect(
      getStatusWrite({
        statuses: STATUSES,
        fromStatusId: "closed",
        pick: { statusId: "closed-duplicate", verdict: "Benign Positive" },
      }),
    ).toEqual({ securityCaseStatusId: "closed-duplicate" });
  });

  test("reopening writes the open status and no verdict: the server clears it", () => {
    expect(
      getStatusWrite({
        statuses: STATUSES,
        fromStatusId: "closed",
        pick: { statusId: "investigating" },
      }),
    ).toEqual({ securityCaseStatusId: "investigating" });
  });
});

describe("what a priority change writes", () => {
  test("the priority, by id", () => {
    expect(getPriorityWrite("high")).toEqual({
      securityCasePriorityId: "high",
    });
  });
});
