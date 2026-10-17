import fs from "fs";
import path from "path";
import {
  TABLE_DURATION_MAX_UNITS,
  getEventDurationText,
} from "../../FeatureSet/Dashboard/src/Utils/EventDuration";
import { FACET_FILTER_BAR_CLASS_NAME } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipStyles";

/*
 * The Dashboard's half of the table redesign (model-table-ui), on the
 * Incidents list of the maintainer's screenshot and every list like it:
 *
 *   - a Duration column says its two largest units ("10 days, 23 hours"),
 *     the whole duration under the pointer - "10 days, 23 hours, 31
 *     minutes" was the widest column of the list;
 *   - a row with no owners says so with the table's quiet dash, not "No
 *     owners." on every row, and owners' avatars are the row's line tall;
 *   - the facet chips sit on the card, not in a bordered, shadowed box of
 *     their own inside it.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\s+/g, " ");
};

describe("a table's Duration says its two largest units", () => {
  const START: Date = new Date("2026-10-05T06:04:00.000Z");
  const MINUTE: number = 60 * 1000;
  const HOUR: number = 60 * MINUTE;
  const DAY: number = 24 * HOUR;

  type CompactFunction = (milliseconds: number) => string;

  const compact: CompactFunction = (milliseconds: number): string => {
    return getEventDurationText(START, new Date(START.getTime() + milliseconds), {
      maxUnits: TABLE_DURATION_MAX_UNITS,
    });
  };

  test("two units", () => {
    expect(TABLE_DURATION_MAX_UNITS).toBe(2);
  });

  test.each([
    // The screenshot's: "10 days, 23 hours, 31 minutes".
    [10 * DAY + 23 * HOUR + 31 * MINUTE, "10 days, 23 hours"],
    [DAY + HOUR + 2 * MINUTE, "1 day, 1 hour"],
    [2 * DAY + 3 * HOUR, "2 days, 3 hours"],
    [DAY + MINUTE, "1 day, 1 minute"],
    [2 * HOUR + 5 * MINUTE, "2 hours, 5 minutes"],
    [HOUR, "1 hour"],
    [45 * MINUTE, "45 minutes"],
    [30 * 1000, "less than a minute"],
    [45 * DAY, "45 days"],
  ])("%i ms reads %s", (milliseconds: number, text: string) => {
    expect(compact(milliseconds)).toBe(text);
  });

  test("a smaller unit is dropped, never rounded into the larger: a duration is never said to be longer than it was", () => {
    expect(compact(DAY + 23 * HOUR + 59 * MINUTE)).toBe("1 day, 23 hours");
    expect(compact(2 * DAY - 1000)).toBe("1 day, 23 hours");
  });

  test("without maxUnits every unit is said, as on an incident's own page", () => {
    expect(
      getEventDurationText(
        START,
        new Date(START.getTime() + 10 * DAY + 23 * HOUR + 31 * MINUTE),
      ),
    ).toBe("10 days, 23 hours, 31 minutes");
  });

  test("a maxUnits of nothing useful is ignored", () => {
    const tenDays: Date = new Date(
      START.getTime() + 10 * DAY + 23 * HOUR + 31 * MINUTE,
    );

    expect(getEventDurationText(START, tenDays, { maxUnits: 0 })).toBe(
      "10 days, 23 hours, 31 minutes",
    );
    expect(getEventDurationText(START, tenDays, { maxUnits: 3 })).toBe(
      "10 days, 23 hours, 31 minutes",
    );
    expect(getEventDurationText(START, tenDays, { maxUnits: 1 })).toBe(
      "10 days",
    );
  });

  test("LiveDuration's compact form says the two units and keeps the whole duration under the pointer", () => {
    const source: string = readSource(
      "Components",
      "EventView",
      "LiveDuration.tsx",
    );

    expect(source).toContain("isCompact?: boolean | undefined;");
    expect(source).toContain("{ maxUnits: TABLE_DURATION_MAX_UNITS }");
    expect(source).toContain(
      "title={compactText === text ? undefined : text}",
    );
  });

  test.each([
    ["Incident", "IncidentsTable.tsx"],
    ["Alert", "AlertsTable.tsx"],
    ["ScheduledMaintenance", "ScheduledMaintenanceTable.tsx"],
  ])(
    "the %s list's Duration is the compact one",
    (folder: string, file: string) => {
      const source: string = readSource("Components", folder, file);

      expect(source).toContain("<LiveDuration");
      expect(source).toContain("isCompact={true}");
    },
  );

  test("an event's own page keeps every unit", () => {
    for (const page of [
      ["Pages", "Incidents", "View", "Index.tsx"],
      ["Pages", "Alerts", "View", "Index.tsx"],
      ["Pages", "ScheduledMaintenanceEvents", "View", "Index.tsx"],
    ]) {
      const source: string = readSource(...page);

      expect([page.join("/"), source.includes("isCompact")]).toEqual([
        page.join("/"),
        false,
      ]);
    }
  });
});

describe("a row's owners", () => {
  const source: string = readSource(
    "Components",
    "ResourceOwners",
    "OwnersCell.tsx",
  );

  test("none: the table's quiet dash, with 'No owners.' for a screen reader", () => {
    expect(source).toContain(
      '<TableEmptyValue screenReaderText="No owners." />',
    );
    expect(source).not.toContain('translator.translateText("No owners.")');
  });

  test("each avatar is the row's 24px line tall, the '+N' too", () => {
    expect(source).toContain('<PeopleAvatar item={item} size="chip" />');
    expect(source).not.toContain('size="sm"');
    expect(source).toContain(
      "h-6 w-6 rounded-full bg-gray-100 ring-2 ring-white",
    );
    expect(source).not.toContain("h-8 w-8");
    expect(source).toContain('<div className="flex h-6 items-center">');
  });
});

describe("the facet chips sit on the card", () => {
  const tokens: Array<string> = FACET_FILTER_BAR_CLASS_NAME.split(" ");

  test("a row that wraps, with room under it for the table's header", () => {
    expect(tokens).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "items-center", "mb-4"]),
    );
  });

  test("no box of its own: no border, no shadow, no fill, no corners, no padding", () => {
    for (const token of tokens) {
      for (const boxPrefix of [
        "border",
        "shadow",
        "bg-",
        "rounded",
        "px-",
        "py-",
        "p-",
      ]) {
        expect([token, token.startsWith(boxPrefix)]).toEqual([token, false]);
      }
    }
  });

  test("the bar is drawn with it, without the divider it had inside its box", () => {
    const source: string = readSource(
      "Components",
      "ResourceOwners",
      "useResourceOwners.tsx",
    );

    expect(source).toContain("className={FACET_FILTER_BAR_CLASS_NAME}");
    expect(source).toContain('data-testid="facet-filter-bar"');
    expect(source).not.toContain(
      "rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm",
    );
    expect(source).not.toContain("h-5 w-px bg-gray-200");
  });
});
