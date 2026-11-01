import { describe, expect, test } from "@jest/globals";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import { PeoplePickerKind } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import {
  DEFAULT_EXCEPTION_LIST_SORT,
  EXCEPTION_LIST_SORT_LABELS,
  ExceptionListSort,
  getExceptionAssigneeAvatar,
  getExceptionAssigneeValue,
  getExceptionAssignmentWrite,
  getExceptionListSortOrder,
  isSameAssignment,
  readExceptionListSort,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionAssignment";

/*
 * Who owns an exception and the order the list shows them in
 * (ExceptionAssignment): one person or one team, picked, written, compared
 * and drawn the same way by the header, the row and Bulk Actions.
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const TEAM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

function exceptionWith(
  values: Partial<TelemetryException> = {},
): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  Object.assign(exception, values);
  return exception;
}

describe("the picker's value", () => {
  test("a person, a team, or nobody", () => {
    expect(
      getExceptionAssigneeValue(exceptionWith({ assignToUserId: USER_ID })),
    ).toEqual({ [PeoplePickerKind.User]: [USER_ID.toString()] });
    expect(
      getExceptionAssigneeValue(exceptionWith({ assignToTeamId: TEAM_ID })),
    ).toEqual({ [PeoplePickerKind.Team]: [TEAM_ID.toString()] });
    expect(getExceptionAssigneeValue(exceptionWith())).toEqual({});
  });
});

describe("what a pick writes", () => {
  test("a person, with the team cleared", () => {
    expect(
      getExceptionAssignmentWrite({
        [PeoplePickerKind.User]: [USER_ID.toString()],
      }),
    ).toEqual({ assignToUserId: USER_ID, assignToTeamId: null });
  });

  test("a team, with the person cleared", () => {
    expect(
      getExceptionAssignmentWrite({
        [PeoplePickerKind.Team]: [TEAM_ID.toString()],
      }),
    ).toEqual({ assignToUserId: null, assignToTeamId: TEAM_ID });
  });

  test("nobody unassigns", () => {
    expect(getExceptionAssignmentWrite({})).toEqual({
      assignToUserId: null,
      assignToTeamId: null,
    });
    expect(
      getExceptionAssignmentWrite({ [PeoplePickerKind.User]: [] }),
    ).toEqual({ assignToUserId: null, assignToTeamId: null });
  });

  test("a person wins over a team if a value ever holds both", () => {
    expect(
      getExceptionAssignmentWrite({
        [PeoplePickerKind.User]: [USER_ID.toString()],
        [PeoplePickerKind.Team]: [TEAM_ID.toString()],
      }),
    ).toEqual({ assignToUserId: USER_ID, assignToTeamId: null });
  });
});

describe("whether a write changes anything", () => {
  test("the same person, the same team, or nobody again is no change", () => {
    expect(
      isSameAssignment(exceptionWith({ assignToUserId: USER_ID }), {
        assignToUserId: new ObjectID(USER_ID.toString()),
        assignToTeamId: null,
      }),
    ).toBe(true);
    expect(
      isSameAssignment(exceptionWith(), {
        assignToUserId: null,
        assignToTeamId: null,
      }),
    ).toBe(true);
  });

  test("another person, or a team in their place, is a change", () => {
    expect(
      isSameAssignment(exceptionWith({ assignToUserId: USER_ID }), {
        assignToUserId: null,
        assignToTeamId: TEAM_ID,
      }),
    ).toBe(false);
    expect(
      isSameAssignment(exceptionWith(), {
        assignToUserId: USER_ID,
        assignToTeamId: null,
      }),
    ).toBe(false);
  });
});

describe("the row's assignee", () => {
  test("a person by name, or by email when they have none", () => {
    const user: User = new User();
    user.name = new Name("Priya Raman");

    expect(
      getExceptionAssigneeAvatar(
        exceptionWith({ assignToUserId: USER_ID, assignToUser: user }),
      ),
    ).toEqual({
      kind: PeoplePickerKind.User,
      name: "Priya Raman",
      userId: USER_ID,
    });

    const nameless: User = new User();
    nameless.email = new Email("ops@example.com");

    expect(
      getExceptionAssigneeAvatar(
        exceptionWith({ assignToUserId: USER_ID, assignToUser: nameless }),
      )?.name,
    ).toBe("ops@example.com");
  });

  test("a team by name", () => {
    const team: Team = new Team();
    team.name = "Payments";

    expect(
      getExceptionAssigneeAvatar(
        exceptionWith({ assignToTeamId: TEAM_ID, assignToTeam: team }),
      ),
    ).toEqual({ kind: PeoplePickerKind.Team, name: "Payments" });
  });

  test("nobody, or someone the reader cannot see, shows no chip", () => {
    expect(getExceptionAssigneeAvatar(exceptionWith())).toBeNull();
    expect(
      getExceptionAssigneeAvatar(exceptionWith({ assignToUserId: USER_ID })),
    ).toBeNull();
  });
});

describe("the list's order", () => {
  test("last seen by default; an unknown order reads as the default", () => {
    expect(DEFAULT_EXCEPTION_LIST_SORT).toBe(ExceptionListSort.LastSeen);
    expect(readExceptionListSort(null)).toBe(ExceptionListSort.LastSeen);
    expect(readExceptionListSort("oldest")).toBe(ExceptionListSort.LastSeen);
    expect(readExceptionListSort("most-events")).toBe(
      ExceptionListSort.MostEvents,
    );
  });

  test("each order sorts on its column, then by last seen", () => {
    expect(getExceptionListSortOrder(ExceptionListSort.LastSeen)).toEqual({
      lastSeenAt: SortOrder.Descending,
    });
    expect(getExceptionListSortOrder(ExceptionListSort.FirstSeen)).toEqual({
      firstSeenAt: SortOrder.Descending,
      lastSeenAt: SortOrder.Descending,
    });
    expect(getExceptionListSortOrder(ExceptionListSort.MostEvents)).toEqual({
      occuranceCount: SortOrder.Descending,
      lastSeenAt: SortOrder.Descending,
    });
  });

  test("every order has its label", () => {
    expect(EXCEPTION_LIST_SORT_LABELS).toEqual({
      [ExceptionListSort.LastSeen]: "Last seen",
      [ExceptionListSort.FirstSeen]: "First seen",
      [ExceptionListSort.MostEvents]: "Most events",
    });
  });
});
