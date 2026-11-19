import {
  USER_OVERRIDE_TEAM_PICKER_EMPTY_TEXT,
  UserOverrideFormTeamLimit,
  getUserOverrideFormFields,
  getUserOverrideTeamPersonError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import OneUptimeDate from "../../../Types/Date";
import UserOverrideTeamAccess, {
  USER_OVERRIDE_TEAM_AWAY_REFUSAL,
  USER_OVERRIDE_TEAM_COVER_REFUSAL,
  USER_OVERRIDE_TEAM_EDIT_REFUSAL,
} from "../../../Types/OnCallDutyPolicy/UserOverrideTeamAccess";
import Field from "../../../UI/Components/Forms/Types/Field";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ADD AND EDIT USER OVERRIDE FORM, KEPT TO THE READER'S TEAM (issue
 * #9733, UserOverrideForm's teamLimit): for a reader whose permission
 * reaches the people of their own team only, "Who is away?" and "Who
 * covers?" search those teams' people only, say why above the list, say so
 * in a list with nobody to offer, and say under the field - before anything
 * is sent - what the server would refuse: somebody outside them. The
 * server's own refusal of one is said under the field it is about. With no
 * limit the form is as it was.
 */

type OverrideField = Field<OnCallDutyPolicyUserOverride>;

const ALEX: string = "9733f000-0000-4000-8000-0000000000a1";
const SAM: string = "9733f000-0000-4000-8000-0000000000b1";
const PAT: string = "9733f000-0000-4000-8000-0000000000c1";
const PAYMENTS: string = "9733f000-0000-4000-8000-0000000000f1";

const HINT: string =
  "Only people in Payments are listed: the teams that let you manage user overrides.";

const LIMIT: UserOverrideFormTeamLimit = {
  teamIds: [PAYMENTS],
  hint: HINT,
  memberIds: new Set<string>([ALEX, SAM]),
};

function fields(options?: {
  teamLimit?: UserOverrideFormTeamLimit | undefined;
  isEditing?: boolean;
}): Array<OverrideField> {
  return getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
    currentUserId: ALEX,
    teamLimit: options?.teamLimit,
    editing: options?.isEditing
      ? {
          saved: {
            startsAt: OneUptimeDate.fromString("2026-12-01T09:00:00.000Z"),
            endsAt: OneUptimeDate.fromString("2026-12-02T09:00:00.000Z"),
          },
          now: OneUptimeDate.fromString("2026-11-19T12:00:00.000Z"),
        }
      : undefined,
  });
}

function byTitle(list: Array<OverrideField>, title: string): OverrideField {
  const found: OverrideField | undefined = list.find(
    (candidate: OverrideField): boolean => {
      return candidate.title === title;
    },
  );

  if (!found) {
    throw new Error(`No field titled ${title}`);
  }

  return found;
}

function errorOf(
  field: OverrideField,
  values: Record<string, unknown>,
): string | null {
  return field.customValidation?.(values as never) ?? null;
}

describe("the pickers, kept to the teams", () => {
  test("both search the teams' people only, say why above the list, and say so with nobody to offer", () => {
    const list: Array<OverrideField> = fields({ teamLimit: LIMIT });

    for (const title of ["Who is away?", "Who covers?"]) {
      expect({
        title,
        teams: byTitle(list, title).peoplePicker?.onlyMembersOfTeamIds,
        hint: byTitle(list, title).peoplePicker?.searchHint,
        empty: byTitle(list, title).peoplePicker?.emptyText,
      }).toEqual({
        title,
        teams: [PAYMENTS],
        hint: HINT,
        empty: USER_OVERRIDE_TEAM_PICKER_EMPTY_TEXT,
      });
    }
  });

  test("while the teams' names are read, the lists are kept to them with no line yet", () => {
    const list: Array<OverrideField> = fields({
      teamLimit: { ...LIMIT, hint: null },
    });

    expect(
      byTitle(list, "Who covers?").peoplePicker?.onlyMembersOfTeamIds,
    ).toEqual([PAYMENTS]);
    expect(byTitle(list, "Who covers?").peoplePicker?.searchHint).toBe(
      undefined,
    );
  });

  test("edited, who is away stays read-only, kept to the teams like the rest", () => {
    const away: OverrideField = byTitle(
      fields({ teamLimit: LIMIT, isEditing: true }),
      "Who is away?",
    );

    expect(away.peoplePicker?.isReadOnly).toBe(true);
    expect(away.peoplePicker?.onlyMembersOfTeamIds).toEqual([PAYMENTS]);
  });

  test("with no limit, the pickers offer everyone, as before", () => {
    const list: Array<OverrideField> = fields();

    for (const title of ["Who is away?", "Who covers?"]) {
      expect(
        byTitle(list, title).peoplePicker?.onlyMembersOfTeamIds,
      ).toBeUndefined();
      expect(byTitle(list, title).peoplePicker?.searchHint).toBeUndefined();
      expect(byTitle(list, title).peoplePicker?.emptyText).not.toBe(
        USER_OVERRIDE_TEAM_PICKER_EMPTY_TEXT,
      );
    }
  });
});

describe("somebody outside the teams, said under the field before anything is sent", () => {
  test("away: the server's refusal, under Who is away?", () => {
    const away: OverrideField = byTitle(
      fields({ teamLimit: LIMIT }),
      "Who is away?",
    );

    expect(errorOf(away, { overrideUserId: PAT })).toBe(
      USER_OVERRIDE_TEAM_AWAY_REFUSAL,
    );
    expect(errorOf(away, { overrideUserId: SAM })).toBeNull();
  });

  test("covering: the server's refusal, under Who covers? - nobody covering is no one outside", () => {
    const cover: OverrideField = byTitle(
      fields({ teamLimit: LIMIT }),
      "Who covers?",
    );

    expect(
      errorOf(cover, { overrideUserId: ALEX, routeAlertsToUserId: PAT }),
    ).toBe(USER_OVERRIDE_TEAM_COVER_REFUSAL);
    expect(
      errorOf(cover, { overrideUserId: ALEX, routeAlertsToUserId: SAM }),
    ).toBeNull();
    expect(
      errorOf(cover, { overrideUserId: ALEX, routeAlertsToUserId: null }),
    ).toBeNull();
  });

  test("edited, an override whose person away is outside is not the reader's to change at all", () => {
    const away: OverrideField = byTitle(
      fields({ teamLimit: LIMIT, isEditing: true }),
      "Who is away?",
    );

    expect(errorOf(away, { overrideUserId: PAT })).toBe(
      USER_OVERRIDE_TEAM_EDIT_REFUSAL,
    );
  });

  test("the form's own checks come first: nobody away is said as ever", () => {
    const away: OverrideField = byTitle(
      fields({ teamLimit: LIMIT }),
      "Who is away?",
    );

    expect(errorOf(away, { overrideUserId: null })).toBe("Choose who is away.");
  });

  test("while the members are not known, nothing is said: the server decides", () => {
    const list: Array<OverrideField> = fields({
      teamLimit: { ...LIMIT, memberIds: null },
    });

    expect(
      errorOf(byTitle(list, "Who is away?"), { overrideUserId: PAT }),
    ).toBeNull();
    expect(
      errorOf(byTitle(list, "Who covers?"), {
        overrideUserId: ALEX,
        routeAlertsToUserId: PAT,
      }),
    ).toBeNull();
  });

  test("with no limit, nobody is outside", () => {
    const list: Array<OverrideField> = fields();

    expect(
      errorOf(byTitle(list, "Who is away?"), { overrideUserId: PAT }),
    ).toBeNull();
  });

  test("the person is matched without case, as ids are", () => {
    expect(
      getUserOverrideTeamPersonError({
        role: "cover",
        userId: SAM.toUpperCase(),
        memberIds: LIMIT.memberIds,
      }),
    ).toBeNull();
    expect(
      getUserOverrideTeamPersonError({
        role: "away",
        userId: ` ${PAT} `,
        memberIds: LIMIT.memberIds,
      }),
    ).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
  });
});

describe("the server's refusal, said under the field it is about", () => {
  test("Who is away? owns the refusal of the person away, Who covers? the one of the person covering", () => {
    const list: Array<OverrideField> = fields({ teamLimit: LIMIT });
    const away: OverrideField = byTitle(list, "Who is away?");
    const cover: OverrideField = byTitle(list, "Who covers?");

    expect(away.ownsServerError?.(USER_OVERRIDE_TEAM_AWAY_REFUSAL)).toBe(true);
    expect(away.ownsServerError?.(USER_OVERRIDE_TEAM_COVER_REFUSAL)).toBe(
      false,
    );
    expect(cover.ownsServerError?.(USER_OVERRIDE_TEAM_COVER_REFUSAL)).toBe(
      true,
    );
    expect(cover.ownsServerError?.(USER_OVERRIDE_TEAM_AWAY_REFUSAL)).toBe(
      false,
    );
    expect(UserOverrideTeamAccess.isCoverRefusal("Something else.")).toBe(
      false,
    );
  });
});
