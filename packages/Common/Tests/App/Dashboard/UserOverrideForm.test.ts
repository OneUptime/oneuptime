import {
  USER_OVERRIDE_AWAY_KEY,
  USER_OVERRIDE_AWAY_REQUIRED_MESSAGE,
  USER_OVERRIDE_COVER_KEY,
  USER_OVERRIDE_COVER_REQUIRED_MESSAGE,
  USER_OVERRIDE_ENDS_BEFORE_START_MESSAGE,
  USER_OVERRIDE_ENDS_KEY,
  USER_OVERRIDE_SAME_PERSON_MESSAGE,
  USER_OVERRIDE_STARTS_KEY,
  getDefaultUserOverrideStartsAt,
  getUserOverrideAwayError,
  getUserOverrideAwayPickerConfig,
  getUserOverrideCoverError,
  getUserOverrideCoverPickerConfig,
  getUserOverrideEndsError,
  getUserOverrideFormFields,
  prepareUserOverrideForCreate,
  readUserOverridePeople,
  toUserOverrideTime,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
} from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE ADD USER OVERRIDE FORM ASKS WHO IS AWAY AND WHO COVERS.
 *
 * The server reads an override's overrideUserId as the person whose pages
 * are rerouted - the one who is away - and routeAlertsToUserId as the person
 * who gets them. The form used to call the first one "Override User - Select
 * the user who will override the on-call duty", the opposite, so an override
 * could be set up backwards and the person on leave kept being paged.
 *
 * This pins the form's description (UserOverrideForm.ts): what each question
 * writes, what it starts as, and what it refuses.
 */

const ALEX: string = "0d300000-0000-4000-8000-0000000000a1";
const SAM: string = "0d300000-0000-4000-8000-0000000000b1";
const PROJECT: string = "0d300000-0000-4000-8000-000000000001";
const POLICY: string = "0d300000-0000-4000-8000-000000000002";

type OverrideField = Field<OnCallDutyPolicyUserOverride>;

function fields(currentUserId?: string | null): Array<OverrideField> {
  return getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
    currentUserId: currentUserId,
  });
}

function keyOf(field: OverrideField): string {
  return Object.keys(field.field || {})[0] as string;
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the questions the form asks", () => {
  test("are who is away, who covers, when it starts and when it ends, in that order", () => {
    expect(
      fields(ALEX).map((field: OverrideField): string => {
        return field.title || "";
      }),
    ).toEqual(["Who is away?", "Who covers?", "Starts", "Ends"]);
  });

  test("each is answered with the control it needs", () => {
    expect(
      fields(ALEX).map((field: OverrideField): FormFieldSchemaType => {
        return field.fieldType!;
      }),
    ).toEqual([
      FormFieldSchemaType.PeoplePicker,
      FormFieldSchemaType.PeoplePicker,
      FormFieldSchemaType.DateTime,
      FormFieldSchemaType.DateTime,
    ]);
  });

  test("all four are required, with no steps and nothing folded away", () => {
    for (const field of fields(ALEX)) {
      expect(field.required).toBe(true);
      expect(field.stepId).toBeUndefined();
      expect(field.collapsibleSection).toBeUndefined();
      expect(field.showIf).toBeUndefined();
    }
  });

  /*
   * The regression this form exists for: the question about the person
   * who is away must write the column paging reroutes (overrideUserId),
   * and the question about who covers the column paging delivers to
   * (routeAlertsToUserId) - never the other way round.
   */
  test("'Who is away?' writes overrideUserId, the person whose pages are rerouted", () => {
    const away: OverrideField = byTitle(fields(ALEX), "Who is away?");

    expect(keyOf(away)).toBe("overrideUserId");
    expect(USER_OVERRIDE_AWAY_KEY).toBe("overrideUserId");
    expect(
      away.peoplePicker?.kinds.map((entry: { valueKey: string }) => {
        return entry.valueKey;
      }),
    ).toEqual(["overrideUserId"]);
  });

  test("'Who covers?' writes routeAlertsToUserId, the person who gets the pages", () => {
    const cover: OverrideField = byTitle(fields(ALEX), "Who covers?");

    expect(keyOf(cover)).toBe("routeAlertsToUserId");
    expect(USER_OVERRIDE_COVER_KEY).toBe("routeAlertsToUserId");
    expect(
      cover.peoplePicker?.kinds.map((entry: { valueKey: string }) => {
        return entry.valueKey;
      }),
    ).toEqual(["routeAlertsToUserId"]);
  });

  test("'Starts' and 'Ends' write the override's window", () => {
    const list: Array<OverrideField> = fields(ALEX);

    expect(keyOf(byTitle(list, "Starts"))).toBe(USER_OVERRIDE_STARTS_KEY);
    expect(keyOf(byTitle(list, "Ends"))).toBe(USER_OVERRIDE_ENDS_KEY);
    expect(USER_OVERRIDE_STARTS_KEY).toBe("startsAt");
    expect(USER_OVERRIDE_ENDS_KEY).toBe("endsAt");
  });

  test("every key it writes is a column of the override", () => {
    const override: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();

    for (const field of fields(ALEX)) {
      expect(override.hasColumn(keyOf(field))).toBe(true);
    }
  });

  test("the help says which way the alerts go, in the words the questions use", () => {
    const list: Array<OverrideField> = fields(ALEX);

    expect(byTitle(list, "Who is away?").description).toBe(
      "Alerts that would page them go to the person who covers.",
    );
    expect(byTitle(list, "Who covers?").description).toBe(
      "They get those alerts until the override ends.",
    );
    expect(byTitle(list, "Starts").description).toBe(
      "It starts now unless you pick another time.",
    );
    expect(byTitle(list, "Ends").description).toBe(
      "From then on, alerts page the person who is away again.",
    );
  });

  test("none of the old, inverted wording is left", () => {
    const words: string = JSON.stringify(
      fields(ALEX).map((field: OverrideField) => {
        return {
          title: field.title,
          description: field.description,
          placeholder: field.placeholder,
          picker: field.peoplePicker,
        };
      }),
    );

    for (const retired of [
      "Override User",
      "Select the user who will override the on-call duty.",
      "Route Alerts To User",
      "Select the user to whom alerts will be routed.",
      "Select Override User",
      "Select User to Route Alerts",
    ]) {
      expect(words).not.toContain(retired);
    }
  });
});

describe("what the form starts with", () => {
  test("'Who is away?' starts as the person filling it in", () => {
    expect(byTitle(fields(ALEX), "Who is away?").defaultValue).toBe(ALEX);
  });

  test("'Who is away?' starts empty when nobody is known to be signed in", () => {
    for (const nobody of [undefined, null, "", "   "]) {
      expect(
        byTitle(fields(nobody), "Who is away?").defaultValue,
      ).toBeUndefined();
    }
  });

  test("'Who covers?' starts empty: nobody is picked for you", () => {
    const cover: OverrideField = byTitle(fields(ALEX), "Who covers?");

    expect(cover.defaultValue).toBeUndefined();
    expect(cover.getDefaultValue).toBeUndefined();
  });

  test("'Starts' starts as now, worked out when the form opens", () => {
    const opened: Date = OneUptimeDate.fromString("2026-03-03T12:34:56.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(opened);

    const starts: OverrideField = byTitle(fields(ALEX), "Starts");

    expect(starts.defaultValue).toBeUndefined();
    expect(starts.getDefaultValue?.({})).toBe("2026-03-03T12:34:56.000Z");
    expect(getDefaultUserOverrideStartsAt()).toBe("2026-03-03T12:34:56.000Z");

    // Opened again an hour later, it is that hour's now.
    const later: Date = OneUptimeDate.fromString("2026-03-03T13:34:56.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(later);

    expect(starts.getDefaultValue?.({})).toBe("2026-03-03T13:34:56.000Z");
  });

  test("'Ends' starts empty: only the person booking knows when the cover stops", () => {
    const ends: OverrideField = byTitle(fields(ALEX), "Ends");

    expect(ends.defaultValue).toBeUndefined();
    expect(ends.getDefaultValue).toBeUndefined();
  });
});

describe("the two people pickers", () => {
  test("each takes one project member", () => {
    for (const config of [
      getUserOverrideAwayPickerConfig(),
      getUserOverrideCoverPickerConfig(),
    ]) {
      expect(config.isSinglePick).toBe(true);
      expect(
        config.kinds.map((entry: { kind: PeoplePickerKind }) => {
          return entry.kind;
        }),
      ).toEqual([PeoplePickerKind.User]);
    }
  });

  test("'Who covers?' leaves the person who is away out of its list", () => {
    const cover: PeoplePickerFieldConfig = getUserOverrideCoverPickerConfig();

    expect(cover.excludePicksOf).toEqual([
      { kind: PeoplePickerKind.User, valueKey: USER_OVERRIDE_AWAY_KEY },
    ]);
  });

  test("'Who is away?' leaves nobody out: anyone can be away", () => {
    expect(getUserOverrideAwayPickerConfig().excludePicksOf).toBeUndefined();
  });

  test("each button says what picking it answers", () => {
    expect(getUserOverrideAwayPickerConfig().addButtonText).toBe(
      "Choose who is away",
    );
    expect(getUserOverrideCoverPickerConfig().addButtonText).toBe(
      "Choose who covers",
    );
    expect(getUserOverrideCoverPickerConfig().emptyText).toBe(
      "There is no one else in this project.",
    );
  });

  test("the fields use these pickers", () => {
    const list: Array<OverrideField> = fields(ALEX);

    expect(byTitle(list, "Who is away?").peoplePicker).toEqual(
      getUserOverrideAwayPickerConfig(),
    );
    expect(byTitle(list, "Who covers?").peoplePicker).toEqual(
      getUserOverrideCoverPickerConfig(),
    );
  });
});

describe("what the form refuses", () => {
  test("nobody away", () => {
    expect(getUserOverrideAwayError({})).toBe(
      USER_OVERRIDE_AWAY_REQUIRED_MESSAGE,
    );
    expect(getUserOverrideAwayError({ overrideUserId: null })).toBe(
      "Choose who is away.",
    );
    expect(getUserOverrideAwayError({ overrideUserId: ALEX })).toBeNull();
  });

  test("nobody covering", () => {
    expect(getUserOverrideCoverError({ overrideUserId: ALEX })).toBe(
      USER_OVERRIDE_COVER_REQUIRED_MESSAGE,
    );
    expect(
      getUserOverrideCoverError({
        overrideUserId: ALEX,
        routeAlertsToUserId: "",
      }),
    ).toBe("Choose who covers.");
  });

  test("the person away covering for themselves, however the id is written", () => {
    for (const cover of [ALEX, ALEX.toUpperCase(), new ObjectID(ALEX)]) {
      expect(
        getUserOverrideCoverError({
          overrideUserId: ALEX,
          routeAlertsToUserId: cover,
        }),
      ).toBe(USER_OVERRIDE_SAME_PERSON_MESSAGE);
    }

    expect(USER_OVERRIDE_SAME_PERSON_MESSAGE).toBe(
      "Choose someone other than the person who is away.",
    );
  });

  test("lets two different people through", () => {
    expect(
      getUserOverrideCoverError({
        overrideUserId: ALEX,
        routeAlertsToUserId: SAM,
      }),
    ).toBeNull();
    // Somebody covering before anyone is said to be away is fine too.
    expect(getUserOverrideCoverError({ routeAlertsToUserId: SAM })).toBeNull();
  });

  test("an end at or before the start", () => {
    const starts: string = "2026-03-03T12:00:00.000Z";

    for (const endsAt of [
      starts,
      "2026-03-03T11:59:00.000Z",
      new Date("2026-03-01T00:00:00.000Z"),
    ]) {
      expect(getUserOverrideEndsError({ startsAt: starts, endsAt })).toBe(
        USER_OVERRIDE_ENDS_BEFORE_START_MESSAGE,
      );
    }

    expect(USER_OVERRIDE_ENDS_BEFORE_START_MESSAGE).toBe(
      "The override has to end after it starts.",
    );
  });

  test("lets an end after the start through", () => {
    expect(
      getUserOverrideEndsError({
        startsAt: "2026-03-03T12:00:00.000Z",
        endsAt: "2026-03-03T12:01:00.000Z",
      }),
    ).toBeNull();
  });

  test("leaves a time not filled in yet to the field's own required check", () => {
    for (const values of [
      {},
      { startsAt: "2026-03-03T12:00:00.000Z" },
      { endsAt: "2026-03-03T12:00:00.000Z" },
      { startsAt: "", endsAt: "2026-03-03T12:00:00.000Z" },
      { startsAt: "not a time", endsAt: "2026-03-03T12:00:00.000Z" },
    ]) {
      expect(getUserOverrideEndsError(values)).toBeNull();
    }
  });

  test("each field checks its own question", () => {
    const list: Array<OverrideField> = fields(ALEX);
    const values: JSONObject = {
      overrideUserId: ALEX,
      routeAlertsToUserId: ALEX,
      startsAt: "2026-03-03T12:00:00.000Z",
      endsAt: "2026-03-03T11:00:00.000Z",
    };

    expect(byTitle(list, "Who is away?").customValidation?.(values)).toBe(null);
    expect(byTitle(list, "Who covers?").customValidation?.(values)).toBe(
      USER_OVERRIDE_SAME_PERSON_MESSAGE,
    );
    expect(byTitle(list, "Starts").customValidation).toBeUndefined();
    expect(byTitle(list, "Ends").customValidation?.(values)).toBe(
      USER_OVERRIDE_ENDS_BEFORE_START_MESSAGE,
    );
    const nobodyAway: JSONObject = { ...values, overrideUserId: null };

    expect(byTitle(list, "Who is away?").customValidation?.(nobodyAway)).toBe(
      USER_OVERRIDE_AWAY_REQUIRED_MESSAGE,
    );
  });
});

describe("reading a form's values", () => {
  test("who is away and who covers, however the ids are held", () => {
    expect(
      readUserOverridePeople({
        overrideUserId: new ObjectID(ALEX),
        routeAlertsToUserId: { _id: SAM },
      }),
    ).toEqual({ awayUserId: ALEX, coverUserId: SAM });

    expect(readUserOverridePeople({})).toEqual({
      awayUserId: null,
      coverUserId: null,
    });

    expect(readUserOverridePeople(null)).toEqual({
      awayUserId: null,
      coverUserId: null,
    });
  });

  test("a time as a date input holds it", () => {
    expect(toUserOverrideTime("2026-03-03T12:00:00.000Z")?.toISOString()).toBe(
      "2026-03-03T12:00:00.000Z",
    );
    expect(
      toUserOverrideTime(new Date("2026-03-03T12:00:00.000Z"))?.toISOString(),
    ).toBe("2026-03-03T12:00:00.000Z");

    for (const nothing of [undefined, null, "", "soon", 12, {}]) {
      expect(toUserOverrideTime(nothing)).toBeNull();
    }
  });
});

describe("an override as the page sends it", () => {
  function newOverride(
    values: Record<string, unknown>,
  ): OnCallDutyPolicyUserOverride {
    const override: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();

    Object.assign(override, values);

    return override;
  }

  test("holds both people as ids in their own columns, in the project", () => {
    const override: OnCallDutyPolicyUserOverride = prepareUserOverrideForCreate(
      newOverride({ overrideUserId: ALEX, routeAlertsToUserId: SAM }),
      { projectId: new ObjectID(PROJECT) },
    );

    expect(override.overrideUserId).toBeInstanceOf(ObjectID);
    expect(override.routeAlertsToUserId).toBeInstanceOf(ObjectID);
    expect(override.overrideUserId?.toString()).toBe(ALEX);
    expect(override.routeAlertsToUserId?.toString()).toBe(SAM);
    expect(override.projectId?.toString()).toBe(PROJECT);
  });

  test("from On-Call Duty > User Overrides, it is global: no policy", () => {
    const override: OnCallDutyPolicyUserOverride = prepareUserOverrideForCreate(
      newOverride({ overrideUserId: ALEX, routeAlertsToUserId: SAM }),
      { projectId: new ObjectID(PROJECT), onCallDutyPolicyId: undefined },
    );

    expect(override.onCallDutyPolicyId).toBeUndefined();
  });

  test("from a policy's User Overrides page, it is that policy's", () => {
    const override: OnCallDutyPolicyUserOverride = prepareUserOverrideForCreate(
      newOverride({ overrideUserId: ALEX, routeAlertsToUserId: SAM }),
      {
        projectId: new ObjectID(PROJECT),
        onCallDutyPolicyId: new ObjectID(POLICY),
      },
    );

    expect(override.onCallDutyPolicyId?.toString()).toBe(POLICY);
  });

  test("refuses an override that names nobody, or one person twice", () => {
    for (const values of [
      { routeAlertsToUserId: SAM },
      { overrideUserId: ALEX },
      { overrideUserId: ALEX, routeAlertsToUserId: ALEX.toUpperCase() },
    ]) {
      expect(() => {
        prepareUserOverrideForCreate(newOverride(values), {
          projectId: new ObjectID(PROJECT),
        });
      }).toThrow(BadDataException);
    }
  });
});
