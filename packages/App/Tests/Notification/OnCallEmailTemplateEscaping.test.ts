import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
/*
 * The production initializer: registers concat, ifCond, ifNotCond, the
 * brand helpers, the detail card helpers and the email language helpers on
 * the global Handlebars, as MailService renders with.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";
import { BRAND_VARIABLE_NAMES } from "../../FeatureSet/Notification/Utils/EmailBranding";
import { EMAIL_LANGUAGE_VARIABLE_NAMES } from "../../FeatureSet/Notification/Utils/EmailLanguage";
import {
  TemplateVariables,
  templateVariables,
} from "./Fixtures/EmailTemplateVariables";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * EVERY ON-CALL EMAIL WRITES THE NAMES PEOPLE TYPE AS TEXT (issue #8166).
 *
 * The on-call emails are the ones a responder trusts most: the page that
 * wakes them, and what they hear about their own duty - added to or
 * removed from a policy, a hand-off, a shift reminder, a missed call to an
 * incoming call policy, a test page. The names in them are typed by people:
 * a policy's, an escalation rule's, a team's and a schedule's by a project's
 * members, and a person's own name by anybody who signs up. A name such as
 * `<a href="https://evil.example">Level 1</a>` must read as those
 * characters, never become a live link in the email.
 *
 * Every value these emails print is one of two kinds:
 *
 *   - HTML the sender made itself (HTML_VARIABLES): Markdown rendered by
 *     Markdown.convertToHTML (a page's description and root cause), the
 *     multi-timezone dates of OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones,
 *     and an episode's members from EpisodeMemberEmailList, which escapes
 *     every title. Only these may be printed raw - DetailBoxField's text= and
 *     blockText=, InfoBlock's info=, TitleBlock's title=, or {{{...}}}.
 *   - everything else, which is printed escaped: DetailBoxField's
 *     plainText=, InfoBlock's plainInfo=, EmailTitle's title, {{...}}.
 *
 * Added to and Removed from on-call policy and both shift reminders printed
 * the policy, rule, team, schedule and people's names raw, and the shift
 * reminders' opening sentence - which names all of them - too.
 *
 * Every on-call template on disk is checked (ON_CALL_TEMPLATE_FILE), and
 * every variable each one reads (Fixtures/EmailTemplateVariables), so a new
 * template, or a new row of an old one, is covered the day it is added.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");

/*
 * The on-call emails: a page (Acknowledge...), a test page (OnCall...),
 * what a person hears about their own on-call duty (User...OnCall...), and
 * a missed call to an incoming call policy.
 */
const ON_CALL_TEMPLATE_FILE: RegExp =
  /^(?:Acknowledge\w+|OnCall\w+|User\w*OnCall\w+|IncomingCallPolicy\w+)\.hbs$/;

const ON_CALL_TEMPLATES: Array<string> = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((filename: string): boolean => {
    return ON_CALL_TEMPLATE_FILE.test(filename);
  })
  .sort();

/*
 * The values the senders pass as HTML they made themselves, and the only
 * ones a raw slot may print.
 */
const HTML_VARIABLES: ReadonlyArray<string> = [
  // Markdown.convertToHTML (UserNotificationRuleService's page emails).
  "rootCause",
  "incidentDescription",
  "alertDescription",
  "incidentEpisodeDescription",
  "alertEpisodeDescription",
  // EpisodeMemberEmailList.toHtml, which escapes every title and monitor.
  "alertsList",
  "incidentsList",
  // OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones.
  "rosterStartsAt",
  "rosterEndsAt",
  // When a turn of active hours ends (#11270).
  "rosterTurnEndsAt",
  "callStartedAt",
];

/*
 * Language helpers that escape what they write - their sentence and every
 * value of it - so what they hand back may be printed raw.
 */
const ESCAPING_HELPERS: ReadonlyArray<string> = [
  "tHtml",
  "ttHtml",
  // Escapes its sentence and values; its one markup is the address's link.
  "ttMailtoHtml",
  "brandNameHtml",
];

/*
 * The partials' parameters that are printed raw, by partial: read off the
 * partials below (rawPartialParameters), and pinned here so a partial that
 * starts printing a parameter raw is looked at before it is trusted.
 */
const RAW_PARTIAL_PARAMETERS: Record<string, ReadonlyArray<string>> = {
  BigTextBlock: ["info"],
  DetailBoxField: ["blockText", "text"],
  InfoBlock: ["info"],
  TitleBlock: ["title"],
};

/*
 * Raw slots that may hold text written into the template itself: InfoBlock
 * prose and a TitleBlock heading. A DetailBoxField row's literal belongs on
 * plainText=.
 */
const LITERAL_RAW_SLOTS: ReadonlyArray<string> = [
  "InfoBlock info=",
  "BigTextBlock info=",
  "TitleBlock title=",
];

// The variables MailService puts in every email: the brand's and the language's.
const MAIL_SERVICE_VARIABLES: ReadonlyArray<string> = [
  ...BRAND_VARIABLE_NAMES,
  ...EMAIL_LANGUAGE_VARIABLE_NAMES,
];

type HbsNode = { type: string; [key: string]: unknown };

interface RawSlot {
  // Where the value is printed raw: "DetailBoxField text=", "{{{...}}}".
  slot: string;
  value: HbsNode;
}

function templateSource(filename: string): string {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, filename), "utf8");
}

function pathName(node: HbsNode): string {
  return ((node["parts"] as Array<string>) || []).join(".");
}

function hashPairs(node: HbsNode): Array<{ key: string; value: HbsNode }> {
  const hash: HbsNode | undefined = node["hash"] as HbsNode | undefined;

  return (hash?.["pairs"] as Array<{ key: string; value: HbsNode }>) || [];
}

// Every node of a template, in order, partial calls and blocks included.
function walk(node: unknown, visit: (node: HbsNode) => void): void {
  if (!node || typeof node !== "object") {
    return;
  }

  const statement: HbsNode = node as HbsNode;

  visit(statement);

  for (const child of (statement["body"] as Array<unknown>) || []) {
    walk(child, visit);
  }

  walk(statement["program"], visit);
  walk(statement["inverse"], visit);
}

/*
 * A partial's parameters it prints raw: {{{name}}}, or
 * {{{emailHtmlValue name}}} in an email read from the right. A value read
 * from the email's root (@root.oneUptimeLogoUrl) is MailService's own.
 */
function rawPartialParameters(source: string): Array<string> {
  const names: Set<string> = new Set<string>();

  walk(Handlebars.parse(source), (node: HbsNode): void => {
    if (node.type !== "MustacheStatement" || node["escaped"] !== false) {
      return;
    }

    const path: HbsNode = node["path"] as HbsNode;
    const params: Array<HbsNode> = (node["params"] as Array<HbsNode>) || [];

    if (path.type !== "PathExpression" || path["data"]) {
      return;
    }

    if (params.length === 0) {
      names.add(pathName(path));
      return;
    }

    if (
      pathName(path) === "emailHtmlValue" &&
      params[0]?.type === "PathExpression"
    ) {
      names.add(pathName(params[0]));
    }
  });

  return Array.from(names).sort();
}

// Every value a template prints raw, and where.
function rawSlotsOf(source: string): Array<RawSlot> {
  const slots: Array<RawSlot> = [];

  walk(Handlebars.parse(source), (node: HbsNode): void => {
    if (node.type === "PartialStatement") {
      const partial: string = String((node["name"] as HbsNode)["original"]);
      const raw: ReadonlyArray<string> = RAW_PARTIAL_PARAMETERS[partial] || [];

      for (const pair of hashPairs(node)) {
        if (raw.includes(pair.key)) {
          slots.push({ slot: `${partial} ${pair.key}=`, value: pair.value });
        }
      }

      return;
    }

    if (node.type === "MustacheStatement" && node["escaped"] === false) {
      slots.push({ slot: "{{{...}}}", value: node });
    }
  });

  return slots;
}

// What a raw slot prints, as a template writes it: for a failure's message.
function describeValue(value: HbsNode): string {
  switch (value.type) {
    case "StringLiteral":
      return JSON.stringify(value["value"]);
    case "PathExpression":
      return pathName(value);
    default: {
      const path: HbsNode = value["path"] as HbsNode;
      const params: Array<HbsNode> = (value["params"] as Array<HbsNode>) || [];

      return `(${[pathName(path), ...params.map(describeValue)].join(" ")})`;
    }
  }
}

/*
 * Why a raw slot's value may not be printed raw, or null when it may: HTML
 * the sender made, a language helper that escapes, or text written into
 * the template where prose may be.
 */
function rawSlotProblem(slot: RawSlot): string | null {
  const value: HbsNode = slot.value;

  if (value.type === "StringLiteral") {
    return LITERAL_RAW_SLOTS.includes(slot.slot)
      ? null
      : `${slot.slot}${describeValue(value)} (put text written into the template on plainText=)`;
  }

  if (value.type === "PathExpression") {
    return HTML_VARIABLES.includes(pathName(value))
      ? null
      : `${slot.slot}${pathName(value)} (a name people type goes on plainText= or plainInfo=)`;
  }

  if (value.type === "SubExpression" || value.type === "MustacheStatement") {
    const helper: string = pathName(value["path"] as HbsNode);
    const params: Array<HbsNode> = (value["params"] as Array<HbsNode>) || [];

    if (ESCAPING_HELPERS.includes(helper)) {
      return LITERAL_RAW_SLOTS.includes(slot.slot) || slot.slot === "{{{...}}}"
        ? null
        : `${slot.slot}${describeValue(value)} (put written text on plainText=)`;
    }

    // A raw value with no helper: {{{alertsList}}}.
    if (value.type === "MustacheStatement" && params.length === 0) {
      return HTML_VARIABLES.includes(helper)
        ? null
        : `${slot.slot}${helper} (a name people type is printed {{escaped}})`;
    }

    if (helper === "concat") {
      const parts: Array<string | null> = params.map(
        (param: HbsNode): string | null => {
          return param.type === "StringLiteral" ||
            (param.type === "PathExpression" &&
              HTML_VARIABLES.includes(pathName(param)))
            ? null
            : describeValue(param);
        },
      );
      const unsafe: Array<string> = parts.filter(
        (part: string | null): part is string => {
          return part !== null;
        },
      );

      return unsafe.length === 0
        ? null
        : `${slot.slot}${describeValue(value)} (${unsafe.join(", ")} printed raw)`;
    }
  }

  return `${slot.slot}${describeValue(value)}`;
}

// A payload that is a live element if it is not escaped, unique per variable.
function markupFor(name: string): string {
  return `<a href="https://evil.example/${name}">${name}</a><img src="https://evil.example/${name}.png"><script>steal("${name}")</script>`;
}

// How Handlebars' escaping (which also escapes "=") shows markupFor.
function escapedMarkupFor(name: string): string {
  return `&lt;a href&#x3D;&quot;https://evil.example/${name}&quot;&gt;${name}&lt;/a&gt;`;
}

// HTML a sender really makes, unique per variable, which must survive as HTML.
function htmlFor(name: string): string {
  return `<p data-html="${name}"><strong>${name}</strong></p>`;
}

function isUrlVariable(name: string): boolean {
  const last: string = name.split(".").pop() || name;

  return last.endsWith("Url") || last.endsWith("URL") || last.endsWith("Link");
}

// A value MailService puts in every email: not a sender's to set.
function isMailServiceVariable(name: string): boolean {
  return MAIL_SERVICE_VARIABLES.includes(name);
}

/*
 * A variable the template reads as text: the fixture gives it "Sample
 * <name>". A flag ("true"), a colour, a number or a value a template
 * compares with a literal is not text a person typed.
 */
function isPlainVariable(name: string, sample: unknown): boolean {
  return (
    !HTML_VARIABLES.includes(name) &&
    !isUrlVariable(name) &&
    !isMailServiceVariable(name) &&
    typeof sample === "string" &&
    sample.startsWith("Sample ")
  );
}

interface HostileEmail {
  // Every variable but the plain ones: flags, colours, links, HTML.
  fixed: Record<string, unknown>;
  // Each plain variable, with markup in it.
  plain: Map<string, string>;
  // Each list, two items of markup.
  lists: Map<string, Array<Record<string, unknown>>>;
  // The plain fields of the lists' items, by the name in their markup.
  listFields: Array<string>;
  // The variables that hold HTML the sender made.
  html: Array<string>;
}

// `name` ("report.title") set to `value`, making the objects on the way.
function assign(
  target: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  const parts: Array<string> = name.split(".");
  let at: Record<string, unknown> = target;

  for (const part of parts.slice(0, -1)) {
    if (!at[part] || typeof at[part] !== "object") {
      at[part] = {};
    }

    at = at[part] as Record<string, unknown>;
  }

  at[parts[parts.length - 1]!] = value;
}

/*
 * Every variable a template reads, with markup in each one a person could
 * have typed, real HTML in each the sender makes, and a URL that tries to
 * leave its attribute in each link; every list with two items, each field
 * markup. Rendered as MailService renders it: read from the left, or from
 * the right (a Persian reader's), where values are laid out their own way.
 */
function hostileEmail(
  source: string,
  options: { rightToLeft: boolean },
): HostileEmail {
  const found: TemplateVariables = templateVariables(source);
  const email: HostileEmail = {
    fixed: {
      year: "2026",
      brandProductName: "OneUptime",
    },
    plain: new Map<string, string>(),
    lists: new Map<string, Array<Record<string, unknown>>>(),
    listFields: [],
    html: [],
  };

  if (options.rightToLeft) {
    email.fixed["emailLanguage"] = "fa";
    email.fixed["emailDirection"] = "rtl";
    email.fixed["isEmailRightToLeft"] = "true";
  }

  for (const [name, sample] of found.values) {
    if (isMailServiceVariable(name) || name === "year") {
      continue;
    }

    if (HTML_VARIABLES.includes(name)) {
      assign(email.fixed, name, htmlFor(name));
      email.html.push(name);
      continue;
    }

    if (isUrlVariable(name)) {
      assign(
        email.fixed,
        name,
        `https://oneuptime.example/${name}" onmouseover="steal('${name}')`,
      );
      continue;
    }

    if (isPlainVariable(name, sample)) {
      email.plain.set(name, markupFor(name));
      continue;
    }

    assign(email.fixed, name, sample);
  }

  for (const [list, fields] of found.lists) {
    const items: Array<Record<string, unknown>> = [];

    for (let index: number = 1; index <= 2; index++) {
      const item: Record<string, unknown> = {};

      for (const [field, sample] of fields) {
        const name: string = `${list}.${field}.${index}`;

        if (isPlainVariable(field, sample)) {
          item[field] = markupFor(name);
          email.listFields.push(name);
        } else {
          item[field] = sample;
        }
      }

      items.push(item);
    }

    email.lists.set(list, items);
  }

  return email;
}

/*
 * The email with the plain variables `shown` set and the others empty, as
 * a sender leaves a value it does not have: every flag, link and list as
 * they are.
 */
function withPlainVariables(
  email: HostileEmail,
  shown: (name: string) => boolean,
): Record<string, unknown> {
  const variables: Record<string, unknown> = { ...email.fixed };

  for (const [name, value] of email.plain) {
    assign(variables, name, shown(name) ? value : "");
  }

  for (const [list, items] of email.lists) {
    assign(variables, list, items);
  }

  return variables;
}

/*
 * The ways a template's rows come and go with its plain variables: all of
 * them, all but one and only one, for each. A row shown only when another
 * is not ({{#if pageAgainInfo}} ... {{else if personPageInfo}}) shows in one
 * of them.
 */
function variants(email: HostileEmail): Array<Record<string, unknown>> {
  const names: Array<string> = Array.from(email.plain.keys());
  const sets: Array<Record<string, unknown>> = [
    withPlainVariables(email, (): boolean => {
      return true;
    }),
  ];

  for (const name of names) {
    sets.push(
      withPlainVariables(email, (other: string): boolean => {
        return other !== name;
      }),
    );
    sets.push(
      withPlainVariables(email, (other: string): boolean => {
        return other === name;
      }),
    );
  }

  return sets;
}

function render(filename: string, variables: Record<string, unknown>): string {
  return Handlebars.compile(templateSource(filename))(variables);
}

beforeAll(() => {
  for (const filename of fs.readdirSync(PARTIALS_DIR)) {
    if (filename.endsWith(".hbs")) {
      Handlebars.registerPartial(
        filename.slice(0, -4),
        fs.readFileSync(Path.join(PARTIALS_DIR, filename), "utf8"),
      );
    }
  }
});

describe("the on-call email templates", () => {
  test("the suite sees every on-call template", () => {
    expect(ON_CALL_TEMPLATES).toEqual([
      "AcknowledgeAlert.hbs",
      "AcknowledgeAlertEpisode.hbs",
      "AcknowledgeIncident.hbs",
      "AcknowledgeIncidentEpisode.hbs",
      "IncomingCallPolicyOwnerMissedCall.hbs",
      "OnCallTestPage.hbs",
      "UserAddedToOnCallPolicy.hbs",
      "UserCurrentlyOnOnCallRoster.hbs",
      "UserNextOnOnCallRoster.hbs",
      "UserNoLongerActiveOnOnCallRoster.hbs",
      "UserOnCallShiftReassigned.hbs",
      "UserOnCallShiftReminder.hbs",
      "UserRemovedFromOnCallPolicy.hbs",
    ]);
  });

  test("the partials print raw only the parameters this guard reads as raw", () => {
    const found: Record<string, Array<string>> = {};

    for (const filename of fs.readdirSync(PARTIALS_DIR).sort()) {
      if (!filename.endsWith(".hbs")) {
        continue;
      }

      const raw: Array<string> = rawPartialParameters(
        fs.readFileSync(Path.join(PARTIALS_DIR, filename), "utf8"),
      );

      if (raw.length > 0) {
        found[filename.slice(0, -4)] = raw;
      }
    }

    expect(found).toEqual(RAW_PARTIAL_PARAMETERS);
  });

  /*
   * A source-level ratchet: every raw slot of an on-call template prints
   * one of the HTML variables, a language helper that escapes, or prose
   * written into the template. A row put on text= with a name would pass
   * every rendering check that does not happen to set that name to
   * markup; this does not.
   */
  test.each(ON_CALL_TEMPLATES)(
    "%s prints raw only HTML its sender made",
    (filename: string) => {
      const problems: Array<string> = rawSlotsOf(templateSource(filename))
        .map(rawSlotProblem)
        .filter((problem: string | null): problem is string => {
          return problem !== null;
        });

      expect(problems).toEqual([]);
    },
  );

  for (const rightToLeft of [false, true]) {
    const reading: string = rightToLeft ? " read from the right" : "";

    test.each(ON_CALL_TEMPLATES)(
      `%s shows every name as text, never as markup${reading}`,
      (filename: string) => {
        const email: HostileEmail = hostileEmail(templateSource(filename), {
          rightToLeft: rightToLeft,
        });
        const names: Array<string> = [
          ...email.plain.keys(),
          ...email.listFields,
        ];
        const shownAsText: Set<string> = new Set<string>();

        for (const variables of variants(email)) {
          const html: string = render(filename, variables);

          expect(html).not.toContain("<script");
          expect(html).not.toContain('href="https://evil.example');
          expect(html).not.toContain('src="https://evil.example');

          for (const name of names) {
            if (html.includes(escapedMarkupFor(name))) {
              shownAsText.add(name);
            }
          }
        }

        // Each one is shown, as text, in one way or another its rows come.
        for (const name of names) {
          expect({ name, shownAsText: shownAsText.has(name) }).toEqual({
            name,
            shownAsText: true,
          });
        }
      },
    );
  }

  test.each(ON_CALL_TEMPLATES)(
    "%s has a name people type to check",
    (filename: string) => {
      const email: HostileEmail = hostileEmail(templateSource(filename), {
        rightToLeft: false,
      });

      // Every on-call email names something: a record, a policy, a schedule.
      expect(email.plain.size + email.listFields.length).toBeGreaterThanOrEqual(
        1,
      );
    },
  );

  test.each(ON_CALL_TEMPLATES)(
    "%s keeps a URL inside its attribute",
    (filename: string) => {
      const email: HostileEmail = hostileEmail(templateSource(filename), {
        rightToLeft: false,
      });

      for (const variables of variants(email)) {
        const html: string = render(filename, variables);

        expect(html).not.toMatch(/"\s*onmouseover="/);
        expect(html).not.toContain(`onmouseover="steal`);
      }
    },
  );

  test.each(ON_CALL_TEMPLATES)(
    "%s still renders the HTML its sender made as HTML",
    (filename: string) => {
      const email: HostileEmail = hostileEmail(templateSource(filename), {
        rightToLeft: false,
      });
      const html: string = render(
        filename,
        withPlainVariables(email, (): boolean => {
          return true;
        }),
      );

      for (const name of email.html) {
        expect({ name, rendered: html.includes(htmlFor(name)) }).toEqual({
          name,
          rendered: true,
        });
      }
    },
  );
});

/*
 * The emails issue #8166 found, by their rows: each name a person typed is
 * a plainText row, and the times OneUptime writes as text are too.
 */
describe("the emails issue #8166 found", () => {
  const ROWS: Array<[string, Array<string>]> = [
    [
      "UserAddedToOnCallPolicy.hbs",
      [
        "onCallPolicyName",
        "escalationRuleName",
        "escalationRuleOrder",
        "reason",
      ],
    ],
    [
      "UserRemovedFromOnCallPolicy.hbs",
      [
        "onCallPolicyName",
        "escalationRuleName",
        "escalationRuleOrder",
        "reason",
      ],
    ],
    [
      "UserOnCallShiftReminder.hbs",
      [
        "scheduleName",
        "policyNames",
        "startsAt",
        "endsAt",
        "leadText",
        "coveringFor",
      ],
    ],
    [
      "UserOnCallShiftReassigned.hbs",
      ["scheduleName", "startsAt", "coveredBy"],
    ],
  ];

  test.each(ROWS)(
    "%s puts each of its values on plainText=",
    (filename: string, variables: Array<string>) => {
      const source: string = templateSource(filename);

      for (const name of variables) {
        expect({
          name,
          plainText: source.includes(`plainText=${name} `),
        }).toEqual({ name, plainText: true });
        expect(source).not.toMatch(new RegExp(`\\btext=${name}\\b`));
      }
    },
  );

  test.each(
    ROWS.map(([filename]: [string, Array<string>]) => {
      return filename;
    }),
  )("%s opens with its sentence as text", (filename: string) => {
    const source: string = templateSource(filename);

    expect(source).toContain("{{> InfoBlock plainInfo=description}}");
    expect(source).not.toContain("info=description");
  });

  test("the reminder's sentence names a schedule with markup as text", () => {
    const html: string = render("UserOnCallShiftReminder.hbs", {
      year: "2026",
      scheduleName: markupFor("scheduleName"),
      description: `Your on-call shift on ${markupFor("description")} starts in 1 hour.`,
      remainingText: "1 hour",
    });

    expect(html).toContain(escapedMarkupFor("description"));
    expect(html).not.toContain('<a href="https://evil.example/description"');
  });
});
