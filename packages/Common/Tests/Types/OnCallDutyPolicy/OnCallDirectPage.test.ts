/*
 * A direct page - people, a team or a schedule paged with no on-call policy
 * behind the page - is kept where an on-call policy's run is, and told apart
 * from one by what this file holds. The rule is small and everything that
 * handles a run reads it, so it is pinned here: what counts as a direct page,
 * how its targets are counted and capped, and the words its run is given.
 */

import ObjectID from "../../../Types/ObjectID";
import {
  MAX_ON_CALL_DIRECT_PAGE_TARGETS,
  ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
  ON_CALL_POLICY_REQUIRED_MESSAGE,
  OnCallDirectPageTargets,
  countOnCallDirectPageTargets,
  getOnCallDirectPagePagingMessage,
  isOnCallDirectPage,
} from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import { describe, expect, test } from "@jest/globals";

const POLICY_ID: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000001",
);

function ids(count: number): Array<ObjectID> {
  return Array.from({ length: count }, (): ObjectID => {
    return ObjectID.generate();
  });
}

describe("which runs are direct pages", () => {
  test("a run that names no policy is one", () => {
    expect(isOnCallDirectPage({})).toBe(true);
    expect(isOnCallDirectPage({ onCallDutyPolicyId: undefined })).toBe(true);
    expect(isOnCallDirectPage({ onCallDutyPolicyId: null })).toBe(true);
    expect(isOnCallDirectPage({ onCallDutyPolicyId: "" })).toBe(true);
  });

  test("a run that names its policy by id is not", () => {
    expect(isOnCallDirectPage({ onCallDutyPolicyId: POLICY_ID })).toBe(false);
    expect(
      isOnCallDirectPage({ onCallDutyPolicyId: POLICY_ID.toString() }),
    ).toBe(false);
  });

  test("nor is one read with its policy and not its policy's id", () => {
    /*
     * A row read through `select: { onCallDutyPolicy: { name: true } }`
     * carries the relation and may not carry the column: it is still a
     * policy's run.
     */
    expect(isOnCallDirectPage({ onCallDutyPolicy: { name: "Critical" } })).toBe(
      false,
    );
    expect(
      isOnCallDirectPage({
        onCallDutyPolicyId: null,
        onCallDutyPolicy: { _id: POLICY_ID.toString() },
      }),
    ).toBe(false);
  });

  test("a relation that came back empty does not make it a policy's run", () => {
    expect(isOnCallDirectPage({ onCallDutyPolicy: null })).toBe(true);
    expect(isOnCallDirectPage({ onCallDutyPolicy: undefined })).toBe(true);
  });
});

describe("how many targets a page names", () => {
  test("people, teams and schedules all count", () => {
    const targets: OnCallDirectPageTargets = {
      userIds: ids(3),
      teamIds: ids(2),
      onCallScheduleIds: ids(4),
    };

    expect(countOnCallDirectPageTargets(targets)).toBe(9);
  });

  test("a page that names nobody counts none", () => {
    expect(
      countOnCallDirectPageTargets({
        userIds: [],
        teamIds: [],
        onCallScheduleIds: [],
      }),
    ).toBe(0);
  });

  test("the cap is a hundred: a longer list is a mistake, not a page", () => {
    expect(MAX_ON_CALL_DIRECT_PAGE_TARGETS).toBe(100);
  });
});

describe("the words a direct page's run is given", () => {
  test("how many people it paged, one or several", () => {
    expect(getOnCallDirectPagePagingMessage(1)).toBe("1 person was paged.");
    expect(getOnCallDirectPagePagingMessage(2)).toBe("2 people were paged.");
    expect(getOnCallDirectPagePagingMessage(37)).toBe("37 people were paged.");
  });

  test("that it reached nobody", () => {
    expect(ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE).toBe("Nobody was paged.");
  });

  test("its timeline says why a team or the whole page reached nobody", () => {
    expect(ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE).toBe(
      "Skipped because this team has no members.",
    );
    expect(ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE).toBe(
      "Skipped because there was nobody to page.",
    );
  });

  test("a timeline line starts as every skipped line does, so it reads back as a reason", () => {
    // OnCallPolicyRunMessage reads "Skipped because ..." back as "...".
    for (const message of [
      ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
      ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
    ]) {
      expect(message.indexOf("Skipped because ")).toBe(0);
      expect(message.charAt(message.length - 1)).toBe(".");
    }
  });
});

describe("what a create that names no policy is told", () => {
  test("to name the policy, and where direct pages are started", () => {
    expect(ON_CALL_POLICY_REQUIRED_MESSAGE).toContain(
      "On-Call Policy ID is required.",
    );

    for (const step of [
      "Page Users",
      "Page a Team",
      "Page Whoever Is On Call",
    ]) {
      expect(ON_CALL_POLICY_REQUIRED_MESSAGE).toContain(step);
    }
  });
});
