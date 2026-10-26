import fs from "fs";
import path from "path";
import {
  EventDurationPart,
  LESS_THAN_A_MINUTE,
  TABLE_DURATION_MAX_UNITS,
  formatEventDurationParts,
  getEventDurationParts,
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
    return getEventDurationText(
      START,
      new Date(START.getTime() + milliseconds),
      {
        maxUnits: TABLE_DURATION_MAX_UNITS,
      },
    );
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
    expect(source).toContain(
      "const compactText: string = getText(TABLE_DURATION_MAX_UNITS);",
    );
    expect(source).toContain("title={compactText === text ? undefined : text}");
    /*
     * In the reader's language - or, inside a sentence, the sentence's: its
     * units, and its words for under a minute.
     */
    expect(source).toContain(
      "const language: string = useSentenceLanguage() ?? translator.language;",
    );
    expect(source).toContain(
      "return formatEventDurationParts(parts, language);",
    );
    expect(source).toContain("translator.translateText(LESS_THAN_A_MINUTE)");
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
    /*
     * The row is the shared FacetFilterBar, which the model tables' facets
     * (useResourceOwners) and the Session Replay list both draw their chips
     * in.
     */
    const bar: string = readSource(
      "Components",
      "ResourceOwners",
      "FacetFilterBar.tsx",
    );

    expect(bar).toContain("className={FACET_FILTER_BAR_CLASS_NAME}");
    expect(bar).toContain(
      'data-testid={props.dataTestId || "facet-filter-bar"}',
    );

    for (const user of [
      ["Components", "ResourceOwners", "useResourceOwners.tsx"],
      ["Components", "SessionReplay", "SessionReplayFacets.tsx"],
    ]) {
      const source: string = readSource(...user);

      expect(source).toContain("<FacetFilterBar");
    }

    for (const source of [
      bar,
      readSource("Components", "ResourceOwners", "useResourceOwners.tsx"),
    ]) {
      expect(source).not.toContain(
        "rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm",
      );
      expect(source).not.toContain("h-5 w-px bg-gray-200");
    }
  });
});

describe("a Duration in the reader's language", () => {
  /*
   * The Duration was English in every language - "1 day, 7 hours" under
   * "Dauer" in a German list. LiveDuration now says its units with Intl's
   * own unit names, plurals and list for the reader's language, and keeps
   * the English text word for word in English.
   */
  const START: Date = new Date("2026-10-05T06:04:00.000Z");
  const MINUTE: number = 60 * 1000;
  const HOUR: number = 60 * MINUTE;
  const DAY: number = 24 * HOUR;

  type PartsFunction = (
    milliseconds: number,
    maxUnits?: number | undefined,
  ) => Array<EventDurationPart>;

  const partsOf: PartsFunction = (
    milliseconds: number,
    maxUnits?: number | undefined,
  ): Array<EventDurationPart> => {
    return getEventDurationParts(
      START,
      new Date(START.getTime() + milliseconds),
      maxUnits ? { maxUnits: maxUnits } : undefined,
    );
  };

  test("the units, largest first; none under a minute; at most maxUnits", () => {
    expect(partsOf(10 * DAY + 23 * HOUR + 31 * MINUTE)).toEqual([
      { count: 10, unit: "day" },
      { count: 23, unit: "hour" },
      { count: 31, unit: "minute" },
    ]);
    expect(partsOf(10 * DAY + 23 * HOUR + 31 * MINUTE, 2)).toEqual([
      { count: 10, unit: "day" },
      { count: 23, unit: "hour" },
    ]);
    expect(partsOf(DAY + MINUTE)).toEqual([
      { count: 1, unit: "day" },
      { count: 1, unit: "minute" },
    ]);
    expect(partsOf(30 * 1000)).toEqual([]);
    expect(LESS_THAN_A_MINUTE).toBe("less than a minute");
  });

  test.each([
    [10 * DAY + 23 * HOUR + 31 * MINUTE],
    [DAY + HOUR],
    [2 * HOUR + 5 * MINUTE],
    [45 * MINUTE],
    [45 * DAY],
  ])(
    "in English it is getEventDurationText's text, word for word (%i ms)",
    (milliseconds: number) => {
      const end: Date = new Date(START.getTime() + milliseconds);

      for (const language of [undefined, "en", "en-GB"]) {
        expect(
          formatEventDurationParts(getEventDurationParts(START, end), language),
        ).toBe(getEventDurationText(START, end));
      }
    },
  );

  test.each([
    ["de", 10 * DAY + 23 * HOUR, "10 Tage, 23 Stunden"],
    ["de", DAY + HOUR, "1 Tag, 1 Stunde"],
    // French keeps a number and its unit together with a no-break space.
    ["fr", 10 * DAY + 23 * HOUR, "10\u00a0jours et 23\u00a0heures"],
    ["es", 2 * HOUR + 5 * MINUTE, "2 horas y 5 minutos"],
    // Russian's own plurals, which a translated "{{count}} days" cannot say.
    ["ru", 21 * DAY, "21 день"],
    ["ru", 10 * DAY + 23 * HOUR, "10 дней 23 часа"],
    ["ja", 10 * DAY + 23 * HOUR, "10 日 23 時間"],
    ["zh-CN", 2 * HOUR + 5 * MINUTE, "2小时5分钟"],
  ])(
    "in %s, %i ms reads %s",
    (language: string, milliseconds: number, text: string) => {
      expect(formatEventDurationParts(partsOf(milliseconds, 2), language)).toBe(
        text,
      );
    },
  );

  test("an engine without Intl's unit style keeps the English text", () => {
    const original: typeof Intl.NumberFormat = Intl.NumberFormat;

    // Such an engine ignores the unit and writes the bare number.
    (Intl as unknown as { NumberFormat: unknown }).NumberFormat = function (
      locale: string,
    ): { format: (value: number) => string } {
      return {
        format: (value: number): string => {
          return value.toLocaleString(locale);
        },
      };
    };

    try {
      expect(
        formatEventDurationParts(partsOf(10 * DAY + 23 * HOUR, 2), "de"),
      ).toBe("10 days, 23 hours");
    } finally {
      (Intl as unknown as { NumberFormat: unknown }).NumberFormat = original;
    }
  });
});
