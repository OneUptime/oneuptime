import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Someone who sets up 'Time to mitigate' opens an incident and finds it
 * nowhere." Each incident's, alert's and maintenance event's page now shows
 * its own measurements in a Measurements card, and the measurement form has
 * the switch that keeps one off those pages. The docs must say both: where
 * the card is, what each of its states means, and the switch with its API
 * default.
 *
 * English and Persian document measurements (the other languages' incident
 * docs predate them). Persian quotes the Dashboard's English labels, as the
 * rest of its measurements section does.
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

const IMPACT_HEADING: RegExp = /### \S*Impact Started At/;

// What a measurement can read on an event's page, as the card writes it.
const STATES: Array<string> = [
  "**Running for 12 minutes**",
  "**Not started yet**",
  "**Not reached**",
  "**Not measured**",
  "**Ends before it starts**",
  "**Not worked out yet**",
];

describe.each(["en", "fa"])("the %s measurements docs", (language: string) => {
  const section: string = measurementsSection(language);

  it("say each incident's page shows its measurements, in a card under its details", () => {
    const start: number = section.indexOf(PAGE_HEADING[language]!);

    expect(start).toBeGreaterThan(-1);

    const subsection: string = section.slice(
      start,
      section.indexOf("\n### ", start + 1),
    );

    expect(subsection).toContain("**Measurements**");
    expect(subsection).toContain("**Incident Details**");
    expect(subsection).toContain("**Declared → Acknowledged**");

    for (const state of STATES) {
      expect({ state, documented: subsection.includes(state) }).toEqual({
        state,
        documented: true,
      });
    }

    // Each state is tied to the API status it comes from.
    for (const status of [
      "**Recorded**",
      "**Not Applicable**",
      "**Invalid**",
    ]) {
      expect(subsection).toContain(status);
    }

    // A number in the measurement's own unit.
    expect(subsection).toContain("**1 hour, 5 minutes**");
    expect(subsection).toContain("**1.5 hours**");
  });

  it("put the page section after the statuses it explains, before Impact Started At", () => {
    const statuses: number = section.indexOf("| **Invalid**");
    const page: number = section.indexOf(PAGE_HEADING[language]!);
    // Persian marks the heading's direction before its English words.
    const impact: number = section.search(IMPACT_HEADING);

    expect(impact).toBeGreaterThan(-1);

    expect(statuses).toBeGreaterThan(-1);
    expect(statuses).toBeLessThan(page);
    expect(page).toBeLessThan(impact);
  });

  it("list the switch under More fields, in each kind of event's words", () => {
    const moreFields: string = section.slice(
      section.indexOf("**More fields**"),
      section.indexOf("**Enabled**"),
    );

    for (const title of [
      "**Show on incident pages**",
      "**Show on alert pages**",
      "**Show on maintenance event pages**",
    ]) {
      expect(moreFields).toContain(title);
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
        return line.startsWith("- **Overview**");
      });

    expect(overview).toContain("**Measurements**");
    expect(overview).toContain("/docs/incidents/settings");
  });
});
