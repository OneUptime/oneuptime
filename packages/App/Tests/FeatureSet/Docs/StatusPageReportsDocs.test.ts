import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import StatusPageReportScheduleUtil from "Common/Utils/StatusPage/ReportSchedule";
import { StatusPageReportsCopy } from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageReportsCopy";

/*
 * Status page email reports had no page in the docs at all, while switching
 * them on meant making a schedule up. Now the Email Reports card is a switch
 * with a default schedule, and the English Subscribers & Announcements page
 * has an "Email reports" section that says what the switch does, what the
 * default schedule is, where the schedule is changed, that switching off
 * needs nothing and keeps the schedule, and what the API and Terraform get
 * when they switch reports on without a schedule.
 *
 * Markdown is not compiled, so this is what notices the docs drifting from
 * the card: the names it uses are read from the card's own copy.
 *
 * English only, as earlier changes to these pages did.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const SUBSCRIBERS_PAGE: string = "en/status-pages/subscribers.md";

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

// The text of a "## " section, up to the next one.
function readSection(page: string, heading: string): string {
  const start: number = page.indexOf(`\n## ${heading}\n`);

  expect([heading, start]).not.toEqual([heading, -1]);

  const next: number = page.indexOf("\n## ", start + 1);

  return page.slice(start, next === -1 ? undefined : next);
}

describe("Subscribers & Announcements (English): Email reports", () => {
  const page: string = readPage(SUBSCRIBERS_PAGE);
  const section: string = readSection(page, "Email reports");

  it("is a section of its own, before the notification templates, and the page's opening says it covers reports", () => {
    expect(page.indexOf("\n## Email reports\n")).toBeLessThan(
      page.indexOf("\n## Customizing notification templates\n"),
    );
    expect(page).toContain("the email report subscribers can get every month");
  });

  it("says where reports are set, by the card's and the switch's own names", () => {
    expect(section).toContain(`**${StatusPageReportsCopy.cardTitle}**`);
    expect(section).toContain(
      "**Status Pages → your page → Advanced → Reports**",
    );
    expect(section).toContain(`**${StatusPageReportsCopy.switchTitle}**`);
    expect(section).toContain("saves as soon as you flip it");
    expect(section).toContain("There is nothing to fill in either way.");
  });

  it("gives the default schedule the server fills in: the 1st of every month at 09:00, covering the calendar month before", () => {
    expect(StatusPageReportScheduleUtil.DEFAULT_SEND_HOUR).toBe(9);
    expect(StatusPageReportScheduleUtil.DEFAULT_SEND_DAY_OF_MONTH).toBe(1);

    expect(section).toContain(
      "a report on the 1st of every month at 09:00, starting on the next 1st of the month, each covering the whole calendar month before it",
    );
    expect(section).toContain("the report sent on 1 November covers October");
    expect(section).toContain(
      "09:00 is in the report time zone, which is UTC unless you change it.",
    );
  });

  it("says where the schedule is changed, naming the dialog's fields and its fold", () => {
    expect(section).toContain(
      `**${StatusPageReportsCopy.editScheduleButton}**`,
    );
    expect(section).toContain("**How often**");
    expect(section).toContain("**First report on**");
    expect(section).toContain(`Under **${MORE_FIELDS_SECTION_TITLE}**`);
    expect(section).toContain("**Report Timezone**");
    expect(section).toContain("**Reporting period**");
  });

  it("says turning reports off keeps the schedule, and that the missed report is not sent", () => {
    expect(section).toContain("**Turning reports off** keeps the schedule.");
    expect(section).toContain("does not send the report it missed");
  });

  it("says who gets reports, the test report, and the plan", () => {
    expect(section).toContain("Reports go to the page's email subscribers");
    expect(section).toContain("**Send Test Report**");
    expect(section).toContain("**Growth** plan");
  });

  it("says what the API and Terraform get when they switch reports on without a schedule", () => {
    expect(section).toContain("**Through the API or Terraform**");
    expect(section).toContain("`isReportEnabled`");
    expect(section).toContain("`reportStartDateTime`");
    expect(section).toContain("`reportRecurringInterval`");
    expect(section).toContain("same default schedule");
    expect(section).toContain("A schedule you send with it is kept");
    expect(section).toContain("`sendNextReportBy`");
  });

  it("links only to sections the page has", () => {
    const anchors: Array<string> = Array.from(
      section.matchAll(/\]\(#([a-z0-9-]+)\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(anchors.length).toBeGreaterThan(0);

    const headings: Array<string> = Array.from(
      page.matchAll(/^#{2,4} (.+)$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .trim()
        .replace(/ +/g, "-");
    });

    for (const anchor of anchors) {
      expect([anchor, headings.includes(anchor)]).toEqual([anchor, true]);
    }
  });
});
