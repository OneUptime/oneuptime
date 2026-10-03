import slugify from "Common/Server/Types/MarkdownSlugify";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import { INCOMING_EMAIL_SCHEDULED_CHECK_LABEL } from "Common/Utils/Monitor/MonitorLogSummaryUtil";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incoming email monitor page, against the product it describes.
 *
 * Azure Monitor action groups now send a one-time passcode to every new email
 * recipient and hold back alerts until someone enters it; Amazon SNS does the
 * same with a confirmation link. When the recipient is a monitor's address,
 * that email lands in OneUptime, and a customer asked how to read it. The
 * page now has a section for that, the monitor's address card links to it,
 * and "Monitor Summary View" says where older emails are.
 *
 * Markdown is not compiled, so nothing else notices when a button the section
 * tells readers to click is renamed, when the anchor the dashboard links to
 * moves, or when a default it quotes changes. Dashboard components read
 * browser globals at load, so their sources are read as text rather than
 * imported.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const DASHBOARD_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Dashboard/src",
);
const DOCS_PAGE: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Docs/Content/en/monitor/incoming-email-monitor.md",
);

const SECTION_HEADING: string = "## Verifying the Address With the Sender";

function readDashboard(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_DIR, relativePath), "utf8");
}

const page: string = fs.readFileSync(DOCS_PAGE, "utf8");

/*
 * The text under `heading` up to the next heading of the same or a higher
 * level, so a section's ### subsections are part of it.
 */
function sectionOf(heading: string): string {
  const start: number = page.indexOf(`${heading}\n`);

  expect(start).toBeGreaterThanOrEqual(0);

  const level: number = heading.indexOf(" ");
  const rest: string = page.slice(start + heading.length + 1);
  const nextHeading: RegExpMatchArray | null = rest.match(
    new RegExp(`^#{1,${level}} `, "m"),
  );

  return nextHeading && nextHeading.index !== undefined
    ? rest.slice(0, nextHeading.index)
    : rest;
}

// A `#` line inside a fenced block is a comment, not a heading.
const HEADING: RegExp = /^#{1,6} /;
const FENCE: RegExp = /^\s*```/;

function headingSlugs(markdown: string): Array<string> {
  let inFence: boolean = false;

  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return false;
      }

      return !inFence && HEADING.test(line);
    })
    .map((line: string): string => {
      return slugify(line.replace(/^#+ /, "").trim());
    });
}

const section: string = sectionOf(SECTION_HEADING);
const summarySection: string = sectionOf("## Monitor Summary View");

describe("The docs section the address card links to", () => {
  const cardSource: string = readDashboard(
    "Components/Monitor/IncomingEmailMonitor/IncomingEmailMonitorLink.tsx",
  );
  const route: string | undefined = cardSource.match(
    /export const VERIFY_ADDRESS_DOCS_ROUTE: string =\s*"([^"]+)"/,
  )?.[1];

  test("the card renders its link from the exported route", () => {
    expect(route).toBeDefined();
    expect(cardSource).toContain(
      "to={Route.fromString(VERIFY_ADDRESS_DOCS_ROUTE)}",
    );
  });

  test("points at this page", () => {
    expect(route!.split("#")[0]).toBe("/docs/monitor/incoming-email-monitor");
  });

  test("lands on the section's heading", () => {
    const anchor: string = route!.split("#")[1]!;

    expect(slugify(SECTION_HEADING.replace(/^#+ /, ""))).toBe(anchor);
    expect(headingSlugs(page)).toContain(anchor);
  });
});

describe("Every in-page link on the page", () => {
  test("resolves to a heading", () => {
    const slugs: Array<string> = headingSlugs(page);
    const anchors: Array<string> = Array.from(
      page.matchAll(/\]\(#([^)]+)\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    // The section links to the address section; Troubleshooting links here.
    expect(anchors).toEqual(
      expect.arrayContaining([
        "resetting-or-customizing-the-email-address",
        "verifying-the-address-with-the-sender",
      ]),
    );

    for (const anchor of anchors) {
      expect({ anchor, found: slugs.includes(anchor) }).toEqual({
        anchor,
        found: true,
      });
    }
  });
});

describe("What the section tells readers to click", () => {
  /*
   * Every OneUptime label the section and "Monitor Summary View" put in
   * bold, and the dashboard source that draws it. Azure's and Amazon's
   * labels (Resend, Test, Confirm subscription) are theirs to rename.
   */
  const LABELS: Array<{ label: string; file: string; source: string }> = [
    {
      label: "Overview",
      file: "Pages/Monitor/View/SideMenu.tsx",
      source: 'title: "Overview"',
    },
    {
      label: "Monitor Summary",
      file: "Components/Monitor/SummaryView/Summary.tsx",
      source: 'title="Monitor Summary"',
    },
    {
      label: "From",
      file: "Components/Monitor/SummaryView/IncomingEmailMonitorSummaryView.tsx",
      source: 'title="From"',
    },
    {
      label: "Subject",
      file: "Components/Monitor/SummaryView/IncomingEmailMonitorSummaryView.tsx",
      source: 'title="Subject"',
    },
    {
      label: "Last Email Received At",
      file: "Components/Monitor/SummaryView/IncomingEmailMonitorSummaryView.tsx",
      source: 'title="Last Email Received At"',
    },
    {
      label: "Show More Details",
      file: "Components/Monitor/SummaryView/IncomingEmailMonitorSummaryView.tsx",
      source: 'title="Show More Details"',
    },
    {
      label: "Email Headers",
      file: "Components/Monitor/SummaryView/IncomingEmailMonitorSummaryView.tsx",
      source: 'title: "Email Headers"',
    },
    {
      label: "Email Body (Text)",
      file: "Components/Monitor/SummaryView/IncomingEmailMonitorSummaryView.tsx",
      source: 'title: "Email Body (Text)"',
    },
    {
      label: "Email Body (HTML)",
      file: "Components/Monitor/SummaryView/IncomingEmailMonitorSummaryView.tsx",
      source: 'title: "Email Body (HTML)"',
    },
    {
      label: "Monitoring Logs",
      file: "Pages/Monitor/View/SideMenu.tsx",
      source: 'title: "Monitoring Logs"',
    },
    {
      label: "View Summary",
      file: "Pages/Monitor/View/Logs.tsx",
      source: 'title: "View Summary"',
    },
    {
      label: "Email",
      file: "Pages/Monitor/View/Logs.tsx",
      source: 'title: "Email"',
    },
    {
      label: "Settings",
      file: "Pages/Monitor/View/SideMenu.tsx",
      source: 'title: "Settings"',
    },
    {
      label: "Edit Settings",
      file: "Pages/Monitor/View/Settings.tsx",
      source: 'editButtonText="Edit Settings"',
    },
    {
      label: "Disable Active Monitoring",
      file: "Pages/Monitor/View/Settings.tsx",
      source: 'title: "Disable Active Monitoring"',
    },
  ];

  // A list item bolds its label with the colon: "- **From:** The sender".
  function boldLabel(label: string): RegExp {
    return new RegExp(
      `\\*\\*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:?\\*\\*`,
    );
  }

  for (const entry of LABELS) {
    test(`**${entry.label}** is in the docs and in ${path.basename(entry.file)}`, () => {
      expect(`${section}\n${summarySection}`).toMatch(boldLabel(entry.label));
      expect(readDashboard(entry.file)).toContain(entry.source);
    });
  }

  test("finds the verification email's row by the Email column", () => {
    expect(section).toContain(
      "find the verification email by its subject in the **Email** column",
    );
    expect(summarySection).toContain(
      "the **Email** column shows its subject and sender",
    );

    // The column is the email monitor's alone, and names a check as one.
    const logsPage: string = readDashboard("Pages/Monitor/View/Logs.tsx");

    expect(summarySection).toContain(
      `The **Email** column says "${INCOMING_EMAIL_SCHEDULED_CHECK_LABEL}" on those rows`,
    );
    expect(logsPage).toContain("{INCOMING_EMAIL_SCHEDULED_CHECK_LABEL}");
    expect(logsPage).toMatch(
      /\.\.\.\(isIncomingEmailMonitor\s*\?\s*\[\s*\{[\s\S]*?title: "Email"/,
    );
  });

  test("quotes what a check that ran before any email shows", () => {
    expect(summarySection).toContain('"No email yet"');
    expect(
      readDashboard(
        "Components/Monitor/SummaryView/IncomingEmailMonitorSummaryView.tsx",
      ),
    ).toContain(
      'lastEmailReceivedAt = translator.translateTemplate("No email yet");',
    );
  });

  test("says the HTML body is shown as source, which is true", () => {
    expect(section).toContain("**Email Body (HTML)** shows the HTML source");
    expect(section).toContain("change every `&amp;` in it to `&`");
    expect(
      readDashboard(
        "Components/Monitor/SummaryView/IncomingEmailMonitorSummaryView.tsx",
      ),
    ).toMatch(/key: "emailBodyHtml",[\s\S]*?fieldType: FieldType\.HTML/);
  });
});

describe("The defaults the section quotes", () => {
  test("the default criteria's keyword is the one it warns about", () => {
    expect(MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD).toBe(
      "error",
    );
    expect(section).toContain(
      `matches the default \`${MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD}\` criteria`,
    );
  });

  test("monitoring logs are kept for as long as it says", () => {
    const monitorLogUtil: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "Common/Server/Utils/Monitor/MonitorLogUtil.ts"),
      "utf8",
    );
    const days: string | undefined = monitorLogUtil.match(
      /DEFAULT_RETENTION_DAYS: number = (\d+);/,
    )?.[1];

    expect(days).toBe("1");
    expect(summarySection).toContain(
      "Monitoring logs are kept for one day by default.",
    );
  });

  test("a disabled monitor records the email but logs nothing, as it says", () => {
    /*
     * processIncomingEmailFromQueue writes the email to the monitor before
     * it checks whether the monitor is disabled, then returns before
     * monitorResource - the evaluation, which is what writes MonitorLog.
     */
    const ingest: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "App/FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest.ts",
      ),
      "utf8",
    );
    const writesEmail: number = ingest.indexOf(
      "incomingEmailMonitorRequest: incomingEmailRequest",
    );
    // An archived monitor is skipped at the same point, for the same reason.
    const skipsDisabled: number = ingest.indexOf(
      "Incoming email received for archived or disabled monitor",
    );

    const evaluates: number = ingest.indexOf(
      "await MonitorResourceUtil.monitorResource(incomingEmailRequest);",
    );

    expect(writesEmail).toBeGreaterThan(0);
    expect(skipsDisabled).toBeGreaterThan(writesEmail);
    expect(evaluates).toBeGreaterThan(skipsDisabled);
    expect(ingest.slice(skipsDisabled, evaluates)).toContain("return;");

    expect(section).toContain(
      "A disabled monitor still records the email, and the **Monitor Summary** card still shows it.",
    );
    expect(section).toContain(
      "It evaluates nothing, though, so the email gets no row in **Monitoring Logs**",
    );
    expect(summarySection).toContain(
      "A disabled monitor evaluates nothing, so the emails it receives get no rows.",
    );
  });
});

describe("The senders it covers", () => {
  const azure: string = sectionOf("### Azure Monitor action groups");
  const sns: string = sectionOf("### Amazon SNS");

  test("Azure: when, what it blocks, the time limit, Resend and Test", () => {
    expect(azure).toContain("Since July 2026");
    expect(azure).toContain("one-time passcode");
    expect(azure).toContain("no alerts and no test notifications");
    expect(azure).toContain("within 30 minutes of saving the action group");
    expect(azure).toContain("select **Resend**");
    expect(azure).toContain("select **Test**");
    expect(azure).toContain("same Azure tenant");
  });

  test("Amazon SNS: nothing until confirmed, the link, the 48 hours", () => {
    expect(sns).toContain("receives nothing until it's confirmed");
    expect(sns).toContain("**Confirm subscription**");
    expect(sns).toContain("48 hours");
  });

  test("Troubleshooting sends a reader with no mail to the section", () => {
    expect(sectionOf("### Emails Not Being Received")).toContain(
      "[Verifying the Address With the Sender](#verifying-the-address-with-the-sender)",
    );
  });
});
