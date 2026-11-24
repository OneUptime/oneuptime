import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import User from "../../../../Models/DatabaseModels/User";
import UserService from "../../../../Server/Services/UserService";
import { writeInLanguage } from "../../../../Server/Utils/ServerTranslation";
import WorkspaceSharedNames, {
  UNKNOWN_WORKSPACE_READER,
  WORKSPACE_SHARED_NAME_SHORTEST_NAME,
  WorkspaceNamedOption,
  WorkspaceSharedNameReader,
  WorkspaceTwinDetails,
} from "../../../../Server/Utils/Workspace/WorkspaceSharedNames";
import {
  SharedNameOption,
  getSharedNameFacts,
} from "../../../../Types/Database/SharedNameMarks";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import Timezone from "../../../../Types/Timezone";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A CHAT'S PICKER TELLS RECORDS THAT SHARE A NAME APART (#10314).
 *
 * Slack's selects, Microsoft Teams' choice sets and Mattermost's dialogs
 * draw each option as one line of plain text, so what sets a twin apart
 * goes in its label, after its name: "Primary · Created Nov 5, 2026". The
 * rule is the Dashboard's (Types/Database/SharedNameMarks); the words and
 * the zone are those on the reader's account, read only when the list
 * holds twins; the label is cut to what the chat shows, the name before
 * what sets the twin apart.
 */

const READER_ID: ObjectID = new ObjectID(
  "0193c0de-d0d0-4aaa-8bbb-000000000aaa",
);

const NOVEMBER_MORNING: Date = new Date("2026-11-05T09:30:00.000Z");
const NOVEMBER_AFTERNOON: Date = new Date("2026-11-05T15:30:00.000Z");
const MARCH: Date = new Date("2024-03-05T09:30:00.000Z");

type Spy = ReturnType<typeof getJestSpyOn>;

function policy(data: {
  id: string;
  name: string;
  description?: string;
  createdAt?: Date;
}): OnCallDutyPolicy {
  const record: OnCallDutyPolicy = new OnCallDutyPolicy();
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

function optionOf(record: OnCallDutyPolicy | Label): SharedNameOption {
  return {
    value: record._id,
    label: record.name || "",
    sharedName: getSharedNameFacts(record),
  };
}

// The reader's account, as UserService answers it.
function stubReader(
  account: { language?: string; timezone?: string } | null,
): Spy {
  return getJestSpyOn(UserService, "findOneById").mockImplementation(
    async (): Promise<User | null> => {
      if (!account) {
        return null;
      }

      const user: User = new User();
      user._id = READER_ID.toString();

      if (account.language !== undefined) {
        user.language = account.language;
      }

      if (account.timezone !== undefined) {
        (user as unknown as { timezone: string }).timezone = account.timezone;
      }

      return user;
    },
  );
}

// A day and a moment as a chat writes them, in a zone and a language.
function day(date: Date, timezone: string, language: string = "en"): string {
  return writeInLanguage(language, (): string => {
    return OneUptimeDate.getDateAsFormattedStringInTimezone({
      date: date,
      timezone: timezone,
      onlyShowDate: true,
    });
  });
}

function moment(date: Date, timezone: string, language: string = "en"): string {
  return writeInLanguage(language, (): string => {
    return OneUptimeDate.getDateAsFormattedStringInTimezone({
      date: date,
      timezone: timezone,
    });
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the reader of a chat's picker", () => {
  test("is read as OneUptime, their language and their zone and nothing else", async () => {
    const read: Spy = stubReader({ language: "de", timezone: "Asia/Tokyo" });

    const reader: WorkspaceSharedNameReader =
      await WorkspaceSharedNames.getReader(READER_ID);

    expect(reader).toEqual({ language: "de", timezone: "Asia/Tokyo" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0]).toEqual({
      id: READER_ID,
      select: { language: true, timezone: true },
      props: { isRoot: true },
    });
  });

  test("nobody to read is English and UTC, and nothing is read", async () => {
    const read: Spy = stubReader({ language: "de" });

    expect(await WorkspaceSharedNames.getReader(undefined)).toEqual(
      UNKNOWN_WORKSPACE_READER,
    );
    expect(await WorkspaceSharedNames.getReader(null)).toEqual({
      language: "en",
      timezone: Timezone.UTC,
    });
    expect(read).not.toHaveBeenCalled();
  });

  test("an account with no language, no zone, or a zone no clock knows is English, or UTC", async () => {
    stubReader({});
    expect(await WorkspaceSharedNames.getReader(READER_ID)).toEqual({
      language: "en",
      timezone: "UTC",
    });

    stubReader({ language: "fa", timezone: "Mars/Olympus_Mons" });
    expect(await WorkspaceSharedNames.getReader(READER_ID)).toEqual({
      language: "fa",
      timezone: "UTC",
    });

    stubReader(null);
    expect(await WorkspaceSharedNames.getReader(READER_ID)).toEqual(
      UNKNOWN_WORKSPACE_READER,
    );
  });

  test("a read that fails is English and UTC: a picker is shown whatever it answers", async () => {
    getJestSpyOn(UserService, "findOneById").mockRejectedValue(
      new Error("The database is slow."),
    );

    expect(await WorkspaceSharedNames.getReader(READER_ID)).toEqual(
      UNKNOWN_WORKSPACE_READER,
    );
  });
});

describe("what sets each twin apart, for the reader", () => {
  test("a list with no twins reads nothing of the reader and tells nothing", async () => {
    const read: Spy = stubReader({ language: "de" });

    const twins: WorkspaceTwinDetails =
      await WorkspaceSharedNames.getTwinDetails({
        options: [
          policy({ id: "a", name: "Primary", createdAt: MARCH }),
          policy({ id: "b", name: "Secondary", createdAt: MARCH }),
        ].map(optionOf),
        readerUserId: READER_ID,
        maxLength: 75,
      });

    expect(twins.details.size).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });

  test("twins made on different days are known by the day, in English and UTC for a reader who set neither", async () => {
    const read: Spy = stubReader({});

    const twins: WorkspaceTwinDetails =
      await WorkspaceSharedNames.getTwinDetails({
        options: [
          policy({ id: "a", name: "Primary", createdAt: MARCH }),
          policy({ id: "b", name: "primary ", createdAt: NOVEMBER_MORNING }),
          policy({ id: "c", name: "Secondary", createdAt: MARCH }),
        ].map(optionOf),
        readerUserId: READER_ID,
        maxLength: 75,
      });

    expect(Object.fromEntries(twins.details)).toEqual({
      a: "Created Mar 5, 2024",
      b: "Created Nov 5, 2026",
    });
    expect(twins.separator).toBe(" · ");
    // Once, for the whole list.
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("twins made the same day are known by the moment, its zone named", async () => {
    stubReader({});

    const twins: WorkspaceTwinDetails =
      await WorkspaceSharedNames.getTwinDetails({
        options: [
          policy({ id: "a", name: "Primary", createdAt: NOVEMBER_MORNING }),
          policy({ id: "b", name: "Primary", createdAt: NOVEMBER_AFTERNOON }),
        ].map(optionOf),
        readerUserId: READER_ID,
        maxLength: 75,
      });

    expect(Object.fromEntries(twins.details)).toEqual({
      a: "Created Nov 5, 2026, 9:30 AM UTC",
      b: "Created Nov 5, 2026, 3:30 PM UTC",
    });
  });

  test("the day is the reader's own: the same two moments are two days in Tokyo", async () => {
    stubReader({ timezone: "Asia/Tokyo" });

    const twins: WorkspaceTwinDetails =
      await WorkspaceSharedNames.getTwinDetails({
        options: [
          policy({ id: "a", name: "Primary", createdAt: NOVEMBER_MORNING }),
          policy({ id: "b", name: "Primary", createdAt: NOVEMBER_AFTERNOON }),
        ].map(optionOf),
        readerUserId: READER_ID,
        maxLength: 75,
      });

    expect(Object.fromEntries(twins.details)).toEqual({
      a: `Created ${day(NOVEMBER_MORNING, "Asia/Tokyo")}`,
      b: `Created ${day(NOVEMBER_AFTERNOON, "Asia/Tokyo")}`,
    });
    expect(twins.details.get("a")).toBe("Created Nov 5, 2026");
    expect(twins.details.get("b")).toBe("Created Nov 6, 2026");
  });

  test("a moment is written in the reader's zone, and says which", async () => {
    stubReader({ timezone: "America/New_York" });

    const twins: WorkspaceTwinDetails =
      await WorkspaceSharedNames.getTwinDetails({
        options: [
          policy({ id: "a", name: "Primary", createdAt: NOVEMBER_MORNING }),
          policy({ id: "b", name: "Primary", createdAt: NOVEMBER_AFTERNOON }),
        ].map(optionOf),
        readerUserId: READER_ID,
        maxLength: 75,
      });

    expect(twins.details.get("a")).toBe(
      `Created ${moment(NOVEMBER_MORNING, "America/New_York")}`,
    );
    expect(twins.details.get("a")).toBe("Created Nov 5, 2026, 4:30 AM EST");
  });

  test("in the reader's language: the Dashboard's own words, the date written in it too", async () => {
    stubReader({ language: "de", timezone: "Europe/Berlin" });

    const twins: WorkspaceTwinDetails =
      await WorkspaceSharedNames.getTwinDetails({
        options: [
          policy({ id: "a", name: "Primary", createdAt: MARCH }),
          policy({ id: "b", name: "Primary", createdAt: NOVEMBER_MORNING }),
        ].map(optionOf),
        readerUserId: READER_ID,
        maxLength: 75,
      });

    expect(twins.details.get("a")).toBe(
      `Erstellt am ${day(MARCH, "Europe/Berlin", "de")}`,
    );
    expect(twins.details.get("a")).not.toContain("Mar");
    expect(twins.details.get("b")).toMatch(/^Erstellt am .*2026$/);
  });

  test("a Persian reader's separator is theirs, where a middle dot reads as a zero", async () => {
    stubReader({ language: "fa" });

    const twins: WorkspaceTwinDetails =
      await WorkspaceSharedNames.getTwinDetails({
        options: [
          policy({ id: "a", name: "Primary", createdAt: MARCH }),
          policy({ id: "b", name: "Primary", createdAt: NOVEMBER_MORNING }),
        ].map(optionOf),
        readerUserId: READER_ID,
        maxLength: 75,
      });

    expect(twins.separator).toBe(" • ");
    expect(twins.details.get("a")).not.toContain("Created");
  });

  test("its own description when no twin has the same one: the owner's words, cut to about half a label", async () => {
    const read: Spy = stubReader({ language: "de" });

    const twins: WorkspaceTwinDetails =
      await WorkspaceSharedNames.getTwinDetails({
        options: [
          policy({
            id: "a",
            name: "Payments",
            description:
              "EU checkout failures, paged to the payments team at night",
          }),
          policy({ id: "b", name: "Payments", description: "US checkout" }),
        ].map(optionOf),
        readerUserId: READER_ID,
        maxLength: 75,
      });

    expect(WorkspaceSharedNames.getDescriptionLength(75)).toBe(36);
    expect(twins.details.get("a")).toBe("EU checkout failures, paged to the…");
    // As written, in no language of OneUptime's.
    expect(twins.details.get("b")).toBe("US checkout");
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("a description's lines are one line in a label", async () => {
    stubReader({});

    const twins: WorkspaceTwinDetails =
      await WorkspaceSharedNames.getTwinDetails({
        options: [
          policy({ id: "a", name: "Payments", description: "EU\n\ncheckout" }),
          policy({ id: "b", name: "Payments", description: "US\tcheckout" }),
        ].map(optionOf),
        readerUserId: READER_ID,
        maxLength: 75,
      });

    expect(Object.fromEntries(twins.details)).toEqual({
      a: "EU checkout",
      b: "US checkout",
    });
  });

  test("twins with nothing to tell them by are told nothing, and their labels stay their names", async () => {
    stubReader({});

    const options: Array<WorkspaceNamedOption> =
      await WorkspaceSharedNames.getOptions({
        records: [
          policy({ id: "a", name: "Primary" }),
          policy({ id: "b", name: "Primary" }),
        ],
        readerUserId: READER_ID,
        maxLength: 75,
      });

    expect(options).toEqual([
      { value: "a", label: "Primary" },
      { value: "b", label: "Primary" },
    ]);
  });
});

describe("a twin's label, cut to what the chat shows", () => {
  test("its name, the separator and what sets it apart", () => {
    expect(
      WorkspaceSharedNames.toLabel({
        name: "Primary",
        detail: "Created Nov 5, 2026",
        separator: " · ",
        maxLength: 75,
      }),
    ).toBe("Primary · Created Nov 5, 2026");
  });

  test("a long name is cut before what sets it apart, which stays whole", () => {
    const name: string =
      "Payments and checkout escalation for the European region";
    const label: string = WorkspaceSharedNames.toLabel({
      name: name,
      detail: "Created Nov 5, 2026, 9:30 AM UTC",
      separator: " · ",
      maxLength: 75,
    });

    expect(label.length).toBeLessThanOrEqual(75);
    expect(label.endsWith(" · Created Nov 5, 2026, 9:30 AM UTC")).toBe(true);
    expect(label.startsWith("Payments and checkout")).toBe(true);
    expect(label).toContain("… · Created");
  });

  test("what the label says after them stays after them: a schedule's on-call person", () => {
    expect(
      WorkspaceSharedNames.toLabel({
        name: "Primary",
        detail: "Created Nov 5, 2026",
        separator: " · ",
        after: " (Nawaz Dhandala on call now)",
        maxLength: 75,
      }),
    ).toBe("Primary · Created Nov 5, 2026 (Nawaz Dhandala on call now)");
  });

  test("with no room for a name, the name keeps a few characters and the label's end is cut", () => {
    const label: string = WorkspaceSharedNames.toLabel({
      name: "Payments primary rotation",
      detail: "Created Nov 5, 2026, 9:30 AM UTC",
      separator: " · ",
      after: " (Someone With A Very Long Name Indeed on call now)",
      maxLength: 75,
    });

    expect(label.length).toBeLessThanOrEqual(75);
    expect(label.startsWith("Payment…")).toBe(true);
    expect("Payment…".length).toBe(WORKSPACE_SHARED_NAME_SHORTEST_NAME);
    // What sets the twin apart comes before what is cut.
    expect(label).toContain(" · Created Nov 5, 2026, 9:30 AM UTC");
    expect(label.endsWith("…")).toBe(true);
  });

  test("never between the halves of an emoji, and on one line", () => {
    const name: string = `${"🔥".repeat(40)} rotation`;
    const label: string = WorkspaceSharedNames.toLabel({
      name: name,
      detail: "Created Nov 5, 2026",
      separator: " · ",
      maxLength: 75,
    });

    expect(label.length).toBeLessThanOrEqual(75);
    expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(
      WorkspaceSharedNames.toLabel({
        name: "Primary\n  on-call",
        detail: "Created Nov 5, 2026",
        maxLength: 75,
      }),
    ).toBe("Primary on-call · Created Nov 5, 2026");
  });
});

describe("a picker's options of records", () => {
  test("a record of no twin keeps its name as written; twins are told apart; the order is kept", async () => {
    stubReader({});

    const options: Array<WorkspaceNamedOption> =
      await WorkspaceSharedNames.getOptions({
        records: [
          policy({ id: "a", name: "Primary", createdAt: MARCH }),
          policy({ id: "b", name: "  Escalation  ", createdAt: MARCH }),
          policy({ id: "c", name: "PRIMARY", createdAt: NOVEMBER_MORNING }),
        ],
        readerUserId: READER_ID,
        maxLength: 75,
      });

    expect(options).toEqual([
      { value: "a", label: "Primary · Created Mar 5, 2024" },
      { value: "b", label: "  Escalation  " },
      { value: "c", label: "PRIMARY · Created Nov 5, 2026" },
    ]);
  });

  test("records of a kind whose names are not one record's are never relabelled, and nothing is read", async () => {
    const read: Spy = stubReader({});
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = "s1";
    severity.name = "Critical";
    const twin: IncidentSeverity = new IncidentSeverity();
    twin._id = "s2";
    twin.name = "Critical";

    expect(
      await WorkspaceSharedNames.getOptions({
        records: [severity, twin],
        readerUserId: READER_ID,
        maxLength: 75,
      }),
    ).toEqual([
      { value: "s1", label: "Critical" },
      { value: "s2", label: "Critical" },
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  test("a label and a policy of one name are no twins", async () => {
    const read: Spy = stubReader({});
    const label: Label = new Label();
    label._id = "l1";
    label.name = "Primary";

    expect(
      await WorkspaceSharedNames.getOptions({
        records: [label, policy({ id: "p1", name: "Primary" })],
        readerUserId: READER_ID,
        maxLength: 75,
      }),
    ).toEqual([
      { value: "l1", label: "Primary" },
      { value: "p1", label: "Primary" },
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  test("every twin's label fits the chat's limit, Microsoft Teams' 80 too", async () => {
    stubReader({ timezone: "America/Los_Angeles" });
    const name: string =
      "Checkout and payments platform primary escalation policy";

    for (const maxLength of [75, 80]) {
      const options: Array<WorkspaceNamedOption> =
        await WorkspaceSharedNames.getOptions({
          records: [
            policy({ id: "a", name: name, createdAt: NOVEMBER_MORNING }),
            policy({ id: "b", name: name, createdAt: NOVEMBER_AFTERNOON }),
          ],
          readerUserId: READER_ID,
          maxLength: maxLength,
        });

      for (const option of options) {
        expect(option.label.length).toBeLessThanOrEqual(maxLength);
        expect(option.label).toMatch(/ · Created Nov 5, 2026, \d+:30 AM PST$/);
      }

      expect(options[0]!.label).not.toBe(options[1]!.label);
    }
  });
});
