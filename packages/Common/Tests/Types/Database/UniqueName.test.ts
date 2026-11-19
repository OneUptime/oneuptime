import {
  LABEL_NAME_TAKEN_REFUSAL,
  LABELS_RENAMED_TOGETHER_REFUSAL,
  NAME_TAKEN_REFUSALS,
  NAME_WHITE_SPACE_CHARACTERS,
  NAME_WHITE_SPACE_RUN_PATTERN,
  TEAM_NAME_TAKEN_REFUSAL,
  TEAMS_RENAMED_TOGETHER_REFUSAL,
  getLabelNameTakenRefusal,
  getNameKey,
  getNameKeySql,
  getTeamNameTakenRefusal,
  isNameTakenRefusal,
  isSameName,
  normalizeName,
} from "../../../Types/Database/UniqueName";
import { readRefusalValues } from "../../../Types/Exception/RefusalWithValues";
import { describe, expect, test } from "@jest/globals";

// A byte order mark, which draws as nothing.
const BYTE_ORDER_MARK: string = String.fromCharCode(0xfeff);
// An ideographic space, as a Japanese keyboard types one.
const IDEOGRAPHIC_SPACE: string = String.fromCharCode(0x3000);
// A narrow no-break space.
const NARROW_NO_BREAK_SPACE: string = String.fromCharCode(0x202f);
// A no-break space, as a document pastes one.
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

/*
 * A NAME ONE OF ITS KIND IN A PROJECT, HOWEVER IT IS WRITTEN (#9674).
 *
 * Two teams called "Tenants" could not be told apart in any picker, and a
 * label could be renamed to another label's name. The server now refuses
 * both, comparing names as they read (Types/Database/UniqueName):
 *
 *   - case aside, and the white space around a name;
 *   - every run of white space inside it one space, whatever its kind: a
 *     page draws "Platform  Team", "Platform<tab>Team" and a non-breaking
 *     space the same;
 *   - nothing that is not text is a name;
 *   - the refusal is a sentence with the name in it, read back by the
 *     Dashboard to say it in the reader's language under the Name field.
 */

describe("a name as it reads", () => {
  test.each([
    ["Tenants", "Tenants"],
    ["  Tenants  ", "Tenants"],
    ["Platform  Team", "Platform Team"],
    ["Platform\tTeam", "Platform Team"],
    ["Platform\nTeam", "Platform Team"],
    [`Platform${NO_BREAK_SPACE}Team`, "Platform Team"],
    [`Platform${NARROW_NO_BREAK_SPACE}Team`, "Platform Team"],
    [`Platform${IDEOGRAPHIC_SPACE}Team`, "Platform Team"],
    [`${BYTE_ORDER_MARK}Platform Team`, "Platform Team"],
    ["Équipe   Plateforme ", "Équipe Plateforme"],
    ["x-y", "x-y"],
  ])("%j reads as %j", (written: string, reads: string) => {
    expect(normalizeName(written)).toBe(reads);
  });

  test("keeps its case: only the comparison folds it", () => {
    expect(normalizeName("TENANTS")).toBe("TENANTS");
  });

  test.each([
    [undefined],
    [null],
    [42],
    [{}],
    [[]],
    [""],
    ["   "],
    [`${NO_BREAK_SPACE}`],
  ])("%j is no name", (value: unknown) => {
    expect(normalizeName(value)).toBe("");
    expect(getNameKey(value)).toBe("");
  });
});

describe("two names that are one name", () => {
  test.each([
    ["Tenants", "tenants"],
    ["Tenants", " TENANTS "],
    ["Platform Team", "platform  team"],
    ["Platform Team", `Platform${NO_BREAK_SPACE}Team`],
    ["Команда", "КОМАНДА"],
  ])("%j and %j", (left: string, right: string) => {
    expect(isSameName(left, right)).toBe(true);
    expect(getNameKey(left)).toBe(getNameKey(right));
  });

  test.each([
    ["Tenants", "Tenant"],
    ["Platform Team", "PlatformTeam"],
    ["Platform-Team", "Platform Team"],
  ])("but not %j and %j", (left: string, right: string) => {
    expect(isSameName(left, right)).toBe(false);
  });

  test("no name is the same as no name only in being none: never one name", () => {
    expect(isSameName("", "")).toBe(false);
    expect(isSameName("  ", undefined)).toBe(false);
  });
});

describe("the white space a name may hold", () => {
  test("is every character JavaScript's \\s matches, and nothing else", () => {
    const pattern: RegExp = new RegExp(`^${NAME_WHITE_SPACE_RUN_PATTERN}$`);
    const javaScriptSpace: RegExp = /^\s$/;

    for (let code: number = 0; code <= 0xffff; code++) {
      const character: string = String.fromCharCode(code);

      expect({ code, isSpace: pattern.test(character) }).toEqual({
        code,
        isSpace: javaScriptSpace.test(character),
      });
    }
  });

  test("is one bracket expression's body, the pattern a run of it", () => {
    expect(NAME_WHITE_SPACE_RUN_PATTERN).toBe(
      `[${NAME_WHITE_SPACE_CHARACTERS}]+`,
    );
  });
});

describe("the SQL a name is read with", () => {
  test("reads a column or a parameter as getNameKey does, in Postgres", () => {
    expect(
      getNameKeySql({ textSql: '"Team"."name"', patternSql: ":pattern" }),
    ).toBe(`LOWER(BTRIM(REGEXP_REPLACE("Team"."name", :pattern, ' ', 'g')))`);
  });
});

describe("the refusals", () => {
  test("a team's: what happened, and what to do next, with the name as it reads", () => {
    expect(getTeamNameTakenRefusal("  Tenants  ")).toBe(
      "There is already a team called Tenants in this project. Pick another name.",
    );
    expect(TEAM_NAME_TAKEN_REFUSAL.terms).toEqual([]);
  });

  test("a label's", () => {
    expect(getLabelNameTakenRefusal("Production")).toBe(
      "There is already a label called Production in this project. Pick another name.",
    );
    expect(LABEL_NAME_TAKEN_REFUSAL.terms).toEqual([]);
  });

  test("several records given one name", () => {
    expect(TEAMS_RENAMED_TOGETHER_REFUSAL).toBe(
      "Several teams cannot be given one name. Rename one team at a time.",
    );
    expect(LABELS_RENAMED_TOGETHER_REFUSAL).toBe(
      "Several labels cannot be given one name. Rename one label at a time.",
    );
  });

  test("each is a sentence: a capital first, a full stop last", () => {
    for (const sentence of [
      getTeamNameTakenRefusal("tenants"),
      getLabelNameTakenRefusal("prod"),
      TEAMS_RENAMED_TOGETHER_REFUSAL,
      LABELS_RENAMED_TOGETHER_REFUSAL,
    ]) {
      expect(sentence.charAt(0)).toBe(sentence.charAt(0).toUpperCase());
      expect(sentence.endsWith(".")).toBe(true);
    }
  });

  test("the name is read back out of the server's English, for the reader's language", () => {
    expect(
      readRefusalValues(
        TEAM_NAME_TAKEN_REFUSAL,
        getTeamNameTakenRefusal("Platform. Team in. this project"),
      ),
    ).toEqual({ name: "Platform. Team in. this project" });
    expect(
      readRefusalValues(
        LABEL_NAME_TAKEN_REFUSAL,
        getLabelNameTakenRefusal("Platform"),
      ),
    ).toEqual({ name: "Platform" });
  });

  test("both name refusals are listed for the Dashboard", () => {
    expect(NAME_TAKEN_REFUSALS).toEqual([
      TEAM_NAME_TAKEN_REFUSAL,
      LABEL_NAME_TAKEN_REFUSAL,
    ]);
  });
});

describe("a form says a refusal of its name under the Name field", () => {
  test.each([
    getTeamNameTakenRefusal("Tenants"),
    getLabelNameTakenRefusal("Production"),
    `  ${getTeamNameTakenRefusal("Tenants")}  `,
    TEAMS_RENAMED_TOGETHER_REFUSAL,
    LABELS_RENAMED_TOGETHER_REFUSAL,
  ])("%j", (message: string) => {
    expect(isNameTakenRefusal(message)).toBe(true);
  });

  test.each([
    "",
    "This team cannot be updated because its a critical team for this project.",
    "Team with the same name already exists.",
    "You do not have permission to create a team.",
    "There is already a team called  in this project. Pick another name.",
  ])("and any other answer above the form: %j", (message: string) => {
    expect(isNameTakenRefusal(message)).toBe(false);
  });
});
