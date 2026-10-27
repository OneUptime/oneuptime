import HuntressSeverity from "../../../Types/Huntress/HuntressSeverity";
import {
  HuntressIncidentReportEvent,
  ParsedHuntressWebhook,
  parseHuntressWebhook,
} from "../../../Types/Huntress/HuntressWebhook";
import { JSONObject } from "../../../Types/JSON";
import {
  HUNTRESS_MAX_INCIDENT_TITLE_LENGTH,
  HUNTRESS_PORTAL_ORIGIN,
  getHuntressAffectedLabel,
  getHuntressAffectedName,
  getHuntressClosedNote,
  getHuntressCommentNote,
  getHuntressIncidentDescription,
  getHuntressIncidentTitle,
  getHuntressIndicatorTitle,
  getHuntressPlatformTitle,
  getHuntressReportPortalUrl,
} from "../../../Utils/Huntress/HuntressIncidentReportText";
import {
  getHuntressCommentBody,
  getHuntressIdentityReportBody,
  getHuntressIncidentReportBody,
} from "../../Types/Huntress/HuntressWebhookFixtures";
import { WORD_JOINER } from "../../../Utils/Markdown/MarkdownEscape";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * The incident a Huntress report opens, as responders read it: the title a
 * page or a call says, the description (summary first, then the facts and
 * the way back to Huntress), and the notes for comments and closing. What
 * Huntress wrote is placed as reported (FeedMarkdown.reportedValue): it
 * reads as written, but a name, a subject or a summary never becomes a
 * link, an image, HTML or a chat mention of its own. The breaks that takes
 * are invisible word joiners. TemplateOutsideText.test.ts reads the same
 * texts through the dashboard's parser, marked and Slack.
 */

const WORD_JOINERS: RegExp = new RegExp(WORD_JOINER, "g");

// A "<" that starts something - a tag, a comment, a mention: placed text holds none.
const TAG_START: RegExp = new RegExp(`<(?![\\s${WORD_JOINER}])`);

// The text as a reader sees it: the invisible breaks taken out.
function asRead(text: string): string {
  return text.replace(WORD_JOINERS, "");
}

function event(body: JSONObject): HuntressIncidentReportEvent {
  const parsed: ParsedHuntressWebhook = parseHuntressWebhook(body);

  if (parsed.kind !== "incident-report") {
    throw new Error("not a report");
  }

  return parsed.event;
}

describe("getHuntressIncidentTitle", () => {
  test("is the report's subject after Huntress:, without the severity Huntress puts first", () => {
    expect(
      getHuntressIncidentTitle(event(getHuntressIncidentReportBody())),
    ).toBe("Huntress: Incident on DESKTOP-ARL0EQ1 (Acme Corp)");
  });

  test.each([
    [
      "HIGH - Incident on laptop01 (Test)",
      "Huntress: Incident on laptop01 (Test)",
    ],
    [
      "low - Incident on laptop01 (Test)",
      "Huntress: Incident on laptop01 (Test)",
    ],
    [
      "CRITICAL - ISOLATED - Incident on DESKTOP-01 (Acme)",
      "Huntress: ISOLATED - Incident on DESKTOP-01 (Acme)",
    ],
    ["Incident on laptop01 (Test)", "Huntress: Incident on laptop01 (Test)"],
  ])("%s", (subject: string, title: string) => {
    expect(
      getHuntressIncidentTitle(
        event(getHuntressIncidentReportBody({ subject })),
      ),
    ).toBe(title);
  });

  test("without a subject, names the report and its organization", () => {
    expect(
      getHuntressIncidentTitle(
        event(getHuntressIncidentReportBody({ subject: null })),
      ),
    ).toBe("Huntress incident report 1234 (Acme Corp)");
    expect(
      getHuntressIncidentTitle(
        event(
          getHuntressIncidentReportBody({ subject: "", organization: null }),
        ),
      ),
    ).toBe("Huntress incident report 1234");
  });

  test("a subject that is only a severity prefix falls back to the report", () => {
    expect(
      getHuntressIncidentTitle(
        event(getHuntressIncidentReportBody({ subject: "critical - " })),
      ),
    ).toBe("Huntress incident report 1234 (Acme Corp)");
  });

  test("fits an incident title, whatever the subject's length", () => {
    const title: string = getHuntressIncidentTitle(
      event(getHuntressIncidentReportBody({ subject: "x".repeat(5000) })),
    );

    expect(title.length).toBeLessThanOrEqual(500);
    expect(HUNTRESS_MAX_INCIDENT_TITLE_LENGTH).toBe(500);
  });

  test("a subject reads as written, and nothing in it acts: no link, image, HTML or chat mention", () => {
    const subject: string =
      "Incident on [Reset your password](https://login.example/reset) <img src=x> <!channel> ![x](https://tracker.example/p.png)";
    const title: string = getHuntressIncidentTitle(
      event(
        getHuntressIncidentReportBody({ subject: `CRITICAL - ${subject}` }),
      ),
    );

    expect(asRead(title)).toBe(`Huntress: ${subject}`);

    for (const acting of [
      "](https://login.example/reset)",
      "<img",
      "<!channel>",
      "![x]",
    ]) {
      expect({ acting, found: title.includes(acting) }).toEqual({
        acting,
        found: false,
      });
    }
  });

  test("so does the organization a title names without a subject", () => {
    const title: string = getHuntressIncidentTitle(
      event(
        getHuntressIncidentReportBody({
          subject: null,
          organization: { id: 4, name: "<!here> Acme" },
        }),
      ),
    );

    expect(asRead(title)).toBe("Huntress incident report 1234 (<!here> Acme)");
    expect(title).not.toContain("<!here>");
  });

  test("a subject whose every character gets a break still fits the title's column, cut short with …", () => {
    // Each "<" takes a word joiner after it: twice the subject, past the column.
    const title: string = getHuntressIncidentTitle(
      event(getHuntressIncidentReportBody({ subject: "<".repeat(300) })),
    );

    expect(title.length).toBeLessThanOrEqual(
      HUNTRESS_MAX_INCIDENT_TITLE_LENGTH,
    );
    expect(title.length).toBeGreaterThan(
      HUNTRESS_MAX_INCIDENT_TITLE_LENGTH - 5,
    );
    expect(asRead(title).startsWith("Huntress: <<<")).toBe(true);
    expect(title.endsWith("…")).toBe(true);
    // And no "<" in it starts anything.
    expect(TAG_START.test(title)).toBe(false);
  });
});

describe("getHuntressAffectedName", () => {
  test("reads the host from the subject", () => {
    expect(
      getHuntressAffectedName(event(getHuntressIncidentReportBody())),
    ).toBe("DESKTOP-ARL0EQ1");
  });

  test("reads an identity from an ITDR report's subject", () => {
    expect(
      getHuntressAffectedName(event(getHuntressIdentityReportBody())),
    ).toBe("jane.doe@acme.example");
  });

  test("takes the organization off by its name, brackets in it included", () => {
    expect(
      getHuntressAffectedName(
        event(
          getHuntressIncidentReportBody({
            organization: { id: 4, name: "Acme (UK)" },
            subject: "HIGH - Incident on John Smith (Acme (UK))",
          }),
        ),
      ),
    ).toBe("John Smith");
  });

  test("without an organization name, cuts at the first bracket", () => {
    expect(
      getHuntressAffectedName(
        event(
          getHuntressIncidentReportBody({
            organization: { id: 4 },
            subject: "LOW - Incident on laptop01 (Test)",
          }),
        ),
      ),
    ).toBe("laptop01");
  });

  test("reads the email subject format Huntress sends too", () => {
    expect(
      getHuntressAffectedName(
        event(
          getHuntressIncidentReportBody({
            subject:
              "Huntress EDR Critical Incident Report | Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
          }),
        ),
      ),
    ).toBe("DESKTOP-ARL0EQ1");
  });

  test("a subject that names no host gives none", () => {
    expect(
      getHuntressAffectedName(
        event(getHuntressIncidentReportBody({ subject: "Suspicious login" })),
      ),
    ).toBeNull();
    expect(
      getHuntressAffectedName(
        event(
          getHuntressIncidentReportBody({ subject: "Incident on (Acme Corp)" }),
        ),
      ),
    ).toBeNull();
    expect(
      getHuntressAffectedName(
        event(getHuntressIncidentReportBody({ subject: null })),
      ),
    ).toBeNull();
  });

  test("is searched with indexOf: a megabyte of brackets is read at once", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        getHuntressAffectedName({
          subject: `Incident on ${" (".repeat(1024 * 1024)}`,
          organization: { id: null, name: null },
        });
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("getHuntressReportPortalUrl", () => {
  test("opens the report in the Huntress portal by organization and report", () => {
    expect(
      getHuntressReportPortalUrl(event(getHuntressIncidentReportBody())),
    ).toBe("https://huntress.io/org/4/incident_reports/1234");
    expect(HUNTRESS_PORTAL_ORIGIN).toBe("https://huntress.io");
  });

  test("is not made without an organization id", () => {
    expect(
      getHuntressReportPortalUrl(
        event(
          getHuntressIncidentReportBody({
            organization: { name: "Acme Corp" },
            organization_id: null,
          }),
        ),
      ),
    ).toBeNull();
  });
});

describe("platforms, indicators and the affected label", () => {
  test("platforms read as Huntress shows them", () => {
    expect(getHuntressPlatformTitle("windows")).toBe("Windows");
    expect(getHuntressPlatformTitle("darwin")).toBe("macOS");
    expect(getHuntressPlatformTitle("microsoft_365")).toBe("Microsoft 365");
    expect(getHuntressPlatformTitle("google")).toBe("Google Workspace");
    expect(getHuntressPlatformTitle("something_new")).toBe("something_new");
    expect(getHuntressPlatformTitle(null)).toBeNull();
  });

  test("indicator types read as words", () => {
    expect(getHuntressIndicatorTitle("process_detections")).toBe(
      "Process detections",
    );
    expect(getHuntressIndicatorTitle("mde_detections")).toBe(
      "Microsoft Defender detections",
    );
    expect(getHuntressIndicatorTitle("brand_new_type")).toBe("Brand new type");
  });

  test("an endpoint report names a host, an identity report an identity", () => {
    expect(getHuntressAffectedLabel("windows")).toBe("Host");
    expect(getHuntressAffectedLabel("linux")).toBe("Host");
    expect(getHuntressAffectedLabel("microsoft_365")).toBe("Identity");
    expect(getHuntressAffectedLabel("google")).toBe("Identity");
    expect(getHuntressAffectedLabel("email_security")).toBe("Affected");
    expect(getHuntressAffectedLabel(null)).toBe("Affected");
  });
});

describe("getHuntressIncidentDescription", () => {
  test("the analyst's summary first, then the facts and the link to the report", () => {
    expect(
      getHuntressIncidentDescription({
        event: event(getHuntressIncidentReportBody()),
        severity: HuntressSeverity.Critical,
      }),
    ).toBe(
      [
        "Huntress detected a malicious scheduled task on this host. We recommend removing the file and scheduled task listed in the remediation steps below.",
        "",
        "- **Severity in Huntress:** Critical",
        "- **Organization:** Acme Corp",
        "- **Host:** DESKTOP-ARL0EQ1 (Windows)",
        "- **Indicators:** Footholds (1), Process detections (2)",
        "- **Huntress report:** [1234](https://huntress.io/org/4/incident_reports/1234)",
      ].join("\n"),
    );
  });

  test("an identity report names the identity", () => {
    const description: string = getHuntressIncidentDescription({
      event: event(getHuntressIdentityReportBody()),
      severity: HuntressSeverity.High,
    });

    expect(description).toContain("- **Severity in Huntress:** High");
    expect(description).toContain("- **Identity:**");
    expect(description).toContain("(Microsoft 365)");
    expect(description).toContain("- **Indicators:** Managed identity (1)");
  });

  test("a report with nothing but its id still says which report it is", () => {
    expect(
      getHuntressIncidentDescription({
        event: event({
          event_type: "incident_report.created",
          id: 9,
        }),
        severity: HuntressSeverity.High,
      }),
    ).toBe(
      ["- **Severity in Huntress:** High", "- **Huntress report:** 9"].join(
        "\n",
      ),
    );
  });

  test("names Huntress wrote read as written, and none is a link, image, HTML or chat mention", () => {
    const name: string =
      "Acme](https://evil.example) <!channel> ![x](https://tracker.example/p.png)";
    const description: string = getHuntressIncidentDescription({
      event: event(
        getHuntressIncidentReportBody({
          organization: { id: 4, name: name },
          subject: "CRITICAL - Incident on <img src=x onerror=alert(1)> (Acme)",
          summary: null,
        }),
      ),
      severity: HuntressSeverity.Critical,
    });

    expect(asRead(description)).toContain(`- **Organization:** ${name}`);
    expect(asRead(description)).toContain(
      "<img src=x onerror=alert(1)> (Windows)",
    );

    // Each is broken where it would act, invisibly.
    for (const acting of [
      "](https://evil.example)",
      "<!channel>",
      "![x]",
      "<img",
    ]) {
      expect({ acting, found: description.includes(acting) }).toEqual({
        acting,
        found: false,
      });
    }
  });

  test("the analyst's summary keeps its Markdown, and nothing in it acts", () => {
    const summary: string =
      "**Isolated** the host.\n\n![beacon](https://tracker.example/p.png)\n\n[Reset your password](https://login.example/reset) <!here> please look";
    const description: string = getHuntressIncidentDescription({
      event: event(getHuntressIncidentReportBody({ summary })),
      severity: HuntressSeverity.Critical,
    });

    expect(description).toContain("**Isolated** the host.");
    expect(asRead(description).startsWith(summary)).toBe(true);
    expect(description).not.toContain("![beacon](");
    expect(description).not.toContain("](https://login.example/reset)");
    expect(description).not.toContain("<!here>");
  });
});

describe("notes and the resolution reason", () => {
  test("a comment from Huntress becomes a private note", () => {
    expect(getHuntressCommentNote("We isolated the host.")).toBe(
      "**Comment added in Huntress**\n\nWe isolated the host.",
    );
  });

  test("a comment reads as written, and its image and chat mention do not act", () => {
    const comment: string = "![x](https://tracker.example/p.png) <!channel>";
    const note: string = getHuntressCommentNote(comment);

    expect(asRead(note)).toBe(`**Comment added in Huntress**\n\n${comment}`);
    expect(note).not.toContain("![x](");
    expect(note).not.toContain("<!channel>");
  });

  test("a status Huntress wrote reads as written in the closed note, and does not act", () => {
    const closed: HuntressIncidentReportEvent = event(
      getHuntressCommentBody("", { status: "<!channel> closed" }),
    );
    const note: string = getHuntressClosedNote(closed);

    expect(asRead(note)).toBe(
      "Huntress closed incident report 1234 (status: <!channel> closed).",
    );
    expect(note).not.toContain("<!channel>");
  });

  test("the closed note names the report and its status", () => {
    const closed: HuntressIncidentReportEvent = event(
      getHuntressCommentBody("", { status: "dismissed" }),
    );

    expect(getHuntressClosedNote(closed)).toBe(
      "Huntress closed incident report 1234 (status: dismissed).",
    );
    expect(getHuntressClosedNote({ reportId: "1234", status: null })).toBe(
      "Huntress closed incident report 1234.",
    );
  });
});
