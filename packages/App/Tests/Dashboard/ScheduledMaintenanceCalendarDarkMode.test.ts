import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Maintenance Calendar in the dark theme: the calendar card, its legend
 * and empty line, the Subscribe to calendar dialog, the external calendars'
 * toggles and their striped blocks, and Calendar Settings.
 *
 * The dashboard's dark theme does not come from Tailwind's dark: variants.
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant. A class it has no rule for keeps its light
 * colour in the dark theme and nothing fails - a pale pill on a dark card.
 * So this holds every colour class these modules use to what Theme.css
 * remaps, and pins the calendar's own dark rules: today's cell in the month
 * grid, the edge that keeps a black state's block and legend dot visible,
 * the soft blocks' and the overlay blocks' dark tones, the "+N more"
 * list, and the week's lines.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");

const MODULES: Array<string> = [
  "FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceCalendar.tsx",
  "FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarSubscribeModal.tsx",
  "FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarView.ts",
  // The calendars from outside the project, on the calendar and on Calendar Settings.
  "FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ExternalCalendarToggles.tsx",
  "FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarOverlays.ts",
  "FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ExternalCalendarStatus.ts",
  "FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceCalendarSettings.tsx",
  // Month | Week | Day.
  "../Common/UI/Components/ViewSwitch/ViewSwitch.tsx",
  // The calendar's toolbar and the soft blocks' colours.
  "../Common/UI/Components/Calendar/CalendarToolbar.tsx",
  "../Common/UI/Components/Calendar/CalendarEventTone.ts",
];

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;

const THEME_CSS: string = fs
  .readFileSync(path.join(COMMON_ROOT, "UI", "Styles", "Theme.css"), "utf8")
  .replace(BLOCK_COMMENT, " ");

const CALENDAR_CSS: string = fs
  .readFileSync(
    path.join(COMMON_ROOT, "UI", "Components", "Calendar", "Calendar.css"),
    "utf8",
  )
  .replace(BLOCK_COMMENT, " ");

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(APP_ROOT, relativePath), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ");
}

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `hover:bg-gray-50` only with a rule of its own.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to|placeholder)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// A saturated 400-600 mark reads the same on a light and a dark card.
const SOLID_MARK: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate)[a-z]+-(?:400|500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

const SUBSTRING_SELECTOR: RegExp = /\[class\*="([^"]+)"\]/g;

const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_SELECTOR),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

const BACKSLASH: RegExp = /\\/g;
const COLON: RegExp = /:/g;
const SLASH: RegExp = /\//g;

function isRemapped(token: string): boolean {
  const utility: string = token.slice(token.lastIndexOf(":") + 1);

  if (
    utility === "text-white" ||
    utility.endsWith("-transparent") ||
    SOLID_MARK.test(utility)
  ) {
    return true;
  }

  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  if (
    SUBSTRING_VARIANTS.some((prefix: string): boolean => {
      return token.startsWith(prefix);
    })
  ) {
    return true;
  }

  const escapedClass: string = token
    .replace(BACKSLASH, "\\\\")
    .replace(COLON, "\\:")
    .replace(SLASH, "\\/");
  let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

  while (from !== -1) {
    const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
}

describe("the scheduled maintenance calendar in the dark theme", () => {
  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const modulePath of MODULES) {
      const code: string = readCode(modulePath);

      expect({ modulePath, dark: code.includes("dark:") }).toEqual({
        modulePath,
        dark: false,
      });
      expect({
        modulePath,
        template: TEMPLATE_COLOR_TOKEN.test(code),
      }).toEqual({ modulePath, template: false });
    }
  });

  test("every colour class they use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();

    for (const modulePath of MODULES) {
      for (const match of readCode(modulePath).matchAll(COLOR_TOKEN)) {
        tokens.add(match[1]!);
      }
    }

    // The reading works: the calendar's own greys are among them.
    expect(tokens.has("text-gray-500")).toBe(true);
    expect(tokens.has("bg-gray-100")).toBe(true);

    const unmapped: Array<string> = Array.from(tokens).filter(
      (token: string): boolean => {
        return !isRemapped(token);
      },
    );

    expect(unmapped).toEqual([]);
  });

  test("today keeps its accent in the month grid, whose day cells are painted the card's colour", () => {
    expect(THEME_CSS).toContain(
      "html.dark .oneuptime-calendar .rbc-month-view .rbc-day-bg.rbc-today",
    );
  });

  test("a block or a legend dot as dark as the page keeps an edge", () => {
    expect(THEME_CSS).toContain("html.dark .oneuptime-calendar .rbc-event {");
    expect(THEME_CSS).toContain("html.dark .oneuptime-calendar-legend-dot {");
    expect(CALENDAR_CSS).toContain(".oneuptime-calendar-legend-dot {");
  });

  test("a soft block takes its dark tone from the custom properties its style carries", () => {
    const toneModule: string = readCode(
      "../Common/UI/Components/Calendar/CalendarEventTone.ts",
    );

    expect(toneModule).toContain('"oneuptime-calendar-event--soft"');

    // Not scoped to the calendar's wrapper: the "+N more" list is outside it.
    const rule: string =
      "html.dark .rbc-event.oneuptime-calendar-event--soft {";

    expect(THEME_CSS).toContain(rule);

    const body: string = THEME_CSS.slice(
      THEME_CSS.indexOf(rule),
      THEME_CSS.indexOf("}", THEME_CSS.indexOf(rule)),
    );

    for (const property of [
      "--ou-calendar-event-dark-bg",
      "--ou-calendar-event-dark-text",
      "--ou-calendar-event-dark-shadow",
    ]) {
      expect(toneModule).toContain(`"${property}"`);
      // Important: what it replaces is the light tone's inline style.
      expect(body).toContain(`var(${property}) !important`);
    }
  });

  test("an overlay block - an event from another calendar - takes its dark tone, stripes and edge from the custom properties its style carries", () => {
    const toneModule: string = readCode(
      "../Common/UI/Components/Calendar/CalendarEventTone.ts",
    );

    expect(toneModule).toContain('"oneuptime-calendar-event--overlay"');

    const rule: string =
      "html.dark .rbc-event.oneuptime-calendar-event--overlay {";

    expect(THEME_CSS).toContain(rule);

    const body: string = THEME_CSS.slice(
      THEME_CSS.indexOf(rule),
      THEME_CSS.indexOf("}", THEME_CSS.indexOf(rule)),
    );

    for (const property of [
      "--ou-calendar-overlay-dark-bg",
      "--ou-calendar-overlay-dark-image",
      "--ou-calendar-overlay-dark-text",
      "--ou-calendar-overlay-dark-border",
    ]) {
      expect(toneModule).toContain(`"${property}"`);
      expect(body).toContain(`var(${property}) !important`);
    }

    // Nothing to open: the pointer stays an arrow.
    expect(CALENDAR_CSS).toContain(
      ".oneuptime-calendar .rbc-event.oneuptime-calendar-event--overlay,",
    );
    expect(CALENDAR_CSS).toContain("cursor: default;");
  });

  test('the "+N more" list, drawn at the end of the body, is a dark card on the dark theme', () => {
    expect(CALENDAR_CSS).toContain(".rbc-overlay {");
    expect(CALENDAR_CSS).toContain("max-height: 20rem;");
    expect(THEME_CSS).toContain("html.dark .rbc-overlay {");
    expect(THEME_CSS).toContain("html.dark .rbc-overlay .rbc-overlay-header {");
  });

  test("the week's lines between days and hours are the subtle border on the dark theme, without the half hours", () => {
    expect(THEME_CSS).toContain(
      "html.dark .oneuptime-calendar .rbc-time-content > * + * > * {",
    );
    expect(THEME_CSS).toContain(
      "html.dark .oneuptime-calendar .rbc-day-slot .rbc-time-slot {",
    );
    expect(THEME_CSS).toContain(
      "html.dark .oneuptime-calendar .rbc-time-view .rbc-timeslot-group {",
    );
  });

  test("the day names of the week and the agenda's column titles are dark on the dark theme", () => {
    /*
     * Calendar.css paints the week's day names with a selector four classes
     * deep; the dark rule outranks it only with .rbc-calendar in it.
     */
    expect(CALENDAR_CSS).toContain(
      ".oneuptime-calendar .rbc-time-header-content > .rbc-row > .rbc-header",
    );
    expect(THEME_CSS).toContain(
      "html.dark .oneuptime-calendar .rbc-calendar :is(\n    .rbc-header,",
    );
  });

  test("an event's link reads as its block's label in either theme", () => {
    expect(CALENDAR_CSS).toContain(
      ".oneuptime-calendar .rbc-event .oneuptime-calendar-event-link {",
    );
    expect(
      readCode(MODULES[0]!).includes("oneuptime-calendar-event-link"),
    ).toBe(true);
  });
});
