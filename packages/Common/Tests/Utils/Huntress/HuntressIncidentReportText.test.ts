import HuntressSeverity from "../../../Types/Huntress/HuntressSeverity";
import {
  HuntressIncidentReportEvent,
  ParsedHuntressWebhook,
  parseHuntressWebhook,
} from "../../../Types/Huntress/HuntressWebhook";
import { JSONObject } from "../../../Types/JSON";
import {
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
  getHuntressResolvedReason,
} from "../../../Utils/Huntress/HuntressIncidentReportText";
import {
  getHuntressCommentBody,
  getHuntressIdentityReportBody,
  getHuntressIncidentReportBody,
} from "../../Types/Huntress/HuntressWebhookFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * The incident a Huntress report opens, as responders read it: the title a
 * page or a call says, the description (summary first, then the facts and
 * the way back to Huntress), and the notes for comments and closing. What
 * Huntress wrote is placed as text: a name or a summary never becomes a
 * link, an image or a chat mention of its own.
 */

/*
 * Whether `needle` appears anywhere in `text` without a backslash right
 * before it - the escape every renderer turns back into the character, so
 * an escaped "](" or "<img" reads as typed and does nothing.
 */
function hasUnescaped(text: string, needle: string): boolean {
  let at: number = text.indexOf(needle);

  while (at >= 0) {
    if (at === 0 || text.charAt(at - 1) !== "\\") {
      return true;
    }

    at = text.indexOf(needle, at + 1);
  }

  return false;
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
    expect(getHuntressIncidentTitle(event(getHuntressIncidentReportBody()))).toBe(
      "Huntress: Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
    );
  });

  test.each([
    ["HIGH - Incident on laptop01 (Test)", "Huntress: Incident on laptop01 (Test)"],
    ["low - Incident on laptop01 (Test)", "Huntress: Incident on laptop01 (Test)"],
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
  });
});

describe("getHuntressAffectedName", () => {
  test("reads the host from the subject", () => {
    expect(getHuntressAffectedName(event(getHuntressIncidentReportBody()))).toBe(
      "DESKTOP-ARL0EQ1",
    );
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
        event(getHuntressIncidentReportBody({ subject: "Incident on (Acme Corp)" })),
      ),
    ).toBeNull();
    expect(
      getHuntressAffectedName(event(getHuntressIncidentReportBody({ subject: null }))),
    ).toBeNull();
  });

  test("is searched with indexOf: a megabyte of brackets is read at once", () => {
    const started: number = Date.now();

    getHuntressAffectedName({
      subject: `Incident on ${" (".repeat(1024 * 1024)}`,
      organization: { id: null, name: null },
    });

    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("getHuntressReportPortalUrl", () => {
  test("opens the report in the Huntress portal by organization and report", () => {
    expect(getHuntressReportPortalUrl(event(getHuntressIncidentReportBody()))).toBe(
      "https://huntress.io/org/4/incident_reports/1234",
    );
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
      [
        "- **Severity in Huntress:** High",
        "- **Huntress report:** 9",
      ].join("\n"),
    );
  });

  test("names Huntress wrote stay text: no link, image, HTML or chat mention", () => {
    const description: string = getHuntressIncidentDescription({
      event: event(
        getHuntressIncidentReportBody({
          organization: {
            id: 4,
            name: "Acme](https://evil.example) <!channel> ![x](https://tracker.example/p.png)",
          },
          subject: "CRITICAL - Incident on <img src=x onerror=alert(1)> (Acme)",
          summary: null,
        }),
      ),
      severity: HuntressSeverity.Critical,
    });

    // The bracket that would end a link's words is escaped.
    expect(description).toContain("Acme\\](https://evil.example)");
    expect(hasUnescaped(description, "](https://evil.example)")).toBe(false);
    // So is the image's bracket, and the tag's "<".
    expect(hasUnescaped(description, "[x]")).toBe(false);
    expect(hasUnescaped(description, "<img")).toBe(false);
    // The chat mention is broken by an invisible word joiner.
    expect(description).not.toContain("<!channel>");
    expect(description).toContain("<\u2060!channel>");
  });

  test("the analyst's summary keeps its Markdown, but an image in it is only a link", () => {
    const description: string = getHuntressIncidentDescription({
      event: event(
        getHuntressIncidentReportBody({
          summary:
            "**Isolated** the host.\n\n![beacon](https://tracker.example/p.png)\n\n<!here> please look",
        }),
      ),
      severity: HuntressSeverity.Critical,
    });

    expect(description).toContain("**Isolated** the host.");
    // The "!" is escaped: the image is a plain link nobody's client fetches.
    expect(description).toContain("\\![beacon](https://tracker.example/p.png)");
    expect(hasUnescaped(description, "![beacon](")).toBe(false);
    expect(description).not.toContain("<!here>");
  });
});

describe("notes and the resolution reason", () => {
  test("a comment from Huntress becomes a private note", () => {
    expect(getHuntressCommentNote("We isolated the host.")).toBe(
      "**Comment added in Huntress**\n\nWe isolated the host.",
    );
  });

  test("a comment's image and chat mention do not act", () => {
    const note: string = getHuntressCommentNote(
      "![x](https://tracker.example/p.png) <!channel>",
    );

    expect(note).toContain("\\![x](https://tracker.example/p.png)");
    expect(hasUnescaped(note, "![x](")).toBe(false);
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

  test("the resolution reason names the report and its status", () => {
    expect(getHuntressResolvedReason({ reportId: "1234", status: "closed" })).toBe(
      "Resolved because Huntress closed incident report 1234 (status: closed).",
    );
    expect(getHuntressResolvedReason({ reportId: "1234", status: null })).toBe(
      "Resolved because Huntress closed incident report 1234.",
    );
  });
});
