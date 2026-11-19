import {
  ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
  FREE_NAME_ATTEMPTS,
  LABEL_NAME_TAKEN_REFUSAL,
  LABELS_RENAMED_TOGETHER_REFUSAL,
  NAME_TAKEN_REFUSALS,
  NAME_WHITE_SPACE_CHARACTERS,
  NAME_WHITE_SPACE_RUN_PATTERN,
  ON_CALL_POLICIES_RENAMED_TOGETHER_REFUSAL,
  ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
  ON_CALL_SCHEDULE_NAME_TAKEN_REFUSAL,
  ON_CALL_SCHEDULES_RENAMED_TOGETHER_REFUSAL,
  RENAMED_TOGETHER_REFUSALS,
  TEAM_NAME_TAKEN_REFUSAL,
  TEAMS_RENAMED_TOGETHER_REFUSAL,
  createWithFreeName,
  getLabelNameTakenRefusal,
  getNameKey,
  getNameKeySql,
  getNameTakenRefusalText,
  getNumberedName,
  getTeamNameTakenRefusal,
  isNameTakenRefusal,
  isSameName,
  normalizeName,
} from "../../../Types/Database/UniqueName";
import {
  RefusalWithValues,
  readRefusalValues,
} from "../../../Types/Exception/RefusalWithValues";
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

  test("every name refusal is listed for the Dashboard", () => {
    expect(NAME_TAKEN_REFUSALS).toEqual([
      TEAM_NAME_TAKEN_REFUSAL,
      LABEL_NAME_TAKEN_REFUSAL,
      ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
      ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
      ON_CALL_SCHEDULE_NAME_TAKEN_REFUSAL,
    ]);
    expect(RENAMED_TOGETHER_REFUSALS).toEqual([
      TEAMS_RENAMED_TOGETHER_REFUSAL,
      LABELS_RENAMED_TOGETHER_REFUSAL,
      ON_CALL_POLICIES_RENAMED_TOGETHER_REFUSAL,
      ON_CALL_SCHEDULES_RENAMED_TOGETHER_REFUSAL,
    ]);
  });
});

describe("an on-call policy's and an on-call schedule's refusals (#9742)", () => {
  test("say what happened and what to do next, with the name as it reads", () => {
    expect(
      getNameTakenRefusalText(ON_CALL_POLICY_NAME_TAKEN_REFUSAL, " Primary "),
    ).toBe(
      "There is already an on-call policy called Primary in this project. Pick another name.",
    );
    expect(
      getNameTakenRefusalText(
        ON_CALL_SCHEDULE_NAME_TAKEN_REFUSAL,
        `Platform${NO_BREAK_SPACE} Primary`,
      ),
    ).toBe(
      "There is already an on-call schedule called Platform Primary in this project. Pick another name.",
    );
    expect(ON_CALL_POLICIES_RENAMED_TOGETHER_REFUSAL).toBe(
      "Several on-call policies cannot be given one name. Rename one policy at a time.",
    );
    expect(ON_CALL_SCHEDULES_RENAMED_TOGETHER_REFUSAL).toBe(
      "Several on-call schedules cannot be given one name. Rename one schedule at a time.",
    );
  });

  test("an archived policy's says where to bring it back, by the menu's path", () => {
    expect(
      getNameTakenRefusalText(
        ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
        "Primary",
      ),
    ).toBe(
      "There is already an archived on-call policy called Primary in this project. Unarchive it from On-Call > Advanced > Archived Policies, or pick another name.",
    );
  });

  test("each has the name as its only value, and none reads as another's", () => {
    const refusals: Array<RefusalWithValues> = [
      ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
      ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
      ON_CALL_SCHEDULE_NAME_TAKEN_REFUSAL,
      TEAM_NAME_TAKEN_REFUSAL,
      LABEL_NAME_TAKEN_REFUSAL,
    ];

    for (const refusal of refusals) {
      expect(refusal.terms).toEqual([]);

      const message: string = getNameTakenRefusalText(refusal, "Primary");

      for (const other of refusals) {
        expect({
          template: other.template,
          message,
          values: readRefusalValues(other, message),
        }).toEqual({
          template: other.template,
          message,
          values: other === refusal ? { name: "Primary" } : null,
        });
      }
    }
  });

  test("each is a sentence: a capital first, a full stop last", () => {
    for (const sentence of [
      getNameTakenRefusalText(ON_CALL_POLICY_NAME_TAKEN_REFUSAL, "x"),
      getNameTakenRefusalText(ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL, "x"),
      getNameTakenRefusalText(ON_CALL_SCHEDULE_NAME_TAKEN_REFUSAL, "x"),
      ON_CALL_POLICIES_RENAMED_TOGETHER_REFUSAL,
      ON_CALL_SCHEDULES_RENAMED_TOGETHER_REFUSAL,
    ]) {
      expect(sentence.charAt(0)).toBe(sentence.charAt(0).toUpperCase());
      expect(sentence.endsWith(".")).toBe(true);
    }
  });
});

describe("a form says a refusal of its name under the Name field", () => {
  test.each([
    getTeamNameTakenRefusal("Tenants"),
    getLabelNameTakenRefusal("Production"),
    `  ${getTeamNameTakenRefusal("Tenants")}  `,
    TEAMS_RENAMED_TOGETHER_REFUSAL,
    LABELS_RENAMED_TOGETHER_REFUSAL,
    getNameTakenRefusalText(ON_CALL_POLICY_NAME_TAKEN_REFUSAL, "Primary"),
    getNameTakenRefusalText(
      ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
      "Primary",
    ),
    getNameTakenRefusalText(ON_CALL_SCHEDULE_NAME_TAKEN_REFUSAL, "Primary"),
    ON_CALL_POLICIES_RENAMED_TOGETHER_REFUSAL,
    ON_CALL_SCHEDULES_RENAMED_TOGETHER_REFUSAL,
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

describe("the name a record takes when its own is taken", () => {
  test("is its own name first, then numbered as Duplicate numbers a copy", () => {
    expect(getNumberedName({ name: "Primary", number: 1 })).toBe("Primary");
    expect(getNumberedName({ name: "Primary", number: 2 })).toBe("Primary 2");
    expect(getNumberedName({ name: "Primary", number: 10 })).toBe("Primary 10");
  });

  test("keeps the name as written until it is numbered, then as it reads", () => {
    expect(getNumberedName({ name: " Primary  On-Call", number: 1 })).toBe(
      " Primary  On-Call",
    );
    expect(getNumberedName({ name: " Primary  On-Call", number: 3 })).toBe(
      "Primary On-Call 3",
    );
  });

  test("kept to a length, gives up the end of its words and never its number", () => {
    const name: string = "a".repeat(100);

    expect(getNumberedName({ name, number: 1, maxLength: 100 })).toBe(name);
    expect(getNumberedName({ name, number: 2, maxLength: 100 })).toBe(
      `${"a".repeat(98)} 2`,
    );
    expect(getNumberedName({ name, number: 12, maxLength: 100 })).toHaveLength(
      100,
    );
    expect(
      getNumberedName({ name: "Primary", number: 2, maxLength: 100 }),
    ).toBe("Primary 2");
  });
});

describe("a record made with the first of its names that is free", () => {
  // A create the server refuses while a name is taken, as UniqueNameInProject does.
  function serverWith(taken: Array<string>): {
    create: (name: string) => Promise<string>;
    tried: Array<string>;
  } {
    const tried: Array<string> = [];

    return {
      tried,
      create: async (name: string): Promise<string> => {
        tried.push(name);

        if (
          taken.some((other: string): boolean => {
            return isSameName(other, name);
          })
        ) {
          throw new Error(
            getNameTakenRefusalText(ON_CALL_POLICY_NAME_TAKEN_REFUSAL, name),
          );
        }

        return `id of ${name}`;
      },
    };
  }

  const readRefusal: (error: unknown) => string = (error: unknown): string => {
    return (error as Error).message;
  };

  test("is made with its own name while nothing has it, in one try", async () => {
    const server: ReturnType<typeof serverWith> = serverWith([]);

    await expect(
      createWithFreeName({
        name: "Default on-call policy",
        create: server.create,
        readRefusal,
      }),
    ).resolves.toEqual({
      created: "id of Default on-call policy",
      name: "Default on-call policy",
    });
    expect(server.tried).toEqual(["Default on-call policy"]);
  });

  test("takes the next number for as long as the name is taken, however the taken ones are written", async () => {
    const server: ReturnType<typeof serverWith> = serverWith([
      "default ON-CALL policy",
      "Default on-call policy 2",
    ]);

    await expect(
      createWithFreeName({
        name: "Default on-call policy",
        create: server.create,
        readRefusal,
      }),
    ).resolves.toEqual({
      created: "id of Default on-call policy 3",
      name: "Default on-call policy 3",
    });
    expect(server.tried).toEqual([
      "Default on-call policy",
      "Default on-call policy 2",
      "Default on-call policy 3",
    ]);
  });

  test("passes over an archived namesake too: its refusal is a name refusal", async () => {
    let tries: number = 0;

    const result: { created: string; name: string } = await createWithFreeName({
      name: "Primary",
      create: async (name: string): Promise<string> => {
        tries++;

        if (tries === 1) {
          throw new Error(
            getNameTakenRefusalText(
              ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
              name,
            ),
          );
        }

        return name;
      },
      readRefusal,
    });

    expect(result).toEqual({ created: "Primary 2", name: "Primary 2" });
  });

  test("throws any other refusal as it came, at once", async () => {
    const failure: Error = new Error(
      "You do not have permission to create an on-call policy.",
    );
    let tries: number = 0;

    await expect(
      createWithFreeName({
        name: "Primary",
        create: async (): Promise<string> => {
          tries++;
          throw failure;
        },
        readRefusal,
      }),
    ).rejects.toBe(failure);
    expect(tries).toBe(1);
  });

  test("gives up after its tries, with the last refusal", async () => {
    const server: ReturnType<typeof serverWith> = serverWith(
      Array.from({ length: 20 }, (_value: unknown, index: number): string => {
        return getNumberedName({ name: "Primary", number: index + 1 });
      }),
    );

    await expect(
      createWithFreeName({
        name: "Primary",
        create: server.create,
        readRefusal,
      }),
    ).rejects.toThrow(
      "There is already an on-call policy called Primary 10 in this project. Pick another name.",
    );
    expect(server.tried).toHaveLength(FREE_NAME_ATTEMPTS);

    const fewer: ReturnType<typeof serverWith> = serverWith(["Primary"]);

    await expect(
      createWithFreeName({
        name: "Primary",
        create: fewer.create,
        readRefusal,
        attempts: 1,
      }),
    ).rejects.toThrow("There is already an on-call policy called Primary");
    expect(fewer.tried).toEqual(["Primary"]);
  });

  test("keeps every numbered name to the column's length", async () => {
    const name: string = "p".repeat(100);
    const server: ReturnType<typeof serverWith> = serverWith([name]);

    const result: { created: string; name: string } = await createWithFreeName({
      name,
      create: server.create,
      readRefusal,
      maxLength: 100,
    });

    expect(result.name).toBe(`${"p".repeat(98)} 2`);
  });
});
