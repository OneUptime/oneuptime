import {
  USER_OVERRIDE_AWAY_LOCKED_TEXT,
  USER_OVERRIDE_END_NOW_TEXT,
  USER_OVERRIDE_SAME_PERSON_MESSAGE,
  USER_OVERRIDE_START_LOCKED_TEXT,
  USER_OVERRIDE_START_MOVABLE_TEXT,
  getUserOverrideEditTimeError,
  getUserOverrideFormFields,
  isUserOverrideOverlapRefusal,
  prepareUserOverrideForUpdate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import {
  getUserOverrideOverlapAnswer,
  getUserOverrideOverlapCandidate,
  getUserOverrideOverlapKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideOverlapCheck";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  USER_OVERRIDE_ENDED_REFUSAL,
  USER_OVERRIDE_END_IN_PAST_REFUSAL,
  USER_OVERRIDE_STARTED_REFUSAL,
  USER_OVERRIDE_START_IN_PAST_REFUSAL,
  UserOverrideSavedTimes,
} from "../../../Types/OnCallDutyPolicy/UserOverrideEdit";
import {
  USER_OVERRIDE_CONFLICT_WHAT_TO_DO,
  UserOverrideTimes,
} from "../../../Types/OnCallDutyPolicy/UserOverrideOverlap";
import Field from "../../../UI/Components/Forms/Types/Field";
import OneUptimeDate from "../../../Types/Date";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * THE ONE FORM OF AN OVERRIDE ALSO EDITS ONE (issue #7631), AND SAYS WHAT
 * ITS TIMES OVERLAP (issue #7630).
 *
 * Pins the React-free halves of the Add and Edit dialog
 * (UserOverrideFormModal):
 *
 *   - the Edit form's four rows: who is away shown and never sent; when it
 *     starts shown and not changed once the override has started; Ends
 *     saying how to end it now; the times held to the server's rules
 *     (UserOverrideEdit) under the field each rule is about;
 *   - what an edit sends: who covers - or none, for the rotation - and the
 *     times; never who is away, the policy or the project;
 *   - what the dialog asks the overlap check (UserOverrideOverlapCheck):
 *     nothing until who is away and both times are picked in order, nothing
 *     for an edit that moves neither time, and one question per override,
 *     person, scope and pair of minutes.
 */

const JANE: string = "7631eeee-0000-4000-8000-0000000000a1";
const BOB: string = "7631eeee-0000-4000-8000-0000000000b1";
const POLICY: string = "7631eeee-0000-4000-8000-000000000002";
const OTHER_POLICY: string = "7631eeee-0000-4000-8000-000000000003";
const EDITED: string = "7631eeee-0000-4000-8000-0000000000e1";

// Half a minute into noon, UTC.
const NOW: Date = new Date("2026-11-13T12:00:30.000Z");

const at: (time: string) => Date = (time: string): Date => {
  return new Date(time.includes("T") ? `${time}Z` : `2026-11-13T${time}Z`);
};

// Tomorrow 9 to 5, and one under way since 8:00:45 until 8 tonight.
const UPCOMING: UserOverrideSavedTimes = {
  startsAt: at("2026-11-14T09:00:00"),
  endsAt: at("2026-11-14T17:00:00"),
};
const RUNNING: UserOverrideSavedTimes = {
  startsAt: at("08:00:45"),
  endsAt: at("20:00:00"),
};

type OverrideField = Field<OnCallDutyPolicyUserOverride>;

function editFields(
  saved: UserOverrideSavedTimes,
  extra: {
    isKnownOverlap?: (values: unknown) => boolean;
  } = {},
): Array<OverrideField> {
  return getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
    currentUserId: BOB,
    editing: { saved: saved, now: NOW },
    ...extra,
  });
}

function byTitle(list: Array<OverrideField>, title: string): OverrideField {
  const field: OverrideField | undefined = list.find(
    (candidate: OverrideField): boolean => {
      return candidate.title === title;
    },
  );

  if (!field) {
    throw new Error(`No field titled ${title}`);
  }

  return field;
}

function validate(field: OverrideField, values: unknown): string | null {
  return field.customValidation
    ? field.customValidation(values as never)
    : null;
}

describe("the Edit form's rows", () => {
  test("the same four questions, in the same order", () => {
    expect(
      editFields(UPCOMING).map((field: OverrideField): string => {
        return field.title || "";
      }),
    ).toEqual(["Who is away?", "Who covers?", "Starts", "Ends"]);
  });

  test("who is away is shown as saved, never changed: its column takes no change, so the row is kept on the form though it may not be written", () => {
    const away: OverrideField = byTitle(editFields(UPCOMING), "Who is away?");

    expect(away.disabled).toBe(true);
    expect(away.showEvenIfPermissionDoesNotExist).toBe(true);
    expect(away.description).toBe(USER_OVERRIDE_AWAY_LOCKED_TEXT);
    // The person alone: no Change button, locked or not.
    expect(away.peoplePicker?.isReadOnly).toBe(true);
    expect(
      byTitle(
        getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({}),
        "Who is away?",
      ).peoplePicker?.isReadOnly,
    ).toBe(false);
  });

  test("who covers is asked as it is when adding", () => {
    const cover: OverrideField = byTitle(editFields(RUNNING), "Who covers?");
    const added: OverrideField = byTitle(
      getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({}),
      "Who covers?",
    );

    expect(Boolean(cover.disabled)).toBe(false);
    expect(cover.description).toBe(added.description);
  });

  test("an override that has not started: its start can be moved, and Starts says to when - not that it starts now", () => {
    const starts: OverrideField = byTitle(editFields(UPCOMING), "Starts");

    expect(Boolean(starts.disabled)).toBe(false);
    expect(starts.description).toBe(USER_OVERRIDE_START_MOVABLE_TEXT);
    expect(byTitle(editFields(UPCOMING), "Ends").description).toBe(
      "From then on, alerts page the person who is away again.",
    );
  });

  /*
   * A row with no description of its own says its column's (BasicModelForm):
   * Starts of an override not started yet said "When the override starts
   * sending the Override User's alerts to the Route Alerts To User", in
   * English in every language.
   */
  test("every row of the Add form and of both Edit forms says something of its own", () => {
    const forms: Array<Array<OverrideField>> = [
      getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
        currentUserId: BOB,
      }),
      editFields(UPCOMING),
      editFields(RUNNING),
    ];

    for (const fields of forms) {
      for (const field of fields) {
        expect({
          title: field.title,
          description: (field.description || "").toString().trim().length > 0,
        }).toEqual({ title: field.title, description: true });
      }
    }
  });

  test("an override under way: its start is shown, not changed, and Ends says how to end it now", () => {
    const fields: Array<OverrideField> = editFields(RUNNING);

    expect(byTitle(fields, "Starts").disabled).toBe(true);
    expect(byTitle(fields, "Starts").description).toBe(
      USER_OVERRIDE_START_LOCKED_TEXT,
    );
    expect(byTitle(fields, "Ends").description).toBe(
      USER_OVERRIDE_END_NOW_TEXT,
    );
  });

  test("adding, nothing is locked and the rows read as they always did", () => {
    const fields: Array<OverrideField> =
      getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
        currentUserId: BOB,
      });

    expect(
      fields.map((field: OverrideField): unknown => {
        return [field.title, Boolean(field.disabled), field.description];
      }),
    ).toEqual([
      ["Who is away?", false, "They are not paged while they are away."],
      [
        "Who covers?",
        false,
        "Each of their turns goes to the next person in the rotation who is not away. Or pick someone to take all of their pages instead.",
      ],
      ["Starts", false, "It starts now unless you pick another time."],
      [
        "Ends",
        false,
        "From then on, alerts page the person who is away again.",
      ],
    ]);
  });
});

describe("the Edit form holds its times to the server's rules, under the field each is about", () => {
  const values: (startsAt: Date, endsAt: Date) => unknown = (
    startsAt: Date,
    endsAt: Date,
  ): unknown => {
    return { overrideUserId: JANE, startsAt: startsAt, endsAt: endsAt };
  };

  const errorOf: (
    saved: UserOverrideSavedTimes,
    key: string,
    startsAt: Date,
    endsAt: Date,
  ) => string | null = (
    saved: UserOverrideSavedTimes,
    key: string,
    startsAt: Date,
    endsAt: Date,
  ): string | null => {
    return getUserOverrideEditTimeError({
      values: values(startsAt, endsAt),
      saved: saved,
      key: key,
      now: NOW,
    });
  };

  test("a start moved once it has started is refused under Starts, and Ends says nothing of it", () => {
    expect(errorOf(RUNNING, "startsAt", at("09:00:00"), at("20:00:00"))).toBe(
      USER_OVERRIDE_STARTED_REFUSAL,
    );
    expect(
      errorOf(RUNNING, "endsAt", at("09:00:00"), at("20:00:00")),
    ).toBeNull();
  });

  test("its start sent back at the minute the picker shows it is no move", () => {
    expect(
      errorOf(RUNNING, "startsAt", at("08:00:00"), at("21:00:00")),
    ).toBeNull();
  });

  test("a start moved to the past is refused under Starts", () => {
    expect(errorOf(UPCOMING, "startsAt", at("11:00:00"), UPCOMING.endsAt)).toBe(
      USER_OVERRIDE_START_IN_PAST_REFUSAL,
    );
  });

  test("an end moved to the past is refused under Ends; this minute ends it now", () => {
    expect(errorOf(RUNNING, "endsAt", at("08:00:00"), at("11:59:00"))).toBe(
      USER_OVERRIDE_END_IN_PAST_REFUSAL,
    );
    expect(errorOf(RUNNING, "endsAt", at("08:00:00"), at("12:00:00"))).toBe(
      null,
    );
  });

  test("one that ended while the form was open is refused under Ends", () => {
    expect(
      getUserOverrideEditTimeError({
        values: values(at("08:00:00"), at("13:00:00")),
        saved: RUNNING,
        key: "endsAt",
        now: at("20:00:00"),
      }),
    ).toBe(USER_OVERRIDE_ENDED_REFUSAL);
  });

  test("the fields ask it as they are checked: Starts and Ends of the Edit form, never of the Add form", () => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    const fields: Array<OverrideField> = editFields(UPCOMING);
    const startMoved: unknown = values(at("11:00:00"), UPCOMING.endsAt);
    const endMoved: unknown = values(UPCOMING.startsAt, at("11:00:00"));

    expect(validate(byTitle(fields, "Starts"), startMoved)).toBe(
      USER_OVERRIDE_START_IN_PAST_REFUSAL,
    );
    expect(validate(byTitle(fields, "Ends"), startMoved)).toBeNull();
    // Before its start, too: Ends says that first.
    expect(validate(byTitle(fields, "Ends"), endMoved)).not.toBeNull();

    const added: Array<OverrideField> =
      getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({});

    expect(validate(byTitle(added, "Starts"), startMoved)).toBeNull();
    expect(validate(byTitle(added, "Ends"), startMoved)).toBeNull();
  });
});

describe("Ends and an overlap", () => {
  test("times known to overlap one they may not: Ends says to change them, and the form is not sent", () => {
    const ends: OverrideField = byTitle(
      editFields(UPCOMING, {
        isKnownOverlap: (): boolean => {
          return true;
        },
      }),
      "Ends",
    );

    expect(
      validate(ends, {
        overrideUserId: JANE,
        startsAt: UPCOMING.startsAt,
        endsAt: new Date("2099-01-01T00:00:00.000Z"),
      }),
    ).toBe(USER_OVERRIDE_CONFLICT_WHAT_TO_DO);
  });

  test("the server's refusal of an overlap is said under Ends, and nothing else is", () => {
    const ends: OverrideField = byTitle(editFields(UPCOMING), "Ends");
    const refusal: string = `Jane Doe is already covered by Bob Lee on this policy from Nov 14, 2026, 9:00 AM UTC to Nov 14, 2026, 5:00 PM UTC. ${USER_OVERRIDE_CONFLICT_WHAT_TO_DO}`;

    expect(ends.ownsServerError!(refusal)).toBe(true);
    expect(isUserOverrideOverlapRefusal(refusal)).toBe(true);
    expect(ends.ownsServerError!(USER_OVERRIDE_STARTED_REFUSAL)).toBe(false);
  });

  test("the footer draws nothing unless the dialog hands one in, and then the dialog's, with the values and the error", () => {
    const values: Record<string, unknown> = {
      overrideUserId: JANE,
      startsAt: UPCOMING.startsAt,
      endsAt: UPCOMING.endsAt,
    };

    expect(
      byTitle(editFields(UPCOMING), "Ends").getFooterElement!(
        values as never,
        "An error",
      ),
    ).toBeUndefined();

    // What the dialog draws: UserOverrideOverlapNotice, in the page.
    const footer: ReturnType<NonNullable<OverrideField["getFooterElement"]>> = {
      type: "div",
      props: {},
      key: null,
    } as never;
    const asked: Array<[unknown, string | undefined]> = [];
    const getEndsFooter: (values: unknown, error?: string) => typeof footer = (
      footerValues: unknown,
      error?: string,
    ): typeof footer => {
      asked.push([footerValues, error]);
      return footer;
    };

    const ends: OverrideField = byTitle(
      getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
        currentUserId: BOB,
        editing: { saved: UPCOMING, now: NOW },
        getEndsFooter: getEndsFooter,
      }),
      "Ends",
    );

    expect(ends.getFooterElement!(values as never, "An error")).toBe(footer);
    expect(asked).toEqual([[values, "An error"]]);
  });
});

describe("what an edit sends", () => {
  function edited(data: {
    cover: string | null;
    startsAt?: Date;
  }): OnCallDutyPolicyUserOverride {
    const override: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();
    override._id = EDITED;
    override.projectId = new ObjectID("7631eeee-0000-4000-8000-000000000001");
    override.onCallDutyPolicyId = new ObjectID(POLICY);
    override.overrideUserId = new ObjectID(JANE);

    if (data.cover) {
      override.routeAlertsToUserId = new ObjectID(data.cover);
    }

    override.startsAt = data.startsAt || UPCOMING.startsAt;
    override.endsAt = UPCOMING.endsAt;
    return override;
  }

  test("who covers and the times; never who is away, its policy or its project", () => {
    const sent: OnCallDutyPolicyUserOverride = prepareUserOverrideForUpdate(
      edited({ cover: BOB }),
      { isStartLocked: false },
    );

    expect(sent.overrideUserId).toBeUndefined();
    expect(sent.onCallDutyPolicyId).toBeUndefined();
    expect(sent.projectId).toBeUndefined();
    expect(sent.routeAlertsToUserId?.toString()).toBe(BOB);
    expect(sent.startsAt).toEqual(UPCOMING.startsAt);
    expect(sent.endsAt).toEqual(UPCOMING.endsAt);
  });

  test("nobody to cover is sent as none, so the rotation covers - left out, the saved cover would stay", () => {
    const sent: OnCallDutyPolicyUserOverride = prepareUserOverrideForUpdate(
      edited({ cover: null }),
      { isStartLocked: false },
    );

    expect(sent.routeAlertsToUserId).toBeNull();
    expect(
      Object.prototype.hasOwnProperty.call(sent, "routeAlertsToUserId"),
    ).toBe(true);
  });

  test("once it has started, when it starts is not sent at all", () => {
    const sent: OnCallDutyPolicyUserOverride = prepareUserOverrideForUpdate(
      edited({ cover: BOB, startsAt: RUNNING.startsAt }),
      { isStartLocked: true },
    );

    expect(sent.startsAt).toBeUndefined();
    expect(sent.endsAt).toEqual(UPCOMING.endsAt);
  });

  test("the person away covering for themselves is refused, as the form never lets through", () => {
    expect(() => {
      return prepareUserOverrideForUpdate(edited({ cover: JANE }), {
        isStartLocked: false,
      });
    }).toThrow(new BadDataException(USER_OVERRIDE_SAME_PERSON_MESSAGE));
  });
});

describe("what the dialog asks the overlap check", () => {
  const picked: (data: {
    away?: string | null;
    cover?: string | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
  }) => unknown = (data: {
    away?: string | null;
    cover?: string | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
  }): unknown => {
    return {
      overrideUserId: data.away === undefined ? JANE : data.away,
      routeAlertsToUserId: data.cover === undefined ? BOB : data.cover,
      startsAt: data.startsAt === undefined ? UPCOMING.startsAt : data.startsAt,
      endsAt: data.endsAt === undefined ? UPCOMING.endsAt : data.endsAt,
    };
  };

  test("an add on a policy: the person away, the policy, who covers and the times", () => {
    expect(
      getUserOverrideOverlapCandidate({
        values: picked({}),
        target: { onCallDutyPolicyId: POLICY },
      }),
    ).toEqual({
      id: null,
      overrideUserId: JANE,
      onCallDutyPolicyId: POLICY,
      routeAlertsToUserId: BOB,
      startsAt: UPCOMING.startsAt,
      endsAt: UPCOMING.endsAt,
    });
  });

  test("a global add has no policy, and a skip no cover", () => {
    expect(
      getUserOverrideOverlapCandidate({
        values: picked({ cover: null }),
        target: { onCallDutyPolicyId: null },
      }),
    ).toMatchObject({ onCallDutyPolicyId: null, routeAlertsToUserId: null });
  });

  test("nothing is asked until who is away and both times are picked, in order", () => {
    for (const values of [
      picked({ away: null }),
      picked({ startsAt: null }),
      picked({ endsAt: null }),
      picked({ endsAt: UPCOMING.startsAt }),
      picked({ startsAt: UPCOMING.endsAt, endsAt: UPCOMING.startsAt }),
    ]) {
      expect(
        getUserOverrideOverlapCandidate({
          values: values,
          target: { onCallDutyPolicyId: POLICY },
        }),
      ).toBeNull();
    }
  });

  test("an edit that moves neither time asks nothing, as the server asks nothing of it", () => {
    const target: {
      id: string;
      onCallDutyPolicyId: string;
      saved: UserOverrideSavedTimes;
    } = { id: EDITED, onCallDutyPolicyId: POLICY, saved: RUNNING };

    expect(
      getUserOverrideOverlapCandidate({
        values: picked({
          // The picker's minute of a start saved to the second.
          startsAt: at("08:00:00"),
          endsAt: RUNNING.endsAt,
          cover: null,
        }),
        target: target,
      }),
    ).toBeNull();

    expect(
      getUserOverrideOverlapCandidate({
        values: picked({ startsAt: at("08:00:00"), endsAt: at("22:00:00") }),
        target: target,
      }),
    ).toMatchObject({
      id: EDITED,
      onCallDutyPolicyId: POLICY,
      endsAt: at("22:00:00"),
    });
  });

  test("one question per override, person, scope and pair of minutes, whoever covers", () => {
    const key: (values: unknown, policy: string | null) => string = (
      values: unknown,
      policy: string | null,
    ): string => {
      return getUserOverrideOverlapKey(
        getUserOverrideOverlapCandidate({
          values: values,
          target: { onCallDutyPolicyId: policy },
        })!,
      );
    };

    expect(key(picked({ cover: null }), POLICY)).toBe(
      key(picked({ cover: BOB }), POLICY),
    );
    expect(
      key(
        picked({
          startsAt: new Date(UPCOMING.startsAt.getTime() + 20000),
        }),
        POLICY,
      ),
    ).toBe(key(picked({}), POLICY));
    expect(key(picked({}), POLICY)).not.toBe(key(picked({}), null));
    expect(key(picked({}), POLICY)).not.toBe(key(picked({}), OTHER_POLICY));
    expect(key(picked({ endsAt: at("2026-11-14T18:00:00") }), POLICY)).not.toBe(
      key(picked({}), POLICY),
    );
  });

  test("its answer: the same scope's that keep it from being saved, and the other scope's the rule allows", () => {
    const candidate: UserOverrideTimes = getUserOverrideOverlapCandidate({
      values: picked({}),
      target: { onCallDutyPolicyId: POLICY },
    })!;

    const read: (
      id: string,
      policy: string | null,
      from: string,
      until: string,
    ) => UserOverrideTimes = (
      id: string,
      policy: string | null,
      from: string,
      until: string,
    ): UserOverrideTimes => {
      return {
        id: id,
        overrideUserId: JANE,
        onCallDutyPolicyId: policy,
        routeAlertsToUserId: null,
        startsAt: at(from),
        endsAt: at(until),
      };
    };

    const samePolicy: UserOverrideTimes = read(
      "same",
      POLICY,
      "2026-11-14T12:00:00",
      "2026-11-14T20:00:00",
    );
    const global: UserOverrideTimes = read(
      "global",
      null,
      "2026-11-14T08:00:00",
      "2026-11-14T10:00:00",
    );
    const otherPolicy: UserOverrideTimes = read(
      "other",
      OTHER_POLICY,
      "2026-11-14T08:00:00",
      "2026-11-14T10:00:00",
    );
    const backToBack: UserOverrideTimes = read(
      "after",
      POLICY,
      "2026-11-14T17:00:00",
      "2026-11-14T19:00:00",
    );

    expect(
      getUserOverrideOverlapAnswer(candidate, [
        samePolicy,
        global,
        otherPolicy,
        backToBack,
      ]),
    ).toEqual({ conflicts: [samePolicy], otherScope: [global] });
  });
});
