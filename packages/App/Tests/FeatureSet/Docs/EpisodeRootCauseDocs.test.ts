import { readDashboardSource } from "./DocsDashboardMenus";
import { TRANSLATED_LANGUAGES, readPage } from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN EPISODE'S ROOT CAUSE PAGE CHARTS THE METRICS BEHIND IT (issue #6320).
 *
 * The incident episodes page, which every episode reads ("works the same way
 * for alert episodes"), says so in a section of its own; the alert episodes
 * page says so where it lists an episode's pages; and the charts and time
 * ranges page names an episode's Root Cause page beside an incident's and an
 * alert's. This holds the English to the code that does it, and every
 * translation to its English page: the same lines, and the pages named as
 * that language's Dashboard names them.
 */

const INCIDENT_EPISODES: string = "incidents/episodes";
const ALERT_EPISODES: string = "alerts/episodes";
const CHARTS: string = "telemetry/charts-and-time-ranges";

const HEADING: string = "## Writing down the root cause";

const INCIDENT_EPISODES_TEXT: string =
  "An episode's **Root Cause** page is where you write down why it happened, once for every incident in it. Beside the root cause it charts the metrics behind the episode: those of its first incident, the earliest declared, as the telemetry card on the episode's **Overview** charts them, around when the episode started and with the episode's own moments marked. Pick another time range, drag across a chart to zoom in, or change and add metrics right there; the page's address keeps what you changed, so a link to it opens the same charts. When that incident kept no snapshot of a metric check (one declared by hand on a metrics monitor, say), the page charts that monitor's metrics as the monitor reads them now, and says so. An episode whose first incident has no metrics behind it shows the root cause alone.";

const ALERT_EPISODES_TEXT: string =
  "The **Root Cause** page charts the metrics behind the episode beside its root cause: those of its first alert, the earliest created, as the telemetry card on its **Overview** charts them, around when the episode started and with its moments marked, so you can read them over any time range around it while you write down why it happened. When that alert kept no snapshot of a metric check (one created by hand on a metrics monitor, say), the page charts that monitor's metrics as the monitor reads them now, and says so.";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

// How a language's Dashboard names a page: its own words, or the English.
function dashboardWord(language: string, english: string): string {
  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
  const word: unknown = locale[english];

  return typeof word === "string" && word.trim() ? word : english;
}

function linesOf(language: string, page: string): Array<string> {
  return readPage(language, page).split("\n");
}

function boldWords(line: string): Array<string> {
  return Array.from(line.matchAll(/\*\*([^*\n]+)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function lineIndexOf(lines: Array<string>, text: string): number {
  const index: number = lines.indexOf(text);
  expect({ text: text.slice(0, 60), found: index >= 0 }).toEqual({
    text: text.slice(0, 60),
    found: true,
  });
  return index;
}

describe("the English pages, held to the code", () => {
  it("the incident episodes page gives the Root Cause page a section of its own, at its end", () => {
    const lines: Array<string> = linesOf("en", INCIDENT_EPISODES);
    const heading: number = lineIndexOf(lines, HEADING);

    expect(lines[heading + 1]).toBe("");
    expect(lines[heading + 2]).toBe(INCIDENT_EPISODES_TEXT);
    // Its last section: nothing after it but the end of the page.
    expect(
      lines
        .slice(heading + 3)
        .join("")
        .trim(),
    ).toBe("");
    // Every episode reads it: an alert episode's page works the same way.
    expect(readPage("en", INCIDENT_EPISODES)).toContain(
      'Everything on this page works the same way for alert episodes: read "alert" where it says "incident".',
    );
  });

  it("the alert episodes page says it where it lists an episode's pages, after the Overview", () => {
    const lines: Array<string> = linesOf("en", ALERT_EPISODES);
    const text: number = lineIndexOf(lines, ALERT_EPISODES_TEXT);

    expect(lines[text - 2]).toMatch(
      /^\*\*Developer\*\* and \*\*Advanced\*\* start folded\. On the \*\*Overview\*\*/,
    );
    expect(
      lines.slice(0, text).lastIndexOf("## What each page of an episode shows"),
    ).toBeGreaterThan(-1);
  });

  it("both pages' Root Cause pages show the card, reading the episode's first member as its Overview picks it", () => {
    for (const [page, chart, reader, kind] of [
      [
        "Pages/Incidents/EpisodeView/RootCause.tsx",
        "<IncidentEpisodeRootCauseMetricChart incidentEpisodeId={modelId} />",
        "Components/IncidentEpisode/IncidentEpisodeRootCauseMetricChart.tsx",
        "INCIDENT_EPISODE_FIRST_MEMBER",
      ],
      [
        "Pages/Alerts/EpisodeView/RootCause.tsx",
        "<AlertEpisodeRootCauseMetricChart alertEpisodeId={modelId} />",
        "Components/AlertEpisode/AlertEpisodeRootCauseMetricChart.tsx",
        "ALERT_EPISODE_FIRST_MEMBER",
      ],
    ] as Array<[string, string, string, string]>) {
      expect(readDashboardSource(page)).toContain(chart);
      expect(readDashboardSource(reader)).toContain(
        "<EventRootCauseMetricChart",
      );
      expect(readDashboardSource(reader)).toContain(`kind: ${kind},`);
    }

    // The first member, the earliest declared incident or created alert.
    const firstMember: string = readDashboardSource(
      "Components/EpisodeView/EpisodeFirstMember.ts",
    );
    expect(firstMember).toContain('startedAtField: "declaredAt",');
    expect(firstMember).toContain('startedAtField: "createdAt",');
    expect(firstMember).toContain("sortOrder: SortOrder.Ascending,");

    // The one the episode's Overview charts too.
    expect(
      readDashboardSource("Pages/Incidents/EpisodeView/Index.tsx"),
    ).toContain("kind: INCIDENT_EPISODE_FIRST_MEMBER,");
    expect(readDashboardSource("Pages/Alerts/EpisodeView/Index.tsx")).toContain(
      "kind: ALERT_EPISODE_FIRST_MEMBER,",
    );
  });

  it("around when the episode started, with its own moments; the address keeps what changed; the monitor now, said; and no card without metrics", () => {
    const metrics: string = readDashboardSource(
      "Utils/EventRootCauseMetrics.ts",
    );
    const card: string = readDashboardSource(
      "Components/Telemetry/EventRootCauseMetricChart.tsx",
    );

    // When the episode started: declared, or for an older one created.
    expect(metrics).toContain(
      "asDate(input.episode?.declaredAt) || asDate(input.episode?.createdAt),",
    );
    // The member's own start and impact are not the episode's.
    expect(metrics).toContain("    impactStartedAt: undefined,");
    expect(card).toContain("moments.times ||");
    // A name of its own in the address, so a link opens the same charts.
    expect(card).toContain(
      'export const ROOT_CAUSE_METRICS_URL_PREFIX: string = "rootCauseMetrics";',
    );
    // With no snapshot, the monitor as it reads now, which the card says.
    expect(metrics).toContain("chartedFromMonitorNow: {");
    expect(
      readDashboardSource(
        "Components/Telemetry/EventMetricInvestigationPanel.tsx",
      ),
    ).toContain('"Charted for what this monitor checks now."');
    // No metrics behind its first member: no card, the root cause alone.
    expect(card).toContain("// No metrics behind this event: nothing to show.");
  });

  it("the charts and time ranges page names an episode's Root Cause page with an incident's and an alert's", () => {
    expect(readPage("en", CHARTS)).toContain(
      "an incident's, an alert's or an episode's Root Cause page charts its metrics the same way.",
    );
  });
});

describe.each(TRANSLATED_LANGUAGES)("the %s pages", (language: string) => {
  it("the incident episodes page's section is on the English one's lines, naming the pages as its Dashboard does", () => {
    const english: Array<string> = linesOf("en", INCIDENT_EPISODES);
    const translated: Array<string> = linesOf(language, INCIDENT_EPISODES);
    const heading: number = english.indexOf(HEADING);

    expect(translated).toHaveLength(english.length);
    expect(translated[heading]).toMatch(/^## \S/);
    expect(translated[heading]).not.toBe(HEADING);
    expect(translated[heading + 1]).toBe("");
    expect(translated[heading + 2]).not.toBe(INCIDENT_EPISODES_TEXT);
    expect(boldWords(translated[heading + 2] || "")).toEqual([
      dashboardWord(language, "Root Cause"),
      dashboardWord(language, "Overview"),
    ]);
  });

  it("the alert episodes page's paragraph is on the English one's line, naming the pages as its Dashboard does", () => {
    const english: Array<string> = linesOf("en", ALERT_EPISODES);
    const translated: Array<string> = linesOf(language, ALERT_EPISODES);
    const line: number = english.indexOf(ALERT_EPISODES_TEXT);

    expect(translated).toHaveLength(english.length);
    expect(translated[line - 1]).toBe("");
    expect(translated[line + 1]).toBe("");
    expect(translated[line]).not.toBe(ALERT_EPISODES_TEXT);
    expect(boldWords(translated[line] || "")).toEqual([
      dashboardWord(language, "Root Cause"),
      dashboardWord(language, "Overview"),
    ]);
  });
});
