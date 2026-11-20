import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Team from "../../../Models/DatabaseModels/Team";
import { SharedNameKind } from "../../../Types/Database/SharedNames";
import {
  SHARED_NAME_CREATED_DETAIL,
  SHARED_NAME_DESCRIPTION_LENGTH,
  SharedNameDates,
  SharedNameMark,
  SharedNameOption,
  getSharedNameFacts,
  getSharedNameMarksFor,
  getShortDescription,
  hasSharedNameTwins,
} from "../../../Types/Database/SharedNameMarks";
import { Translator, createTranslator } from "../../../Types/Translator";
import {
  PAGE_SHARED_NAME_DATES,
  getSharedNameMarks,
} from "../../../UI/Utils/SharedNameOptions";
import {
  writeReaderDay,
  writeReaderMoment,
} from "../../../UI/Utils/ReaderMoments";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE RULE THAT TELLS SAME-NAMED RECORDS APART, SHARED BY THE PAGES AND THE
 * CHATS (#10064, #10314).
 *
 * Which options are twins, and what sets each apart - its description when
 * no twin has the same one, else the day it was made, else the moment -
 * moved out of Common/UI so the server can read it: a chat's picker tells
 * twins apart by the same rule. What a page and a chat do differently is
 * handed in: how the day and the moment are written (a page in the
 * reader's zone and clock, a chat in the zone on the reader's account), and
 * how much of a description fits (a sentence or so under a page's option,
 * less in a chat's one-line label). A page's marks are what they were.
 */

const ENGLISH: Translator = createTranslator(undefined, "en", {
  drawsOnPage: true,
});

const MARCH: Date = new Date("2024-03-05T09:30:00.000Z");
const MARCH_AFTERNOON: Date = new Date("2024-03-05T15:45:00.000Z");
const NOVEMBER: Date = new Date("2026-11-05T09:30:00.000Z");

// Dates a test can read back: which writer wrote them, and of what.
const MARKED_DATES: SharedNameDates = {
  writeDay: (date: Date): string => {
    return `day ${date.toISOString().slice(0, 10)}`;
  },
  writeMoment: (date: Date): string => {
    return `moment ${date.toISOString().slice(0, 16)}`;
  },
};

function label(data: {
  id: string;
  name: string;
  description?: string;
  createdAt?: Date;
}): Label {
  const record: Label = new Label();
  record._id = data.id;
  record.name = data.name;

  if (data.description !== undefined) {
    record.description = data.description;
  }

  if (data.createdAt) {
    record.createdAt = data.createdAt;
  }

  return record;
}

function optionOf(record: Label | Team | OnCallDutyPolicy): SharedNameOption {
  return {
    value: record._id,
    label: record.name || "",
    sharedName: getSharedNameFacts(record),
  };
}

function marksOf(
  records: Array<Label | Team | OnCallDutyPolicy>,
  options?: { descriptionLength?: number; dates?: SharedNameDates },
): Map<string, SharedNameMark> {
  return getSharedNameMarksFor(records.map(optionOf), {
    translator: ENGLISH,
    dates: options?.dates || MARKED_DATES,
    descriptionLength: options?.descriptionLength,
  });
}

describe("the rule lives where the server can read it", () => {
  const COMMON: string = path.resolve(__dirname, "../../..");

  test("the rule imports nothing of a page: no React, no i18next, nothing under Common/UI", () => {
    const source: string = fs.readFileSync(
      path.join(COMMON, "Types/Database/SharedNameMarks.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/from "react"/);
    expect(source).not.toMatch(/i18next/);
    expect(source).not.toMatch(/from "[./]*UI\//);
  });

  test("a page's module re-exports it whole, and adds only a page's dates", () => {
    const source: string = fs.readFileSync(
      path.join(COMMON, "UI/Utils/SharedNameOptions.ts"),
      "utf8",
    );

    expect(source).toContain(
      'export * from "../../Types/Database/SharedNameMarks";',
    );
    expect(PAGE_SHARED_NAME_DATES).toEqual({
      writeDay: writeReaderDay,
      writeMoment: writeReaderMoment,
    });
  });

  test("its words are the Dashboard's, which the server's locales copy", () => {
    const repository: string = path.resolve(COMMON, "../..");
    const extractor: string = fs.readFileSync(
      path.join(
        repository,
        "packages/App/FeatureSet/Dashboard/scripts/i18n/ExtractStrings.ts",
      ),
      "utf8",
    );
    const serverLocales: string = fs.readFileSync(
      path.join(COMMON, "Scripts/I18n/ServerLocales.ts"),
      "utf8",
    );

    expect(extractor).toMatch(
      /directory: "packages\/Common\/Types\/Database\/SharedNameMarks\.ts",\s*kind: "keys"/,
    );
    expect(serverLocales).toContain(
      '"packages/Common/Types/Database/SharedNameMarks.ts"',
    );

    for (const language of ["en", "de", "ja", "fa"]) {
      const dashboard: Record<string, string> = JSON.parse(
        fs.readFileSync(
          path.join(
            repository,
            `packages/App/FeatureSet/Dashboard/src/Locales/${language}.json`,
          ),
          "utf8",
        ),
      );
      const server: Record<string, string> = JSON.parse(
        fs.readFileSync(
          path.join(COMMON, `Server/Locales/${language}.json`),
          "utf8",
        ),
      );

      expect({
        language,
        server: server[SHARED_NAME_CREATED_DETAIL],
      }).toEqual({
        language,
        server: dashboard[SHARED_NAME_CREATED_DETAIL],
      });
    }
  });
});

describe("a page's marks are what they were", () => {
  test("the page's rule is the shared rule with the reader's own dates", () => {
    const records: Array<Label> = [
      label({ id: "a", name: "Production", createdAt: MARCH }),
      label({ id: "b", name: "production", createdAt: MARCH_AFTERNOON }),
      label({ id: "c", name: "Staging", description: "Pre-release" }),
      label({
        id: "d",
        name: "Staging",
        description: "Load tests",
        createdAt: NOVEMBER,
      }),
    ];

    expect(getSharedNameMarks(records.map(optionOf), ENGLISH)).toEqual(
      getSharedNameMarksFor(records.map(optionOf), {
        translator: ENGLISH,
        dates: { writeDay: writeReaderDay, writeMoment: writeReaderMoment },
      }),
    );
  });

  test("a description is cut at a sentence or so, as before", () => {
    const words: string = Array.from(
      { length: 30 },
      (_: unknown, i: number) => {
        return `word${i}`;
      },
    ).join(" ");

    const cut: string = getShortDescription(words);

    expect(getShortDescription(words, SHARED_NAME_DESCRIPTION_LENGTH)).toBe(
      cut,
    );
    expect(cut.endsWith("…")).toBe(true);
    // Cut after a word, at most the length and the ellipsis.
    expect(cut.length).toBeLessThanOrEqual(SHARED_NAME_DESCRIPTION_LENGTH + 1);
    expect(words.startsWith(cut.slice(0, -1))).toBe(true);
    expect(words[cut.length - 1]).toBe(" ");
  });
});

describe("which options are twins", () => {
  test("none in a list whose names each read once", () => {
    expect(
      hasSharedNameTwins(
        [
          label({ id: "a", name: "Production" }),
          label({ id: "b", name: "Staging" }),
        ].map(optionOf),
      ),
    ).toBe(false);
  });

  test("two of one kind whose names read as one name, whatever the case and spacing", () => {
    expect(
      hasSharedNameTwins(
        [
          label({ id: "a", name: "Production  EU" }),
          label({ id: "b", name: " production eu" }),
        ].map(optionOf),
      ),
    ).toBe(true);
  });

  test("a team and a label of one name are no twins", () => {
    const team: Team = new Team();
    team._id = "t";
    team.name = "Payments";

    expect(
      hasSharedNameTwins([
        optionOf(team),
        optionOf(label({ id: "l", name: "Payments" })),
      ]),
    ).toBe(false);
  });

  test("one record listed twice is no twin of itself, and an option carrying nothing of its record is never one", () => {
    const record: Label = label({ id: "a", name: "Production" });

    expect(hasSharedNameTwins([optionOf(record), optionOf(record)])).toBe(
      false,
    );
    expect(
      hasSharedNameTwins([
        optionOf(record),
        { value: "b", label: "Production" },
      ]),
    ).toBe(false);
  });

  test("names of no letters are no names", () => {
    expect(
      hasSharedNameTwins(
        [label({ id: "a", name: "  " }), label({ id: "b", name: "" })].map(
          optionOf,
        ),
      ),
    ).toBe(false);
  });

  test("it finds exactly the lists the marks mark", () => {
    const lists: Array<Array<Label>> = [
      [label({ id: "a", name: "A" })],
      [label({ id: "a", name: "A" }), label({ id: "b", name: "a" })],
      [label({ id: "a", name: "A" }), label({ id: "b", name: "B" })],
      [
        label({ id: "a", name: "A" }),
        label({ id: "b", name: "B" }),
        label({ id: "c", name: "b " }),
      ],
    ];

    for (const records of lists) {
      expect(hasSharedNameTwins(records.map(optionOf))).toBe(
        marksOf(records).size > 0,
      );
    }
  });
});

describe("what sets a twin apart, written by the dates it is handed", () => {
  test("the day it was made, by the day writer", () => {
    const marks: Map<string, SharedNameMark> = marksOf([
      label({ id: "a", name: "Production", createdAt: MARCH }),
      label({ id: "b", name: "Production", createdAt: NOVEMBER }),
    ]);

    expect(marks.get("a")).toEqual({
      pill: "Same name as another label",
      detail: "Created day 2024-03-05",
      isDetailAsWritten: false,
    });
    expect(marks.get("b")?.detail).toBe("Created day 2026-11-05");
  });

  test("twins made the same day - as the day writer reads it - by the moment writer", () => {
    const marks: Map<string, SharedNameMark> = marksOf([
      label({ id: "a", name: "Production", createdAt: MARCH }),
      label({ id: "b", name: "Production", createdAt: MARCH_AFTERNOON }),
    ]);

    expect(marks.get("a")?.detail).toBe("Created moment 2024-03-05T09:30");
    expect(marks.get("b")?.detail).toBe("Created moment 2024-03-05T15:45");
  });

  test("the same moments on different days in the reader's zone are two days", () => {
    // 14:30 and 15:30 UTC: one day in UTC, two in Tokyo (23:30 and 00:30).
    const lateEvening: Date = new Date("2026-11-05T14:30:00.000Z");
    const nextMorning: Date = new Date("2026-11-05T15:30:00.000Z");

    const tokyo: SharedNameDates = {
      writeDay: (date: Date): string => {
        return new Date(date.getTime() + 9 * 3600_000)
          .toISOString()
          .slice(0, 10);
      },
      writeMoment: (date: Date): string => {
        return date.toISOString();
      },
    };

    const marks: Map<string, SharedNameMark> = marksOf(
      [
        label({ id: "a", name: "Production", createdAt: lateEvening }),
        label({ id: "b", name: "Production", createdAt: nextMorning }),
      ],
      { dates: tokyo },
    );

    expect(marks.get("a")?.detail).toBe("Created 2026-11-05");
    expect(marks.get("b")?.detail).toBe("Created 2026-11-06");
  });
});

describe("a description, as much of it as the picker shows", () => {
  const LONG_EU: string =
    "Pages the payments team for checkout failures in the EU region";
  const LONG_US: string =
    "Pages the payments team for checkout failures in the US region";

  test("a page shows a sentence or so: two that differ near their end tell their twins apart", () => {
    const marks: Map<string, SharedNameMark> = marksOf([
      label({ id: "a", name: "Payments", description: LONG_EU }),
      label({ id: "b", name: "Payments", description: LONG_US }),
    ]);

    expect(marks.get("a")).toMatchObject({
      detail: LONG_EU,
      isDetailAsWritten: true,
    });
    expect(marks.get("b")?.detail).toBe(LONG_US);
  });

  test("a chat's label shows less: cut alike, they tell nothing, and the twins are known by when they were made", () => {
    const marks: Map<string, SharedNameMark> = marksOf(
      [
        label({
          id: "a",
          name: "Payments",
          description: LONG_EU,
          createdAt: MARCH,
        }),
        label({
          id: "b",
          name: "Payments",
          description: LONG_US,
          createdAt: NOVEMBER,
        }),
      ],
      { descriptionLength: 24 },
    );

    expect(marks.get("a")).toEqual({
      pill: "Same name as another label",
      detail: "Created day 2024-03-05",
      isDetailAsWritten: false,
    });
    expect(marks.get("b")?.detail).toBe("Created day 2026-11-05");
  });

  test("cut to a chat's length, descriptions that still differ are each twin's own, cut after a word", () => {
    const marks: Map<string, SharedNameMark> = marksOf(
      [
        label({
          id: "a",
          name: "Payments",
          description: "EU checkout failures, paged to the payments team",
        }),
        label({
          id: "b",
          name: "Payments",
          description: "US checkout failures, paged to the payments team",
        }),
      ],
      { descriptionLength: 24 },
    );

    expect(marks.get("a")).toMatchObject({
      detail: "EU checkout failures,…",
      isDetailAsWritten: true,
    });
    expect(marks.get("b")?.detail).toBe("US checkout failures,…");
  });

  test("a description is never cut to less than a few words", () => {
    expect(getShortDescription("Pages the payments team", 2)).toBe("Pages…");
    expect(getShortDescription("Short", 2)).toBe("Short");
  });
});

describe("the pill and the words are the reader's", () => {
  test("a translator that words everything words the pill and the created line", () => {
    const shouting: Translator = createTranslator(
      (text: string | undefined): string | undefined => {
        return text ? text.toUpperCase().replace("{{DATE}}", "{{date}}") : text;
      },
      "en",
    );

    const marks: Map<string, SharedNameMark> = getSharedNameMarksFor(
      [
        label({ id: "a", name: "Production", createdAt: MARCH }),
        label({ id: "b", name: "Production", createdAt: NOVEMBER }),
      ].map(optionOf),
      { translator: shouting, dates: MARKED_DATES },
    );

    expect(marks.get("a")).toEqual({
      pill: "SAME NAME AS ANOTHER LABEL",
      detail: "CREATED day 2024-03-05",
      isDetailAsWritten: false,
    });
  });

  test("each kind wears its own list's pill", () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = "p1";
    policy.name = "Primary";
    const twin: OnCallDutyPolicy = new OnCallDutyPolicy();
    twin._id = "p2";
    twin.name = "Primary";

    const marks: Map<string, SharedNameMark> = marksOf([policy, twin]);

    expect(getSharedNameFacts(policy)?.kind).toBe(SharedNameKind.OnCallPolicy);
    expect(marks.get("p1")?.pill).toBe("Same name as another policy");
  });
});
