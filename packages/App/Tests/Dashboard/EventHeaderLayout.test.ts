import { describe, expect, test } from "@jest/globals";
import {
  EVENT_HEADER_BESIDE_WIDTHS_REM,
  EVENT_HEADER_BUTTON_CLASS_NAME,
  EVENT_HEADER_CLASS_NAME,
  EVENT_HEADER_FACT_CLASS_NAME,
  EVENT_HEADER_FACT_COLUMN_STEPS,
  EVENT_HEADER_FACT_LABEL_CLASS_NAME,
  EVENT_HEADER_FACT_LABEL_ICON_CLASS_NAME,
  EVENT_HEADER_FACT_VALUE_CLASS_NAME,
  EVENT_HEADER_LOCKED_WRAPPER_CLASS_NAME,
  EVENT_HEADER_MENU_WRAPPER_CLASS_NAME,
  EVENT_HEADER_NEUTRAL_BUTTON_CLASS_NAME,
  EVENT_HEADER_NOTICE_CLASS_NAMES,
  EVENT_HEADER_NUMBER_CLASS_NAME,
  EVENT_HEADER_PHONE_WIDTH_REM,
  EVENT_HEADER_PRIMARY_BUTTON_CLASS_NAME,
  EVENT_HEADER_TEST_IDS,
  EVENT_HEADER_TITLE_CLASS_NAME,
  EventHeaderActionWidthInput,
  EventHeaderNoticeTone,
  EventHeaderTopRowClassNames,
  atContainerWidth,
  estimateEventHeaderActionsWidthPx,
  estimateEventHeaderButtonWidthPx,
  estimateEventHeaderChipsWidthPx,
  estimateTextWidthEm,
  getEventHeaderActionsBesideWidth,
  getEventHeaderFactColumns,
  getEventHeaderFactsClassName,
  getEventHeaderTopRowClassNames,
} from "../../FeatureSet/Dashboard/src/Components/EventView/EventHeaderLayout";

/*
 * How the header of an incident, an alert, an episode and a scheduled
 * maintenance event lays itself out (EventHeaderLayout.ts): by its own width
 * - it sits beside the record's side menu, so the window says little - with
 * the actions beside the pills from the width they need, worked out from the
 * buttons' words, the title whole under both, and the facts on a grid.
 *
 * The browser checks these at real widths in packages/E2E/EventOverview
 * ("the header, by its own width"); here the rules themselves are pinned.
 */

function classesOf(className: string): Array<string> {
  return className.split(" ").filter((name: string): boolean => {
    return name.length > 0;
  });
}

const PX_PER_REM: number = 16;

/*
 * The header as the overview pages hand it today, at each of its widths:
 * the width a container query reads, the card's less its 1px border on each
 * side.
 */
const HEADER_WIDTH_REM: Record<string, number> = {
  // A 390px phone: no side menu, a 326px card.
  phone: 324 / PX_PER_REM,
  // Beside the side menu at a 768px window: a 416px card.
  tablet: 414 / PX_PER_REM,
  // ... at 1024px: 620px.
  laptop: 618 / PX_PER_REM,
  // ... at 1280px: 876px.
  desktop: 874 / PX_PER_REM,
  // ... at 1440px: 1036px.
  wide: 1034 / PX_PER_REM,
};

const ACKNOWLEDGE: EventHeaderActionWidthInput = {
  label: "Acknowledge",
  hasIcon: true,
};
const RESOLVE: EventHeaderActionWidthInput = {
  label: "Resolve",
  hasIcon: true,
};
const DECLARE_INCIDENT: EventHeaderActionWidthInput = {
  label: "Declare Incident",
  hasIcon: true,
};
const OPEN_CHANNEL: EventHeaderActionWidthInput = {
  label: "Open channel",
  hasIcon: true,
  hasMenu: true,
};

describe("the header is a size container", () => {
  test("the card is the container every rule is read against, and the ⋯'s corner", () => {
    expect(classesOf(EVENT_HEADER_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "relative",
        "rounded-xl",
        "border",
        "border-gray-200",
        "bg-white",
        "shadow-sm",
        "[container-type:inline-size]",
      ]),
    );
  });

  test("atContainerWidth puts every class behind the width's container query", () => {
    expect(atContainerWidth(44, "grid  grid-cols-2 ")).toBe(
      "[@container(min-width:44rem)]:grid [@container(min-width:44rem)]:grid-cols-2",
    );
    expect(atContainerWidth(36, "")).toBe("");
  });

  test("keeps its test ids", () => {
    expect(EVENT_HEADER_TEST_IDS).toEqual({
      header: "event-header",
      top: "event-header-top",
      chips: "event-header-chips",
      number: "event-header-number",
      title: "event-header-title",
      actions: "event-header-actions",
      buttons: "event-header-buttons",
      morePlace: "event-header-more-place",
      track: "event-state-track",
      facts: "event-status-facts",
      notice: "event-header-notice",
    });
  });
});

describe("the number and the title", () => {
  test("draw the number as a security case draws its own", () => {
    expect(classesOf(EVENT_HEADER_NUMBER_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "rounded-md",
        "bg-gray-100",
        "px-2",
        "py-0.5",
        "font-mono",
        "text-xs",
        "font-semibold",
        "text-gray-700",
      ]),
    );
  });

  test("keep the title whole, on lines of its own", () => {
    const classes: Array<string> = classesOf(EVENT_HEADER_TITLE_CLASS_NAME);

    expect(classes).toEqual(
      expect.arrayContaining([
        "basis-full",
        "break-words",
        "[overflow-wrap:anywhere]",
        "text-xl",
        "font-semibold",
        "text-gray-900",
      ]),
    );
    expect(classes).not.toContain("truncate");
    expect(
      classes.some((name: string): boolean => {
        return name.startsWith("line-clamp");
      }),
    ).toBe(false);
  });
});

describe("how wide a text is, in ems", () => {
  test("a Latin letter takes about 0.65em, a space about a third", () => {
    expect(estimateTextWidthEm("Acknowledge")).toBeCloseTo(11 * 0.65, 5);
    expect(estimateTextWidthEm("Mark as Ongoing")).toBeCloseTo(
      13 * 0.65 + 2 * 0.32,
      5,
    );
    // Accented letters and digits too.
    expect(estimateTextWidthEm("Terminé 42")).toBeCloseTo(9 * 0.65 + 0.32, 5);
  });

  test("a CJK character takes a whole em", () => {
    expect(estimateTextWidthEm("インシデント")).toBeCloseTo(6 * 1.05, 5);
    expect(estimateTextWidthEm("확인")).toBeCloseTo(2 * 1.05, 5);
    expect(estimateTextWidthEm("声明事件")).toBeCloseTo(4 * 1.05, 5);
  });

  test("an Arabic or Persian letter takes 0.75em, a Cyrillic one 0.68, a Devanagari one 0.6", () => {
    expect(estimateTextWidthEm("رفع")).toBeCloseTo(3 * 0.75, 5);
    expect(estimateTextWidthEm("Подтвердить")).toBeCloseTo(11 * 0.68, 5);
    // Two letters and a spacing vowel sign: ख ो ल.
    expect(estimateTextWidthEm("खोल")).toBeCloseTo(3 * 0.6, 5);
  });

  test("a mark drawn over or under its letter, and an invisible joiner, take nothing", () => {
    // करें: two letters, then a vowel sign and a nasal mark drawn over them.
    expect(estimateTextWidthEm("करें")).toBeCloseTo(2 * 0.6, 5);
    // به‌عنوان: seven letters, and the zero-width non-joiner after the second.
    expect(estimateTextWidthEm("به\u200cعنوان")).toBeCloseTo(7 * 0.75, 5);
    // A kaf with a fatha over it.
    expect(estimateTextWidthEm("\u0643\u064e")).toBeCloseTo(0.75, 5);
  });

  test("an empty text takes nothing", () => {
    expect(estimateTextWidthEm("")).toBe(0);
  });
});

/*
 * Widths Chromium draws in Inter (measured on the offline fixture at
 * 1440px): every estimate leans wide of them, so a header never puts its
 * buttons beside the pills where they would not fit, and not so wide that
 * the buttons drop under the title much earlier than they must.
 */
describe("the estimates lean wide of what Chromium draws", () => {
  test.each([
    [ACKNOWLEDGE, 150],
    [RESOLVE, 112],
    [DECLARE_INCIDENT, 172],
    [{ label: "Mark as Ongoing", hasIcon: true }, 175],
    [{ label: "Mark as Ended", hasIcon: true }, 159],
    [OPEN_CHANNEL, 176],
    [{ label: "Bestätigen", hasIcon: true }, 130],
    [{ label: "Vorfall melden", hasIcon: true }, 157],
    [{ label: "インシデントを宣言", hasIcon: true }, 180],
    [{ label: "تأیید", hasIcon: true }, 112],
    [{ label: "Marcar como Em andamento", hasIcon: true }, 257],
    [{ label: "Подтвердить", hasIcon: true }, 154],
    [{ label: "Отметить как «Продолжается»", hasIcon: true }, 293],
    [{ label: "پیوستن به تماس", hasIcon: true }, 167],
    [{ label: "चैनल खोलें", hasIcon: true, hasMenu: true }, 129],
    [{ label: "진행 중(으)로 표시", hasIcon: true }, 170],
  ])(
    "%j is drawn %ipx wide",
    (action: EventHeaderActionWidthInput, drawnPx: number) => {
      const estimate: number = estimateEventHeaderButtonWidthPx(action);

      expect(estimate).toBeGreaterThanOrEqual(drawnPx);
      expect(estimate).toBeLessThanOrEqual(drawnPx * 1.15);
    },
  );

  test.each([
    [{ identifier: "#311", pills: ["Created", "High"] }, 43.2 + 78.3 + 55.3],
    [{ identifier: "#1042", pills: ["Created", "SEV-2"] }, 54.5 + 78.3 + 64.3],
    [{ identifier: "#58", pills: ["Scheduled"] }, 39.9 + 94.3],
  ])(
    "the number and pills %j are drawn %fpx wide, gaps aside",
    (input: { identifier: string; pills: Array<string> }, drawnPx: number) => {
      const gaps: number = input.pills.length * 8;

      expect(estimateEventHeaderChipsWidthPx(input)).toBeGreaterThanOrEqual(
        drawnPx + gaps,
      );
      expect(estimateEventHeaderChipsWidthPx(input)).toBeLessThanOrEqual(
        (drawnPx + gaps) * 1.15,
      );
    },
  );

  test("a button is never estimated narrower than its 7rem floor or wider than its 20rem cap", () => {
    expect(
      estimateEventHeaderButtonWidthPx({ label: "OK", hasIcon: false }),
    ).toBe(112);
    expect(
      estimateEventHeaderButtonWidthPx({
        label:
          "A very long custom scheduled maintenance state label that goes on",
        hasIcon: true,
      }),
    ).toBe(320);
  });

  test("an icon and a menu's chevron each add their room", () => {
    const plain: number = estimateEventHeaderButtonWidthPx({
      label: "Escalate the page now",
      hasIcon: false,
    });

    expect(
      estimateEventHeaderButtonWidthPx({
        label: "Escalate the page now",
        hasIcon: true,
      }),
    ).toBe(plain + 24);
    expect(
      estimateEventHeaderButtonWidthPx({
        label: "Escalate the page now",
        hasIcon: true,
        hasMenu: true,
      }),
    ).toBe(plain + 24 + 22);
  });

  test("the actions add their gaps and the ⋯", () => {
    const two: number = estimateEventHeaderActionsWidthPx({
      actions: [ACKNOWLEDGE, RESOLVE],
      hasMore: false,
    });

    expect(two).toBe(
      estimateEventHeaderButtonWidthPx(ACKNOWLEDGE) +
        estimateEventHeaderButtonWidthPx(RESOLVE) +
        8,
    );
    expect(
      estimateEventHeaderActionsWidthPx({
        actions: [ACKNOWLEDGE, RESOLVE],
        hasMore: true,
      }),
    ).toBe(two + 8 + 36);
    expect(
      estimateEventHeaderActionsWidthPx({ actions: [], hasMore: true }),
    ).toBe(36);
  });

  test("a private record's lock takes a little more room than a dot", () => {
    const withDot: number = estimateEventHeaderChipsWidthPx({
      identifier: "#1042",
      pills: ["Created", "Private"],
    });

    expect(
      estimateEventHeaderChipsWidthPx({
        identifier: "#1042",
        pills: ["Created", "Private"],
        hasPillIcon: true,
      }),
    ).toBeGreaterThan(withDot);
  });
});

describe("where the actions go", () => {
  type BesideFunction = (
    actions: Array<EventHeaderActionWidthInput>,
    hasMore?: boolean,
  ) => number | null;

  const incidentBeside: BesideFunction = (
    actions: Array<EventHeaderActionWidthInput>,
    hasMore: boolean = false,
  ): number | null => {
    return getEventHeaderActionsBesideWidth({
      identifier: "#1042",
      pills: ["Created", "SEV-2"],
      actions: actions,
      hasMore: hasMore,
    });
  };

  test("has nothing to place without actions", () => {
    expect(incidentBeside([])).toBeNull();
  });

  test("can switch every 2rem, from a 20rem header to an 80rem one", () => {
    const widths: ReadonlyArray<number> = EVENT_HEADER_BESIDE_WIDTHS_REM;

    expect(widths[0]).toBe(20);
    expect(widths[widths.length - 1]).toBe(80);

    for (let index: number = 1; index < widths.length; index++) {
      expect(widths[index]! - widths[index - 1]!).toBe(2);
    }
  });

  test("always picks one of the widths it can switch at, the smallest that holds everything", () => {
    for (const actions of [
      [RESOLVE],
      [ACKNOWLEDGE, RESOLVE],
      [ACKNOWLEDGE, RESOLVE, DECLARE_INCIDENT],
      [RESOLVE, OPEN_CHANNEL],
    ]) {
      const width: number | null = incidentBeside(actions);
      const needed: number =
        estimateEventHeaderChipsWidthPx({
          identifier: "#1042",
          pills: ["Created", "SEV-2"],
        }) +
        16 +
        estimateEventHeaderActionsWidthPx({ actions, hasMore: false }) +
        40 +
        16;

      expect(EVENT_HEADER_BESIDE_WIDTHS_REM).toContain(width);
      expect(width! * PX_PER_REM).toBeGreaterThanOrEqual(needed);

      const index: number = EVENT_HEADER_BESIDE_WIDTHS_REM.indexOf(width!);

      if (index > 0) {
        expect(
          EVENT_HEADER_BESIDE_WIDTHS_REM[index - 1]! * PX_PER_REM,
        ).toBeLessThan(needed);
      }
    }
  });

  test("needs more room for every button, and for the ⋯", () => {
    const one: number = incidentBeside([RESOLVE])!;
    const two: number = incidentBeside([ACKNOWLEDGE, RESOLVE])!;
    const three: number = incidentBeside([
      ACKNOWLEDGE,
      RESOLVE,
      DECLARE_INCIDENT,
    ])!;

    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
    expect(
      incidentBeside([ACKNOWLEDGE, RESOLVE], true)!,
    ).toBeGreaterThanOrEqual(two);
  });

  test("never puts them beside the pills when even the widest header cannot hold them", () => {
    expect(
      incidentBeside(
        Array.from({ length: 8 }, (_value: unknown, index: number) => {
          return { label: `Another long action ${index}`, hasIcon: true };
        }),
      ),
    ).toBeNull();
  });

  /*
   * What the overview pages draw: a new incident's two buttons fit beside
   * the pills from a 1024px window, a new alert's three only from 1280px,
   * and on a phone or beside a tablet's side menu they go under the title.
   */
  test.each([
    ["a new incident", [ACKNOWLEDGE, RESOLVE], ["laptop", "desktop", "wide"]],
    [
      "a new alert",
      [ACKNOWLEDGE, RESOLVE, DECLARE_INCIDENT],
      ["desktop", "wide"],
    ],
    ["an acknowledged incident", [RESOLVE], ["laptop", "desktop", "wide"]],
  ])(
    "%s keeps its buttons beside the pills at %j",
    (
      _label: string,
      actions: Array<EventHeaderActionWidthInput>,
      besideAt: Array<string>,
    ) => {
      const width: number = incidentBeside(actions)!;

      for (const [name, headerWidth] of Object.entries(HEADER_WIDTH_REM)) {
        expect({ name, beside: headerWidth >= width }).toEqual({
          name,
          beside: besideAt.includes(name),
        });
      }
    },
  );

  test("a longer language needs a wider header for the same buttons", () => {
    const english: number = incidentBeside([ACKNOWLEDGE, RESOLVE])!;
    const longer: number = incidentBeside([
      { label: "Bestätigen und benachrichtigen", hasIcon: true },
      { label: "Als behoben markieren", hasIcon: true },
    ])!;

    expect(longer).toBeGreaterThan(english);
  });
});

describe("the top row's classes", () => {
  test("below the switch, or without one, the row wraps: pills, title, then actions at the right", () => {
    const row: EventHeaderTopRowClassNames = getEventHeaderTopRowClassNames({
      besideWidthRem: null,
      hasMore: false,
    });

    expect(row.row).toBe("flex flex-wrap items-start gap-x-4 gap-y-2");
    expect(classesOf(row.chips)).toEqual([
      "flex",
      "w-full",
      "min-w-0",
      "flex-wrap",
      "items-center",
      "gap-2",
    ]);
    expect(classesOf(row.title)).toContain("basis-full");
    expect(classesOf(row.actions)).toEqual([
      "ms-auto",
      "flex",
      "w-full",
      "max-w-full",
      "items-start",
      "justify-end",
      "gap-2",
    ]);
    for (const className of Object.values(row)) {
      expect(className).not.toContain("@container");
    }
  });

  test("from the switch, a grid: pills and actions on the first row, the title across both under them", () => {
    const row: EventHeaderTopRowClassNames = getEventHeaderTopRowClassNames({
      besideWidthRem: 48,
      hasMore: true,
    });
    const at: (classes: string) => Array<string> = (
      classes: string,
    ): Array<string> => {
      return classesOf(atContainerWidth(48, classes));
    };

    expect(classesOf(row.row)).toEqual(
      expect.arrayContaining(at("grid grid-cols-[minmax(0,1fr)_auto]")),
    );
    expect(classesOf(row.chips)).toEqual(
      expect.arrayContaining(at("col-start-1 row-start-1 min-h-9 pe-0")),
    );
    expect(classesOf(row.title)).toEqual(
      expect.arrayContaining(at("col-span-2 row-start-2")),
    );
    expect(classesOf(row.actions)).toEqual(
      expect.arrayContaining(at("col-start-2 row-start-1 w-auto")),
    );
    expect(classesOf(row.morePlace)).toEqual(
      expect.arrayContaining(at("static shrink-0")),
    );
  });

  test("with a ⋯, it waits in the top corner below the switch, and the pills keep room for it", () => {
    const row: EventHeaderTopRowClassNames = getEventHeaderTopRowClassNames({
      besideWidthRem: 44,
      hasMore: true,
    });

    expect(classesOf(row.morePlace)).toEqual(
      expect.arrayContaining(["absolute", "end-4", "top-4", "sm:end-5"]),
    );
    expect(classesOf(row.chips)).toEqual(
      expect.arrayContaining(["min-h-9", "pe-11"]),
    );
  });

  test("names every side by where a line starts and ends, never left or right", () => {
    const physicalSide: RegExp = /(^|:)-?(ml|mr|pl|pr|left|right)-/;

    for (const hasMore of [true, false]) {
      for (const width of [null, 44]) {
        const row: EventHeaderTopRowClassNames = getEventHeaderTopRowClassNames(
          {
            besideWidthRem: width,
            hasMore: hasMore,
          },
        );

        for (const className of Object.values(row).flatMap(classesOf)) {
          expect({ className, physical: physicalSide.test(className) }).toEqual(
            { className, physical: false },
          );
        }
      }
    }
  });
});

describe("the buttons", () => {
  test("look like a security case's: the main move in indigo, the others white", () => {
    expect(classesOf(EVENT_HEADER_PRIMARY_BUTTON_CLASS_NAME)).toEqual([
      "border-indigo-600",
      "bg-indigo-600",
      "text-white",
      "hover:border-indigo-700",
      "hover:bg-indigo-700",
    ]);
    expect(classesOf(EVENT_HEADER_NEUTRAL_BUTTON_CLASS_NAME)).toEqual(
      expect.arrayContaining(["border-gray-300", "bg-white", "text-gray-700"]),
    );
  });

  test("grow to fill their rows below the phone width, and keep their own width above it", () => {
    for (const className of [
      EVENT_HEADER_BUTTON_CLASS_NAME,
      EVENT_HEADER_LOCKED_WRAPPER_CLASS_NAME,
      EVENT_HEADER_MENU_WRAPPER_CLASS_NAME,
    ]) {
      expect(classesOf(className)).toEqual(
        expect.arrayContaining([
          "min-w-[7rem]",
          "max-w-full",
          "flex-auto",
          `[@container(min-width:${EVENT_HEADER_PHONE_WIDTH_REM}rem)]:max-w-80`,
          `[@container(min-width:${EVENT_HEADER_PHONE_WIDTH_REM}rem)]:flex-none`,
        ]),
      );
    }
  });

  test("a locked button looks locked and keeps its height", () => {
    expect(classesOf(EVENT_HEADER_BUTTON_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "h-9",
        "disabled:cursor-not-allowed",
        "disabled:opacity-50",
        "focus-visible:ring-2",
        "whitespace-nowrap",
      ]),
    );
  });
});

describe("the facts", () => {
  test("may take up to two columns from 18rem, three from 34, four from 50 and five from 64", () => {
    expect(EVENT_HEADER_FACT_COLUMN_STEPS).toEqual([
      { columns: 2, widthRem: 18 },
      { columns: 3, widthRem: 34 },
      { columns: 4, widthRem: 50 },
      { columns: 5, widthRem: 64 },
    ]);
  });

  test.each([
    // Never more columns than facts.
    [1, 5, 1],
    [2, 5, 2],
    [3, 5, 3],
    // Two rows of two, not three and one left alone.
    [4, 3, 2],
    [4, 4, 4],
    [4, 5, 4],
    // Three and two, not four and one.
    [5, 2, 2],
    [5, 3, 3],
    [5, 4, 3],
    [5, 5, 5],
    [6, 4, 3],
    [6, 5, 3],
    [7, 4, 4],
  ])(
    "%i facts where %i fit take %i columns",
    (count: number, allowed: number, columns: number) => {
      expect(getEventHeaderFactColumns(count, allowed)).toBe(columns);
    },
  );

  test("never take fewer columns on a wider header", () => {
    for (let count: number = 1; count <= 8; count++) {
      for (let allowed: number = 1; allowed < 5; allowed++) {
        expect(
          getEventHeaderFactColumns(count, allowed + 1),
        ).toBeGreaterThanOrEqual(getEventHeaderFactColumns(count, allowed));
      }
    }
  });

  test.each([
    [1, []],
    [
      3,
      [
        "[@container(min-width:18rem)]:grid-cols-2",
        "[@container(min-width:34rem)]:grid-cols-3",
      ],
    ],
    [
      4,
      [
        "[@container(min-width:18rem)]:grid-cols-2",
        "[@container(min-width:50rem)]:grid-cols-4",
      ],
    ],
    [
      5,
      [
        "[@container(min-width:18rem)]:grid-cols-2",
        "[@container(min-width:34rem)]:grid-cols-3",
        "[@container(min-width:64rem)]:grid-cols-5",
      ],
    ],
  ])(
    "%i facts: one column, then a rule only where the columns change",
    (count: number, rules: Array<string>) => {
      const classes: Array<string> = classesOf(
        getEventHeaderFactsClassName(count),
      );

      expect(classes).toEqual(
        expect.arrayContaining(["grid", "grid-cols-1", "border-t"]),
      );
      expect(
        classes.filter((className: string): boolean => {
          return className.startsWith("[@container");
        }),
      ).toEqual(rules);
    },
  );

  /*
   * Where the overview pages put them. Five facts (an incident episode's):
   * two to a row on a phone and beside a tablet's side menu, then three and
   * two from a laptop, all five on a wide screen. Four (an incident's, an
   * alert's): two and two until a desktop, then one row.
   */
  test.each([
    ["phone", 5, 2],
    ["tablet", 5, 2],
    ["laptop", 5, 3],
    ["desktop", 5, 3],
    ["wide", 5, 5],
    ["phone", 4, 2],
    ["laptop", 4, 2],
    ["desktop", 4, 4],
  ])(
    "a %s header draws %i facts in %i columns",
    (name: string, count: number, columns: number) => {
      const width: number = HEADER_WIDTH_REM[name]!;
      const allowed: number = EVENT_HEADER_FACT_COLUMN_STEPS.filter(
        (step: { columns: number; widthRem: number }): boolean => {
          return width >= step.widthRem;
        },
      ).reduce((most: number, step: { columns: number }): number => {
        return Math.max(most, step.columns);
      }, 1);

      expect(getEventHeaderFactColumns(count, allowed)).toBe(columns);
    },
  );

  /*
   * A fact spans two rows of the grid - its label's, then its value's - and
   * lays the two on them (a subgrid), so the facts of one row share their
   * rows: a label that wraps ("INCIDENT COMMANDER" in a phone's column,
   * "START OVERDUE BY") makes the label line taller for the whole row, every
   * value of the row starts on one line, and each label sits right above
   * its value. On a phone the commander's name sat a line lower than "19
   * minutes" beside it before.
   */
  test("lay each fact's label and value on two rows of the grid, shared by the facts beside it", () => {
    expect(classesOf(EVENT_HEADER_FACT_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "row-span-2",
        "grid",
        "grid-rows-subgrid",
        "min-w-0",
      ]),
    );
    // The label at the foot of its row, 6px over its value.
    expect(classesOf(EVENT_HEADER_FACT_LABEL_CLASS_NAME)).toEqual(
      expect.arrayContaining(["self-end", "pb-1.5"]),
    );
    // Its icon keeps to the first line of a label that wraps.
    expect(classesOf(EVENT_HEADER_FACT_LABEL_CLASS_NAME)).toContain(
      "items-start",
    );
    expect(classesOf(EVENT_HEADER_FACT_LABEL_ICON_CLASS_NAME)).toEqual(
      expect.arrayContaining(["mt-px", "h-3.5", "w-3.5", "flex-shrink-0"]),
    );
    // The space under each value parts the rows, and closes the grid.
    expect(classesOf(EVENT_HEADER_FACT_VALUE_CLASS_NAME)).toContain("pb-4");
    expect(classesOf(EVENT_HEADER_FACT_VALUE_CLASS_NAME)).not.toContain(
      "mt-1.5",
    );

    for (let count: number = 1; count <= 7; count++) {
      const classes: Array<string> = classesOf(
        getEventHeaderFactsClassName(count),
      );

      expect(classes).toContain("pt-4");
      expect(classes).not.toContain("py-4");
      expect(classes).not.toContain("pb-4");
      // No row gap: it would part a label from its own value too.
      expect(
        classes.filter((name: string): boolean => {
          return name.includes("gap-y-") || name.startsWith("gap-");
        }),
      ).toEqual(["gap-x-6"]);
    }
  });

  test("label each fact as the stat tiles do: small grey capitals", () => {
    expect(classesOf(EVENT_HEADER_FACT_LABEL_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "text-xs",
        "font-medium",
        "uppercase",
        "tracking-wide",
        "text-gray-500",
      ]),
    );
  });
});

describe("the band at the foot of the header", () => {
  test("is a band, not a box: under a hairline, edge to edge, its corners the card's", () => {
    for (const tone of Object.keys(
      EVENT_HEADER_NOTICE_CLASS_NAMES,
    ) as Array<EventHeaderNoticeTone>) {
      const classes: Array<string> = classesOf(
        EVENT_HEADER_NOTICE_CLASS_NAMES[tone],
      );

      expect(classes).toEqual(
        expect.arrayContaining(["rounded-b-[11px]", "border-t", "px-4"]),
      );
      expect(classes).not.toContain("rounded-lg");
      expect(classes).not.toContain("shadow-sm");
      expect(classes).not.toContain("border");
    }
  });

  test("takes its tone from what it says", () => {
    expect(classesOf(EVENT_HEADER_NOTICE_CLASS_NAMES.ai)).toEqual(
      expect.arrayContaining(["border-indigo-100", "bg-indigo-50/60"]),
    );
    expect(classesOf(EVENT_HEADER_NOTICE_CLASS_NAMES.warning)).toEqual(
      expect.arrayContaining(["border-amber-200", "bg-amber-50/70"]),
    );
    expect(classesOf(EVENT_HEADER_NOTICE_CLASS_NAMES.danger)).toEqual(
      expect.arrayContaining(["border-red-100", "bg-red-50/60"]),
    );
    expect(classesOf(EVENT_HEADER_NOTICE_CLASS_NAMES.neutral)).toEqual(
      expect.arrayContaining(["border-gray-100"]),
    );
    expect(
      classesOf(EVENT_HEADER_NOTICE_CLASS_NAMES.neutral).some(
        (name: string): boolean => {
          return name.startsWith("bg-");
        },
      ),
    ).toBe(false);
  });
});
