import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import UserNotificationEmailRollupItem from "Common/Models/DatabaseModels/UserNotificationEmailRollupItem";
import RollupCategory from "Common/Types/NotificationSetting/NotificationEmailRollupCategory";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import {
  RollupEmail,
  buildRollupEmail,
} from "Common/Server/Utils/EmailRollup/EmailRollupRenderer";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * NotificationRollup.hbs — the one email a flooded recipient gets instead of
 * the forty it replaces.
 *
 * It is rendered here with the EXACT vars buildRollupEmail produces, through
 * the same partials MailService registers, so a variable renamed on either
 * side shows up as an empty headline or a link pointing nowhere in this file
 * rather than in somebody's inbox.
 *
 * Three things this template must never do, each pinned below:
 *
 *  1. Call (concat ...). The helper MailService registers takes exactly TWO
 *     arguments and silently drops the rest, and two shipped templates are
 *     standing on that trap today (AlertEpisodeOwnerAlertAdded.hbs passes it
 *     five arguments on one line and nine on another). Every composed string
 *     in this email is therefore built in TypeScript, and the assertion here
 *     is that the template contains no concat call AT ALL.
 *  2. Put a raw value in a triple stache. InfoBlock renders {{{info}}} and
 *     TitleBlock renders {{{title}}} unescaped, so only pre-escaped ...Html
 *     vars may reach them.
 *  3. Read a variable the builder does not set. An unset variable renders as
 *     the empty string, which is how a headline silently disappears.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

type TemplateSourceFunction = (name: EmailTemplateType) => string;

const templateSource: TemplateSourceFunction = (
  name: EmailTemplateType,
): string => {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
};

type RenderFunction = (
  name: EmailTemplateType,
  vars: Dictionary<string | JSONObject>,
) => string;

const render: RenderFunction = (
  name: EmailTemplateType,
  vars: Dictionary<string | JSONObject>,
): string => {
  return Handlebars.compile(templateSource(name))({
    homeURL: "https://oneuptime.example.com",
    year: "2026",
    ...vars,
  });
};

const BASE_TIME_MS: number = Date.UTC(2026, 8, 3, 12, 0, 0);

interface ItemInput {
  offsetSeconds: number;
  subject: string;
  viewLink?: string | undefined;
  rollupCategory?: RollupCategory | undefined;
}

type MakeItemFunction = (input: ItemInput) => UserNotificationEmailRollupItem;

const makeItem: MakeItemFunction = (
  input: ItemInput,
): UserNotificationEmailRollupItem => {
  const item: UserNotificationEmailRollupItem =
    new UserNotificationEmailRollupItem();

  item.createdAt = new Date(BASE_TIME_MS + input.offsetSeconds * 1000);
  item.subject = input.subject;
  item.eventType =
    NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;
  item.rollupCategory = input.rollupCategory ?? RollupCategory.Incidents;

  if (input.viewLink !== undefined) {
    item.viewLink = input.viewLink;
  }

  return item;
};

const PROJECT_HOME_LINK: string =
  "https://oneuptime.example.com/dashboard/6560/home";
const PREFERENCES_LINK: string =
  "https://oneuptime.example.com/dashboard/6560/user-settings/notification-settings";
const INCIDENT_LINK: string =
  "https://oneuptime.example.com/dashboard/6560/incidents/i1";
const MONITOR_LINK: string =
  "https://oneuptime.example.com/dashboard/6560/monitors/m1";

type BuildFunction = (
  items: Array<UserNotificationEmailRollupItem>,
) => RollupEmail;

const build: BuildFunction = (
  items: Array<UserNotificationEmailRollupItem>,
): RollupEmail => {
  return buildRollupEmail({
    projectName: "Acme",
    projectHomeLink: PROJECT_HOME_LINK,
    preferencesLink: PREFERENCES_LINK,
    items: items,
  });
};

type StandardEmailFunction = () => RollupEmail;

const standardEmail: StandardEmailFunction = (): RollupEmail => {
  return build([
    makeItem({
      offsetSeconds: 0,
      subject: "Checkout is down",
      viewLink: INCIDENT_LINK,
    }),
    makeItem({
      offsetSeconds: 60,
      subject: "Checkout is down - acknowledged",
      viewLink: INCIDENT_LINK,
    }),
    makeItem({
      offsetSeconds: 120,
      subject: "api.acme.com is offline",
      viewLink: MONITOR_LINK,
      rollupCategory: RollupCategory.Monitors,
    }),
    makeItem({
      offsetSeconds: 180,
      subject: "Probe eu-west is disconnected",
      rollupCategory: RollupCategory.Probes,
    }),
  ]);
};

/*
 * Every variable a template reads, split by scope.
 *
 * Lifted from OnCallShiftReminderTemplates.test.ts, with three additions this
 * template needs and that one did not: block helpers other than {{#if}}
 * ({{#each rows}} and {{#ifCond a "b"}}), Handlebars data variables (@odd,
 * which no builder sets and no builder should), and `this.`-scoped paths,
 * which are fields of a row rather than top-level vars and are collected
 * separately so both halves can be pinned against the builder's output.
 */
interface TemplateVariableReferences {
  topLevel: Set<string>;
  rowScoped: Set<string>;
}

const PATH_PATTERN: RegExp = /[@A-Za-z_][A-Za-z0-9_.]*/g;

type ReferencedVariablesFunction = (
  source: string,
) => TemplateVariableReferences;

const referencedVariables: ReferencedVariablesFunction = (
  source: string,
): TemplateVariableReferences => {
  const topLevel: Set<string> = new Set<string>();
  const rowScoped: Set<string> = new Set<string>();

  type CollectFunction = (fragment: string) => void;

  const collect: CollectFunction = (fragment: string): void => {
    for (const token of fragment.match(PATH_PATTERN) || []) {
      if (token.startsWith("@") || token === "this" || token === "concat") {
        continue;
      }

      if (token.startsWith("this.")) {
        rowScoped.add(token.slice("this.".length));
        continue;
      }

      topLevel.add(token.split(".")[0]!);
    }
  };

  for (const match of source.matchAll(/\{\{([^}]*)\}\}/g)) {
    let inner: string = match[1]!.trim();

    if (inner.startsWith("/") || inner.startsWith("!") || inner === "else") {
      continue;
    }

    if (inner.startsWith("#") || inner.startsWith("^")) {
      // Drop the block helper name and any string literal arguments.
      inner = inner.replace(/^[#^]\w+\s*/, "");
      inner = inner.replace(/"[^"]*"/g, "");
      collect(inner);
      continue;
    }

    if (inner.startsWith(">")) {
      // Drop the partial name, string literals and parameter keys.
      inner = inner.replace(/^>\s*\S+/, "");
      inner = inner.replace(/"[^"]*"/g, "");
      inner = inner.replace(/\b\w+=/g, "");
      collect(inner);
      continue;
    }

    collect(inner);
  }

  return { topLevel: topLevel, rowScoped: rowScoped };
};

/*
 * The `concat` helper MailService registers takes exactly TWO arguments
 * (FeatureSet/Notification/Utils/Handlebars.ts) and silently drops the rest.
 * Lifted verbatim from OnCallShiftReminderTemplates.test.ts so the assertion
 * "this template contains no concat call" is made by the same parser that
 * catches the over-long calls elsewhere, rather than by a bare string search
 * that a reformatted template could slip past.
 */
const WHITESPACE: RegExp = /\s/;

type ConcatAritiesFunction = (source: string) => Array<number>;

const concatArities: ConcatAritiesFunction = (
  source: string,
): Array<number> => {
  const arities: Array<number> = [];
  const stripped: string = source.replace(/"[^"]*"/g, '"s"');

  for (const match of stripped.matchAll(/\(concat\b/g)) {
    let depth: number = 0;
    let args: number = 0;
    let inToken: boolean = false;

    for (let index: number = match.index!; index < stripped.length; index++) {
      const char: string = stripped[index]!;

      if (char === "(") {
        if (depth === 1) {
          args++;
        }
        depth++;
        inToken = false;
        continue;
      }

      if (char === ")") {
        depth--;
        if (depth === 0) {
          break;
        }
        continue;
      }

      if (depth === 1) {
        if (WHITESPACE.test(char)) {
          inToken = false;
        } else if (!inToken) {
          inToken = true;
          args++;
        }
      }
    }

    // The first token at depth 1 is the helper name itself.
    arities.push(args - 1);
  }

  return arities;
};

beforeAll(() => {
  // Mirrors FeatureSet/Notification/Utils/Handlebars.ts (see CompleteRegistrationTemplate.test.ts).
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

  Handlebars.registerHelper(
    "ifCond",
    function (v1: any, v2: any, options: any) {
      // @ts-expect-error - Handlebars uses dynamic this context for template helpers
      return v1 === v2 ? options.fn(this) : options.inverse(this);
    },
  );

  Handlebars.registerHelper(
    "ifNotCond",
    function (v1: any, v2: any, options: any) {
      // @ts-expect-error - Handlebars uses dynamic this context for template helpers
      return v1 !== v2 ? options.fn(this) : options.inverse(this);
    },
  );

  Handlebars.registerHelper("concat", (v1: any, v2: any) => {
    return v1 + v2;
  });
});

describe("EmailTemplateType", () => {
  test("names the rollup template, and the file exists", () => {
    /*
     * The enum value IS the filename. There is no manifest and no loader:
     * MailService resolves the template by this string, so a typo here is a
     * runtime "template not found" for every rollup, forever.
     */
    expect(EmailTemplateType.NotificationRollup).toBe("NotificationRollup.hbs");
    expect(
      fs.existsSync(
        Path.resolve(TEMPLATES_DIR, EmailTemplateType.NotificationRollup),
      ),
    ).toBe(true);
  });
});

describe("NotificationRollup.hbs rendered with the builder's own vars", () => {
  test("renders the headline, the intro and the category counts", () => {
    const email: RollupEmail = standardEmail();
    const html: string = render(
      EmailTemplateType.NotificationRollup,
      email.vars,
    );

    expect(html).toContain("4 notifications from Acme");
    expect(html).toContain("arrived in the last few minutes");
    expect(html).toContain("2 Incidents · 1 Monitors · 1 Probes");
  });

  test("renders every row title, and links only the rows that have a link", () => {
    const email: RollupEmail = standardEmail();
    const html: string = render(
      EmailTemplateType.NotificationRollup,
      email.vars,
    );

    expect(html).toContain("Probe eu-west is disconnected");
    expect(html).toContain("api.acme.com is offline");
    expect(html).toContain("Checkout is down - acknowledged");

    expect(html).toContain(`href="${INCIDENT_LINK}"`);
    expect(html).toContain(`href="${MONITOR_LINK}"`);

    // The folded incident is one row carrying its update count, not two rows.
    expect(html).toContain("2 updates");
    expect(html.split(INCIDENT_LINK).length - 1).toBe(1);
  });

  test("renders the button and the notification settings link", () => {
    const email: RollupEmail = standardEmail();
    const html: string = render(
      EmailTemplateType.NotificationRollup,
      email.vars,
    );

    expect(html).toContain("Open Project");
    expect(html).toContain(`href=${PROJECT_HOME_LINK}`);
    expect(html).toContain("Why did I get one email instead of several?");
    expect(html).toContain(`href="${PREFERENCES_LINK}"`);
    expect(html).toContain("user-settings/notification-settings");
  });

  test("leaves no unresolved mustache and no empty href", () => {
    const email: RollupEmail = standardEmail();
    const html: string = render(
      EmailTemplateType.NotificationRollup,
      email.vars,
    );

    expect(html).not.toContain("{{");
    expect(html).not.toContain('href=""');
  });

  test("does not carry the static unsubscribe partial it deliberately replaced", () => {
    const source: string = templateSource(EmailTemplateType.NotificationRollup);

    expect(source).not.toContain("UnsubscribeOwnerEmail");
  });
});

describe("NotificationRollup.hbs escaping", () => {
  test("a hostile row title renders escaped and never as a live tag", () => {
    const email: RollupEmail = build([
      makeItem({
        offsetSeconds: 0,
        subject: "<script>alert(1)</script>",
        viewLink: INCIDENT_LINK,
      }),
      makeItem({ offsetSeconds: 60, subject: "Something ordinary" }),
    ]);

    const html: string = render(
      EmailTemplateType.NotificationRollup,
      email.vars,
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("the pre-escaped vars survive the triple stache without double escaping", () => {
    const email: RollupEmail = standardEmail();
    const html: string = render(
      EmailTemplateType.NotificationRollup,
      email.vars,
    );

    /*
     * InfoBlock and TitleBlock render {{{info}}} and {{{title}}} unescaped,
     * so a value that had been escaped twice would show the reader a literal
     * "&amp;lt;" here.
     */
    expect(html).not.toContain("&amp;lt;");
    expect(html).not.toContain("&amp;#39;");
  });
});

describe("NotificationRollup.hbs hasMore tail", () => {
  type VarsWithFunction = (
    email: RollupEmail,
    overrides: Dictionary<string | JSONObject>,
  ) => Dictionary<string | JSONObject>;

  const varsWith: VarsWithFunction = (
    email: RollupEmail,
    overrides: Dictionary<string | JSONObject>,
  ): Dictionary<string | JSONObject> => {
    return { ...email.vars, ...overrides };
  };

  test("the tail is rendered only when hasMore is the string 'true'", () => {
    const email: RollupEmail = standardEmail();

    const shown: string = render(
      EmailTemplateType.NotificationRollup,
      varsWith(email, {
        hasMore: "true",
        moreTextHtml: "50 more updates are not listed here.",
      }),
    );

    expect(shown).toContain("50 more updates are not listed here.");

    const hidden: string = render(
      EmailTemplateType.NotificationRollup,
      varsWith(email, {
        hasMore: "false",
        moreTextHtml: "50 more updates are not listed here.",
      }),
    );

    expect(hidden).not.toContain("50 more updates are not listed here.");
  });

  test("a real oversized rollup renders its own tail", () => {
    const items: Array<UserNotificationEmailRollupItem> = [];

    for (let index: number = 0; index < 130; index++) {
      items.push(
        makeItem({
          offsetSeconds: index * 60,
          subject: `Event ${index}`,
          viewLink: `https://oneuptime.example.com/dashboard/6560/r/${index}`,
        }),
      );
    }

    const html: string = render(
      EmailTemplateType.NotificationRollup,
      build(items).vars,
    );

    expect(html).toContain("30 more updates");
    expect(html).toContain("covering 30 notifications");
  });
});

describe("NotificationRollup.hbs source rules", () => {
  test("contains no (concat ...) call at all", () => {
    expect(
      concatArities(templateSource(EmailTemplateType.NotificationRollup)),
    ).toEqual([]);
  });

  test("the parser that says so does catch a concat call when there is one", () => {
    expect(
      concatArities(
        '{{> EmailTitle title=(concat "a " scheduleName " b " remainingText) }}',
      ),
    ).toEqual([4]);
    expect(concatArities('{{> EmailTitle title=(concat "a " b) }}')).toEqual([
      2,
    ]);
  });

  test("reads only top-level variables the builder sets", () => {
    const references: TemplateVariableReferences = referencedVariables(
      templateSource(EmailTemplateType.NotificationRollup),
    );
    const email: RollupEmail = standardEmail();

    expect(Array.from(references.topLevel).sort()).toEqual(
      [
        "categoryCountsHtml",
        "hasMore",
        "moreTextHtml",
        "preferencesHtml",
        "preferencesLink",
        "projectHomeLink",
        "rollupIntroHtml",
        "rollupTitle",
        "rows",
      ].sort(),
    );

    for (const name of references.topLevel) {
      expect(Object.keys(email.vars)).toContain(name);
    }
  });

  test("reads only row fields the builder sets", () => {
    const references: TemplateVariableReferences = referencedVariables(
      templateSource(EmailTemplateType.NotificationRollup),
    );
    const email: RollupEmail = standardEmail();
    const rows: Array<JSONObject> = email.vars[
      "rows"
    ] as unknown as Array<JSONObject>;

    expect(Array.from(references.rowScoped).sort()).toEqual(
      ["hasLink", "link", "title", "updatesLabel"].sort(),
    );

    for (const name of references.rowScoped) {
      expect(Object.keys(rows[0]!)).toContain(name);
    }
  });
});
