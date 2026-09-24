import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import User from "Common/Models/DatabaseModels/User";
import ProbeMonitorsNotification, {
  ProbeAffectedMonitor,
  ProbeMonitorsNotificationContent,
  ProbeMonitorsRecipient,
  ProbeMonitorsRecipientOwnership,
} from "Common/Server/Utils/Monitor/ProbeMonitorsNotification";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `ifCond` / `ifNotCond` / `concat` helpers on
 * the shared Handlebars instance as a side effect of import, so this suite
 * renders with the helpers MailService renders with. The partials are
 * registered from disk below.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * The grouped email a person receives when a probe stops reporting (or comes
 * back): ONE message naming the probe and listing their monitors it affected,
 * instead of one message per monitor (issue #2486).
 *
 * Every test builds the email the way production does. The vars come from the
 * real builder, ProbeMonitorsNotification.buildContent, and are rendered the
 * way MailService renders them: the template file named by the envelope,
 * compiled on the shared Handlebars instance with the real partials and
 * helpers. So a builder var the template stops reading, or a template branch
 * the builder never selects, fails here.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";
const PROJECT_ID: string = "6f1c2b9a-1111-4111-8111-111111111111";
const PROBE_ID: string = "7a2d3c4b-2222-4222-8222-222222222222";
/*
 * What MonitorService passes as viewMonitorsLink for each direction. The
 * probeId query parameter is ignored by the page. It keeps the link unique
 * per probe, because the email rollup folds deferred emails that share a
 * link into one row.
 */
const PROBE_DISCONNECTED_LIST_PAGE: string = `${DASHBOARD_URL}/${PROJECT_ID}/monitors/probe-disconnected`;
const MONITORS_LIST_PAGE: string = `${DASHBOARD_URL}/${PROJECT_ID}/monitors`;
const PROBE_DISCONNECTED_LIST_LINK: string = `${PROBE_DISCONNECTED_LIST_PAGE}?probeId=${PROBE_ID}`;
const MONITORS_LIST_LINK: string = `${MONITORS_LIST_PAGE}?probeId=${PROBE_ID}`;

// The one sentence that follows the list when a disconnect email is cut short.
const DISCONNECT_MORE_TAIL: string =
  "The button below lists every monitor that is not being monitored.";

// Injected centrally by UserNotificationSettingService for every owner email.
const PREFERENCES_URL: string = `${DASHBOARD_URL}/${PROJECT_ID}/user-settings/notification-settings`;

const PROBE_NAME: string = "Frankfurt Probe";
const PROJECT_NAME: string = "Acme Production";

const XSS_MONITOR_NAME: string = "<img src=x onerror=alert(1)>";
const XSS_LINK_NAME: string = '<a href="https://evil">x</a>';

const PREFERENCES_FALLBACK: string =
  "Dashboard > More > User Settings > Notification Settings";

const OWNERSHIP_SENTENCES: Record<ProbeMonitorsRecipientOwnership, string> = {
  [ProbeMonitorsRecipientOwnership.MonitorOwner]:
    "You are receiving this email because you are an owner of these monitors.",
  [ProbeMonitorsRecipientOwnership.ProjectOwner]:
    "You are receiving this email because no owners have been added to these monitors and you are an owner of the project.",
  [ProbeMonitorsRecipientOwnership.Mixed]:
    "You are receiving this email because you are an owner of some of these monitors, and the others have no owners and you are an owner of the project.",
};

function templateSource(name: string): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
}

function makeId(index: number): ObjectID {
  return new ObjectID(
    `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
  );
}

function makeUser(index: number): User {
  const user: User = new User();
  user.id = new ObjectID(
    `11111111-0000-4000-8000-${index.toString().padStart(12, "0")}`,
  );
  return user;
}

function makeMonitor(index: number, name?: string): ProbeAffectedMonitor {
  const monitorId: ObjectID = makeId(index);

  return {
    monitorId: monitorId,
    monitorName: name ?? `Monitor ${index.toString().padStart(2, "0")}`,
    monitorViewLink: `${DASHBOARD_URL}/${PROJECT_ID}/monitors/${monitorId.toString()}`,
  };
}

// "Monitor 01" .. "Monitor NN", already in the name order the builder sorts to.
function makeMonitors(count: number): Array<ProbeAffectedMonitor> {
  return Array.from(
    { length: count },
    (_value: unknown, index: number): ProbeAffectedMonitor => {
      return makeMonitor(index + 1);
    },
  );
}

interface TransitionOptions {
  isProbeDisconnected: boolean;
  probeName?: string | undefined;
  projectName?: string | undefined;
  viewMonitorsLink?: string | undefined;
}

function buildContentFor(
  recipient: ProbeMonitorsRecipient,
  options: TransitionOptions,
): ProbeMonitorsNotificationContent {
  return ProbeMonitorsNotification.buildContent({
    probeName: options.probeName ?? PROBE_NAME,
    projectName: options.projectName ?? PROJECT_NAME,
    isProbeDisconnected: options.isProbeDisconnected,
    recipient: recipient,
    viewMonitorsLink:
      options.viewMonitorsLink ??
      (options.isProbeDisconnected
        ? PROBE_DISCONNECTED_LIST_LINK
        : MONITORS_LIST_LINK),
  });
}

interface EmailOptions extends TransitionOptions {
  monitors: Array<ProbeAffectedMonitor>;
  ownership?: ProbeMonitorsRecipientOwnership | undefined;
}

function buildEmail(options: EmailOptions): ProbeMonitorsNotificationContent {
  return buildContentFor(
    {
      user: makeUser(1),
      monitors: options.monitors,
      ownership:
        options.ownership ?? ProbeMonitorsRecipientOwnership.MonitorOwner,
    },
    options,
  );
}

/*
 * What MailService.compileEmailBody does with an envelope: read the template
 * file the envelope names, compile it on the shared Handlebars instance and
 * apply the vars. `year` is the one default MailService adds itself.
 */
function renderEmail(
  content: ProbeMonitorsNotificationContent,
  extraVars: Dictionary<string> = {},
): string {
  const templateType: EmailTemplateType | undefined =
    content.emailEnvelope.templateType;

  if (!templateType) {
    throw new Error("The envelope does not name a template");
  }

  const vars: Dictionary<string | JSONObject> = {
    year: "2026",
    ...content.emailEnvelope.vars,
    ...extraVars,
  };

  return Handlebars.compile(templateSource(templateType))(vars).toString();
}

// MailService.compileText: the subject is compiled as a template too.
function renderSubject(content: ProbeMonitorsNotificationContent): string {
  return Handlebars.compile(content.emailEnvelope.subject)(
    content.emailEnvelope.vars,
  ).toString();
}

/*
 * Decode once, like an HTML attribute or text node. Handlebars escapes "="
 * and quotes as numeric references as well as the named ones.
 */
function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };

  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
    (entity: string, code: string): string => {
      if (code.startsWith("#")) {
        const hex: boolean = code[1]?.toLowerCase() === "x";
        return String.fromCodePoint(
          parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10),
        );
      }
      return named[code.toLowerCase()] ?? entity;
    },
  );
}

// The words a reader sees: tags dropped, entities decoded, whitespace collapsed.
function visibleText(html: string): string {
  return decodeHtml(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

interface Anchor {
  href: string;
  text: string;
  isButton: boolean;
}

function anchors(html: string): Array<Anchor> {
  return Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)).map(
    (match: RegExpMatchArray): Anchor => {
      const attributes: string = match[1] ?? "";

      return {
        href: decodeHtml(attributes.match(/\bhref="([^"]*)"/i)?.[1] ?? ""),
        text: decodeHtml((match[2] ?? "").replace(/<[^>]*>/g, "")).trim(),
        isButton: attributes.includes("st-Button-link"),
      };
    },
  );
}

interface Link {
  href: string;
  text: string;
}

// The monitor rows: every non-button link that points at a monitor's own page.
function listedMonitors(
  html: string,
  candidates: Array<ProbeAffectedMonitor>,
): Array<Link> {
  const monitorLinks: Set<string> = new Set(
    candidates.map((monitor: ProbeAffectedMonitor): string => {
      return monitor.monitorViewLink;
    }),
  );

  return anchors(html)
    .filter((anchor: Anchor): boolean => {
      return !anchor.isButton && monitorLinks.has(anchor.href);
    })
    .map((anchor: Anchor): Link => {
      return { href: anchor.href, text: anchor.text };
    });
}

function expectedRows(monitors: Array<ProbeAffectedMonitor>): Array<Link> {
  return monitors.map((monitor: ProbeAffectedMonitor): Link => {
    return { href: monitor.monitorViewLink, text: monitor.monitorName };
  });
}

function buttons(html: string): Array<Link> {
  return anchors(html)
    .filter((anchor: Anchor): boolean => {
      return anchor.isButton;
    })
    .map((anchor: Anchor): Link => {
      return { href: anchor.href, text: anchor.text };
    });
}

/*
 * The detail card, label -> value. The value is matched only when it holds
 * no markup at all, so a name rendered as live HTML drops its row and fails
 * the assertion instead of passing it.
 */
function detailFields(html: string): Dictionary<string> {
  const fields: Dictionary<string> = {};

  for (const match of html.matchAll(
    /<p class="st-DetailCard-label"[^>]*>([^<]*)<\/p>\s*<div class="st-DetailCard-value"[^>]*>([^<]*)<\/div>/g,
  )) {
    fields[decodeHtml(match[1] ?? "").trim()] = decodeHtml(
      match[2] ?? "",
    ).trim();
  }

  return fields;
}

function headings(html: string): Array<string> {
  return Array.from(html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)).map(
    (match: RegExpMatchArray): string => {
      return decodeHtml(match[1] ?? "").trim();
    },
  );
}

// Every opening and closing tag name, in document order.
function tagSequence(html: string): Array<string> {
  return Array.from(html.matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)).map(
    (match: RegExpMatchArray): string => {
      return (match[1] ?? "").toLowerCase();
    },
  );
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// The visible text of each InfoBlock paragraph, in document order.
function infoBlocks(html: string): Array<string> {
  return Array.from(
    html.matchAll(/<td class="st-Gutter st-Rich"[^>]*>([\s\S]*?)<\/td>/g),
  ).map((match: RegExpMatchArray): string => {
    return visibleText(match[1] ?? "");
  });
}

// The "...and N more" paragraph under the monitor list, whole.
function moreLines(html: string): Array<string> {
  return infoBlocks(html).filter((block: string): boolean => {
    return block.startsWith("...and");
  });
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

describe("the probe disconnected", () => {
  const monitors: Array<ProbeAffectedMonitor> = [
    makeMonitor(1, "Checkout API"),
    makeMonitor(2, "Payments Worker"),
    makeMonitor(3, "Search API"),
  ];

  test("the builder hands MailService this template", () => {
    const content: ProbeMonitorsNotificationContent = buildEmail({
      isProbeDisconnected: true,
      monitors,
    });

    expect(content.emailEnvelope.templateType).toBe(
      EmailTemplateType.MonitorsAffectedByProbeStatus,
    );
    expect(
      fs.existsSync(
        Path.resolve(
          TEMPLATES_DIR,
          EmailTemplateType.MonitorsAffectedByProbeStatus,
        ),
      ),
    ).toBe(true);
  });

  test("the headline counts the monitors that are not being monitored", () => {
    expect(
      headings(
        renderEmail(buildEmail({ isProbeDisconnected: true, monitors })),
      ),
    ).toEqual(["3 monitors not being monitored"]);

    expect(
      headings(
        renderEmail(
          buildEmail({
            isProbeDisconnected: true,
            monitors: [makeMonitor(1, "Checkout API")],
          }),
        ),
      ),
    ).toEqual(["1 monitor not being monitored"]);
  });

  test("the intro names the probe and says the monitors are not being monitored", () => {
    const text: string = visibleText(
      renderEmail(buildEmail({ isProbeDisconnected: true, monitors })),
    );

    expect(text).toContain(
      `Probe ${PROBE_NAME} stopped reporting to OneUptime. The monitors below have no other connected probe, so they are not being monitored until a probe reconnects.`,
    );
    // The reconnect copy must not leak into the disconnect email.
    expect(text).not.toContain("being monitored again");
    expect(text).not.toContain("is connected again");
  });

  test("the detail card names the probe, its status, the project and the count", () => {
    const fields: Dictionary<string> = detailFields(
      renderEmail(buildEmail({ isProbeDisconnected: true, monitors })),
    );

    expect(fields).toEqual({
      "Probe:": PROBE_NAME,
      "Probe Status:": "Disconnected",
      "Project:": PROJECT_NAME,
      "Monitors Affected:": "3",
    });
  });

  test("each listed monitor name links to that monitor's own page", () => {
    const html: string = renderEmail(
      buildEmail({ isProbeDisconnected: true, monitors }),
    );

    expect(listedMonitors(html, monitors)).toEqual(expectedRows(monitors));
  });

  test("the button opens the list of monitors with disconnected probes", () => {
    const html: string = renderEmail(
      buildEmail({ isProbeDisconnected: true, monitors }),
    );

    expect(buttons(html)).toEqual([
      { href: PROBE_DISCONNECTED_LIST_LINK, text: "View Affected Monitors" },
    ]);
    // ...with the same destination as the copyable fallback.
    expect(
      anchors(html).filter((anchor: Anchor): boolean => {
        return !anchor.isButton && anchor.text === anchor.href;
      }),
    ).toEqual([
      {
        href: PROBE_DISCONNECTED_LIST_LINK,
        text: PROBE_DISCONNECTED_LIST_LINK,
        isButton: false,
      },
    ]);
    expect(visibleText(html)).toContain(
      "You can see every monitor that is not being monitored by clicking on the button below",
    );
  });
});

describe("the probe reconnected", () => {
  const monitors: Array<ProbeAffectedMonitor> = [
    makeMonitor(1, "Checkout API"),
    makeMonitor(2, "Search API"),
  ];

  test("the headline and intro say the monitors are being monitored again", () => {
    const html: string = renderEmail(
      buildEmail({ isProbeDisconnected: false, monitors }),
    );
    const text: string = visibleText(html);

    expect(headings(html)).toEqual(["2 monitors being monitored again"]);
    expect(text).toContain(
      `Probe ${PROBE_NAME} is connected again. The monitors below are being monitored again.`,
    );
    // The disconnect copy must not leak into the reconnect email.
    expect(text).not.toContain("not being monitored");
    expect(text).not.toContain("stopped reporting");
  });

  test("the detail card says Connected", () => {
    expect(
      detailFields(
        renderEmail(buildEmail({ isProbeDisconnected: false, monitors })),
      )["Probe Status:"],
    ).toBe("Connected");
  });

  test("the button is View Monitors and opens the monitor list", () => {
    const html: string = renderEmail(
      buildEmail({ isProbeDisconnected: false, monitors }),
    );

    expect(buttons(html)).toEqual([
      { href: MONITORS_LIST_LINK, text: "View Monitors" },
    ]);
    expect(visibleText(html)).not.toContain("View Affected Monitors");
  });

  test("the reconnected monitors are still listed, each linked", () => {
    const html: string = renderEmail(
      buildEmail({ isProbeDisconnected: false, monitors }),
    );

    expect(listedMonitors(html, monitors)).toEqual(expectedRows(monitors));
  });
});

/*
 * Monitor, probe and project names are free text a project member typed, and
 * this email lists many of them. Every one must reach the reader as text: a
 * name rendered as markup puts an attacker-authored <a href> or <img> into an
 * email the recipient trusts.
 */
describe("names reach the email as text, never as markup", () => {
  const benignMonitors: Array<ProbeAffectedMonitor> = [
    makeMonitor(1, "Checkout API"),
    makeMonitor(2, "Search API"),
  ];
  const hostileMonitors: Array<ProbeAffectedMonitor> = [
    makeMonitor(1, XSS_MONITOR_NAME),
    makeMonitor(2, XSS_LINK_NAME),
  ];

  test.each([true, false])(
    "isProbeDisconnected=%s: the hostile names add no tag anywhere in the document",
    (isProbeDisconnected: boolean) => {
      const benign: string = renderEmail(
        buildEmail({ isProbeDisconnected, monitors: benignMonitors }),
      );
      const hostile: string = renderEmail(
        buildEmail({
          isProbeDisconnected,
          monitors: hostileMonitors,
          probeName: XSS_LINK_NAME,
          projectName: XSS_MONITOR_NAME,
        }),
      );

      /*
       * Same template branches, same number of rows: any name rendered raw
       * would add its own <img> or <a> to the sequence.
       */
      expect(tagSequence(hostile)).toEqual(tagSequence(benign));
      expect(
        anchors(hostile).some((anchor: Anchor): boolean => {
          return anchor.href === "https://evil";
        }),
      ).toBe(false);
      expect(hostile).not.toMatch(/<img\b[^>]*onerror/i);
      expect(hostile).not.toMatch(/<img\b[^>]*src=x/i);
    },
  );

  test("each monitor name is escaped exactly once inside its own link", () => {
    const html: string = renderEmail(
      buildEmail({ isProbeDisconnected: true, monitors: hostileMonitors }),
    );

    expect(html).toContain(
      `>${Handlebars.escapeExpression(XSS_MONITOR_NAME)}</a>`,
    );
    expect(html).toContain(
      `>${Handlebars.escapeExpression(XSS_LINK_NAME)}</a>`,
    );
    // One decode gives back exactly what the user typed: escaped once, not twice.
    expect(listedMonitors(html, hostileMonitors)).toEqual(
      expectedRows(hostileMonitors),
    );
    expect(html).not.toContain("&amp;lt;");
    expect(html).not.toContain("&amp;quot;");
  });

  test.each([
    [true, "stopped reporting to OneUptime."],
    [false, "is connected again."],
  ])(
    "isProbeDisconnected=%s: the probe name is escaped in the intro and in the detail card",
    (isProbeDisconnected: boolean, introTail: string) => {
      const html: string = renderEmail(
        buildEmail({
          isProbeDisconnected,
          monitors: benignMonitors,
          probeName: XSS_LINK_NAME,
          projectName: XSS_MONITOR_NAME,
        }),
      );

      expect(html).toContain(
        `Probe ${Handlebars.escapeExpression(XSS_LINK_NAME)} ${introTail}`,
      );

      const fields: Dictionary<string> = detailFields(html);

      expect(fields["Probe:"]).toBe(XSS_LINK_NAME);
      expect(fields["Project:"]).toBe(XSS_MONITOR_NAME);
      expect(html).not.toContain("&amp;lt;");
    },
  );

  /*
   * MailService compiles the body AND the subject with Handlebars. A value is
   * never re-evaluated in the body, but the subject is a template string, so
   * a probe named with braces must neither break it nor be evaluated in it.
   */
  test("a probe name containing Handlebars braces renders literally and is never evaluated", () => {
    const bracedName: string = "{{projectName}} {{#each monitors}}";
    const content: ProbeMonitorsNotificationContent = buildEmail({
      isProbeDisconnected: true,
      monitors: benignMonitors,
      probeName: bracedName,
    });

    const html: string = renderEmail(content);

    expect(visibleText(html)).toContain(
      `Probe ${bracedName} stopped reporting to OneUptime.`,
    );
    expect(detailFields(html)["Probe:"]).toBe(bracedName);
    expect(visibleText(html)).not.toContain(`Probe ${PROJECT_NAME}`);
    expect(listedMonitors(html, benignMonitors)).toEqual(
      expectedRows(benignMonitors),
    );

    let subject: string = "";

    expect(() => {
      subject = renderSubject(content);
    }).not.toThrow();
    expect(subject).toContain("2 monitors not being monitored");
    expect(subject).not.toContain(PROJECT_NAME);
    expect(subject).not.toContain("{{");
  });

  /*
   * Removing only "{{" and "}}" can join two single braces into a new "{{":
   * "a{}}{b" loses its "}}" and becomes "a{{b", an unclosed expression the
   * subject compile throws on, so the email is never sent.
   */
  test.each([
    ["a{}}{b", "ab"],
    ["{}}{projectName}}}", "projectName"],
    ["{}}{#each monitors}}", "#each monitors"],
  ])(
    "a probe named %j still gets a subject that compiles: %j",
    (probeName: string, subjectName: string) => {
      const content: ProbeMonitorsNotificationContent = buildEmail({
        isProbeDisconnected: true,
        monitors: benignMonitors,
        probeName: probeName,
      });

      let subject: string = "";

      expect(() => {
        subject = renderSubject(content);
      }).not.toThrow();
      expect(subject).toBe(
        `[Probe Disconnected] ${subjectName}: 2 monitors not being monitored`,
      );
      // The body shows the name exactly as typed.
      expect(detailFields(renderEmail(content))["Probe:"]).toBe(probeName);
    },
  );
});

/*
 * What the "...and N more" line may promise depends on where the button goes.
 * For a disconnect it opens the monitors-with-disconnected-probes list, which
 * does hold every monitor that is not being monitored. For a reconnect it
 * opens the plain monitor list, which cannot tell the reconnected monitors
 * apart, so that line only counts them and promises no full list.
 */
describe("a long list is cut at 25 monitors", () => {
  test.each<[number, boolean, string, string]>([
    [
      30,
      true,
      `...and 5 more. ${DISCONNECT_MORE_TAIL}`,
      "30 monitors not being monitored",
    ],
    [
      26,
      true,
      `...and 1 more. ${DISCONNECT_MORE_TAIL}`,
      "26 monitors not being monitored",
    ],
    [30, false, "...and 5 more.", "30 monitors being monitored again"],
    [26, false, "...and 1 more.", "26 monitors being monitored again"],
  ])(
    "%i monitors, isProbeDisconnected=%s: the first 25 are listed and the rest are counted in one line",
    (
      count: number,
      isProbeDisconnected: boolean,
      moreLine: string,
      headline: string,
    ) => {
      const monitors: Array<ProbeAffectedMonitor> = makeMonitors(count);
      const html: string = renderEmail(
        buildEmail({ isProbeDisconnected, monitors }),
      );
      const text: string = visibleText(html);

      expect(listedMonitors(html, monitors)).toEqual(
        expectedRows(monitors.slice(0, 25)),
      );

      for (const hidden of monitors.slice(25)) {
        expect(text).not.toContain(hidden.monitorName);
        expect(html).not.toContain(hidden.monitorViewLink);
      }

      // The whole paragraph, so a sentence added to either direction fails.
      expect(moreLines(html)).toEqual([moreLine]);
      expect(countOf(text, "...and")).toBe(1);

      // The headline and the card still count every affected monitor.
      expect(headings(html)).toEqual([headline]);
      expect(detailFields(html)["Monitors Affected:"]).toBe(count.toString());
    },
  );

  test("disconnected: the button the 'more' line points at comes after it and opens the disconnected list", () => {
    const html: string = renderEmail(
      buildEmail({ isProbeDisconnected: true, monitors: makeMonitors(30) }),
    );

    expect(buttons(html)).toEqual([
      { href: PROBE_DISCONNECTED_LIST_LINK, text: "View Affected Monitors" },
    ]);

    // "below": the line is rendered before the one button in the email.
    const moreLineAt: number = html.indexOf(
      Handlebars.escapeExpression(DISCONNECT_MORE_TAIL),
    );

    expect(moreLineAt).toBeGreaterThan(-1);
    expect(moreLineAt).toBeLessThan(html.indexOf('class="st-Button-link"'));
    expect(visibleText(html)).not.toContain("Open the dashboard");
  });

  test.each([30, 26])(
    "reconnected, %i monitors: the 'more' line claims no full list anywhere",
    (count: number) => {
      const html: string = renderEmail(
        buildEmail({
          isProbeDisconnected: false,
          monitors: makeMonitors(count),
        }),
      );
      const text: string = visibleText(html);

      expect(text).not.toContain("full list");
      expect(text).not.toContain("lists every monitor");
      expect(text).not.toContain("The button below");
      expect(text).not.toContain("Open the dashboard");
      // The button it would have pointed at is the plain monitor list.
      expect(buttons(html)).toEqual([
        { href: MONITORS_LIST_LINK, text: "View Monitors" },
      ]);
    },
  );

  test.each<[number, boolean, string]>([
    [1, true, "1 monitor not being monitored"],
    [24, true, "24 monitors not being monitored"],
    [25, true, "25 monitors not being monitored"],
    [1, false, "1 monitor being monitored again"],
    [25, false, "25 monitors being monitored again"],
  ])(
    "%i monitors, isProbeDisconnected=%s: every one is listed and there is no 'more' line",
    (count: number, isProbeDisconnected: boolean, headline: string) => {
      const monitors: Array<ProbeAffectedMonitor> = makeMonitors(count);
      const html: string = renderEmail(
        buildEmail({ isProbeDisconnected, monitors }),
      );
      const text: string = visibleText(html);

      expect(listedMonitors(html, monitors)).toEqual(expectedRows(monitors));
      expect(headings(html)).toEqual([headline]);
      expect(moreLines(html)).toEqual([]);
      expect(text).not.toContain("...and");
      expect(text).not.toContain("lists every monitor");
    },
  );
});

/*
 * MonitorService appends ?probeId=<id> to the list link. The builder passes
 * the link through untouched, so it must reach both the button and the
 * copyable fallback whole: escaped once for the attribute, query included.
 */
describe("the list link carries the probe id", () => {
  test.each<[boolean, string, string]>([
    [true, PROBE_DISCONNECTED_LIST_LINK, PROBE_DISCONNECTED_LIST_PAGE],
    [false, MONITORS_LIST_LINK, MONITORS_LIST_PAGE],
  ])(
    "isProbeDisconnected=%s: the button and the copyable link keep ?probeId= intact",
    (isProbeDisconnected: boolean, link: string, page: string) => {
      const html: string = renderEmail(
        buildEmail({ isProbeDisconnected, monitors: makeMonitors(30) }),
      );

      expect(
        anchors(html).filter((anchor: Anchor): boolean => {
          return anchor.href === link;
        }),
      ).toEqual([
        {
          href: link,
          text: isProbeDisconnected
            ? "View Affected Monitors"
            : "View Monitors",
          isButton: true,
        },
        { href: link, text: link, isButton: false },
      ]);

      // Escaped exactly once: "=" becomes "&#x3D;", never "&amp;#x3D;".
      expect(countOf(html, `href="${Handlebars.escapeExpression(link)}"`)).toBe(
        2,
      );
      expect(html).not.toContain("&amp;#x3D;");

      // No anchor falls back to the bare page without the probe id.
      expect(
        anchors(html).some((anchor: Anchor): boolean => {
          return anchor.href === page;
        }),
      ).toBe(false);
    },
  );

  test("two probes in one project get two different links", () => {
    const otherProbeId: string = "8b3e4d5c-3333-4333-8333-333333333333";
    const otherLink: string = `${PROBE_DISCONNECTED_LIST_PAGE}?probeId=${otherProbeId}`;
    const monitors: Array<ProbeAffectedMonitor> = makeMonitors(2);

    const first: string = renderEmail(
      buildEmail({ isProbeDisconnected: true, monitors }),
    );
    const second: string = renderEmail(
      buildEmail({
        isProbeDisconnected: true,
        monitors,
        probeName: "Dublin Probe",
        viewMonitorsLink: otherLink,
      }),
    );

    expect(buttons(first)).toEqual([
      { href: PROBE_DISCONNECTED_LIST_LINK, text: "View Affected Monitors" },
    ]);
    expect(buttons(second)).toEqual([
      { href: otherLink, text: "View Affected Monitors" },
    ]);
  });
});

/*
 * One person can hear about a probe's monitors for two reasons: they own a
 * monitor, or it has no owners and they own the project. The recipients here
 * come from the real grouping step, so each reason is reached the way
 * MonitorService reaches it.
 */
describe("why am I receiving this email", () => {
  const checkout: ProbeAffectedMonitor = makeMonitor(1, "Checkout API");
  const search: ProbeAffectedMonitor = makeMonitor(2, "Search API");
  const monitorOwner: User = makeUser(1);
  const projectOwner: User = makeUser(2);
  const bothOwner: User = makeUser(3);

  // Checkout API has owners; Search API has none, so it goes to project owners.
  const recipients: Array<ProbeMonitorsRecipient> =
    ProbeMonitorsNotification.groupMonitorsByRecipient({
      monitors: [checkout, search],
      ownersByMonitorId: {
        [checkout.monitorId.toString()]: [monitorOwner, bothOwner],
      },
      projectOwners: [projectOwner, bothOwner],
    });

  function recipientFor(user: User): ProbeMonitorsRecipient {
    const recipient: ProbeMonitorsRecipient | undefined = recipients.find(
      (candidate: ProbeMonitorsRecipient): boolean => {
        return candidate.user.id?.toString() === user.id?.toString();
      },
    );

    if (!recipient) {
      throw new Error(`No recipient for user ${user.id?.toString()}`);
    }

    return recipient;
  }

  test.each<[string, User, ProbeMonitorsRecipientOwnership, Array<string>]>([
    [
      "an owner of every listed monitor",
      monitorOwner,
      ProbeMonitorsRecipientOwnership.MonitorOwner,
      ["Checkout API"],
    ],
    [
      "a project owner, for monitors with no owners",
      projectOwner,
      ProbeMonitorsRecipientOwnership.ProjectOwner,
      ["Search API"],
    ],
    [
      "both",
      bothOwner,
      ProbeMonitorsRecipientOwnership.Mixed,
      ["Checkout API", "Search API"],
    ],
  ])(
    "%s reads that reason and only that one",
    (
      _label: string,
      user: User,
      ownership: ProbeMonitorsRecipientOwnership,
      listedNames: Array<string>,
    ) => {
      const recipient: ProbeMonitorsRecipient = recipientFor(user);

      expect(recipient.ownership).toBe(ownership);

      const html: string = renderEmail(
        buildContentFor(recipient, { isProbeDisconnected: true }),
      );
      const text: string = visibleText(html);

      expect(countOf(text, "Why am I receiving this email?")).toBe(1);
      expect(text).toContain(OWNERSHIP_SENTENCES[ownership]);

      for (const other of Object.values(ProbeMonitorsRecipientOwnership)) {
        if (other !== ownership) {
          expect(text).not.toContain(OWNERSHIP_SENTENCES[other]);
        }
      }

      expect(countOf(text, "You are receiving this email because")).toBe(1);
      expect(
        listedMonitors(html, [checkout, search]).map((row: Link): string => {
          return row.text;
        }),
      ).toEqual(listedNames);
    },
  );
});

describe("the notification preferences footer", () => {
  const monitors: Array<ProbeAffectedMonitor> = makeMonitors(2);

  test("links straight to the preferences page when the URL is set", () => {
    const html: string = renderEmail(
      buildEmail({ isProbeDisconnected: true, monitors }),
      { notificationPreferencesUrl: PREFERENCES_URL },
    );
    const text: string = visibleText(html);

    expect(
      anchors(html).filter((anchor: Anchor): boolean => {
        return anchor.href === PREFERENCES_URL;
      }),
    ).toEqual([
      {
        href: PREFERENCES_URL,
        text: "Manage notification preferences",
        isButton: false,
      },
    ]);
    expect(text).toContain(
      "Choose which notifications you receive in this project.",
    );
    expect(text).not.toContain(PREFERENCES_FALLBACK);
  });

  test("falls back to directions when no URL was injected", () => {
    const html: string = renderEmail(
      buildEmail({ isProbeDisconnected: true, monitors }),
    );

    expect(visibleText(html)).toContain(PREFERENCES_FALLBACK);
    expect(html).not.toContain("Manage notification preferences");
  });
});

describe("the rendered document", () => {
  test.each([true, false])(
    "isProbeDisconnected=%s: one non-empty <h1>, a closed document and no unrendered Handlebars",
    (isProbeDisconnected: boolean) => {
      const html: string = renderEmail(
        buildEmail({ isProbeDisconnected, monitors: makeMonitors(30) }),
        { notificationPreferencesUrl: PREFERENCES_URL },
      );

      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(headings(html)[0]).not.toBe("");
      expect(html).toContain("</html>");
      expect(html).not.toContain("{{");
      expect(html).not.toContain("}}");
      expect(html).not.toContain('href=""');
      expect(visibleText(html)).not.toContain("undefined");
      expect(visibleText(html)).not.toContain("[object Object]");
    },
  );
});

/*
 * The per-probe email (sent to the probe's owners) told readers to look under
 * "Project Settings > Probes", a place probes no longer live. They are under
 * Monitors > Settings > Probes.
 */
describe("ProbeConnectionStatusChange.hbs", () => {
  test("directs the reader to Monitors > Settings > Probes", () => {
    const viewProbesLink: string = `${DASHBOARD_URL}/${PROJECT_ID}/monitors/settings/probes/${makeId(9).toString()}`;
    const html: string = Handlebars.compile(
      templateSource("ProbeConnectionStatusChange.hbs"),
    )({
      title: `Probe ${PROBE_NAME} is Disconnected`,
      probeName: PROBE_NAME,
      probeDescription: "Primary probe",
      probeStatus: "Disconnected",
      lastAlive: "Sep 22 2026, 09:00 AM UTC",
      projectName: PROJECT_NAME,
      viewProbesLink: viewProbesLink,
      year: "2026",
    });
    const text: string = visibleText(html);

    expect(text).toContain(
      "You can view this probe by going to Monitors > Settings > Probes",
    );
    expect(text).not.toContain("Project Settings > Probes");
    expect(buttons(html)).toEqual([
      { href: viewProbesLink, text: "View Probes" },
    ]);
  });
});
