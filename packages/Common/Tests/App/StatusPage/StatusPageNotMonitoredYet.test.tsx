/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import MonitorOverview from "../../../../App/FeatureSet/StatusPage/src/Components/Monitor/MonitorOverview";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { Green } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import { NOT_MONITORED_STATUS_COLOR } from "../../../Utils/StatusPage/FrozenMonitorResources";

/*
 * A STATUS PAGE RESOURCE NOTHING HAS CHECKED YET (issue #8899).
 *
 * A new monitor holds the operational status it was created in until its
 * first check comes back, and for good when no probe reaches it. The page
 * drew it "Operational", in green, to every visitor. It reads "Not
 * monitored yet" now, in the gray of "Not monitored" - the page's word for
 * a resource whose monitoring is off - in every language the status page
 * speaks, and a page nothing on which has been checked yet says so in its
 * banner. Here with the real MonitorOverview and the real locale files, in
 * English and in Persian, which reads right to left.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/StatusPage/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  });

function readLocale(language: string): JSONObject {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as JSONObject;
}

function overviewWords(language: string): Record<string, string> {
  return readLocale(language)["overview"] as unknown as Record<string, string>;
}

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");

function operationalStatus(): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = "e8990000-0000-4000-8000-000000000001";
  status.name = "Operational";
  status.color = Green;
  status.priority = 1;
  status.isOperationalState = true;
  return status;
}

function renderResource(data: {
  isNotMonitored: boolean;
  isNotMonitoredYet?: boolean | undefined;
  showUptimePercent?: boolean | undefined;
}): void {
  render(
    <MonitorOverview
      monitorName="Checkout API"
      currentStatus={operationalStatus()}
      monitorStatusTimeline={[]}
      startDate={new Date(NOW.getTime() - 9 * 24 * 3600 * 1000)}
      endDate={NOW}
      showHistoryChart={false}
      showCurrentStatus={true}
      showUptimePercent={Boolean(data.showUptimePercent)}
      statusPageHistoryChartBarColorRules={[]}
      downtimeMonitorStatuses={[]}
      monitorStatuses={[operationalStatus()]}
      defaultBarColor={new Color("#10B981")}
      uptimeHistoryDays={9}
      isNotMonitored={data.isNotMonitored}
      isNotMonitoredYet={data.isNotMonitoredYet}
    />,
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
  await i18next.changeLanguage("en");
});

describe("every status page language words a resource nothing has checked yet", () => {
  const KEYS: Array<string> = ["notMonitoredYet", "noResourcesAreMonitoredYet"];

  test("there are the eighteen languages the status page speaks", () => {
    expect(LANGUAGES.length).toBe(18);
  });

  test.each(LANGUAGES)("%s", (language: string) => {
    const words: Record<string, string> = overviewWords(language);
    const english: Record<string, string> = overviewWords("en");

    for (const key of KEYS) {
      expect({ key, worded: typeof words[key] === "string" }).toEqual({
        key,
        worded: true,
      });
      expect(words[key]!.trim().length).toBeGreaterThan(0);
      // No placeholder: a whole phrase of its own.
      expect(words[key]).not.toMatch(/\{\{/);

      if (language !== "en") {
        expect({ key, translated: words[key] !== english[key] }).toEqual({
          key,
          translated: true,
        });
      }
    }

    // Said apart from Not monitored, which is said of what nothing checks.
    expect(words["notMonitoredYet"]).not.toBe(words["notMonitored"]);
    expect(words["noResourcesAreMonitoredYet"]).not.toBe(
      words["noResourcesAreMonitored"],
    );
  });

  test("in English", () => {
    expect(overviewWords("en")["notMonitoredYet"]).toBe("Not monitored yet");
    expect(overviewWords("en")["noResourcesAreMonitoredYet"]).toBe(
      "No Resources are monitored yet",
    );
  });
});

describe("a resource nothing has checked yet, on the page", () => {
  test("says Not monitored yet, in the gray of Not monitored, never Operational", () => {
    renderResource({ isNotMonitored: true, isNotMonitoredYet: true });

    const status: HTMLElement = screen.getByTestId("resource-not-monitored");

    expect(status).toHaveTextContent("Not monitored yet");
    expect(screen.queryByText("Operational")).toBeNull();
    // #6b7280, the gray Not monitored is drawn in.
    expect(NOT_MONITORED_STATUS_COLOR.toString()).toBe("#6b7280");
    expect(status.style.color).toBe("rgb(107, 114, 128)");
  });

  test("in place of its uptime too: nothing has been measured to count", () => {
    renderResource({
      isNotMonitored: true,
      isNotMonitoredYet: true,
      showUptimePercent: true,
    });

    expect(screen.getByTestId("resource-not-monitored")).toHaveTextContent(
      "Not monitored yet",
    );
    expect(screen.queryByText(/uptime/i)).toBeNull();
  });

  test("a resource whose monitoring is off still says Not monitored", () => {
    renderResource({ isNotMonitored: true });

    const status: HTMLElement = screen.getByTestId("resource-not-monitored");

    expect(status).toHaveTextContent(/^Not monitored$/);
  });

  test("a resource that is checked says its status, as always", () => {
    renderResource({ isNotMonitored: false, isNotMonitoredYet: false });

    expect(screen.queryByTestId("resource-not-monitored")).toBeNull();
    expect(screen.getByText("Operational")).toBeInTheDocument();
  });

  test("in Persian, read right to left, in the page's own words", async () => {
    await i18next.changeLanguage("fa");
    document.documentElement.setAttribute("dir", "rtl");
    document.documentElement.setAttribute("lang", "fa");

    renderResource({ isNotMonitored: true, isNotMonitoredYet: true });

    expect(screen.getByTestId("resource-not-monitored")).toHaveTextContent(
      overviewWords("fa")["notMonitoredYet"]!,
    );
  });
});

describe("the overview draws Not monitored yet where it draws Not monitored", () => {
  const OVERVIEW: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview.tsx",
    ),
    "utf8",
  );

  test("it reads the server's notMonitoredYetResourceIds", () => {
    expect(OVERVIEW).toContain(
      'readNotMonitoredResourceIds(data["notMonitoredYetResourceIds"])',
    );
  });

  test("a resource, a group's rollup, a grid cell and the banner each say it", () => {
    expect(OVERVIEW).toContain("isNotMonitoredYet={isNotMonitoredYet}");
    expect(OVERVIEW.match(/t\("overview\.notMonitoredYet"\)/g)).toHaveLength(2);
    expect(OVERVIEW).toContain('t("overview.noResourcesAreMonitoredYet")');
  });
});
