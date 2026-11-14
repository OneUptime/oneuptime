import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import MeasurementUnit from "Common/Types/Measurement/MeasurementUnit";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatEventMeasurementDuration } from "../../../FeatureSet/Dashboard/src/Utils/Measurement/EventMeasurements";
import { MEASUREMENT_VALUE_COPY } from "../../../FeatureSet/Dashboard/src/Utils/Measurement/MeasurementSetup";
import {
  dashboardTranslator,
  drawnDashboardLabel,
} from "./DocsDashboardLabels";
import { pathWithArrows } from "./DocsPageShape";

/*
 * "Someone who sets up 'Time to mitigate' opens an incident and finds it
 * nowhere." Each incident's, alert's and maintenance event's page now shows
 * its own measurements in a Measurements card, and the measurement form has
 * the switch that keeps one off those pages. The docs must say both: where
 * the card is, what each of its states means, and the switch with its API
 * default.
 *
 * English and Persian document measurements (the other languages' incident
 * docs predate them). Each names what the card shows as its own Dashboard
 * draws it, worked out here with the card's own functions (#7100). The
 * API statuses (Recorded, Not Applicable, Invalid) stay in English: they
 * are the values the API returns.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

// The section's heading in each language.
const MEASUREMENTS_HEADING: Record<string, string> = {
  en: "## Measurements",
  fa: "## اندازه‌گیری‌ها",
};

// The subsection on the incident's page, in each language.
const PAGE_HEADING: Record<string, string> = {
  en: "### On each incident's page",
  fa: "### در صفحه هر حادثه",
};

function read(language: string, file: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "incidents", file),
    "utf8",
  );
}

function measurementsSection(language: string): string {
  const page: string = read(language, "settings.md");
  const start: number = page.indexOf(MEASUREMENTS_HEADING[language]!);

  expect(start).toBeGreaterThan(-1);

  const end: number = page.indexOf("\n## ", start + 1);

  return page.slice(start, end === -1 ? undefined : end);
}

// A label in bold, as this language's Dashboard draws it.
function bold(language: string, english: string): string {
  return `**${drawnDashboardLabel(language, english)}**`;
}

const SECONDS_PER_MINUTE: number = 60;

// A duration in bold, as the card writes it in this language.
function duration(
  language: string,
  seconds: number,
  unit: MeasurementUnit,
  isRunning?: boolean,
): string {
  return formatEventMeasurementDuration({
    seconds: seconds,
    unit: unit,
    translator: dashboardTranslator(language),
    isRunning: isRunning,
  });
}

// What a measurement can read on an event's page, as the card writes it.
function states(language: string): Array<string> {
  const translator: Translator = dashboardTranslator(language);
  const running: string = translator.translateTemplate(
    MEASUREMENT_VALUE_COPY.running,
    {
      duration: duration(
        language,
        12 * SECONDS_PER_MINUTE,
        MeasurementUnit.Seconds,
        true,
      ),
    },
  );

  return [
    `**${running}**`,
    bold(language, MEASUREMENT_VALUE_COPY.notStarted),
    bold(language, MEASUREMENT_VALUE_COPY.notReached),
    bold(language, MEASUREMENT_VALUE_COPY.notMeasured),
    bold(language, MEASUREMENT_VALUE_COPY.endsBeforeStart),
    bold(language, MEASUREMENT_VALUE_COPY.notWorkedOut),
  ];
}

describe.each(["en", "fa"])("the %s measurements docs", (language: string) => {
  const section: string = measurementsSection(language);

  it("say each incident's page shows its measurements, in a card under its details", () => {
    const start: number = section.indexOf(PAGE_HEADING[language]!);

    expect(start).toBeGreaterThan(-1);

    const subsection: string = section.slice(
      start,
      section.indexOf("\n### ", start + 1),
    );

    expect(subsection).toContain(bold(language, "Measurements"));
    expect(subsection).toContain(bold(language, "Incident Details"));
    // From one moment to the other: "←" between two Persian ones (#7611).
    expect(subsection).toContain(
      `**${pathWithArrows(
        [
          drawnDashboardLabel(language, "Declared"),
          drawnDashboardLabel(language, "Acknowledged"),
        ],
        language,
      )}**`,
    );

    for (const state of states(language)) {
      expect({ state, documented: subsection.includes(state) }).toEqual({
        state,
        documented: true,
      });
    }

    // Each state is tied to the API status it comes from, as the API names it.
    for (const status of [
      "**Recorded**",
      "**Not Applicable**",
      "**Invalid**",
    ]) {
      expect(subsection).toContain(status);
    }

    // A number in the measurement's own unit.
    for (const reading of [
      duration(language, 4 * SECONDS_PER_MINUTE, MeasurementUnit.Seconds),
      duration(language, 65 * SECONDS_PER_MINUTE, MeasurementUnit.Seconds),
      duration(language, 90 * SECONDS_PER_MINUTE, MeasurementUnit.Hours),
    ]) {
      expect(subsection).toContain(`**${reading}**`);
    }
  });

  it("put the page section after the statuses it explains, before Impact Started At", () => {
    const statuses: number = section.indexOf("| **Invalid**");
    const page: number = section.indexOf(PAGE_HEADING[language]!);
    const impact: number = section.indexOf(
      `### ${drawnDashboardLabel(language, "Impact Started At")}`,
    );

    expect(impact).toBeGreaterThan(-1);

    expect(statuses).toBeGreaterThan(-1);
    expect(statuses).toBeLessThan(page);
    expect(page).toBeLessThan(impact);
  });

  it("list the switch under More fields, in each kind of event's words", () => {
    const moreFields: string = section.slice(
      section.indexOf(bold(language, "More fields")),
      section.indexOf(bold(language, "Enabled")),
    );

    for (const title of [
      "Show on incident pages",
      "Show on alert pages",
      "Show on maintenance event pages",
    ]) {
      expect(moreFields).toContain(bold(language, title));
    }
  });

  it("give the switch's API and Terraform default", () => {
    for (const attribute of [
      "`show_on_incident_view`",
      "`show_on_alert_view`",
      "`show_on_scheduled_maintenance_view`",
    ]) {
      expect(section).toContain(attribute);
    }

    expect(section).toContain("`true`");
  });

  it("no longer leave the measurements off the incident's Overview", () => {
    const overview: string | undefined = read(language, "index.md")
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith(`- ${bold(language, "Overview")}`);
      });

    expect(overview).toContain(bold(language, "Measurements"));
    expect(overview).toContain("/docs/incidents/settings");
  });
});
