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
 *  2. Put a raw value in a triple stache, or a pre-escaped one in a double.
 *     InfoBlock renders {{{info}}} and TitleBlock renders {{{title}}}
 *     unescaped, so only pre-escaped ...Html vars may reach them; EmailTitle
 *     renders {{title}} escaped, so only raw vars may reach that. Both
 *     mistakes are silent, and the fixture below therefore carries every
 *     character escaping touches - a fixture without one cannot tell the two
 *     wirings apart at all.
 *  3. Read a variable the builder does not set - top level OR inside a row.
 *     An unset variable renders as the empty string, which is how a headline
 *     silently disappears and how `background-color: ;` gets shipped.
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
  projectName?: string,
) => RollupEmail;

const build: BuildFunction = (
  items: Array<UserNotificationEmailRollupItem>,
  projectName: string = "Acme",
): RollupEmail => {
  return buildRollupEmail({
    projectName: projectName,
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

type ZebraEmailFunction = (rowCount: number) => RollupEmail;

/*
 * One item per row, each with its own link so nothing folds. Five rows is the
 * smallest count that distinguishes "alternating" from "only the second row
 * is striped" and from "only the last row is striped".
 */
const zebraEmail: ZebraEmailFunction = (rowCount: number): RollupEmail => {
  const items: Array<UserNotificationEmailRollupItem> = [];

  for (let index: number = 0; index < rowCount; index++) {
    items.push(
      makeItem({
        offsetSeconds: index * 60,
        subject: `Event ${index}`,
        viewLink: `https://oneuptime.example.com/dashboard/6560/r/${index}`,
      }),
    );
  }

  return build(items);
};

type RenderedRowBackgroundsFunction = (html: string) => Array<string>;

/*
 * The colour of every body row, in render order. Reads the attribute the
 * template actually emits rather than searching for the two hex strings, so
 * a row whose colour came out EMPTY - the shape of the bug this replaces -
 * is captured as "" and fails a comparison instead of being invisible.
 */
const renderedRowBackgrounds: RenderedRowBackgroundsFunction = (
  html: string,
): Array<string> => {
  const found: Array<string> = [];

  for (const match of html.matchAll(
    /<tr style="background-color: ([^;"]*);">/g,
  )) {
    found.push(match[1]!);
  }

  return found;
};

/*
 * Every variable a template reads, split by scope.
 *
 * Lifted from OnCallShiftReminderTemplates.test.ts, with three additions this
 * template needs and that one did not: block helpers other than {{#if}}
 * ({{#each rows}} and {{#ifCond a "b"}}), Handlebars data variables (@index
 * and friends, which no builder sets and which this template is separately
 * forbidden from using at all), and `this.`-scoped paths, which are fields of
 * a row rather than top-level vars and are collected separately so BOTH
 * halves can be pinned against the builder's output. A row field is the half
 * that was missing when the zebra stripe rotted.
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
    expect(html).toContain(
      "OneUptime grouped these 4 notifications from Acme into a single email",
    );

    /* The summary card: the count, the window it covers, and the breakdown. */
    expect(html).toContain("4 notifications");
    expect(html).toContain("12:00 UTC to 12:03 UTC");
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
    expect(html).toContain("2 updates · latest 12:01 UTC");
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
  /*
   * Every character escaping touches - & < > " and ' - in both a project name
   * and a row title, because a fixture missing them cannot distinguish the
   * two wirings: with nothing to escape, "raw" and "pre-escaped" are the same
   * bytes and every assertion about them holds either way round.
   */
  const HOSTILE_PROJECT: string = "A&B <\"Corp\"> 'Ltd'";
  const HOSTILE_SUBJECT: string =
    "Disk \"sda1\" > 90% & <b>hot</b> at 'eu-west'";

  /*
   * The same project name, escaped ONCE, by each of the two escapers. They
   * differ only on the apostrophe, and that single difference is what lets
   * one assertion name the headline and another name the intro:
   *
   *   escapeHtml (TypeScript, for triple staches) -> &#39;
   *   Handlebars.escapeExpression (double staches) -> &#x27;
   */
  const PROJECT_ESCAPED_BY_BUILDER: string =
    "A&amp;B &lt;&quot;Corp&quot;&gt; &#39;Ltd&#39;";
  const PROJECT_ESCAPED_BY_HANDLEBARS: string =
    "A&amp;B &lt;&quot;Corp&quot;&gt; &#x27;Ltd&#x27;";
  const SUBJECT_ESCAPED_BY_HANDLEBARS: string =
    "Disk &quot;sda1&quot; &gt; 90% &amp; &lt;b&gt;hot&lt;/b&gt; at &#x27;eu-west&#x27;";

  type HostileHtmlFunction = () => string;

  const hostileHtml: HostileHtmlFunction = (): string => {
    return render(
      EmailTemplateType.NotificationRollup,
      build(
        [
          makeItem({
            offsetSeconds: 0,
            subject: HOSTILE_SUBJECT,
            viewLink: INCIDENT_LINK,
          }),
          makeItem({ offsetSeconds: 60, subject: "Something ordinary" }),
        ],
        HOSTILE_PROJECT,
      ).vars,
    );
  };

  test("a var the template feeds to a DOUBLE stache arrives RAW and is escaped once here", () => {
    const html: string = hostileHtml();

    /*
     * rollupTitle reaches EmailTitle's {{title}} and rows[].title reaches
     * {{this.title}}. Both must be raw in the vars, so what lands in the HTML
     * is Handlebars' own encoding - &#x27; for the apostrophe - applied once.
     * Pre-escape either one in the builder and these read &amp;amp;B instead.
     */
    expect(html).toContain(
      `2 notifications from ${PROJECT_ESCAPED_BY_HANDLEBARS}`,
    );
    expect(html).toContain(SUBJECT_ESCAPED_BY_HANDLEBARS);
  });

  test("a var the template feeds to a TRIPLE stache arrives PRE-ESCAPED and is not escaped again", () => {
    const html: string = hostileHtml();

    /*
     * rollupIntroHtml reaches InfoBlock's {{{info}}}, which does not escape.
     * The builder's own encoding - &#39; for the apostrophe - therefore has
     * to be what is already in the string. Hand that stache a raw value and
     * the assertion below fails while the page quietly grows a live <b> tag.
     */
    expect(html).toContain(PROJECT_ESCAPED_BY_BUILDER);
  });

  test("nothing reaches the recipient unescaped", () => {
    const html: string = hostileHtml();

    expect(html).not.toContain(HOSTILE_PROJECT);
    expect(html).not.toContain(HOSTILE_SUBJECT);
    expect(html).not.toContain("<b>hot</b>");
    expect(html).not.toContain('A&B <"Corp">');
  });

  test("and nothing reaches the recipient escaped twice", () => {
    const html: string = hostileHtml();

    /*
     * The other direction, and the one that used to be untestable here: a
     * value escaped in TypeScript and then escaped again by a double stache
     * shows the reader a literal "&amp;lt;" where a "<" belongs.
     */
    expect(html).not.toContain("&amp;amp;");
    expect(html).not.toContain("&amp;lt;");
    expect(html).not.toContain("&amp;gt;");
    expect(html).not.toContain("&amp;quot;");
    expect(html).not.toContain("&amp;#39;");
    expect(html).not.toContain("&amp;#x27;");
  });

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
});

describe("NotificationRollup.hbs zebra striping", () => {
  /*
   * The stripe used to be {{#if @odd}} in the template. Handlebars defines
   * @index, @first, @last, @key, @root and @level - never @odd - and an
   * unknown @-variable resolves to undefined rather than raising, so the
   * condition was false on every row and a hundred-row table rendered as one
   * flat wall of white. The colour is a builder field now; both sides of that
   * handshake are pinned, because pinning only one leaves the same hole.
   */
  test("a multi-row rollup renders BOTH colours, alternating from the first row", () => {
    const html: string = render(
      EmailTemplateType.NotificationRollup,
      zebraEmail(5).vars,
    );

    expect(html).toContain("background-color: #ffffff;");
    expect(html).toContain("background-color: #f7f9fc;");

    expect(renderedRowBackgrounds(html)).toEqual([
      "#ffffff",
      "#f7f9fc",
      "#ffffff",
      "#f7f9fc",
      "#ffffff",
    ]);
  });

  test("the colours in the HTML are exactly the ones the builder emitted", () => {
    const email: RollupEmail = zebraEmail(6);
    const html: string = render(
      EmailTemplateType.NotificationRollup,
      email.vars,
    );
    const rows: Array<JSONObject> = email.vars[
      "rows"
    ] as unknown as Array<JSONObject>;

    expect(renderedRowBackgrounds(html)).toEqual(
      rows.map((row: JSONObject): unknown => {
        return row["rowBackground"];
      }),
    );
  });

  test("the real four-notification rollup puts its three folded rows in three sections, each starting white", () => {
    /*
     * One incident (two notifications folded), one monitor, one probe: three
     * categories, so three sections of one row each, and the stripe restarts
     * in every one of them. A stripe that ran across section boundaries would
     * read as a pattern underneath the headings rather than as part of them.
     */
    const html: string = render(
      EmailTemplateType.NotificationRollup,
      standardEmail().vars,
    );

    expect(renderedRowBackgrounds(html)).toEqual([
      "#ffffff",
      "#ffffff",
      "#ffffff",
    ]);
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
        "categoryCounts",
        "hasMore",
        "moreTextHtml",
        "preferencesHtml",
        "preferencesLink",
        "projectHomeLink",
        "rollupIntroHtml",
        "rollupTitle",
        "rows",
        "summaryCount",
        "summaryWindow",
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

    /*
     * rowBackground belongs in this list and not in the top-level one: it is
     * read as {{this.rowBackground}} inside {{#each rows}}, so the builder
     * has to set it on every ROW, and a top-level var of the same name would
     * not be found. It is also the field with the nastiest failure mode - it
     * sits inside a style attribute, so unset renders `background-color: ;`
     * and the declaration is discarded rather than merely looking wrong.
     */
    expect(Array.from(references.rowScoped).sort()).toEqual(
      [
        "hasLink",
        "isSectionStart",
        "link",
        "metaLabel",
        "rowBackground",
        "sectionCount",
        "sectionLabel",
        "title",
      ].sort(),
    );

    /*
     * EVERY row, not just the first. rowBackground is the one field whose
     * value depends on the row's index, so a builder that set it on some
     * rows and not others would satisfy a first-row-only check and still
     * ship a table with holes in it.
     */
    for (const row of rows) {
      for (const name of references.rowScoped) {
        expect(Object.keys(row)).toContain(name);
      }
    }
  });

  test("uses no Handlebars @-variable, because an unknown one is silently undefined", () => {
    /*
     * The stripe shipped as {{#if @odd}}. Handlebars defines @index, @first,
     * @last, @key, @root and @level, and resolves anything else to undefined
     * without complaint, so that block was dead from the first render. The
     * analysis above deliberately IGNORES @-tokens - it cannot check them
     * against the builder, because no builder sets them - which means a
     * second rule is needed to stop one creeping back: this template composes
     * every per-row value in TypeScript and needs no @-variable at all.
     */
    expect(
      templateSource(EmailTemplateType.NotificationRollup).match(
        /\{\{[^}]*@[A-Za-z_]/g,
      ),
    ).toBeNull();
  });
});

describe("NotificationRollup.hbs sections", () => {
  type SectionHeadingsFunction = (html: string) => Array<string>;

  /*
   * The heading cells as they actually render, in document order. Read out of
   * the HTML rather than out of the vars, because the heading is emitted by a
   * {{#ifCond this.isSectionStart "true"}} block: a builder that flags every
   * row, or none, is invisible in the vars and obvious here.
   */
  const sectionHeadings: SectionHeadingsFunction = (
    html: string,
  ): Array<string> => {
    const found: Array<string> = [];

    for (const match of html.matchAll(
      /text-transform: uppercase; color: #6b7280;">([^<]*)<\/td>\s*<td align="right"[^>]*>([^<]*)<\/td>/g,
    )) {
      found.push(`${match[1]!.trim()} ${match[2]!.trim()}`);
    }

    return found;
  };

  type MixedHtmlFunction = () => string;

  const mixedHtml: MixedHtmlFunction = (): string => {
    return render(
      EmailTemplateType.NotificationRollup,
      build([
        makeItem({
          offsetSeconds: 0,
          subject: "Probe eu-west is disconnected",
          rollupCategory: RollupCategory.Probes,
        }),
        makeItem({
          offsetSeconds: 60,
          subject: "api.acme.com is offline",
          viewLink: MONITOR_LINK,
          rollupCategory: RollupCategory.Monitors,
        }),
        makeItem({
          offsetSeconds: 120,
          subject: "Checkout is down",
          viewLink: INCIDENT_LINK,
        }),
        makeItem({
          offsetSeconds: 180,
          subject: "Checkout is down - acknowledged",
          viewLink: INCIDENT_LINK,
        }),
      ]).vars,
    );
  };

  test("renders one heading per category, in the builder's order, with its update count", () => {
    expect(sectionHeadings(mixedHtml())).toEqual([
      "Incidents 2 updates",
      "Monitors 1 update",
      "Probes 1 update",
    ]);
  });

  test("the headings are the only rows without a title, and every other row has one", () => {
    const html: string = mixedHtml();

    /* Three headings, three data rows: no row rendered twice, none dropped. */
    expect(sectionHeadings(html)).toHaveLength(3);
    expect(renderedRowBackgrounds(html)).toHaveLength(3);
  });

  test("each row renders its own meta line under its title", () => {
    const html: string = mixedHtml();

    expect(html).toContain("2 updates · latest 12:03 UTC");
    expect(html).toContain("12:01 UTC");
    expect(html).toContain("12:00 UTC");
  });

  test("a rollup with one category renders exactly one heading", () => {
    const html: string = render(
      EmailTemplateType.NotificationRollup,
      build([
        makeItem({ offsetSeconds: 0, subject: "a", viewLink: INCIDENT_LINK }),
        makeItem({
          offsetSeconds: 60,
          subject: "b",
          viewLink: `${INCIDENT_LINK}-2`,
        }),
      ]).vars,
    );

    expect(sectionHeadings(html)).toEqual(["Incidents 2 updates"]);
  });

  test("a heading label is escaped by the double stache it is rendered through", () => {
    /*
     * The labels shipped today contain nothing to escape, which is exactly
     * why this is worth pinning: the day somebody adds a category called
     * "Monitors & Probes", the heading must not become live markup. Feeding
     * the row field directly is the only way to test the wiring rather than
     * today's data.
     */
    const email: RollupEmail = build([
      makeItem({ offsetSeconds: 0, subject: "a" }),
    ]);
    const rows: Array<JSONObject> = email.vars[
      "rows"
    ] as unknown as Array<JSONObject>;

    rows[0]!["sectionLabel"] = "<b>Monitors & Probes</b>";

    const html: string = render(EmailTemplateType.NotificationRollup, {
      ...email.vars,
      rows: rows as unknown as JSONObject,
    });

    expect(html).toContain("&lt;b&gt;Monitors &amp; Probes&lt;/b&gt;");
    expect(html).not.toContain("<b>Monitors");
  });
});

describe("NotificationRollup.hbs summary card", () => {
  test("renders the count, the window and the category breakdown", () => {
    const html: string = render(
      EmailTemplateType.NotificationRollup,
      standardEmail().vars,
    );

    expect(html).toContain(">4 notifications</div>");
    expect(html).toContain(">12:00 UTC to 12:03 UTC</div>");
    expect(html).toContain(">2 Incidents · 1 Monitors · 1 Probes</div>");
  });

  test("an empty window renders no empty line at all", () => {
    const email: RollupEmail = standardEmail();

    const html: string = render(EmailTemplateType.NotificationRollup, {
      ...email.vars,
      summaryWindow: "",
    });

    expect(html).not.toContain("UTC to");
    expect(html).not.toContain('padding-top: 4px;"></div>');
    /* The rest of the card still renders. */
    expect(html).toContain(">4 notifications</div>");
  });

  test("the card's count and the headline agree", () => {
    const email: RollupEmail = standardEmail();
    const html: string = render(
      EmailTemplateType.NotificationRollup,
      email.vars,
    );

    expect(html).toContain("4 notifications from Acme");
    expect(html).toContain(">4 notifications</div>");
  });
});
