import Handlebars, { TemplateDelegate } from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * "=3D" is quoted-printable for "=". Built with the RegExp constructor rather
 * than a literal: a literal opening with "=" reads as the /= operator, to a
 * human and to no-div-regex alike.
 */
const QUOTED_PRINTABLE_EQUALS: RegExp = new RegExp("=3D", "u");

/*
 * Registers the product's real `ifCond` / `ifNotCond` / `concat` helpers on
 * the shared Handlebars instance as a side effect of import, so this suite
 * exercises the helpers the product ships rather than reimplementations of
 * them. The module also kicks off an async partial load that resolves its
 * directory from process.cwd() and swallows its own failure, so importing it
 * from a test is safe; the partials are registered from disk below.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * The alert emails a customer actually received, and the three rendering
 * defects visible in them.
 *
 * A single Kubernetes monitor created from a OneUptime recommendation sent
 * 39 emails in under two hours. Reading one of them:
 *
 *   Headline:            "Alert ALT-113"
 *   ALERT TITLE:         "[K8s] Pod CPU Saturating Container Limit (>90%) -
 *                         oneuptime-test - Pod CPU Saturating Container Limit"
 *   RESOURCES AFFECTED:  "oneuptime-test - Pod CPU Saturating Container Limit"
 *
 * 1. The headline lost the title. `AlertOwnerResourceCreated.hbs` asks for
 *    `(concat "Alert " alertNumber ": " alertTitle)`, but the `concat`
 *    helper took exactly two arguments and dropped the rest.
 * 2. "Resources Affected" was the MONITOR's name, not the pod that broke —
 *    see AlertOwnerEmailResourcesAffected.test.ts.
 * 3. `Header.hbs` carried quoted-printable escapes (`charset=3Dutf-8`,
 *    `width=3Ddevice-width`) that broke the charset declaration and the
 *    mobile viewport in EVERY email the product sends.
 */

const NOTIFICATION_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
);

const TEMPLATES_DIR: string = Path.resolve(NOTIFICATION_DIR, "Templates");

const HANDLEBARS_UTIL_PATH: string = Path.resolve(
  NOTIFICATION_DIR,
  "Utils",
  "Handlebars.ts",
);

const ALERT_NUMBER: string = "ALT-113";
const ALERT_TITLE: string =
  "[K8s] Pod CPU Saturating Container Limit (>90%) - oneuptime-test";

function templateSource(name: string): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
}

function render(name: string, vars: Record<string, unknown>): string {
  return Handlebars.compile(templateSource(name))(vars);
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/);

    if (!matches) {
      continue;
    }

    Handlebars.registerPartial(
      matches[1]!,
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }
});

describe("the concat helper", () => {
  test("the production module is what registered it", () => {
    /*
     * Guards the import above: if Handlebars.ts stops registering `concat`,
     * every rendering assertion in this file would silently start passing
     * against Handlebars' own missing-helper behaviour instead of failing.
     */
    expect(
      fs.readFileSync(HANDLEBARS_UTIL_PATH, { encoding: "utf8" }),
    ).toContain('registerHelper("concat"');
  });

  test("joins more than two arguments", () => {
    const template: TemplateDelegate = Handlebars.compile(
      '{{concat "Alert " alertNumber ": " alertTitle}}',
    );

    expect(
      template({ alertNumber: ALERT_NUMBER, alertTitle: ALERT_TITLE }),
    ).toBe(
      `Alert ${ALERT_NUMBER}: ${Handlebars.escapeExpression(ALERT_TITLE)}`,
    );
  });

  test("still joins exactly two", () => {
    expect(Handlebars.compile('{{concat "a" "b"}}')({})).toBe("ab");
  });

  test("does not leak Handlebars' own options object into the output", () => {
    const output: string = Handlebars.compile('{{concat "a" "b" "c"}}')({});

    expect(output).toBe("abc");
    expect(output).not.toContain("object Object");
  });

  test("renders a missing variable as empty rather than 'undefined'", () => {
    expect(Handlebars.compile('{{concat "Alert " missing "!"}}')({})).toBe(
      "Alert !",
    );
  });

  test("stringifies non-string arguments", () => {
    expect(Handlebars.compile("{{concat n1 n2}}")({ n1: 1, n2: 2 })).toBe("12");
  });
});

const VARS: Record<string, unknown> = {
  alertTitle: ALERT_TITLE,
  alertNumber: ALERT_NUMBER,
  projectName: "OneUptime Kubernetes Test Cluster",
  currentState: "Identified",
  resourcesAffected: "Pod: kubernetes-agent-logs-7t88f | Namespace: default",
  declaredBy: "OneUptime",
  declaredAt: "Sep 05 2026, 10:55 AM BST",
  alertSeverity: "Warning",
  rootCause:
    "Any value of Pod CPU vs Limit (%) is 91.53 % which is greater than 90 %.",
  alertDescription: "A pod's CPU usage has exceeded 90% of its limit.",
  remediationNotes: "",
  alertViewLink: "https://oneuptime.test/dashboard/alerts/1",
};

describe("AlertOwnerResourceCreated.hbs", () => {
  test("the headline carries the alert title, not just the number", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    /*
     * `{{title}}` escapes, as it should — the alert title is user-supplied
     * and reaches the email as HTML. Compare against the escaped form
     * rather than loosening the template.
     */
    expect(html).toContain(
      `Alert ${ALERT_NUMBER}: ${Handlebars.escapeExpression(ALERT_TITLE)}`,
    );
  });

  test("the headline is not the bare identifier customers received", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    /*
     * Pins the specific regression: the rendered headline used to be
     * "Alert ALT-113" and then the closing tag, with the title dropped by
     * the two-argument `concat`.
     */
    expect(html).not.toContain(`>Alert ${ALERT_NUMBER}</h1>`);
    expect(html).toMatch(new RegExp(`>Alert ${ALERT_NUMBER}: .+</h1>`, "u"));
  });

  test("the affected resource reaches the body", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    expect(html).toContain("kubernetes-agent-logs-7t88f");
  });

  test("the root cause reaches the body", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    expect(html).toContain("91.53");
  });

  test("an empty remediationNotes does not render an empty labelled row", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    expect(html).not.toContain("Remediation Notes:");
  });

  test("remediationNotes renders when present", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", {
      ...VARS,
      remediationNotes: "Raise the CPU limit.",
    });

    expect(html).toContain("Remediation Notes:");
    expect(html).toContain("Raise the CPU limit.");
  });
});

/*
 * THE ESCAPING CONTRACT.
 *
 * DetailBoxField.hbs rendered EVERY value with a triple stash, and the values
 * the alert workers hand it are not HTML: the alert title a project member
 * typed, the severity and state names, the user's own name and email, and -
 * the interesting one - `resourcesAffected`, which is built by
 * SeriesLabelDisplay.buildInlineSummary from telemetry attributes. Any
 * principal that can ship telemetry to the project's ingest endpoint controls
 * those attribute values. Mail clients strip <script>, but <a href> and
 * <img src> survive, which makes it a phishing and read-receipt vector inside
 * an email the recipient trusts.
 *
 * The fix is an ADDITIVE `plainText` parameter rather than flipping `text` to
 * escaped: ~330 call sites across the notification templates legitimately
 * pass Markdown-rendered HTML through `text`, and the HTML/plain split is not
 * expressible per variable name.
 */
describe("DetailBoxField escaping", () => {
  const XSS: string = "<img src=x onerror=alert(1)>";

  const PLAIN_TEXT_FIELDS: Array<string> = [
    "resourcesAffected",
    "alertTitle",
    "declaredBy",
    "alertSeverity",
    "currentState",
  ];

  for (const field of PLAIN_TEXT_FIELDS) {
    test(`${field} is escaped, not injected as markup`, () => {
      const html: string = render("AlertOwnerResourceCreated.hbs", {
        ...VARS,
        [field]: `${XSS} tail`,
      });

      expect(html).toContain("&lt;img");
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("onerror=alert(1)>");
    });
  }

  /*
   * The other half of the contract, and the reason the flip has to be done by
   * VARIABLE NAME rather than by position: this value is produced by
   * OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones, which joins the
   * timezones with a real <br/>. Escaping it would show the reader a literal
   * "<br/>".
   */
  test("the multi-timezone declaredAt keeps its real <br/>", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", {
      ...VARS,
      declaredAt: "Sep 05 2026, 10:55 AM BST<br/>Sep 05 2026, 05:55 AM EDT",
    });

    expect(html).toContain("BST<br/>Sep 05");
    expect(html).not.toContain("&lt;br/&gt;");
  });

  // Markdown-rendered HTML still renders as HTML.
  test("rootCause still renders as HTML", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", {
      ...VARS,
      rootCause: "<p>CPU is <strong>91.53 %</strong></p>",
    });

    expect(html).toContain("<strong>91.53 %</strong>");
  });

  /*
   * A source-level ratchet. A future edit that restores the triple stash on
   * the label, or drops the escaped branch, must fail loudly rather than
   * quietly reopening the hole.
   */
  test("the partial keeps an escaped label and an escaped plainText branch", () => {
    const source: string = fs.readFileSync(
      Path.resolve(TEMPLATES_DIR, "Partials", "DetailBoxField.hbs"),
      { encoding: "utf8" },
    );

    expect(source).toContain("{{plainText}}");
    expect(source).not.toContain("{{{plainText}}}");
    expect(source).toContain("{{title}}");
    expect(source).not.toContain("{{{title}}}");
  });

  /*
   * `blockText` is the third slot and carries the SAME raw-HTML contract as
   * `text` — it exists for the <p>-nesting problem, not for escaping, and
   * must never be mistaken for the escaped branch.
   */
  test("the partial's blockText branch is raw HTML in a block container", () => {
    const source: string = fs.readFileSync(
      Path.resolve(TEMPLATES_DIR, "Partials", "DetailBoxField.hbs"),
      { encoding: "utf8" },
    );

    expect(source).toContain("{{{blockText}}}");
    expect(source).not.toContain("{{blockText}}}}");
    // A block container, so a <table> or <ul> can nest legally inside it.
    expect(source).toMatch(/<div[^>]*>\{\{\{blockText\}\}\}<\/div>/u);
  });

  /*
   * Every value the alert templates pass that is NOT Markdown output or a
   * pre-rendered date must be on plainText=. Reading the two templates
   * catches a new row added on the wrong parameter, which no rendering
   * assertion would.
   */
  test("the alert templates pass their plain strings on plainText=", () => {
    const created: string = templateSource("AlertOwnerResourceCreated.hbs");
    const changed: string = templateSource("AlertOwnerStateChanged.hbs");

    for (const variable of [
      "resourcesAffected",
      "alertSeverity",
      "currentState",
      "declaredBy",
    ]) {
      expect(created).toContain(`plainText=${variable}`);
      expect(created).not.toContain(`text=${variable} `);
    }

    for (const variable of [
      "resourcesAffected",
      "alertSeverity",
      "alertTitle",
    ]) {
      expect(changed).toContain(`plainText=${variable}`);
    }

    /*
     * ...and their HTML-bearing ones stay on a raw slot. Markdown output
     * moved to `blockText` (it emits <table>/<ul>, which cannot nest in the
     * <p> that `text` renders); a pre-rendered date stays on `text`,
     * because it is inline <br/> markup and a <p> is the right box for it.
     */
    expect(created).toContain("blockText=rootCause");
    expect(created).toContain("blockText=alertDescription");
    expect(created).toContain("text=declaredAt");
    expect(changed).toContain("blockText=stateChangeRootCause");
    expect(changed).toContain("text=stateChangedAt");
  });

  /*
   * The four on-call page-out emails were the last family still passing
   * every row — titles, state names, severity, resources — through the raw
   * `text` slot, which is the hole the `plainText` branch was added to
   * close. They are also the emails a responder reads at 3am, so they are
   * the worst place to leave attacker-authored markup live.
   */
  test("the acknowledge templates pass their plain strings on plainText=", () => {
    const acknowledgeTemplates: Record<string, Array<string>> = {
      "AcknowledgeAlert.hbs": [
        "alertTitle",
        "currentState",
        "resourcesAffected",
        "alertSeverity",
      ],
      "AcknowledgeIncident.hbs": [
        "incidentTitle",
        "currentState",
        "resourcesAffected",
        "incidentSeverity",
      ],
      "AcknowledgeAlertEpisode.hbs": [
        "alertEpisodeTitle",
        "currentState",
        "resourcesAffected",
        "alertEpisodeSeverity",
      ],
      "AcknowledgeIncidentEpisode.hbs": [
        "incidentEpisodeTitle",
        "currentState",
        "resourcesAffected",
        "incidentEpisodeSeverity",
      ],
    };

    for (const [templateName, variables] of Object.entries(
      acknowledgeTemplates,
    )) {
      const source: string = templateSource(templateName);

      for (const variable of variables) {
        expect(source).toContain(`plainText=${variable}`);
        expect(source).not.toContain(`text=${variable} `);
      }

      // The one genuinely-HTML row per template rides the block slot.
      expect(source).toContain("blockText=rootCause");
    }
  });

  /*
   * `concat` only String()s and joins — it does not escape — so a project
   * name reaching InfoBlock's raw {{{info}}} through it was live HTML.
   */
  test("the acknowledge templates put their concatenated project name on plainInfo=", () => {
    for (const templateName of [
      "AcknowledgeAlert.hbs",
      "AcknowledgeIncident.hbs",
      "AcknowledgeAlertEpisode.hbs",
      "AcknowledgeIncidentEpisode.hbs",
    ]) {
      const source: string = templateSource(templateName);

      expect(source).toContain("InfoBlock plainInfo=(concat");
      expect(source).not.toContain("InfoBlock info=(concat");
    }

    const infoBlock: string = fs.readFileSync(
      Path.resolve(TEMPLATES_DIR, "Partials", "InfoBlock.hbs"),
      { encoding: "utf8" },
    );

    expect(infoBlock).toContain("{{plainInfo}}");
    expect(infoBlock).not.toContain("{{{plainInfo}}}");
  });
});

/*
 * WHAT THE READER SEES FIRST.
 *
 * The email a customer received put its only two instance-specific lines -
 * Root Cause and Description - seventh and eighth, behind five rows that are
 * identical in every notification the monitor sends, and led with two
 * sentences of boilerplate. The inbox list showed "A new alert has been
 * created in the project" on all thirty-nine rows.
 */
describe("AlertOwnerResourceCreated.hbs information architecture", () => {
  test("the boilerplate lead sentences are gone", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    expect(html).not.toContain("A new alert has been created in the project");
    expect(html).not.toContain(
      "You will be notified when the status of this alert changes",
    );
  });

  // The project is still named - as a fact in the card, not as a sentence.
  test("the project is still named", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    expect(html).toContain("OneUptime Kubernetes Test Cluster");
  });

  /*
   * An ordering assertion by indexOf is the only way to pin an information-
   * architecture decision: what broke, then why, then how bad, and the fixed
   * per-criteria prose last.
   */
  test("what broke and why come before the boilerplate description", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    const affected: number = html.indexOf("Affected Resource");
    const rootCause: number = html.indexOf("Root Cause");
    const severity: number = html.indexOf("Severity");
    const description: number = html.indexOf("Description");

    expect(affected).toBeGreaterThan(-1);
    expect(affected).toBeLessThan(rootCause);
    expect(rootCause).toBeLessThan(severity);
    expect(severity).toBeLessThan(description);
  });

  test("the headline is not repeated as an Alert Title row", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

    expect(html).not.toContain("ALERT TITLE");
    expect(html).not.toContain("Alert Title:");
  });

  describe("the preheader", () => {
    test("is hidden, and is the first text in the body", () => {
      const html: string = render("AlertOwnerResourceCreated.hbs", {
        ...VARS,
        preheader: "CPU 91.53% · Pod: kubernetes-agent-logs-7t88f",
      });

      expect(html).toContain("CPU 91.53% · Pod: kubernetes-agent-logs-7t88f");
      expect(html).toMatch(
        /display:\s*none;\s*max-height:\s*0;\s*overflow:\s*hidden/u,
      );

      // Hidden, i.e. it is inside the display:none div and not loose in the body.
      const hidden: number = html.search(/display:\s*none;\s*max-height:\s*0/u);
      const value: number = html.indexOf("CPU 91.53%");

      expect(hidden).toBeLessThan(value);
      expect(value - hidden).toBeLessThan(200);
    });

    test("is escaped like every other reader-facing value", () => {
      const html: string = render("AlertOwnerResourceCreated.hbs", {
        ...VARS,
        preheader: "<img src=x> pod",
      });

      expect(html).toContain("&lt;img");
      expect(html).not.toContain("<img src=x>");
    });
  });

  describe("the severity badge", () => {
    test("renders the severity name in the severity's own colour", () => {
      const html: string = render("AlertOwnerResourceCreated.hbs", {
        ...VARS,
        severityBadgeText: "Critical",
        severityColor: "#dc2626",
      });

      expect(html).toContain(">Critical</span>");
      expect(html).toContain("border:1px solid #dc2626");
    });

    /*
     * `{{#if}}`, not `{{#ifNotCond ... ""}}`: ifNotCond is a strict !==, so an
     * ABSENT var passes it and would render an empty pill with
     * `border:1px solid ;`.
     */
    test("an absent severity renders no badge at all", () => {
      const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

      expect(html).not.toContain("border-radius:9999px");
      expect(html).not.toContain("border:1px solid ;");
    });
  });

  describe("the flapping banner", () => {
    test("renders when the worker found a repeat", () => {
      const html: string = render("AlertOwnerResourceCreated.hbs", {
        ...VARS,
        flapWarning: "This condition has fired 19 times in the last 2 hours.",
      });

      expect(html).toContain("fired 19 times");
      expect(html).toMatch(/background-color:\s*#fffbeb/u);
    });

    /*
     * The guard is what keeps an ordinary alert email byte-identical: without
     * it every one of them would gain an empty amber box.
     */
    test("renders nothing at all when there is no repeat", () => {
      const html: string = render("AlertOwnerResourceCreated.hbs", VARS);

      expect(html).not.toMatch(/background-color:\s*#fffbeb/u);
    });

    test("escapes its text - the partial is general", () => {
      const html: string = render("AlertOwnerResourceCreated.hbs", {
        ...VARS,
        flapWarning: "<b>19</b> firings",
      });

      expect(html).toContain("&lt;b&gt;19&lt;/b&gt;");
      expect(html).not.toContain("<b>19</b>");
    });
  });

  describe("the Monitor row", () => {
    test("renders when the worker supplied one", () => {
      const html: string = render("AlertOwnerResourceCreated.hbs", {
        ...VARS,
        monitorName: "Pod CPU Saturating Container Limit",
      });

      expect(html).toContain("Monitor:");
      expect(html).toContain("Pod CPU Saturating Container Limit");
    });

    // The worker blanks it when it would duplicate the affected resource.
    test("renders no empty labelled row when it was suppressed", () => {
      const html: string = render("AlertOwnerResourceCreated.hbs", {
        ...VARS,
        monitorName: "",
      });

      expect(html).not.toContain("Monitor:");
    });
  });
});

describe("AlertOwnerStateChanged.hbs", () => {
  const STATE_VARS: Record<string, unknown> = {
    alertTitle: ALERT_TITLE,
    alertNumber: ALERT_NUMBER,
    projectName: "OneUptime Kubernetes Test Cluster",
    currentState: "Resolved",
    currentStateColor: "#10b981",
    previousState: "Identified",
    previousStateColor: "#ef4444",
    previousStateDurationText: "Was Identified for 6 minutes",
    resourcesAffected: "Pod: kubernetes-agent-logs-7t88f | Namespace: default",
    stateChangedAt: "Sep 05 2026, 11:01 AM BST",
    alertSeverity: "Warning",
    alertDescription: "A pod's CPU usage has exceeded 90% of its limit.",
    stateChangeRootCause: "",
    alertViewLink: "https://oneuptime.test/dashboard/alerts/1",
  };

  /*
   * Twenty of the thirty-nine emails were resolutions, and none of them said
   * what the value recovered TO - so a reader could not tell a real recovery
   * from a monitor oscillating around its threshold.
   */
  test("the recovery reading renders when the timeline carried one", () => {
    const html: string = render("AlertOwnerStateChanged.hbs", {
      ...STATE_VARS,
      stateChangeRootCause:
        "<p>Alert autoresolved. (used_cpu / limit_cpu) * 100 peaked at <strong>24.92 %</strong>.</p>",
    });

    expect(html).toContain("Root Cause:");
    expect(html).toContain("24.92 %");
    // Markdown output, so it must render as HTML rather than be escaped.
    expect(html).toContain("<strong>24.92 %</strong>");
  });

  test("an absent recovery reading renders no empty labelled row", () => {
    expect(render("AlertOwnerStateChanged.hbs", STATE_VARS)).not.toContain(
      "Root Cause:",
    );

    const withoutTheVar: Record<string, unknown> = { ...STATE_VARS };
    delete withoutTheVar["stateChangeRootCause"];

    expect(render("AlertOwnerStateChanged.hbs", withoutTheVar)).not.toContain(
      "Root Cause:",
    );
  });

  test("the affected resource is the pod, escaped", () => {
    const html: string = render("AlertOwnerStateChanged.hbs", {
      ...STATE_VARS,
      resourcesAffected: "<img src=x> pod",
    });

    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img src=x>");
  });

  test("the duration in the previous state still renders", () => {
    expect(render("AlertOwnerStateChanged.hbs", STATE_VARS)).toContain(
      "Was Identified for 6 minutes",
    );
  });

  test("the preheader names the new state and the resource", () => {
    const html: string = render("AlertOwnerStateChanged.hbs", {
      ...STATE_VARS,
      preheader: "Resolved · Pod: kubernetes-agent-logs-7t88f",
    });

    expect(html).toContain("Resolved · Pod: kubernetes-agent-logs-7t88f");
    expect(html).toMatch(
      /display:\s*none;\s*max-height:\s*0;\s*overflow:\s*hidden/u,
    );
  });
});

/*
 * `href={{homeURL}}` - unquoted - with homeURL unset rendered `<a href=>`,
 * a dead link as the first interactive element of every alert, incident,
 * monitor and on-call email, because none of those workers set the var.
 * The anchor is now GUARDED: with the var unset the logo renders as a plain
 * image rather than a dead link. (Populating homeURL for every email was
 * tried and reverted — it pulled the whole DatabaseConfig graph onto the
 * send path and tripled MailServiceTemplateCache's runtime.)
 */
describe("Logo.hbs", () => {
  function renderPartial(name: string, vars: Record<string, unknown>): string {
    return Handlebars.compile(
      fs.readFileSync(Path.resolve(TEMPLATES_DIR, "Partials", name), {
        encoding: "utf8",
      }),
    )(vars);
  }

  test("with no homeURL it renders the image and NO anchor", () => {
    const html: string = renderPartial("Logo.hbs", {});

    expect(html).toContain("<img");
    expect(html).not.toContain("<a");
    expect(html).not.toMatch(/href=\s*>/u);
    expect(html).not.toContain("href=");
  });

  test("with a homeURL it renders a QUOTED href", () => {
    const html: string = renderPartial("Logo.hbs", {
      homeURL: "https://oneuptime.test/",
    });

    expect(html).toContain('href="https://oneuptime.test/"');
    expect(html).toContain("</a>");
  });

  // Source ratchet: the unquoted form must not come back.
  test("the partial never carries an unquoted href", () => {
    const source: string = fs.readFileSync(
      Path.resolve(TEMPLATES_DIR, "Partials", "Logo.hbs"),
      { encoding: "utf8" },
    );

    expect(source).not.toContain("href={{homeURL}}");
    expect(source).toContain('href="{{homeURL}}"');
  });
});

/*
 * The unsubscribe copy was a four-level menu path in prose with no link. The
 * either/or is the contract: the templates whose workers do not yet build the
 * URL keep today's sentence, so this could land one producer at a time.
 */
/*
 * UnsubscribeOwnerEmail.hbs is covered by
 * Tests/Notification/OwnerNotificationPreferencesTemplate.test.ts, which
 * owns the `notificationPreferencesUrl` contract. The link is injected
 * centrally by UserNotificationSettingService for every owner email, so
 * there is no per-worker producer to pin here.
 */
describe("Header.hbs", () => {
  const source: string = fs.readFileSync(
    Path.resolve(TEMPLATES_DIR, "Partials", "Header.hbs"),
    { encoding: "utf8" },
  );

  test("declares utf-8, not the quoted-printable-mangled '3Dutf-8'", () => {
    expect(source).toContain("charset=utf-8");
    expect(source).not.toContain("charset=3Dutf-8");
  });

  test("declares a mobile viewport, not '3Ddevice-width'", () => {
    expect(source).toContain("width=device-width");
    expect(source).not.toContain("width=3Ddevice-width");
  });

  test("no quoted-printable escape survives anywhere in the email templates", () => {
    const offenders: Array<string> = [];

    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = Path.resolve(dir, entry.name);

        if (entry.isDirectory()) {
          walk(full);
          continue;
        }

        if (!entry.name.endsWith(".hbs")) {
          continue;
        }

        /*
         * `=3D` is the quoted-printable encoding of "=". Its presence in
         * source means content was pasted out of a raw email body without
         * being decoded, and it silently corrupts the attribute it lands in.
         */
        if (
          QUOTED_PRINTABLE_EQUALS.test(
            fs.readFileSync(full, { encoding: "utf8" }),
          )
        ) {
          offenders.push(Path.relative(TEMPLATES_DIR, full));
        }
      }
    };

    walk(TEMPLATES_DIR);

    expect(offenders).toEqual([]);
  });
});
