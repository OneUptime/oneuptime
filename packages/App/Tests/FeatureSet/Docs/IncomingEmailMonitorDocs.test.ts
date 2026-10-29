import slugify from "Common/Server/Types/MarkdownSlugify";
import { REDACTED } from "Common/Server/Utils/LogRedaction";
import ColumnLength from "Common/Types/Database/ColumnLength";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "Common/Types/Monitor/MonitorType";
import TemplateVariablesCatalog, {
  TemplateVariable,
  TemplateVariableGroup,
} from "Common/UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";
import { INCOMING_EMAIL_SCHEDULED_CHECK_LABEL } from "Common/Utils/Monitor/MonitorLogSummaryUtil";
import { OPEN_FOR_EVERY_EMAIL_DOCS_PATH } from "Common/Types/Monitor/IncomingEmailMonitor/OpenForEveryEmail";
import EmailThreadHeaders from "Common/Utils/Email/EmailThreadHeaders";
import { escapeRegExp } from "./DocsTranslationChecks";
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
 *
 * "Template Variables" once listed five variables that no alert or incident
 * template could use: the server had no Incoming Email branch, and the
 * template-variables picker listed none of them. The page is now held to the
 * picker, which MonitorTemplateUtilIncomingEmail.test.ts holds to the server.
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
      // One button, open or folded (issue #5364): its title follows the state.
      source: 'title={showMoreDetails ? "Hide Details" : "Show More Details"}',
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
    /*
     * The Monitoring card's switch, which saves when it is flipped, and the
     * banner's button that turns monitoring back on. They replaced "Disable
     * Active Monitoring" behind an Edit Settings dialog.
     */
    {
      label: "Monitoring",
      file: "Components/Monitor/MonitoringSwitchCopy.ts",
      source: 'cardTitle: translationKey("Monitoring")',
    },
    {
      label: "Check this monitor",
      file: "Components/Monitor/MonitoringSwitchCopy.ts",
      source: 'switchTitle: translationKey("Check this monitor")',
    },
    {
      label: "Turn monitoring on",
      file: "Components/Monitor/MonitoringSwitchCopy.ts",
      source: 'turnOnButton: translationKey("Turn monitoring on")',
    },
  ];

  // A list item bolds its label with the colon: "- **From:** The sender".
  function boldLabel(label: string): RegExp {
    return new RegExp(`\\*\\*${escapeRegExp(label)}:?\\*\\*`);
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

  test("a monitor with monitoring off records the email but logs nothing, as it says", () => {
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
    // The email is stored as a jsonb-safe copy of the request.
    const writesEmail: number = ingest.indexOf(
      "incomingEmailMonitorRequest: toStorableJson(",
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
      "A monitor with monitoring off still records the email, and the **Monitor Summary** card still shows it.",
    );
    expect(section).toContain(
      "It evaluates nothing, though, so the email gets no row in **Monitoring Logs**",
    );
    expect(summarySection).toContain(
      "A monitor with monitoring turned off evaluates nothing, so the emails it receives get no rows.",
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

describe("The template variables the page lists", () => {
  const templateSection: string = sectionOf("## Template Variables");

  // `{{emailSubject}}` and the rest, from the first column of its table.
  const documented: Array<string> = Array.from(
    templateSection.matchAll(/^\| `\{\{(\w+)\}\}` /gm),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });

  test("are the ones the template-variables picker offers an Incoming Email monitor", () => {
    const group: TemplateVariableGroup | undefined =
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.IncomingEmail,
      }).find((candidate: TemplateVariableGroup): boolean => {
        return candidate.title === "Incoming Email";
      });

    expect(group).toBeDefined();
    expect(documented).toEqual(
      group!.variables.map((variable: TemplateVariable): string => {
        return variable.key;
      }),
    );
  });

  test("quotes the title cap and the title column the server uses", () => {
    const templateUtil: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "Common/Server/Utils/Monitor/MonitorTemplateUtil.ts",
      ),
      "utf8",
    );
    const cap: string | undefined = templateUtil.match(
      /export const MaxEmailValueLengthInTitle: number = (\d+);/,
    )?.[1];

    expect(cap).toBeDefined();
    expect(templateSection).toContain(
      `each variable is cut to one line of at most ${cap} characters`,
    );
    expect(templateSection).toContain(
      `A title can't be longer than ${ColumnLength.LongText} characters`,
    );
  });

  test("shows the monitor's address masked the way it is stored", () => {
    expect(templateSection).toContain(
      `\`monitor-${REDACTED}@{inbound-domain}\``,
    );
    expect(templateSection).toContain(`\`${REDACTED}@{inbound-domain}\``);
  });

  test("links to the templating page, which lists the same variables", () => {
    expect(templateSection).toContain(
      "[Incident & Alert Dynamic Templating](/docs/monitor/incident-alert-templating)",
    );

    const templatingPage: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "App/FeatureSet/Docs/Content/en/monitor/incident-alert-templating.md",
      ),
      "utf8",
    );
    const start: number = templatingPage.indexOf(
      "### Incoming Email Monitors\n",
    );
    const end: number = templatingPage.indexOf("\n### ", start + 1);

    expect(start).toBeGreaterThanOrEqual(0);

    const listedThere: Array<string> = Array.from(
      templatingPage.slice(start, end).matchAll(/^\| `(\w+)` /gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(listedThere).toEqual(documented);
    expect(templatingPage.slice(start, end)).toContain(
      "(/docs/monitor/incoming-email-monitor#template-variables)",
    );
    expect(headingSlugs(page)).toContain("template-variables");
  });
});

/*
 * "Open an incident for every email": the answer to a customer who raises
 * incidents by emailing the monitor's address and found that, while one was
 * open, later emails opened nothing. The section names the criteria form's
 * switch, the form links to the section, and the section quotes the rules
 * the server keeps (IncomingEmailOpenForEveryEmail) - so each is read here
 * from where it lives.
 */
describe("Open an incident for every email", () => {
  const HEADING: string = "## Open an incident for every email";
  const everyEmail: string = sectionOf(HEADING);
  const form: string = readDashboard(
    "Components/Form/Monitor/MonitorCriteriaInstance.tsx",
  );
  const readOnlyView: string = readDashboard(
    "Components/Monitor/MonitorSteps/MonitorCriteriaInstance.tsx",
  );
  const server: string = fs.readFileSync(
    path.join(
      PACKAGES_DIR,
      "Common/Server/Utils/Monitor/IncomingEmailOpenForEveryEmail.ts",
    ),
    "utf8",
  );
  const limit: string | undefined = server.match(
    /export const MAX_OPENED_FROM_EMAILS_PER_HOUR: number = (\d+);/,
  )?.[1];

  test("the criteria form's link lands on the section's heading", () => {
    const [docsPage, anchor] = OPEN_FOR_EVERY_EMAIL_DOCS_PATH.split("#");

    expect(docsPage).toBe("/monitor/incoming-email-monitor");
    expect(slugify(HEADING.replace(/^#+ /, ""))).toBe(anchor);
    expect(headingSlugs(page)).toContain(anchor);
    expect(form).toContain(
      "DOCS_URL.toString() + OPEN_FOR_EVERY_EMAIL_DOCS_PATH",
    );
  });

  test("names the switch, and the actions above it, as the form draws them", () => {
    for (const title of [
      "Open a new incident for every email",
      "Open a new incident and alert for every email",
    ]) {
      expect(everyEmail).toContain(`**${title}**`);
      expect(form).toContain(`"${title}"`);
    }

    expect(form).toContain('"Open a new alert for every email"');
    expect(everyEmail).toContain(
      "Under **Actions**, turn on **When filters match, declare an incident.**",
    );
    expect(form).toContain('title="Actions"');
    expect(form).toContain('title="When filters match, declare an incident."');
  });

  test("says the switch belongs to Incoming Email monitors' criteria that open something", () => {
    expect(form).toContain(
      "props.monitorType === MonitorType.IncomingEmail &&",
    );
    expect(form).toContain("(showIncidentControl || showAlertControl)");
    expect(readOnlyView).toContain(
      '"{{action}} for every email that meets this criteria. These are the incident details:"',
    );
  });

  test("tells emails apart by the header the server reads", () => {
    expect(everyEmail).toContain(
      "OneUptime tells emails apart by their `Message-ID` header",
    );
    expect(
      EmailThreadHeaders.getMessageId({ "Message-ID": "<a@example.com>" }),
    ).toBe("a@example.com");
    expect(server).toContain("EmailThreadHeaders.getMessageId(");
  });

  test("adds a reply to its open incident as a private note, and opens one once it is resolved, as the server does", () => {
    expect(everyEmail).toContain(
      "| A reply to an email that opened an incident | Is added to that incident as a private note and opens nothing while the incident is open. Once the incident is resolved, a reply opens a new incident. |",
    );
    expect(server).toContain("IncidentInternalNoteService.create(");
    // Open: in one of the project's states that are not resolved.
    expect(server).toContain(
      "IncidentStateService.getUnresolvedIncidentStateIds(",
    );
    expect(server).toContain("currentIncidentStateId: true,");
    expect(server).toContain("return record.isOpen;");
    expect(
      EmailThreadHeaders.getReferencedMessageIds({
        "In-Reply-To": "<a@example.com>",
      }),
    ).toEqual(["a@example.com"]);
  });

  test("leaves an out-of-office message alone, and not a monitoring system's report", () => {
    expect(everyEmail).toContain(
      "| An automatic reply, such as an out-of-office message | Opens nothing. |",
    );
    expect(
      EmailThreadHeaders.isAutomaticReply({ "Auto-Submitted": "auto-replied" }),
    ).toBe(true);
    expect(
      EmailThreadHeaders.isAutomaticReply({
        "Auto-Submitted": "auto-generated",
      }),
    ).toBe(false);
  });

  test("quotes the hourly limit the server keeps, here and in Troubleshooting", () => {
    expect(limit).toBeDefined();
    expect(everyEmail).toContain(
      `| An email after the monitor opened ${limit} incidents from emails in the past hour | Opens nothing,`,
    );
    expect(sectionOf("### Alerts Not Being Created")).toContain(
      `the monitor may have opened ${limit} incidents from emails in the past hour. **View Summary** on the email's row says which.`,
    );
  });

  test("says how the incidents resolve, as the evaluation does", () => {
    expect(everyEmail).toContain(
      "With **Auto Resolve Incident** on, they also resolve when a later email matches a different criteria",
    );
    expect(everyEmail).toContain(
      "a later email that matches the same criteria never resolves the earlier ones",
    );
    // A scheduled check has no email: the server hands nothing over for it.
    expect(server).toContain(
      "if (email.onlyCheckForIncomingEmailReceivedAt) {",
    );
    expect(everyEmail).toContain(
      "A check for missing email (**Email Received**) is not an email, so it still opens one incident at a time.",
    );
  });

  test("warns that the address is the only key, and sends readers to reset it", () => {
    expect(everyEmail).toContain(
      "**Anyone who knows the address can open incidents.**",
    );
    expect(everyEmail).toContain(
      "[reset the address](#resetting-or-customizing-the-email-address)",
    );
  });

  test("points to the workflow trigger for more control, at a heading it has", () => {
    const triggers: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "App/FeatureSet/Docs/Content/en/workflows/triggers.md",
      ),
      "utf8",
    );

    expect(everyEmail).toContain(
      "[Incoming Email trigger](/docs/workflows/triggers#incoming-email)",
    );
    expect(headingSlugs(triggers)).toContain("incoming-email");
  });

  test("is reached from the page's cards, How It Works and Use Cases", () => {
    expect(page).toContain(
      "- [An incident for every email](#open-an-incident-for-every-email): Let people report incidents by emailing the address.",
    );
    expect(sectionOf("## How It Works")).toContain(
      "unless it [opens an incident for every email](#open-an-incident-for-every-email)",
    );
    expect(sectionOf("## Use Cases")).toContain(
      "| Reporting incidents by email |",
    );
  });
});
