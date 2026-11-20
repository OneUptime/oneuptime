import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import { SharedNameKind } from "../../../Types/Database/SharedNames";
import {
  SHARED_NAME_CREATED_DETAIL,
  SHARED_NAME_DESCRIPTION_LENGTH,
  SHARED_NAME_PILLS,
  SharedNameMark,
  SharedNameOption,
  getSharedNameFacts,
  getSharedNameKindOfTable,
  getSharedNameMarks,
  getSharedNameSelect,
  getShortDescription,
} from "../../../UI/Utils/SharedNameOptions";
import {
  writeReaderDay,
  writeReaderMoment,
} from "../../../UI/Utils/ReaderMoments";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ONE RULE EVERY PICKER AND FILTER TELLS TWINS APART BY (#10064).
 *
 * Teams, labels, on-call policies and on-call schedules named alike before
 * names were held to one record each keep their names; their lists mark
 * them, and now every picker and filter of those kinds does too, by this
 * rule: options of one kind whose names read as one name are each marked
 * with the pill their list draws, and a line that sets them apart - the
 * record's description when no twin has the same one, else the day it was
 * made, else the moment.
 */

// English, as a page draws it.
const ENGLISH: Translator = createTranslator(undefined, "en", {
  drawsOnPage: true,
});

// A language that words everything, to see the words are looked up.
const SHOUTING: Translator = createTranslator(
  (text: string | undefined): string | undefined => {
    return text ? text.toUpperCase().replace("{{DATE}}", "{{date}}") : text;
  },
  "en",
  { drawsOnPage: true },
);

const MARCH: Date = new Date("2024-03-05T09:30:00.000Z");
const MARCH_AFTERNOON: Date = new Date("2024-03-05T15:45:00.000Z");
const NOVEMBER: Date = new Date("2026-11-05T09:30:00.000Z");

function label(data: {
  id: string;
  name: string;
  description?: string;
  createdAt?: Date;
}): Label {
  const record: Label = new Label();
  record._id = data.id;
  record.name = data.name;
  record.description = data.description;
  record.createdAt = data.createdAt;
  return record;
}

function optionOf(record: Label | Team): SharedNameOption {
  return {
    value: record._id,
    label: (record as unknown as { name: string }).name,
    sharedName: getSharedNameFacts(record),
  };
}

function marksOf(
  options: Array<SharedNameOption>,
  translator: Translator = ENGLISH,
): Map<string, SharedNameMark> {
  return getSharedNameMarks(options, translator);
}

describe("the kinds whose twins are marked", () => {
  test("are teams, labels, on-call policies and schedules, by their table", () => {
    expect(getSharedNameKindOfTable("Team")).toBe(SharedNameKind.Team);
    expect(getSharedNameKindOfTable("Label")).toBe(SharedNameKind.Label);
    expect(getSharedNameKindOfTable("OnCallDutyPolicy")).toBe(
      SharedNameKind.OnCallPolicy,
    );
    expect(getSharedNameKindOfTable("OnCallDutyPolicySchedule")).toBe(
      SharedNameKind.OnCallSchedule,
    );
    expect(getSharedNameKindOfTable("Monitor")).toBeNull();
    expect(getSharedNameKindOfTable(undefined)).toBeNull();
  });

  test("a read of one selects its description and when it was made; any other model nothing", () => {
    for (const type of [
      Team,
      Label,
      OnCallDutyPolicy,
      OnCallDutyPolicySchedule,
    ]) {
      expect(getSharedNameSelect(type)).toEqual({
        description: true,
        createdAt: true,
      });
      expect(getSharedNameSelect(new type())).toEqual({
        description: true,
        createdAt: true,
      });
    }

    expect(getSharedNameSelect(Monitor)).toEqual({});
    expect(getSharedNameSelect(undefined)).toEqual({});
  });

  test("each column it selects is one of the model's own", () => {
    for (const type of [
      Team,
      Label,
      OnCallDutyPolicy,
      OnCallDutyPolicySchedule,
    ]) {
      for (const column of Object.keys(getSharedNameSelect(type))) {
        expect({
          table: new type().tableName,
          column,
          has: new type().hasColumn(column),
        }).toEqual({
          table: new type().tableName,
          column,
          has: true,
        });
      }
    }
  });

  test("the pills are the words the lists draw", () => {
    expect(SHARED_NAME_PILLS).toEqual({
      [SharedNameKind.Team]: "Same name as another team",
      [SharedNameKind.Label]: "Same name as another label",
      [SharedNameKind.OnCallPolicy]: "Same name as another policy",
      [SharedNameKind.OnCallSchedule]: "Same name as another schedule",
    });
  });
});

describe("what an option carries of its record", () => {
  test("its kind, description and when it was made, a date sent as text read back as one", () => {
    const team: Team = new Team();
    team._id = "team-1";
    team.name = "Platform";
    team.description = "Runs the clusters";
    (team as unknown as { createdAt: string }).createdAt =
      "2024-03-05T09:30:00.000Z";

    expect(getSharedNameFacts(team)).toEqual({
      kind: SharedNameKind.Team,
      description: "Runs the clusters",
      createdAt: MARCH,
    });
  });

  test("nothing for a record of another kind, or none", () => {
    expect(getSharedNameFacts(new Monitor())).toBeUndefined();
    expect(getSharedNameFacts(undefined)).toBeUndefined();
    expect(getSharedNameFacts(null)).toBeUndefined();
  });

  test("a date that is no date is left out", () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    (policy as unknown as { createdAt: string }).createdAt = "not a date";

    expect(getSharedNameFacts(policy)).toEqual({
      kind: SharedNameKind.OnCallPolicy,
      description: undefined,
      createdAt: undefined,
    });
  });
});

describe("a description, as a picker's line shows it", () => {
  test("on one line, its spaces one space", () => {
    expect(getShortDescription("  Customer\n facing   services ")).toBe(
      "Customer facing services",
    );
    expect(getShortDescription(undefined)).toBe("");
    expect(getShortDescription("")).toBe("");
  });

  test("cut after a word with an ellipsis past a sentence or so", () => {
    const long: string =
      "Every service our customers reach directly, from the storefront and the checkout to the public API and its webhooks.";
    const short: string = getShortDescription(long);

    expect(short.endsWith("…")).toBe(true);
    expect(short.length).toBeLessThanOrEqual(
      SHARED_NAME_DESCRIPTION_LENGTH + 1,
    );
    // Cut between words, never inside one.
    expect(long.startsWith(short.slice(0, -1))).toBe(true);
    expect(long.charAt(short.length - 1)).toBe(" ");
  });
});

describe("the twins among a picker's options", () => {
  test("are the options of one kind whose names read as one name, whatever the case and spacing", () => {
    const marks: Map<string, SharedNameMark> = marksOf([
      optionOf(label({ id: "a", name: "Production", description: "EU" })),
      optionOf(label({ id: "b", name: " production ", description: "US" })),
      optionOf(label({ id: "c", name: "Staging" })),
    ]);

    expect(Array.from(marks.keys()).sort()).toEqual(["a", "b"]);
    expect(marks.get("a")!.pill).toBe("Same name as another label");
  });

  test("each is told apart by its own description when no twin has the same one", () => {
    const marks: Map<string, SharedNameMark> = marksOf([
      optionOf(
        label({ id: "a", name: "Production", description: "EU services" }),
      ),
      optionOf(
        label({ id: "b", name: "Production", description: "US services" }),
      ),
    ]);

    expect(marks.get("a")).toEqual({
      pill: "Same name as another label",
      detail: "EU services",
      isDetailAsWritten: true,
    });
    expect(marks.get("b")!.detail).toBe("US services");
  });

  test("one with no description, or the same one as a twin, by the day it was made", () => {
    const marks: Map<string, SharedNameMark> = marksOf([
      optionOf(
        label({
          id: "a",
          name: "Production",
          description: "Live",
          createdAt: MARCH,
        }),
      ),
      optionOf(
        label({
          id: "b",
          name: "Production",
          description: "live",
          createdAt: NOVEMBER,
        }),
      ),
      optionOf(label({ id: "c", name: "Production", createdAt: NOVEMBER })),
    ]);

    expect(marks.get("a")).toEqual({
      pill: "Same name as another label",
      detail: `Created ${writeReaderDay(MARCH)}`,
      isDetailAsWritten: false,
    });
    /*
     * b and c were made the same day: each is known by the moment it was
     * made instead.
     */
    expect(marks.get("b")!.detail).toBe(
      `Created ${writeReaderMoment(NOVEMBER)}`,
    );
    expect(marks.get("c")!.detail).toBe(
      `Created ${writeReaderMoment(NOVEMBER)}`,
    );
  });

  test("twins made the same day are known by the moment", () => {
    const marks: Map<string, SharedNameMark> = marksOf([
      optionOf(label({ id: "a", name: "Production", createdAt: MARCH })),
      optionOf(
        label({ id: "b", name: "Production", createdAt: MARCH_AFTERNOON }),
      ),
    ]);

    expect(marks.get("a")!.detail).toBe(`Created ${writeReaderMoment(MARCH)}`);
    expect(marks.get("b")!.detail).toBe(
      `Created ${writeReaderMoment(MARCH_AFTERNOON)}`,
    );
    expect(marks.get("a")!.detail).not.toBe(marks.get("b")!.detail);
  });

  test("a twin with nothing to tell it by is marked all the same, with no line", () => {
    const marks: Map<string, SharedNameMark> = marksOf([
      optionOf(label({ id: "a", name: "Production" })),
      optionOf(label({ id: "b", name: "Production" })),
    ]);

    expect(marks.get("a")).toEqual({
      pill: "Same name as another label",
      detail: undefined,
      isDetailAsWritten: false,
    });
  });

  test("a team and a label of one name are no twins, nor are options that carry nothing of their record", () => {
    const team: Team = new Team();
    team._id = "t";
    team.name = "Production";

    expect(
      marksOf([
        optionOf(label({ id: "a", name: "Production" })),
        optionOf(team),
        { value: "plain-1", label: "Production" },
        { value: "plain-2", label: "Production" },
      ]).size,
    ).toBe(0);
  });

  test("one record listed twice - in two groups of a menu - is no twin of itself", () => {
    const production: Label = label({ id: "a", name: "Production" });

    expect(marksOf([optionOf(production), optionOf(production)]).size).toBe(0);
  });

  test("a name of no letters is no name", () => {
    expect(
      marksOf([
        optionOf(label({ id: "a", name: "  " })),
        optionOf(label({ id: "b", name: "" })),
      ]).size,
    ).toBe(0);
  });

  test("the pill and the line are the reader's words; a description is the owner's, as written", () => {
    const marks: Map<string, SharedNameMark> = marksOf(
      [
        optionOf(label({ id: "a", name: "Production", createdAt: MARCH })),
        optionOf(
          label({ id: "b", name: "Production", description: "Live traffic" }),
        ),
      ],
      SHOUTING,
    );

    expect(marks.get("a")).toEqual({
      pill: "SAME NAME AS ANOTHER LABEL",
      detail: `CREATED ${writeReaderDay(MARCH)}`,
      isDetailAsWritten: false,
    });
    expect(marks.get("b")!.detail).toBe("Live traffic");
    expect(SHARED_NAME_CREATED_DETAIL).toBe("Created {{date}}");
  });

  test("each kind wears its own list's pill", () => {
    const policyA: OnCallDutyPolicy = new OnCallDutyPolicy();
    policyA._id = "p1";
    policyA.name = "Primary";
    const policyB: OnCallDutyPolicy = new OnCallDutyPolicy();
    policyB._id = "p2";
    policyB.name = "PRIMARY";
    const scheduleA: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    scheduleA._id = "s1";
    scheduleA.name = "Primary";
    const scheduleB: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    scheduleB._id = "s2";
    scheduleB.name = "Primary";
    const teamA: Team = new Team();
    teamA._id = "t1";
    teamA.name = "Primary";
    const teamB: Team = new Team();
    teamB._id = "t2";
    teamB.name = "Primary";

    const marks: Map<string, SharedNameMark> = marksOf(
      [policyA, policyB, scheduleA, scheduleB, teamA, teamB].map(
        (record: OnCallDutyPolicy | OnCallDutyPolicySchedule | Team) => {
          return {
            value: record._id,
            label: (record as unknown as { name: string }).name,
            sharedName: getSharedNameFacts(record),
          };
        },
      ),
    );

    expect(marks.get("p1")!.pill).toBe("Same name as another policy");
    expect(marks.get("s1")!.pill).toBe("Same name as another schedule");
    expect(marks.get("t1")!.pill).toBe("Same name as another team");
    expect(marks.size).toBe(6);
  });
});
