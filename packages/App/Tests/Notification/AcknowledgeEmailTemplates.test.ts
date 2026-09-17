import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `concat` / `ifCond` helpers as an import
 * side effect, so this suite renders with the helpers the product ships.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * THE FOUR PAGE-OUT EMAILS.
 *
 * These are what an on-call responder is woken up by, and they were the
 * last email family still passing every detail row through DetailBoxField's
 * RAW `text` slot. Two consequences, both visible in a real inbox:
 *
 *  1. `rootCause` is a Markdown column — MonitorCriteriaEvaluator writes
 *     "**Filter Conditions Met**: ..." into it, and for a metric monitor a
 *     "| Timestamp | Metric | Alias | Value |" table underneath. Passed
 *     raw, the responder read literal asterisks and literal pipe rows.
 *  2. Titles, state names, severities and resource names are free text a
 *     project member typed. In a raw slot they are live HTML in an email
 *     the recipient trusts — the precise hole DetailBoxField's `plainText`
 *     branch was added to close, and which these four never adopted.
 *
 * A third defect had no visible symptom at all: AcknowledgeAlert.hbs asks
 * for a Root Cause row and its generator never set the variable, so
 * `{{#if}}` silently dropped it. The person being paged for the alert was
 * the only one who could not see why it fired.
 */

const NOTIFICATION_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
);

const TEMPLATES_DIR: string = Path.resolve(NOTIFICATION_DIR, "Templates");

/** A metric-monitor root cause, as the evaluator actually writes it. */
const ROOT_CAUSE_HTML: string = [
  "<p><strong>Filter Conditions Met</strong>: Metric Value is 1.07 GB",
  " which is greater than 1 GB.</p>",
  '<table cellpadding="0" cellspacing="0" border="0" width="100%"',
  ' style="border-collapse:collapse;"><thead><tr>',
  '<th style="padding:8px 10px;">Timestamp</th>',
  '<th style="padding:8px 10px;">Value</th>',
  "</tr></thead><tbody><tr>",
  '<td style="padding:8px 10px;">2026-08-14T10:30:00.000Z</td>',
  '<td style="padding:8px 10px;">1.07 GB</td>',
  "</tr></tbody></table>",
].join("");

const HOSTILE: string = '<img src=x onerror="alert(1)">';

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
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/u);

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

interface AcknowledgeTemplate {
  file: string;
  titleVar: string;
  severityVar: string;
  descriptionVar: string;
}

const TEMPLATES: Array<AcknowledgeTemplate> = [
  {
    file: "AcknowledgeAlert.hbs",
    titleVar: "alertTitle",
    severityVar: "alertSeverity",
    descriptionVar: "alertDescription",
  },
  {
    file: "AcknowledgeIncident.hbs",
    titleVar: "incidentTitle",
    severityVar: "incidentSeverity",
    descriptionVar: "incidentDescription",
  },
  {
    file: "AcknowledgeAlertEpisode.hbs",
    titleVar: "alertEpisodeTitle",
    severityVar: "alertEpisodeSeverity",
    descriptionVar: "alertEpisodeDescription",
  },
  {
    file: "AcknowledgeIncidentEpisode.hbs",
    titleVar: "incidentEpisodeTitle",
    severityVar: "incidentEpisodeSeverity",
    descriptionVar: "incidentEpisodeDescription",
  },
];

function varsFor(
  template: AcknowledgeTemplate,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    [template.titleVar]: "Pod CPU saturating limit",
    [template.severityVar]: "Critical",
    [template.descriptionVar]: "<p>A pod is over its CPU limit.</p>",
    currentState: "Created",
    resourcesAffected: "web-7d9f",
    projectName: "acme-prod",
    rootCause: ROOT_CAUSE_HTML,
    alertNumber: "ALT-113",
    incidentNumber: "INC-9",
    episodeNumber: "EP-4",
    alertsCount: "2",
    incidentsCount: "2",
    alertsList: "",
    incidentsList: "",
    ...overrides,
  };
}

describe("the acknowledge emails render the root cause as HTML", () => {
  for (const template of TEMPLATES) {
    test(`${template.file} renders root-cause markup, not literal markdown`, () => {
      const html: string = render(template.file, varsFor(template));

      expect(html).toContain("<strong>Filter Conditions Met</strong>");
      expect(html).toContain("<table");
      expect(html).toContain("1.07 GB");

      // What the responder used to read instead.
      expect(html).not.toContain("**Filter Conditions Met**");
      expect(html).not.toContain("| Timestamp | Metric | Alias | Value |");
    });

    /*
     * The <table> arrives inside a DetailBoxField. On the `text` slot that
     * meant <p><table>…</table></p>, which every mail client repairs by
     * closing the paragraph early — dropping the table out of the styled
     * value box. `blockText` renders a <div>, where it nests legally.
     */
    test(`${template.file} puts block content in a div, never a p`, () => {
      const html: string = render(template.file, varsFor(template));

      expect(html).toMatch(
        /<div[^>]*class="[^"]*\bst-DetailCard-value\b[^"]*"[^>]*>\s*<p>/u,
      );
      expect(html).not.toMatch(
        /<p[^>]*class="[^"]*\bst-DetailCard-value\b[^"]*"[^>]*>\s*<p>/u,
      );
      expect(html).not.toMatch(
        /<p[^>]*class="[^"]*\bst-DetailCard-value\b[^"]*"[^>]*>\s*<table/u,
      );
    });
  }
});

describe("the acknowledge emails escape everything that is not markup", () => {
  for (const template of TEMPLATES) {
    test(`${template.file} escapes a hostile title, state, severity and resource`, () => {
      const html: string = render(
        template.file,
        varsFor(template, {
          [template.titleVar]: HOSTILE,
          [template.severityVar]: HOSTILE,
          currentState: HOSTILE,
          resourcesAffected: HOSTILE,
        }),
      );

      expect(html).not.toContain(HOSTILE);
      expect(html).not.toContain('onerror="alert(1)"');
      /*
       * Handlebars escapes "=" to "&#x3D;" as well as the angle brackets,
       * so the tag arrives as inert text the reader can see.
       */
      expect(html).toContain("&lt;img");
      expect(html).toContain("onerror&#x3D;");
    });

    /*
     * `concat` joins without escaping, and its output went into InfoBlock's
     * raw {{{info}}}. A project name is free text a member typed.
     */
    test(`${template.file} escapes a hostile project name in the intro line`, () => {
      const html: string = render(
        template.file,
        varsFor(template, { projectName: HOSTILE }),
      );

      expect(html).not.toContain(HOSTILE);
      expect(html).toContain("&lt;img");
    });

    /*
     * The control: the description and root cause are Markdown.convertToHTML
     * output, which has already escaped what the user typed. If this branch
     * ever started escaping, every email would show its own tags.
     */
    test(`${template.file} still renders converted markdown unescaped`, () => {
      const html: string = render(template.file, varsFor(template));

      expect(html).toContain("<p>A pod is over its CPU limit.</p>");
      expect(html).not.toContain("&lt;strong&gt;Filter Conditions Met");
    });
  }
});

describe("the acknowledge emails show every row their template asks for", () => {
  for (const template of TEMPLATES) {
    /*
     * DetailBoxField renders the LABEL from `title` but guards the VALUE
     * with `{{#if}}`. A variable the generator forgets to set therefore
     * produces a labelled row with nothing under it — no error, no blank
     * where a reader would notice one. That is how AcknowledgeAlert.hbs
     * shipped a "ROOT CAUSE:" heading over empty space for as long as its
     * generator never set the variable.
     *
     * This test pins the failure mode so the service-level fix that now
     * supplies the variable has something to be measured against.
     */
    test(`${template.file} renders an empty value box when a variable is missing`, () => {
      const withRow: string = render(template.file, varsFor(template));
      const withoutRow: string = render(
        template.file,
        varsFor(template, { rootCause: undefined }),
      );

      expect(withRow).toContain("<strong>Filter Conditions Met</strong>");
      expect(withoutRow).not.toContain(
        "<strong>Filter Conditions Met</strong>",
      );

      // The label survives either way — which is exactly why it went unnoticed.
      expect(withoutRow).toContain("Root Cause:");
    });

    test(`${template.file} asks for a Resources Affected row`, () => {
      const source: string = templateSource(template.file);

      expect(source).toContain("plainText=resourcesAffected");

      const html: string = render(template.file, varsFor(template));
      expect(html).toContain("web-7d9f");
    });
  }
});
