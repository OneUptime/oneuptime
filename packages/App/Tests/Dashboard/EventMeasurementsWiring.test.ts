import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An incident's, an alert's and a maintenance event's own measurements, on
 * its own page. App's node test environment cannot render React, so what is
 * pinned here is the wiring and the styling the rendered suites stub out:
 *
 *   - each overview page draws the Measurements card in its right-hand
 *     column, straight under its details card - out of the hero and the stat
 *     bar, whose layout the EventOverview suites pin - with the event's id,
 *     whether the event is over, and the feed's refresh token;
 *   - each Measurements settings page offers the switch that puts a
 *     measurement on those pages, folded under More fields;
 *   - every colour the card draws is re-coloured by Theme.css for the dark
 *     theme, and the card draws no banner of its own.
 *
 * The card's behaviour is in Common/Tests/App/Dashboard
 * (EventMeasurementsCard.test.tsx, EventMeasurements.test.ts), the pages'
 * in EventOverviewPages.test.tsx and ScheduledMaintenanceOverviewPage.test.tsx.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const THEME_CSS_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Styles",
  "Theme.css",
);

type ReadFunction = (...parts: Array<string>) => string;

const readRaw: ReadFunction = (...parts: Array<string>): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8");
};

const stripComments: (text: string) => string = (text: string): string => {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
};

// Comment-free and whitespace-squashed, so a prettier re-wrap changes nothing.
const readSource: ReadFunction = (...parts: Array<string>): string => {
  return stripComments(readRaw(...parts))
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")");
};

type IndexOfFunction = (source: string, needle: string, from?: number) => number;

const indexOf: IndexOfFunction = (
  source: string,
  needle: string,
  from: number = 0,
): number => {
  const index: number = source.indexOf(needle, from);

  if (index < 0) {
    throw new Error(`Expected the source to contain: ${needle}`);
  }

  return index;
};

type CountFunction = (source: string, needle: string) => number;

const count: CountFunction = (source: string, needle: string): number => {
  return source.split(needle).length - 1;
};

type ElementAtFunction = (source: string, start: number) => string;

// The JSX element that starts at `start`, up to its self-closing "/>".
const elementAt: ElementAtFunction = (source: string, start: number): string => {
  return source.slice(start, indexOf(source, "/>", start) + 2);
};

interface OverviewPage {
  label: string;
  file: Array<string>;
  source: string;
  // The details card the Measurements card sits under, and the card after it.
  detailsCard: string;
  nextCard: string;
  isEventOver: RegExp;
}

const OVERVIEW_PAGES: Array<OverviewPage> = [
  {
    label: "incident",
    file: ["Pages", "Incidents", "View", "Index.tsx"],
    source: "INCIDENT_EVENT_MEASUREMENTS",
    detailsCard: 'name="Incident Details"',
    nextCard: "<IncidentMemberRoleAssignment",
    isEventOver: /isEventOver=\{Boolean\(durationEndDate\)\}/,
  },
  {
    label: "alert",
    file: ["Pages", "Alerts", "View", "Index.tsx"],
    source: "ALERT_EVENT_MEASUREMENTS",
    detailsCard: 'name="Alert Details"',
    nextCard: 'name="Affected Resources"',
    isEventOver: /isEventOver=\{Boolean\(durationEndDate\)\}/,
  },
  {
    label: "scheduled maintenance",
    file: ["Pages", "ScheduledMaintenanceEvents", "View", "Index.tsx"],
    source: "SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS",
    detailsCard: 'name="Scheduled Maintenance Details"',
    nextCard: "<OverviewCustomFields",
    isEventOver:
      /isEventOver=\{Boolean\(scheduledMaintenance\?\.currentScheduledMaintenanceState ?\?\.isResolvedState,?\)\}/,
  },
];

describe.each(OVERVIEW_PAGES)(
  "the $label overview's Measurements card",
  (page: OverviewPage) => {
    const view: string = readSource(...page.file);

    test("is drawn once, for this kind of event, with the event's id and the feed's refresh token", () => {
      expect(count(view, "<EventMeasurementsCard")).toBe(1);

      const card: string = elementAt(view, indexOf(view, "<EventMeasurementsCard"));

      expect(card).toContain(`source={${page.source}}`);
      expect(card).toContain("eventId={modelId}");
      expect(card).toContain("refreshToken={feedRefreshToken}");
      expect(card).toContain('headerLayout="stacked"');
      expect(card).toMatch(page.isEventOver);
      expect(view).toContain(
        'import EventMeasurementsCard from "../../../Components/Measurement/EventMeasurementsCard";',
      );
      expect(view).toContain(
        `import { ${page.source} } from "../../../Utils/Measurement/EventMeasurements";`,
      );
    });

    test("sits in the right-hand column, straight under the details card", () => {
      const grid: number = indexOf(
        view,
        '<div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">',
      );
      const rightColumn: number = indexOf(
        view,
        '<div className="min-w-0 xl:col-span-1">',
      );
      const details: number = indexOf(view, page.detailsCard);
      const card: number = indexOf(view, "<EventMeasurementsCard");
      const next: number = indexOf(view, page.nextCard, details);

      // Out of the hero and the stat bar: inside the grid, on the right.
      expect(grid).toBeLessThan(rightColumn);
      expect(rightColumn).toBeLessThan(details);
      expect(details).toBeLessThan(card);
      expect(card).toBeLessThan(next);
      expect(indexOf(view, "</EventStatBar>")).toBeLessThan(card);

      // Nothing else between the details card's end and it.
      const detailsEnd: number = view.lastIndexOf("/>", card);

      expect(view.slice(detailsEnd + 2, card).trim()).toBe("");
    });
  },
);

test("the maintenance page reads whether the event is completed with the event itself", () => {
  const view: string = readSource(
    "Pages",
    "ScheduledMaintenanceEvents",
    "View",
    "Index.tsx",
  );
  const fetch: string = view.slice(
    indexOf(view, "await ModelAPI.getItem<ScheduledMaintenance>({"),
    indexOf(view, "if (requestNumber !== latestRequestRef.current)"),
  );

  expect(fetch).toContain(
    "currentScheduledMaintenanceState: { isResolvedState: true, },",
  );
});

interface SettingsPage {
  label: string;
  file: Array<string>;
  model: string;
  source: string;
}

const SETTINGS_PAGES: Array<SettingsPage> = [
  {
    label: "incident",
    file: ["Pages", "Incidents", "Settings", "IncidentMeasurements.tsx"],
    model: "IncidentMeasurement",
    source: "INCIDENT_EVENT_MEASUREMENTS",
  },
  {
    label: "alert",
    file: ["Pages", "Alerts", "Settings", "AlertMeasurements.tsx"],
    model: "AlertMeasurement",
    source: "ALERT_EVENT_MEASUREMENTS",
  },
  {
    label: "scheduled maintenance",
    file: [
      "Pages",
      "ScheduledMaintenanceEvents",
      "Settings",
      "ScheduledMaintenanceMeasurements.tsx",
    ],
    model: "ScheduledMaintenanceMeasurement",
    source: "SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS",
  },
];

describe.each(SETTINGS_PAGES)(
  "the $label measurement form",
  (page: SettingsPage) => {
    const settings: string = readSource(...page.file);

    test("offers the show-on-pages switch under More fields, last, on the column the card reads", () => {
      expect(count(settings, "getMeasurementShowOnViewFormField<")).toBe(1);
      expect(settings).toContain(
        `getMeasurementShowOnViewFormField<${page.model}>({ column: ${page.source}.showOnViewColumn, stepId: "moments", title: COPY.showOnViewTitle, description: COPY.showOnViewDescription, collapsibleSection: advancedSection, }), ]}`,
      );
      // After the other folded options, in the same section.
      expect(
        indexOf(settings, "getMeasurementChartSummaryFormField<"),
      ).toBeLessThan(indexOf(settings, "getMeasurementShowOnViewFormField<"));
    });
  },
);

test("the switch is on by default, as the server has it, so an Edit compares with the same default", () => {
  const fields: string = readSource(
    "Components",
    "Measurement",
    "MeasurementFormFields.tsx",
  );
  const builder: string = fields.slice(
    indexOf(fields, "export const getMeasurementShowOnViewFormField"),
    indexOf(fields, "export const getMeasurementColumnFormFields"),
  );

  expect(builder).toContain("fieldType: FormFieldSchemaType.Toggle,");
  expect(builder).toContain("defaultValue: true,");
  expect(builder).toContain("collapsibleSection: options.collapsibleSection,");
  expect(builder).not.toContain("doNotShowWhenCreating");
});

describe("the Measurements card itself", () => {
  const card: string = readSource(
    "Components",
    "Measurement",
    "EventMeasurementsCard.tsx",
  );

  test("draws nothing when there is nothing to show, and no banner ever", () => {
    expect(card).toContain(
      "if (!isReadable || readings.length === 0) { return <></>; }",
    );
    expect(card).not.toMatch(/<Alert\b|<AlertBanner\b|ComponentLoader|PageLoader/);
  });

  test("is a card of the page: one Card, no box inside it", () => {
    expect(count(card, "<Card")).toBe(1);
    expect(card).not.toMatch(/\b(?:border|shadow|rounded)(?:-[a-z0-9]+)?\b/);
    expect(card).not.toMatch(/\bbg-(?!gray-100)/);
  });
});

/*
 * The dark theme does not use Tailwind's dark: variants: Theme.css re-colours
 * the light utility classes under html.dark, one rule per class. A class it
 * has no rule for keeps its light colour in the dark theme, and nothing fails.
 */
describe("the Measurements card in the dark theme", () => {
  const code: string = stripComments(
    readRaw("Components", "Measurement", "EventMeasurementsCard.tsx"),
  );
  const themeCss: string = fs
    .readFileSync(THEME_CSS_PATH, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  const COLOR_UTILITY: RegExp =
    /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;
  const IDENTIFIER_CHAR: RegExp = /[\w-]/;

  const tokens: Array<string> = [];

  for (const match of code.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
    tokens.push(
      ...(match[1] ?? match[2] ?? "")
        .replace(/\$\{[^}]*\}/g, " ")
        .split(/\s+/)
        .filter((token: string): boolean => {
          return token.length > 0;
        }),
    );
  }

  const colorTokens: Array<string> = Array.from(
    new Set(
      tokens.filter((token: string): boolean => {
        return COLOR_UTILITY.test(token);
      }),
    ),
  );

  const isRemapped: (token: string) => boolean = (token: string): boolean => {
    let from: number = themeCss.indexOf(`.${token}`);

    while (from !== -1) {
      const next: string = themeCss[from + token.length + 1] || " ";

      // Followed by a non-identifier character: gray-50 is not gray-500.
      if (!IDENTIFIER_CHAR.test(next)) {
        return true;
      }

      from = themeCss.indexOf(`.${token}`, from + 1);
    }

    return false;
  };

  test("uses no dark: variants and builds no colour class from a template", () => {
    expect(code).not.toContain("dark:");
    expect(code).not.toMatch(/(?:bg|text|border|ring|divide)-\$\{/);
  });

  test("every colour class it draws is re-coloured for the dark theme", () => {
    // The scan found the card's colours at all, so this is not vacuous.
    expect(colorTokens).toEqual(
      expect.arrayContaining([
        // Names, summaries, values and reasons.
        "text-gray-500",
        "text-gray-400",
        "text-gray-900",
        // The hairlines between measurements.
        "divide-gray-100",
        // An end before its start.
        "text-amber-700",
      ]),
    );

    expect(
      colorTokens.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });
});
