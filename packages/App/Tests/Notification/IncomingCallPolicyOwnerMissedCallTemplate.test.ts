import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import MissedCallNotification, {
  MissedCall,
  MissedCallAttempt,
  MissedCallNotificationContent,
} from "Common/Server/Utils/IncomingCall/MissedCallNotification";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import IncomingCallStatus from "Common/Types/IncomingCall/IncomingCallStatus";
import { MissedIncomingCallReason } from "Common/Types/IncomingCall/MissedIncomingCall";
import { JSONObject } from "Common/Types/JSON";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `ifCond` / `ifNotCond` / `concat` helpers on
 * the shared Handlebars instance as a side effect of import, so this suite
 * renders with the helpers MailService renders with. The partials are
 * registered from disk below.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * The email an Incoming Call Policy's owners get when a call reaches nobody
 * (issue #4159). The vars come from the real builder,
 * MissedCallNotification.buildContent, and are rendered the way MailService
 * renders them: the template file the envelope names, on the shared
 * Handlebars instance with the real partials and helpers. So a var the
 * template stops reading, or a branch the builder never selects, fails here.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const CALL_LOG_LINK: string =
  "https://oneuptime.example.com/dashboard/11111111-1111-4111-8111-111111111111/on-call-duty/incoming-call-policies/22222222-2222-4222-8222-222222222222/logs/44444444-4444-4444-8444-444444444444";

// Injected centrally by UserNotificationSettingService for every owner email.
const PREFERENCES_URL: string =
  "https://oneuptime.example.com/dashboard/11111111-1111-4111-8111-111111111111/user-settings/notification-settings";

const STARTED_AT: Date = new Date("2026-10-01T22:00:00.000Z");

const XSS_POLICY_NAME: string = '<img src=x onerror="alert(1)">Support';
const XSS_USER_NAME: string = '<a href="https://evil.example">Alice</a>';

function templateSource(name: string): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
}

function makeAttempt(
  overrides: Partial<MissedCallAttempt> = {},
): MissedCallAttempt {
  return {
    userName: "Alice Martin",
    phoneNumber: "+14155551001",
    ruleName: "Primary on-call",
    status: IncomingCallStatus.NoAnswer,
    ringSeconds: 30,
    ...overrides,
  };
}

function makeCall(overrides: Partial<MissedCall> = {}): MissedCall {
  return {
    policyName: "Support Hotline",
    projectName: "Acme",
    callerPhoneNumber: "+14155550999",
    routingPhoneNumber: "+14155550102",
    reason: MissedIncomingCallReason.NoAnswer,
    statusMessage: "",
    startedAt: STARTED_AT,
    endedAt: new Date(STARTED_AT.getTime() + 62_000),
    attempts: [
      makeAttempt(),
      makeAttempt({
        userName: "Bob Chen",
        phoneNumber: "+14155551002",
        ruleName: "Secondary",
        ringSeconds: 25,
      }),
    ],
    incomingCallLogViewLink: CALL_LOG_LINK,
    ...overrides,
  };
}

function build(
  call: MissedCall,
  isOwner: boolean = true,
): MissedCallNotificationContent {
  return MissedCallNotification.buildContent({ call, isOwner });
}

/*
 * What MailService.compileEmailBody does with an envelope: read the template
 * file the envelope names, compile it and apply the vars. `year` is the one
 * default MailService adds itself.
 */
function render(
  content: MissedCallNotificationContent,
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

/*
 * The detail card, label -> value. Only values with no markup match, so a
 * name rendered as live HTML drops its row and fails the assertion.
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

interface AttemptRow {
  heading: string;
  details: string;
}

// The "Who was called" rows, in order.
function attemptRows(html: string): Array<AttemptRow> {
  return Array.from(
    html.matchAll(
      /<p style="margin: 0; font-size: 15px; line-height: 24px; font-weight: 600; color: #0f172a;">([^<]*)<\/p>\s*<p style="margin: 2px 0 0; font-size: 13px; line-height: 21px; color: #64748b;">([^<]*)<\/p>/g,
    ),
  ).map((match: RegExpMatchArray): AttemptRow => {
    return {
      heading: decodeHtml(match[1] ?? "").trim(),
      details: decodeHtml(match[2] ?? "").trim(),
    };
  });
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

describe("the missed call email", () => {
  test("is the template the builder names", () => {
    expect(build(makeCall()).emailEnvelope.templateType).toBe(
      EmailTemplateType.IncomingCallPolicyOwnerMissedCall,
    );
    expect(
      fs.existsSync(
        Path.resolve(
          TEMPLATES_DIR,
          EmailTemplateType.IncomingCallPolicyOwnerMissedCall,
        ),
      ),
    ).toBe(true);
  });

  test("is headed with the policy that missed the call", () => {
    expect(headings(render(build(makeCall())))).toEqual([
      "Missed call to Support Hotline",
    ]);
  });

  test("opens with what happened", () => {
    expect(visibleText(render(build(makeCall())))).toContain(
      "Nobody answered. OneUptime went through the escalation rules, then played your No Answer Message to the caller and ended the call.",
    );
  });

  test("lists who called, the number they dialled, the policy and the result", () => {
    const fields: Dictionary<string> = detailFields(render(build(makeCall())));

    expect(fields).toMatchObject({
      "Caller:": "+14155550999",
      "Number Called:": "+14155550102",
      "Incoming Call Policy:": "Support Hotline",
      "Result:": "Nobody answered",
    });
  });

  test("shows when the call started", () => {
    const html: string = render(build(makeCall()));

    expect(html).toContain("Call Started At:");
    expect(visibleText(html)).toContain("2026");
  });

  test("leaves out the called number and the start time when they are unknown", () => {
    const html: string = render(
      build(makeCall({ routingPhoneNumber: "", startedAt: undefined })),
    );

    expect(detailFields(html)).not.toHaveProperty("Number Called:");
    expect(html).not.toContain("Call Started At:");
  });

  test("names an unknown caller as such", () => {
    expect(
      detailFields(render(build(makeCall({ callerPhoneNumber: "" }))))[
        "Caller:"
      ],
    ).toBe("an unknown number");
  });

  test("lists everyone who was rung, in order, with the rule, number and result", () => {
    const html: string = render(build(makeCall()));

    expect(visibleText(html)).toContain("Who was called:");
    expect(attemptRows(html)).toEqual([
      {
        heading: "1. Alice Martin",
        details: "Primary on-call · +14155551001 · No answer after 30 seconds",
      },
      {
        heading: "2. Bob Chen",
        details: "Secondary · +14155551002 · No answer after 25 seconds",
      },
    ]);
  });

  test("a caller who hung up: the last attempt says so", () => {
    const html: string = render(
      build(
        makeCall({
          reason: MissedIncomingCallReason.CallerHungUp,
          attempts: [
            makeAttempt({
              status: IncomingCallStatus.CallerHungUp,
              ringSeconds: 11,
            }),
          ],
        }),
      ),
    );

    expect(detailFields(html)["Result:"]).toBe(
      "Caller hung up before anyone answered",
    );
    expect(attemptRows(html)).toEqual([
      {
        heading: "1. Alice Martin",
        details:
          "Primary on-call · +14155551001 · Caller hung up while ringing after 11 seconds",
      },
    ]);
  });

  test.each([
    MissedIncomingCallReason.NoOneAvailable,
    MissedIncomingCallReason.PolicyDisabled,
  ])(
    "a call that rang nobody (%s) has no list of who was called",
    (reason: MissedIncomingCallReason) => {
      const html: string = render(build(makeCall({ reason, attempts: [] })));

      expect(visibleText(html)).not.toContain("Who was called:");
      expect(attemptRows(html)).toEqual([]);
      expect(visibleText(html)).toContain(
        MissedCallNotification.getExplanation(
          makeCall({ reason, attempts: [] }),
        ),
      );
    },
  );

  test("a long hunt lists 25 attempts and says how many more the call log has", () => {
    const attempts: Array<MissedCallAttempt> = Array.from(
      { length: 31 },
      (_value: unknown, index: number): MissedCallAttempt => {
        return makeAttempt({ userName: `Engineer ${index + 1}` });
      },
    );

    const html: string = render(build(makeCall({ attempts })));
    const rows: Array<AttemptRow> = attemptRows(html);

    expect(rows).toHaveLength(25);
    expect(rows[24]?.heading).toBe("25. Engineer 25");
    expect(visibleText(html)).toContain(
      "...and 6 more. The call log lists every attempt.",
    );
  });

  test("a short hunt does not claim there are more", () => {
    expect(visibleText(render(build(makeCall())))).not.toContain("more.");
  });

  test("links to the call in the call log, as a button and as text", () => {
    const links: Array<Anchor> = anchors(render(build(makeCall())));

    expect(links).toContainEqual({
      href: CALL_LOG_LINK,
      text: "View Call Log",
      isButton: true,
    });
    expect(links).toContainEqual({
      href: CALL_LOG_LINK,
      text: CALL_LOG_LINK,
      isButton: false,
    });
  });

  test("tells an owner why they got it", () => {
    expect(visibleText(render(build(makeCall(), true)))).toContain(
      "You are receiving this email because you are the owner of this resource.",
    );
  });

  test("tells a project owner why they got it instead", () => {
    expect(visibleText(render(build(makeCall(), false)))).toContain(
      "You are receiving this email because no owners have been added to this resource and you are the owner of the project.",
    );
  });

  test("says it will happen again for the next missed call", () => {
    expect(visibleText(render(build(makeCall())))).toContain(
      "You will be notified every time a call to this policy ends without reaching anyone.",
    );
  });

  test("carries the link to the notification preferences", () => {
    const links: Array<Anchor> = anchors(
      render(build(makeCall()), {
        notificationPreferencesUrl: PREFERENCES_URL,
      }),
    );

    expect(links).toContainEqual(
      expect.objectContaining({
        href: PREFERENCES_URL,
        text: "Manage notification preferences",
      }),
    );
  });

  test("renders a policy name and an engineer's name as text, never as markup", () => {
    const html: string = render(
      build(
        makeCall({
          policyName: XSS_POLICY_NAME,
          attempts: [makeAttempt({ userName: XSS_USER_NAME })],
        }),
      ),
    );

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(headings(html)).toEqual([`Missed call to ${XSS_POLICY_NAME}`]);
    expect(detailFields(html)["Incoming Call Policy:"]).toBe(XSS_POLICY_NAME);
    expect(attemptRows(html)[0]?.heading).toBe(`1. ${XSS_USER_NAME}`);
  });

  test("renders template-looking text in a policy name literally", () => {
    const html: string = render(
      build(makeCall({ policyName: "Support {{ .Values.tier }}" })),
    );

    expect(headings(html)).toEqual([
      "Missed call to Support {{ .Values.tier }}",
    ]);
  });

  test("reads every variable the builder sets for it", () => {
    const source: string = templateSource(
      EmailTemplateType.IncomingCallPolicyOwnerMissedCall,
    );

    for (const name of [
      "policyName",
      "explanation",
      "callerPhoneNumber",
      "routingPhoneNumber",
      "result",
      "callStartedAt",
      "hasAttempts",
      "attempts",
      "hasMoreAttempts",
      "moreAttemptsCount",
      "incomingCallLogViewLink",
    ]) {
      expect(source).toContain(name);
      expect(build(makeCall()).emailEnvelope.vars).toHaveProperty(name);
    }
  });
});
