import { describe, expect, test } from "@jest/globals";
import IncomingCallPolicyEscalationRule from "../../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import ObjectID from "../../../../Types/ObjectID";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  PeoplePickerValue,
  readPeoplePickerFormValue,
  replacePeoplePickerValue,
  toPeoplePickerFormValue,
  toPeoplePickerFormValues,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

/*
 * A picker field that takes one pick (isSinglePick) - an incoming call
 * rule's "Who to call", one on-call schedule or one person. A pick replaces
 * the last one, of either kind, and each kind's form value is that one id or
 * null - the shape of the rule's own onCallDutyPolicyScheduleId and userId
 * columns, which are its value keys. A picker without isSinglePick writes
 * lists exactly as before; the owners pickers, the escalation rule's Notify
 * and the on-call policy's first responders all rely on that.
 */

const SCHEDULE: string = "0000000c-0000-4000-8000-000000000001";
const OTHER_SCHEDULE: string = "0000000c-0000-4000-8000-000000000002";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";

const WHO_TO_CALL: PeoplePickerFieldConfig = {
  kinds: [
    {
      kind: PeoplePickerKind.OnCallSchedule,
      valueKey: "onCallDutyPolicyScheduleId",
    },
    { kind: PeoplePickerKind.User, valueKey: "userId" },
  ],
  isSinglePick: true,
};

const OWNERS: PeoplePickerFieldConfig = {
  kinds: [
    { kind: PeoplePickerKind.User, valueKey: "ownerUsers" },
    { kind: PeoplePickerKind.Team, valueKey: "ownerTeams" },
  ],
};

describe("a single pick", () => {
  test("replaces whatever was picked, of any kind", () => {
    expect(replacePeoplePickerValue(PeoplePickerKind.User, ADA)).toEqual({
      [PeoplePickerKind.User]: [ADA],
    });

    expect(
      replacePeoplePickerValue(PeoplePickerKind.OnCallSchedule, SCHEDULE),
    ).toEqual({ [PeoplePickerKind.OnCallSchedule]: [SCHEDULE] });
  });
});

describe("a single-pick field's form values", () => {
  test("hold the picked kind's one id, and null for the other kind", () => {
    expect(
      toPeoplePickerFormValues(WHO_TO_CALL, {
        [PeoplePickerKind.OnCallSchedule]: [SCHEDULE],
      }),
    ).toEqual({ onCallDutyPolicyScheduleId: SCHEDULE, userId: null });

    expect(
      toPeoplePickerFormValues(WHO_TO_CALL, {
        [PeoplePickerKind.User]: [ADA],
      }),
    ).toEqual({ onCallDutyPolicyScheduleId: null, userId: ADA });
  });

  test("hold null for every kind when nothing is picked", () => {
    expect(toPeoplePickerFormValues(WHO_TO_CALL, {})).toEqual({
      onCallDutyPolicyScheduleId: null,
      userId: null,
    });
  });

  test("are the rule's own columns", () => {
    const rule: IncomingCallPolicyEscalationRule =
      new IncomingCallPolicyEscalationRule();

    for (const key of Object.keys(toPeoplePickerFormValues(WHO_TO_CALL, {}))) {
      expect(rule.hasColumn(key)).toBe(true);
    }
  });

  test("read back as the value they were written from", () => {
    const value: PeoplePickerValue = replacePeoplePickerValue(
      PeoplePickerKind.User,
      ADA,
    );

    expect(
      readPeoplePickerFormValue(
        WHO_TO_CALL,
        toPeoplePickerFormValues(WHO_TO_CALL, value),
      ),
    ).toEqual({
      [PeoplePickerKind.OnCallSchedule]: [],
      [PeoplePickerKind.User]: [ADA],
    });
  });

  test("read a saved rule's columns, an ObjectID or null each", () => {
    expect(
      readPeoplePickerFormValue(WHO_TO_CALL, {
        onCallDutyPolicyScheduleId: new ObjectID(SCHEDULE),
        userId: null,
      }),
    ).toEqual({
      [PeoplePickerKind.OnCallSchedule]: [SCHEDULE],
      [PeoplePickerKind.User]: [],
    });
  });
});

describe("one kind's form value, in the shape the field writes it", () => {
  test("is one id for a single-pick field, whatever the form held", () => {
    expect(toPeoplePickerFormValue(WHO_TO_CALL, SCHEDULE)).toBe(SCHEDULE);
    expect(toPeoplePickerFormValue(WHO_TO_CALL, new ObjectID(SCHEDULE))).toBe(
      SCHEDULE,
    );
    expect(toPeoplePickerFormValue(WHO_TO_CALL, [SCHEDULE])).toBe(SCHEDULE);
    expect(toPeoplePickerFormValue(WHO_TO_CALL, { _id: SCHEDULE })).toBe(
      SCHEDULE,
    );
  });

  test("is the first id when a single-pick field was handed several", () => {
    expect(
      toPeoplePickerFormValue(WHO_TO_CALL, [SCHEDULE, OTHER_SCHEDULE]),
    ).toBe(SCHEDULE);
  });

  test("is null for a single-pick field holding nothing", () => {
    expect(toPeoplePickerFormValue(WHO_TO_CALL, null)).toBeNull();
    expect(toPeoplePickerFormValue(WHO_TO_CALL, undefined)).toBeNull();
    expect(toPeoplePickerFormValue(WHO_TO_CALL, "")).toBeNull();
    expect(toPeoplePickerFormValue(WHO_TO_CALL, [])).toBeNull();
  });

  test("is still a list for a field that takes several picks", () => {
    expect(toPeoplePickerFormValue(OWNERS, ADA)).toEqual([ADA]);
    expect(toPeoplePickerFormValue(OWNERS, new ObjectID(ADA))).toEqual([ADA]);
    expect(toPeoplePickerFormValue(OWNERS, [ADA, PLATFORM])).toEqual([
      ADA,
      PLATFORM,
    ]);
    expect(toPeoplePickerFormValue(OWNERS, null)).toEqual([]);
  });
});

describe("a field that takes several picks", () => {
  test("still writes every kind as a list", () => {
    expect(
      toPeoplePickerFormValues(OWNERS, {
        [PeoplePickerKind.User]: [ADA],
      }),
    ).toEqual({ ownerUsers: [ADA], ownerTeams: [] });
  });

  test("is one unless it says it takes a single pick", () => {
    expect(OWNERS.isSinglePick).toBeUndefined();
    expect(
      toPeoplePickerFormValues(
        { ...WHO_TO_CALL, isSinglePick: false },
        { [PeoplePickerKind.User]: [ADA] },
      ),
    ).toEqual({ onCallDutyPolicyScheduleId: [], userId: [ADA] });
  });
});
