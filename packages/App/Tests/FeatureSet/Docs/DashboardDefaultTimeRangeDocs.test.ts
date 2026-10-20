import { DashboardDefaultsCopy } from "../../../FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardDefaultsCopy";
import {
  DASHBOARD_TIME_RANGES,
  DASHBOARD_TIME_RANGE_FALLBACK,
  DASHBOARD_TIME_RANGE_FIELD,
  getDashboardTimeRangeLinkValue,
  getDashboardTimeRangeProblem,
  parseDashboardTimeRange,
} from "Common/Types/Dashboard/DashboardTimeRange";
import {
  DASHBOARD_AUTO_REFRESH_FIELD,
  getDashboardAutoRefreshProblem,
} from "Common/Types/Dashboard/DashboardAutoRefresh";
import { DEFAULT_CHOICE_TEMPLATE } from "Common/UI/Utils/DefaultChoiceLabel";
import TimeRange from "Common/Types/Time/TimeRange";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dashboards guides on a dashboard's default time range and
 * auto-refresh, and each viewer's own picks (issue #5080), held to the
 * product: the editing row's labels (DashboardDefaultsCopy), the ranges a
 * dashboard may open on and what a write may hold (Common/Types/Dashboard/
 * DashboardTimeRange.ts, DashboardAutoRefresh.ts), and the pickers' Default
 * (...) choice (DefaultChoiceLabel). Markdown is not compiled, so a guide
 * that drifts from any of them fails here. Every language's copy is held to
 * the English one by DashboardsDocsTranslations; the overview, the
 * variables and the sharing guides' sentences by DashboardsDocsFacts.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

// The text under a heading (any level), up to the next heading of its level or above.
function sectionOf(page: string, heading: string): string {
  const level: number = heading.indexOf(" ");
  const start: number = page.indexOf(`\n${heading}\n`);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const rest: string = page.slice(start + heading.length + 2);
  const ends: Array<number> = [];

  for (let depth: number = 1; depth <= level; depth++) {
    const end: number = rest.indexOf(`\n${"#".repeat(depth)} `);

    if (end >= 0) {
      ends.push(end);
    }
  }

  return ends.length > 0 ? rest.slice(0, Math.min(...ends)) : rest;
}

// "Past 5 Mins" -> "the past 5 minutes", "Past 3 Months" -> "the past 3 months".
const SPOKEN_UNITS: Readonly<Record<string, string>> = {
  Mins: "minutes",
  Hour: "hour",
  Hours: "hours",
  Day: "day",
  Days: "days",
  Week: "week",
  Weeks: "weeks",
  Month: "month",
  Months: "months",
};

function spoken(range: TimeRange): string {
  const [, count, unit] = range.split(" ");
  const words: string = SPOKEN_UNITS[unit as string] || "";

  expect([range, words.length > 0]).toEqual([range, true]);

  return count === "1" ? `the past ${words}` : `the past ${count} ${words}`;
}

const authoring: string = readPage("en/dashboards/authoring.md");
const defaults: string = sectionOf(authoring, "### The dashboard's defaults");
const ownPicks: string = sectionOf(authoring, "### Your own picks");

describe("the dashboard's defaults", () => {
  it("names the editing row's two pickers as the toolbar draws them", () => {
    expect(defaults).toContain(
      `the row under the toolbar's buttons sets what everyone opens it on: **${DashboardDefaultsCopy.timeRangeLabel}**, a preset from ${spoken(
        DASHBOARD_TIME_RANGES[0] as TimeRange,
      )} to ${spoken(
        DASHBOARD_TIME_RANGES[DASHBOARD_TIME_RANGES.length - 1] as TimeRange,
      )}, and **${DashboardDefaultsCopy.autoRefreshLabel}**.`,
    );
  });

  it("says Save Changes saves them for the team and the public link alike", () => {
    expect(defaults).toContain(
      "**Save Changes** saves them with the rest of the dashboard, for your team and for the visitors of its public link alike.",
    );
  });

  it("says a custom start and end can't be a default, as no custom range is one", () => {
    expect(DASHBOARD_TIME_RANGES).not.toContain(TimeRange.CUSTOM);
    expect(getDashboardTimeRangeProblem(TimeRange.CUSTOM)).not.toBeNull();
    expect(defaults).toContain(
      "A custom start and end can't be a default: the dashboard would stay on that moment for good.",
    );
  });

  it("says a dashboard saved before them opens on the past hour, with the auto-refresh it had", () => {
    expect(DASHBOARD_TIME_RANGE_FALLBACK).toBe(TimeRange.PAST_ONE_HOUR);
    expect(defaults).toContain(
      `Dashboards saved before these settings open on ${spoken(
        DASHBOARD_TIME_RANGE_FALLBACK,
      )}, with the auto-refresh they had.`,
    );
  });

  it("names the API's fields, with examples the server saves, and says anything else is refused", () => {
    expect(DASHBOARD_TIME_RANGE_FIELD).toBe("timeRange");
    expect(DASHBOARD_AUTO_REFRESH_FIELD).toBe("refreshInterval");
    expect(getDashboardTimeRangeProblem("Past 1 Day")).toBeNull();
    expect(getDashboardAutoRefreshProblem("1m")).toBeNull();
    expect(getDashboardTimeRangeProblem("1d")).not.toBeNull();
    expect(getDashboardAutoRefreshProblem("2m")).not.toBeNull();

    expect(defaults).toContain(
      "Through the API and Terraform, both are in the dashboard's `dashboardViewConfig`: `timeRange`, a preset as the API reference spells it, such as `Past 1 Day`, and `refreshInterval`, such as `1m`. Any other value is refused.",
    );
  });
});

describe("a viewer's own picks", () => {
  it("are remembered for each dashboard, and only a preset is", () => {
    // A custom range is neither a range a pick keeps nor one a link names.
    expect(parseDashboardTimeRange(TimeRange.CUSTOM)).toBeNull();
    expect(getDashboardTimeRangeLinkValue(TimeRange.CUSTOM)).toBeNull();

    expect(ownPicks).toContain(
      "your browser remembers them for each dashboard: a refresh, a browser restart or a wall screen's reboot opens the dashboard as you left it. Only a preset is remembered.",
    );
    expect(ownPicks).toContain(
      "A custom range or a zoom lasts until you leave the page, so the dashboard never sticks on a moment in the past.",
    );
  });

  it("names the pickers' first choice as they draw it", () => {
    expect(ownPicks).toContain(
      `The first choice of each picker names the dashboard's default, as in ${DEFAULT_CHOICE_TEMPLATE.split(
        "{{value}}",
      ).join("Past 1 Day")}.`,
    );
  });

  it("says Default goes back to it, and follows a later change", () => {
    expect(ownPicks).toContain(
      "Pick it to go back to the default: your browser forgets your pick, and the dashboard follows its default again, even when an editor changes it later.",
    );
  });
});

describe("the other dashboards guides", () => {
  it("the sharing guide says a public dashboard opens on the defaults, with each visitor's own picks remembered", () => {
    expect(readPage("en/dashboards/sharing.md")).toContain(
      "It opens on the dashboard's default time range and auto-refresh, and each visitor's browser remembers their own picks.",
    );
  });

  it("no guide says every visit starts at the past hour any more", () => {
    for (const page of [
      "index",
      "authoring",
      "variables",
      "sharing",
      "configuration",
      "widgets",
      "data-sources",
    ]) {
      const markdown: string = readPage(`en/dashboards/${page}.md`);

      expect([page, markdown.includes("starts at the past hour")]).toEqual([
        page,
        false,
      ]);
      expect([page, markdown.includes("not part of the link")]).toEqual([
        page,
        false,
      ]);
    }
  });
});
