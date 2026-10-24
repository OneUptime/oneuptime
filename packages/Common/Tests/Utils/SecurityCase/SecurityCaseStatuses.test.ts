import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import { Blue, Green, Red, Yellow } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseStage, {
  SECURITY_CASE_STAGES,
} from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStatuses, {
  DEFAULT_SECURITY_CASE_STATUSES,
  DefaultSecurityCaseStatus,
  SecurityCaseStatusChange,
} from "../../../Utils/SecurityCase/SecurityCaseStatuses";
import {
  TEST_STATUS_IDS,
  buildDefaultTestStatuses,
  buildTestStatus,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";
import { describe, expect, test } from "@jest/globals";

/*
 * What a case's status counts as - new, acknowledged, contained or closed -
 * by where the status sits in the project's own list, and what moving a
 * case between two statuses records on it.
 */

const QUEUED_ID: string = "c2000000-0000-4000-8000-0000000000a1";
const ERADICATING_ID: string = "c2000000-0000-4000-8000-0000000000a2";
const DUPLICATE_ID: string = "c2000000-0000-4000-8000-0000000000a3";
const UNKNOWN_ID: string = "c2000000-0000-4000-8000-0000000000ff";

const NEW_ID: string = TEST_STATUS_IDS[SecurityCaseStage.New];
const ACKNOWLEDGED_ID: string = TEST_STATUS_IDS[SecurityCaseStage.Acknowledged];
const CONTAINED_ID: string = TEST_STATUS_IDS[SecurityCaseStage.Contained];
const CLOSED_ID: string = TEST_STATUS_IDS[SecurityCaseStage.Closed];

/*
 * A team with a process of its own: a "Queued" above Investigating, an
 * "Eradicating" after Contained, a "Closed - Duplicate" after Closed, and
 * the built-ins renamed - stored out of order, as the database hands rows
 * back.
 */
function buildTeamStatuses(): Array<SecurityCaseStatus> {
  return [
    buildTestStatus({
      id: DUPLICATE_ID,
      name: "Closed - Duplicate",
      order: 7,
    }),
    buildTestStatus({
      id: CONTAINED_ID,
      name: "Contained",
      order: 4,
      stage: SecurityCaseStage.Contained,
    }),
    buildTestStatus({
      id: NEW_ID,
      name: "Untriaged",
      order: 1,
      stage: SecurityCaseStage.New,
    }),
    buildTestStatus({
      id: ERADICATING_ID,
      name: "Eradicating",
      order: 5,
    }),
    buildTestStatus({
      id: QUEUED_ID,
      name: "Queued",
      order: 2,
    }),
    buildTestStatus({
      id: CLOSED_ID,
      name: "Resolved",
      order: 6,
      stage: SecurityCaseStage.Closed,
    }),
    buildTestStatus({
      id: ACKNOWLEDGED_ID,
      name: "Working",
      order: 3,
      stage: SecurityCaseStage.Acknowledged,
    }),
  ];
}

function namesOf(statuses: Array<SecurityCaseStatus>): Array<string> {
  return statuses.map((status: SecurityCaseStatus): string => {
    return status.name || "";
  });
}

const NOTHING: SecurityCaseStatusChange = {
  acknowledges: false,
  contains: false,
  closes: false,
  reopens: false,
};

describe("a new project's case statuses", () => {
  test("are the steps cases always went through: the same names, order and colours", () => {
    expect(
      DEFAULT_SECURITY_CASE_STATUSES.map((status: DefaultSecurityCaseStatus) => {
        return [status.name, status.order, status.color, status.stage];
      }),
    ).toEqual([
      ["New", 1, Red, SecurityCaseStage.New],
      ["Investigating", 2, Yellow, SecurityCaseStage.Acknowledged],
      ["Contained", 3, Blue, SecurityCaseStage.Contained],
      ["Closed", 4, Green, SecurityCaseStage.Closed],
    ]);

    for (const status of DEFAULT_SECURITY_CASE_STATUSES) {
      expect(status.description.length).toBeGreaterThan(10);
      expect(status.description.length).toBeLessThanOrEqual(150);
    }
  });

  test("count as their own stage each", () => {
    const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();

    for (const stage of SECURITY_CASE_STAGES) {
      expect(SecurityCaseStatuses.getStage(statuses, testStatusId(stage))).toBe(
        stage,
      );
      expect(
        SecurityCaseStatuses.getStatusOfStage(statuses, stage)?._id,
      ).toBe(TEST_STATUS_IDS[stage]);
    }
  });
});

describe("what a status counts as", () => {
  test("follows from where it sits, not from its name", () => {
    const statuses: Array<SecurityCaseStatus> = buildTeamStatuses();
    const stages: Array<[string, SecurityCaseStage | null]> =
      SecurityCaseStatuses.sort(statuses).map(
        (status: SecurityCaseStatus): [string, SecurityCaseStage | null] => {
          return [
            status.name || "",
            SecurityCaseStatuses.getStage(statuses, status._id),
          ];
        },
      );

    expect(stages).toEqual([
      ["Untriaged", SecurityCaseStage.New],
      // Above the acknowledged status: still nobody's.
      ["Queued", SecurityCaseStage.New],
      ["Working", SecurityCaseStage.Acknowledged],
      ["Contained", SecurityCaseStage.Contained],
      // After Contained, before Closed: contained, still open.
      ["Eradicating", SecurityCaseStage.Contained],
      ["Resolved", SecurityCaseStage.Closed],
      // After Closed: closed too.
      ["Closed - Duplicate", SecurityCaseStage.Closed],
    ]);
  });

  test("a status above the new one counts as new", () => {
    const statuses: Array<SecurityCaseStatus> = [
      buildTestStatus({ id: QUEUED_ID, name: "Inbox", order: 1 }),
      ...buildDefaultTestStatuses().map((status: SecurityCaseStatus) => {
        status.order = (status.order || 0) + 1;
        return status;
      }),
    ];

    expect(SecurityCaseStatuses.getStage(statuses, QUEUED_ID)).toBe(
      SecurityCaseStage.New,
    );
    expect(SecurityCaseStatuses.isOpen(statuses, QUEUED_ID)).toBe(true);
  });

  test("a status with no place counts as its own flag says, else new", () => {
    const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
    const placeless: SecurityCaseStatus = buildTestStatus({
      id: QUEUED_ID,
      name: "Somewhere",
      order: 0,
    });
    (placeless as unknown as { order: number | undefined }).order = undefined;
    const placelessClosed: SecurityCaseStatus = buildTestStatus({
      id: DUPLICATE_ID,
      name: "Closed again",
      order: 0,
      stage: SecurityCaseStage.Closed,
    });
    (placelessClosed as unknown as { order: number | undefined }).order = undefined;

    expect(
      SecurityCaseStatuses.getStage([...statuses, placeless], QUEUED_ID),
    ).toBe(SecurityCaseStage.New);
    expect(
      SecurityCaseStatuses.getStage(
        [...statuses, placelessClosed],
        DUPLICATE_ID,
      ),
    ).toBe(SecurityCaseStage.Closed);
  });

  test("an id that is none of the project's statuses counts as nothing", () => {
    const statuses: Array<SecurityCaseStatus> = buildTeamStatuses();

    expect(SecurityCaseStatuses.getStage(statuses, UNKNOWN_ID)).toBeNull();
    expect(SecurityCaseStatuses.getStage(statuses, undefined)).toBeNull();
    expect(SecurityCaseStatuses.getStage(statuses, "")).toBeNull();
    expect(SecurityCaseStatuses.isOpen(statuses, UNKNOWN_ID)).toBe(false);
    expect(SecurityCaseStatuses.isClosed(statuses, UNKNOWN_ID)).toBe(false);
    expect(
      SecurityCaseStatuses.hasReached(
        statuses,
        UNKNOWN_ID,
        SecurityCaseStage.New,
      ),
    ).toBe(false);
  });

  test("reads an id however it is spelled", () => {
    const statuses: Array<SecurityCaseStatus> = buildTeamStatuses();

    expect(
      SecurityCaseStatuses.getStage(statuses, new ObjectID(ERADICATING_ID)),
    ).toBe(SecurityCaseStage.Contained);
    expect(
      SecurityCaseStatuses.getStage(statuses, ERADICATING_ID.toUpperCase()),
    ).toBe(SecurityCaseStage.Contained);
    expect(SecurityCaseStatuses.find(statuses, ERADICATING_ID)?.name).toBe(
      "Eradicating",
    );
  });

  test("has reached a stage at or past it", () => {
    const statuses: Array<SecurityCaseStatus> = buildTeamStatuses();

    expect(
      SecurityCaseStatuses.hasReached(
        statuses,
        ERADICATING_ID,
        SecurityCaseStage.Acknowledged,
      ),
    ).toBe(true);
    expect(
      SecurityCaseStatuses.hasReached(
        statuses,
        ERADICATING_ID,
        SecurityCaseStage.Contained,
      ),
    ).toBe(true);
    expect(
      SecurityCaseStatuses.hasReached(
        statuses,
        ERADICATING_ID,
        SecurityCaseStage.Closed,
      ),
    ).toBe(false);
    expect(
      SecurityCaseStatuses.hasReached(
        statuses,
        QUEUED_ID,
        SecurityCaseStage.Acknowledged,
      ),
    ).toBe(false);
  });
});

describe("the open and closed statuses", () => {
  test("every status before the closed one is open; it and after it are closed", () => {
    const statuses: Array<SecurityCaseStatus> = buildTeamStatuses();

    expect(namesOf(SecurityCaseStatuses.getOpenStatuses(statuses))).toEqual([
      "Untriaged",
      "Queued",
      "Working",
      "Contained",
      "Eradicating",
    ]);
    expect(namesOf(SecurityCaseStatuses.getClosedStatuses(statuses))).toEqual([
      "Resolved",
      "Closed - Duplicate",
    ]);
    expect(SecurityCaseStatuses.getOpenStatusIds(statuses)).toEqual([
      NEW_ID,
      QUEUED_ID,
      ACKNOWLEDGED_ID,
      CONTAINED_ID,
      ERADICATING_ID,
    ]);
    expect(SecurityCaseStatuses.getClosedStatusIds(statuses)).toEqual([
      CLOSED_ID,
      DUPLICATE_ID,
    ]);
  });

  test("the built-in of each stage is where OneUptime moves a case", () => {
    const statuses: Array<SecurityCaseStatus> = buildTeamStatuses();

    expect(
      SecurityCaseStatuses.getStatusOfStage(statuses, SecurityCaseStage.New)
        ?.name,
    ).toBe("Untriaged");
    expect(
      SecurityCaseStatuses.getStatusOfStage(
        statuses,
        SecurityCaseStage.Acknowledged,
      )?.name,
    ).toBe("Working");
    expect(
      SecurityCaseStatuses.getStatusOfStage(statuses, SecurityCaseStage.Closed)
        ?.name,
    ).toBe("Resolved");
    expect(
      SecurityCaseStatuses.getStatusOfStage([], SecurityCaseStage.Closed),
    ).toBeNull();
  });

  test("follows a drag: moving Eradicating below Closed closes the cases in it", () => {
    const statuses: Array<SecurityCaseStatus> = buildTeamStatuses();
    const eradicating: SecurityCaseStatus = SecurityCaseStatuses.find(
      statuses,
      ERADICATING_ID,
    )!;
    const resolved: SecurityCaseStatus = SecurityCaseStatuses.find(
      statuses,
      CLOSED_ID,
    )!;

    eradicating.order = 6;
    resolved.order = 5;

    expect(SecurityCaseStatuses.isClosed(statuses, ERADICATING_ID)).toBe(true);
    expect(SecurityCaseStatuses.getOpenStatusIds(statuses)).not.toContain(
      ERADICATING_ID,
    );
  });
});

describe("what moving a case records on it", () => {
  test("taking a new case on acknowledges it", () => {
    expect(
      SecurityCaseStatuses.getStatusChange({
        statuses: buildTeamStatuses(),
        fromStatusId: NEW_ID,
        toStatusId: ACKNOWLEDGED_ID,
      }),
    ).toEqual({ ...NOTHING, acknowledges: true });
  });

  test("a status of the project's own above Investigating acknowledges nothing", () => {
    expect(
      SecurityCaseStatuses.getStatusChange({
        statuses: buildTeamStatuses(),
        fromStatusId: NEW_ID,
        toStatusId: QUEUED_ID,
      }),
    ).toEqual(NOTHING);
  });

  test("containing it, straight from New, acknowledges and contains it", () => {
    expect(
      SecurityCaseStatuses.getStatusChange({
        statuses: buildTeamStatuses(),
        fromStatusId: NEW_ID,
        toStatusId: CONTAINED_ID,
      }),
    ).toEqual({ ...NOTHING, acknowledges: true, contains: true });
    // Eradicating counts as contained too.
    expect(
      SecurityCaseStatuses.getStatusChange({
        statuses: buildTeamStatuses(),
        fromStatusId: ACKNOWLEDGED_ID,
        toStatusId: ERADICATING_ID,
      }),
    ).toEqual({ ...NOTHING, acknowledges: true, contains: true });
  });

  test("closing a false positive from New acknowledges and closes it, never contains it", () => {
    expect(
      SecurityCaseStatuses.getStatusChange({
        statuses: buildTeamStatuses(),
        fromStatusId: NEW_ID,
        toStatusId: CLOSED_ID,
      }),
    ).toEqual({ ...NOTHING, acknowledges: true, closes: true });
  });

  test("moving between two closed statuses neither closes nor reopens", () => {
    expect(
      SecurityCaseStatuses.getStatusChange({
        statuses: buildTeamStatuses(),
        fromStatusId: CLOSED_ID,
        toStatusId: DUPLICATE_ID,
      }),
    ).toEqual({ ...NOTHING, acknowledges: true });
  });

  test("moving a closed case back to an open status reopens it", () => {
    expect(
      SecurityCaseStatuses.getStatusChange({
        statuses: buildTeamStatuses(),
        fromStatusId: DUPLICATE_ID,
        toStatusId: ACKNOWLEDGED_ID,
      }),
    ).toEqual({ ...NOTHING, acknowledges: true, reopens: true });
    expect(
      SecurityCaseStatuses.getStatusChange({
        statuses: buildTeamStatuses(),
        fromStatusId: CLOSED_ID,
        toStatusId: NEW_ID,
      }),
    ).toEqual({ ...NOTHING, reopens: true });
  });

  test("a status that is none of the project's records nothing", () => {
    expect(
      SecurityCaseStatuses.getStatusChange({
        statuses: buildTeamStatuses(),
        fromStatusId: NEW_ID,
        toStatusId: UNKNOWN_ID,
      }),
    ).toEqual(NOTHING);
    // From one, the case was not closed: closing it closes it.
    expect(
      SecurityCaseStatuses.getStatusChange({
        statuses: buildTeamStatuses(),
        fromStatusId: UNKNOWN_ID,
        toStatusId: CLOSED_ID,
      }),
    ).toEqual({ ...NOTHING, acknowledges: true, closes: true });
  });

  test("a case created in a status records what moving into it from nowhere does", () => {
    const statuses: Array<SecurityCaseStatus> = buildTeamStatuses();

    expect(
      SecurityCaseStatuses.getCreatedStatusChange({
        statuses,
        statusId: NEW_ID,
      }),
    ).toEqual(NOTHING);
    expect(
      SecurityCaseStatuses.getCreatedStatusChange({
        statuses,
        statusId: CLOSED_ID,
      }),
    ).toEqual({ ...NOTHING, acknowledges: true, closes: true });
    expect(
      SecurityCaseStatuses.getCreatedStatusChange({
        statuses,
        statusId: ERADICATING_ID,
      }),
    ).toEqual({ ...NOTHING, acknowledges: true, contains: true });
  });
});
