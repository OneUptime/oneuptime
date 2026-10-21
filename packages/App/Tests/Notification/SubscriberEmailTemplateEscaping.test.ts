import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import ObjectID from "Common/Types/ObjectID";
import StatusPageResourceUtil from "Common/Server/Utils/StatusPageResource";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * THE ESCAPING CONTRACT FOR THE DEFAULT SUBSCRIBER EMAILS.
 *
 * Status page subscribers are often outside the organisation, and they trust
 * these emails. Every value the subscriber jobs hand these templates is one
 * of two kinds:
 *
 *   - HTML the job produced itself: Markdown rendered by
 *     Markdown.convertToHTML (descriptions, notes, the postmortem), the
 *     multi-timezone date HTML, and the resource list from
 *     StatusPageResourceUtil.getResourcesGroupedByGroupName, which escapes
 *     every name. These go in a raw slot (DetailBoxField text=/blockText=).
 *   - plain text a project member typed: incident, episode, maintenance and
 *     announcement titles, severity and state names, the status page name.
 *     These go through escaped output (DetailBoxField plainText=, InfoBlock
 *     plainInfo=, EmailTitle's {{title}}), so a title such as
 *     `<a href="https://evil.example">Reset your password</a>` reads as
 *     those characters instead of becoming a live link.
 *
 * The one exception is the footer text, which the status page's admins
 * write for their own emails, as they write custom templates.
 *
 * Every Subscriber*.hbs on disk is checked, so a new one is covered the day
 * it is added.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const SUBSCRIBER_TEMPLATE_FILE: RegExp = /^Subscriber.*\.hbs$/;

const SUBSCRIBER_TEMPLATES: Array<string> = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((filename: string): boolean => {
    return SUBSCRIBER_TEMPLATE_FILE.test(filename);
  })
  .sort();

/*
 * The values the jobs pass as HTML. Only these may reach a raw slot, and a
 * job must only ever pass them the HTML producers listed above.
 */
const HTML_VARIABLES: ReadonlyArray<string> = [
  "resourcesAffected",
  "incidentDescription",
  "episodeDescription",
  "eventDescription",
  "announcementDescription",
  "note",
  "postmortemNote",
  "scheduledAt",
  "subscriberEmailNotificationFooterText",
];

// Everything else a subscriber template reads is plain text.
const PLAIN_VARIABLES: ReadonlyArray<string> = [
  "statusPageName",
  "emailTitle",
  "announcementTitle",
  "incidentTitle",
  "incidentSeverity",
  "incidentState",
  "episodeTitle",
  "episodeSeverity",
  "episodeState",
  "eventTitle",
  "eventState",
];

// Rendered into attributes (href, src) by double-stash partials.
const URL_VARIABLES: ReadonlyArray<string> = [
  "statusPageUrl",
  "detailsUrl",
  "unsubscribeUrl",
  "logoUrl",
];

const handlebars: typeof Handlebars = Handlebars.create();

function templateSource(filename: string): string {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, filename), "utf8");
}

function render(filename: string, variables: Record<string, string>): string {
  return handlebars.compile(templateSource(filename))(variables);
}

// A payload that is a live element if it is not escaped, unique per variable.
function markupFor(name: string): string {
  return `<a href="https://evil.example/${name}">${name}</a><script>steal("${name}")</script>`;
}

// How Handlebars' escaping (which also escapes "=") shows markupFor.
function escapedMarkupFor(name: string): string {
  return `&lt;a href&#x3D;&quot;https://evil.example/${name}&quot;&gt;`;
}

// HTML a job really produces, unique per variable, which must survive as HTML.
function htmlFor(name: string): string {
  return `<p data-html="${name}"><strong>${name}</strong></p>`;
}

function hostileVariables(): Record<string, string> {
  const variables: Record<string, string> = { year: "2026" };

  for (const name of PLAIN_VARIABLES) {
    variables[name] = markupFor(name);
  }

  for (const name of HTML_VARIABLES) {
    variables[name] = htmlFor(name);
  }

  for (const name of URL_VARIABLES) {
    variables[name] =
      `https://status.example.com/${name}" onmouseover="steal('${name}')`;
  }

  return variables;
}

// Does the template (or a partial it passes `this` to) read this variable?
function readsVariable(source: string, name: string): boolean {
  if (new RegExp(`\\b${name}\\b`).test(source)) {
    return true;
  }

  // CustomLogo reads statusPageName and the URLs from `this`.
  return (
    source.includes("{{> CustomLogo this}}") &&
    ["statusPageName", "logoUrl", "statusPageUrl"].includes(name)
  );
}

beforeAll(() => {
  const partialsDir: string = Path.join(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    if (filename.endsWith(".hbs")) {
      handlebars.registerPartial(
        filename.slice(0, -4),
        fs.readFileSync(Path.join(partialsDir, filename), "utf8"),
      );
    }
  }

  // Same semantics as App/FeatureSet/Notification/Utils/Handlebars.ts.
  handlebars.registerHelper("concat", (...args: Array<unknown>): string => {
    return args
      .slice(0, -1)
      .map((value: unknown): string => {
        return value === null || value === undefined ? "" : String(value);
      })
      .join("");
  });

  handlebars.registerHelper(
    "ifCond",
    function (
      this: unknown,
      v1: unknown,
      v2: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return v1 === v2 ? options.fn(this) : options.inverse(this);
    },
  );
});

describe("default subscriber email templates", () => {
  test("the suite sees every subscriber template", () => {
    expect(SUBSCRIBER_TEMPLATES).toEqual(
      expect.arrayContaining([
        "SubscriberAnnouncementCreated.hbs",
        "SubscriberAnnouncementUpdated.hbs",
        "SubscriberEpisodeCreated.hbs",
        "SubscriberEpisodeNoteCreated.hbs",
        "SubscriberEpisodeNoteUpdated.hbs",
        "SubscriberEpisodeStateChanged.hbs",
        "SubscriberIncidentCreated.hbs",
        "SubscriberIncidentNoteCreated.hbs",
        "SubscriberIncidentNoteUpdated.hbs",
        "SubscriberIncidentPostmortemCreated.hbs",
        "SubscriberIncidentStateChanged.hbs",
        "SubscriberScheduledMaintenanceEventCreated.hbs",
        "SubscriberScheduledMaintenanceEventNoteCreated.hbs",
        "SubscriberScheduledMaintenanceEventNoteUpdated.hbs",
        "SubscriberScheduledMaintenanceEventStateChanged.hbs",
      ]),
    );
  });

  /*
   * A source-level ratchet: every raw slot in a subscriber template carries
   * one of the HTML variables, or text written into the template itself. A
   * new row put on `text=` with a title would pass every rendering check
   * that does not happen to set that title to markup; this does not.
   */
  test.each(SUBSCRIBER_TEMPLATES)(
    "%s puts only HTML variables in a raw slot",
    (filename: string) => {
      const source: string = templateSource(filename);
      const problems: Array<string> = [];

      for (const match of source.matchAll(
        /\b(text|blockText|info)=(\([^)]*\)|"[^"]*"|[\w.]+)/g,
      )) {
        const slot: string = match[1]!;
        const value: string = match[2]!;

        if (value.startsWith('"')) {
          // Text written into the template. Only InfoBlock prose may be raw.
          if (slot !== "info") {
            problems.push(`${slot}=${value} (put literal text on plainText=)`);
          }
          continue;
        }

        const variables: Array<string> = value.startsWith("(")
          ? Array.from(
              value.slice(1, -1).matchAll(/(?:^|\s)([A-Za-z][\w.]*)/g),
              (argument: RegExpMatchArray): string => {
                return argument[1]!;
              },
            ).filter((argument: string): boolean => {
              return argument !== "concat";
            })
          : [value];

        for (const variable of variables) {
          if (!HTML_VARIABLES.includes(variable)) {
            problems.push(`${slot}=${value}`);
          }
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test.each(SUBSCRIBER_TEMPLATES)(
    "%s shows every plain value as text, never as markup",
    (filename: string) => {
      const source: string = templateSource(filename);
      const html: string = render(filename, hostileVariables());

      expect(html).not.toContain("<script");
      expect(html).not.toContain('href="https://evil.example');
      expect(html).not.toContain('<a href="https://evil');

      const readPlainVariables: Array<string> = PLAIN_VARIABLES.filter(
        (name: string): boolean => {
          return readsVariable(source, name);
        },
      );

      // Every template shows at least its title and the status page name.
      expect(readPlainVariables.length).toBeGreaterThanOrEqual(2);

      for (const name of readPlainVariables) {
        expect({ name, shown: html.includes(escapedMarkupFor(name)) }).toEqual({
          name,
          shown: true,
        });
        expect(html).not.toContain(`<a href="https://evil.example/${name}"`);
      }
    },
  );

  test.each(SUBSCRIBER_TEMPLATES)(
    "%s keeps a URL inside its attribute",
    (filename: string) => {
      const html: string = render(filename, hostileVariables());

      expect(html).not.toMatch(/"\s*onmouseover="/);
      expect(html).not.toContain(`onmouseover="steal`);
    },
  );

  test.each(SUBSCRIBER_TEMPLATES)(
    "%s still renders the HTML values as HTML",
    (filename: string) => {
      const source: string = templateSource(filename);
      const html: string = render(filename, hostileVariables());

      for (const name of HTML_VARIABLES) {
        if (!readsVariable(source, name)) {
          continue;
        }

        expect({ name, rendered: html.includes(htmlFor(name)) }).toEqual({
          name,
          rendered: true,
        });
      }
    },
  );

  /*
   * The same promise end to end, with the real producers: a resource list
   * built from hostile resource and group names, and a note rendered from
   * Markdown that tries raw HTML and a javascript: link.
   */
  describe("with the real resource list and Markdown", () => {
    function resource(
      displayName: string,
      groupName?: string,
    ): StatusPageResource {
      const row: StatusPageResource = new StatusPageResource();
      row._id = ObjectID.generate().toString();
      row.displayName = displayName;

      if (groupName) {
        row.statusPageGroupId = ObjectID.generate();
        const group: StatusPageGroup = new StatusPageGroup();
        group.name = groupName;
        row.statusPageGroup = group;
      }

      return row;
    }

    test("resource and group names are escaped and the groups stay on their own lines", async () => {
      const resourcesAffected: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName([
          resource('<a href="https://evil.example">Checkout</a>', "EU"),
          resource("API", '<img src=x onerror="alert(1)">'),
          resource(`Payments "Core" & 'Ledger'`),
        ]);

      const html: string = render("SubscriberIncidentCreated.hbs", {
        ...hostileVariables(),
        resourcesAffected: resourcesAffected,
        incidentDescription: await Markdown.convertToHTML(
          "Card payments **fail**.",
          MarkdownContentType.Email,
        ),
      });

      expect(html).toContain(
        "EU: &lt;a href=&quot;https://evil.example&quot;&gt;Checkout&lt;/a&gt;<br/>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;: API<br/>Payments &quot;Core&quot; &amp; &#39;Ledger&#39;",
      );
      expect(html).not.toContain('<a href="https://evil.example"');
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("<strong>fail</strong>");
    });

    test("a note's raw HTML and javascript: link are neutralised", async () => {
      const note: string = await Markdown.convertToHTML(
        'Update <img src=x onerror="alert(1)"> [Reset password](javascript:alert(1)) and [status](https://status.example.com)',
        MarkdownContentType.Email,
      );

      for (const filename of [
        "SubscriberIncidentNoteCreated.hbs",
        "SubscriberEpisodeNoteUpdated.hbs",
        "SubscriberScheduledMaintenanceEventNoteCreated.hbs",
      ]) {
        const html: string = render(filename, {
          ...hostileVariables(),
          note: note,
        });

        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("Reset password");
        expect(html).toContain(
          '<a href="https://status.example.com">status</a>',
        );
      }
    });
  });
});
