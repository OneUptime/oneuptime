import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import RunbookTriggersSummaryElement, {
  RUNBOOK_TRIGGERS_SUMMARY_SELECT,
  RUNBOOK_TRIGGERS_SUMMARY_TEST_ID,
  RunbookTriggersSummary,
  RunbookTriggersSummaryCopy,
  getRunbookTriggersSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookTriggersSummary";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE } from "../../../Types/Runbook/RunbookSchedule";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * WHAT STARTS A RUNBOOK ON ITS OWN, on its Overview
 * (Components/Runbook/Triggers/RunbookTriggersSummary).
 *
 * A runbook's Triggers page sits in its menu's folded Settings section, so
 * the Overview says whether a schedule or the webhook starts it - or
 * neither, and what does - with the way to change it: one line each, then
 * "Change it under Settings › Triggers".
 */

const RUNBOOK_ID: string = "77777777-0000-4000-8000-0000000000e5";

const WEEKDAY_SCHEDULE_LINE: RegExp =
  /^Runs every weekday at (09:00|9:00 AM) · Europe\/London$/;

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const OVERVIEW_PAGE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Runbook",
  "View",
  "Index.tsx",
);

type RunbookTriggers = Pick<
  Runbook,
  "isScheduleEnabled" | "scheduleCron" | "scheduleTimezone" | "isWebhookEnabled"
>;

const renderSummary: (runbook: RunbookTriggers) => HTMLElement = (
  runbook: RunbookTriggers,
): HTMLElement => {
  goTo(`/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}`);

  render(
    <MemoryRouter>
      <RunbookTriggersSummaryElement
        runbookId={new ObjectID(RUNBOOK_ID)}
        runbook={runbook}
      />
    </MemoryRouter>,
  );

  return screen.getByTestId(RUNBOOK_TRIGGERS_SUMMARY_TEST_ID);
};

// The summary's lines, in order, without the link line.
const linesOf: (summary: HTMLElement) => Array<string> = (
  summary: HTMLElement,
): Array<string> => {
  return Array.from(summary.querySelectorAll("p[data-testid]")).map(
    (line: Element): string => {
      return (line.textContent || "").trim();
    },
  );
};

afterEach(() => {
  cleanup();
});

describe("what starts the runbook, read from it", () => {
  test("a schedule that is on: when, in its time zone", () => {
    const summary: RunbookTriggersSummary = getRunbookTriggersSummary({
      isScheduleEnabled: true,
      scheduleCron: "0 9 * * 1-5",
      scheduleTimezone: "Europe/London",
      isWebhookEnabled: false,
    });

    expect(summary).toEqual({
      scheduleOn: { cron: "0 9 * * 1-5", timezone: "Europe/London" },
      isSchedulePaused: false,
      isWebhookOn: false,
    });
  });

  test("a schedule with no time zone is read in the default one, as the scheduler reads it", () => {
    expect(
      getRunbookTriggersSummary({
        isScheduleEnabled: true,
        scheduleCron: "*/15 * * * *",
        isWebhookEnabled: false,
      }).scheduleOn,
    ).toEqual({
      cron: "*/15 * * * *",
      timezone: DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE,
    });
  });

  test("a schedule set up and turned off is paused", () => {
    expect(
      getRunbookTriggersSummary({
        isScheduleEnabled: false,
        scheduleCron: "0 9 * * *",
        isWebhookEnabled: false,
      }),
    ).toEqual({ isSchedulePaused: true, isWebhookOn: false });
  });

  test("a schedule turned on with no times is none at all", () => {
    expect(
      getRunbookTriggersSummary({
        isScheduleEnabled: true,
        scheduleCron: "  ",
        isWebhookEnabled: false,
      }),
    ).toEqual({ isSchedulePaused: false, isWebhookOn: false });
  });

  test("a webhook that is on", () => {
    expect(
      getRunbookTriggersSummary({
        isScheduleEnabled: false,
        isWebhookEnabled: true,
      }),
    ).toEqual({ isSchedulePaused: false, isWebhookOn: true });
  });
});

describe("the Overview's lines", () => {
  test("a schedule: as the Triggers page's schedule card says it", () => {
    const summary: HTMLElement = renderSummary({
      isScheduleEnabled: true,
      scheduleCron: "0 9 * * 1-5",
      scheduleTimezone: "Europe/London",
      isWebhookEnabled: false,
    });

    // The time as the reader's clock shows times: 09:00, or 9:00 AM.
    expect(linesOf(summary)).toHaveLength(1);
    expect(linesOf(summary)[0]).toMatch(WEEKDAY_SCHEDULE_LINE);
  });

  test("a webhook: a call to its URL runs it - never the URL itself", () => {
    const summary: HTMLElement = renderSummary({
      isScheduleEnabled: false,
      isWebhookEnabled: true,
    });

    expect(linesOf(summary)).toEqual([RunbookTriggersSummaryCopy.webhookOn]);
    expect(summary).not.toHaveTextContent("http");
  });

  test("both: one line each, the schedule first", () => {
    const summary: HTMLElement = renderSummary({
      isScheduleEnabled: true,
      scheduleCron: "*/15 * * * *",
      scheduleTimezone: "UTC",
      isWebhookEnabled: true,
    });

    expect(linesOf(summary)).toEqual([
      "Runs every 15 minutes · UTC",
      RunbookTriggersSummaryCopy.webhookOn,
    ]);
  });

  test("neither: what does start it", () => {
    const summary: HTMLElement = renderSummary({
      isScheduleEnabled: false,
      isWebhookEnabled: false,
    });

    expect(linesOf(summary)).toEqual([RunbookTriggersSummaryCopy.none]);
  });

  test("a paused schedule says so, and what does start it meanwhile", () => {
    const summary: HTMLElement = renderSummary({
      isScheduleEnabled: false,
      scheduleCron: "0 9 * * *",
      isWebhookEnabled: false,
    });

    expect(linesOf(summary)).toEqual([
      RunbookTriggersSummaryCopy.schedulePaused,
      RunbookTriggersSummaryCopy.none,
    ]);
  });

  test("a paused schedule beside a webhook that is on: no none line", () => {
    const summary: HTMLElement = renderSummary({
      isScheduleEnabled: false,
      scheduleCron: "0 9 * * *",
      isWebhookEnabled: true,
    });

    expect(linesOf(summary)).toEqual([
      RunbookTriggersSummaryCopy.schedulePaused,
      RunbookTriggersSummaryCopy.webhookOn,
    ]);
  });

  test("says where it is changed, a link to the runbook's Triggers page", () => {
    const summary: HTMLElement = renderSummary({
      isScheduleEnabled: false,
      isWebhookEnabled: false,
    });

    expect(summary).toHaveTextContent("Change it under Settings › Triggers.");

    const link: HTMLElement = within(summary).getByRole("link", {
      name: RunbookTriggersSummaryCopy.location,
    });

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/triggers`,
    );
  });
});

describe("on the runbook's Overview", () => {
  test("its details read the trigger columns and draw the summary as the Triggers field, after Enabled", () => {
    const source: string = fs
      .readFileSync(OVERVIEW_PAGE, "utf8")
      .replace(/\s+/g, " ");

    expect(source).toContain("...RUNBOOK_TRIGGERS_SUMMARY_SELECT,");
    expect(source).toContain("title: RunbookTriggersSummaryCopy.title,");
    expect(source).toContain(
      "<RunbookTriggersSummaryElement runbookId={modelId} runbook={item} />",
    );
    expect(source.indexOf('title: "Enabled"')).toBeLessThan(
      source.indexOf("title: RunbookTriggersSummaryCopy.title,"),
    );
    expect(Object.keys(RUNBOOK_TRIGGERS_SUMMARY_SELECT).sort()).toEqual([
      "isScheduleEnabled",
      "isWebhookEnabled",
      "scheduleCron",
      "scheduleTimezone",
    ]);
  });

  test("every column it reads is one a runbook's readers may read", () => {
    const runbook: Runbook = new Runbook();

    for (const column of Object.keys(RUNBOOK_TRIGGERS_SUMMARY_SELECT)) {
      const access: { read: Array<string> } | undefined = (
        runbook.getColumnAccessControlForAllColumns() as Record<
          string,
          { read: Array<string> } | undefined
        >
      )[column];

      expect({ column, readers: access?.read }).toEqual({
        column,
        readers: expect.arrayContaining([
          "ProjectOwner",
          "ProjectAdmin",
          "ProjectMember",
          "Viewer",
          "RunbookAdmin",
          "RunbookMember",
          "RunbookViewer",
          "ReadRunbook",
        ]),
      });
    }
  });
});

describe("the words", () => {
  test("every Dashboard language has them, translated", () => {
    const files: Array<string> = fs
      .readdirSync(DASHBOARD_LOCALES)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(DASHBOARD_LOCALES, file), "utf8"),
      );

      // The field's title is the Triggers page's own name, which it has.
      expect([file, typeof locale[RunbookTriggersSummaryCopy.title]]).toEqual([
        file,
        "string",
      ]);

      for (const key of [
        RunbookTriggersSummaryCopy.schedulePaused,
        RunbookTriggersSummaryCopy.webhookOn,
        RunbookTriggersSummaryCopy.none,
        RunbookTriggersSummaryCopy.change,
        RunbookTriggersSummaryCopy.location,
      ]) {
        const value: string | undefined = locale[key];

        expect([file, key, typeof value]).toEqual([file, key, "string"]);

        if (file === "en.json") {
          expect(value).toBe(key);
        } else {
          expect([file, key, value === key]).toEqual([file, key, false]);
        }
      }

      // The link names the page as the language's menu does.
      expect([file, locale[RunbookTriggersSummaryCopy.location]]).toEqual([
        file,
        `${locale["Settings"]} › ${locale["Triggers"]}`,
      ]);
      expect([
        file,
        (locale[RunbookTriggersSummaryCopy.change] as string).split(
          "{{location}}",
        ).length - 1,
      ]).toEqual([file, 1]);
    }
  });
});
