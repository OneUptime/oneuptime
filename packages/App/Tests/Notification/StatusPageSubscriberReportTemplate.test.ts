/*
 * The rendered "Uptime Report" email for a status page.
 *
 * StatusPageService builds the report; this is the other half - what a
 * subscriber actually receives. The bug these tests pin: the email dumped every
 * monitor into one flat "Per-resource breakdown" table, so a reader could not
 * tell which Region / Market / Unit a monitor belonged to and never saw the
 * rolled up availability the live status page shows at every level. Most
 * recipients of this email have no OneUptime login, so the email is all they get.
 *
 * Both the built-in template (StatusPageSubscriberReport.hbs) and the default
 * body offered to customers who author their own report template are rendered
 * here, through real Handlebars, from a report built by the real tree util.
 */

import Handlebars from "handlebars";
import {
  getEmailLanguageVariables,
  registerEmailLanguageHelpers,
} from "../../FeatureSet/Notification/Utils/EmailLanguage";
import fs from "fs";
import Path from "path";
import StatusPageReportTreeUtil, {
  StatusPageReportResourceEntry,
  StatusPageReportStructure,
} from "Common/Utils/StatusPage/Report";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import {
  StatusPageReport,
  StatusPageReportGroupMetrics,
} from "Common/Types/StatusPage/StatusPageReport";
import { getDefaultSubscriberNotificationTemplate } from "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { STATUS_PAGE_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";

// The email language helpers the templates word their text with.
registerEmailLanguageHelpers(Handlebars);

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const HANDLEBARS_UTIL_PATH: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Utils",
  "Handlebars.ts",
);

const CORPORATE: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const REGION_ONE: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MARKET_ONE: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const UNIT_0660: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

function makeGroup(data: {
  id: ObjectID;
  name: string;
  parentId?: ObjectID | undefined;
}): StatusPageGroup {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = data.id.toString();
  group.name = data.name;
  group.order = 1;

  if (data.parentId) {
    group.parentStatusPageGroupId = data.parentId;
  }

  return group;
}

function makeEntry(data: {
  resourceName: string;
  groupId?: ObjectID | undefined;
  uptimePercent?: number | undefined;
}): StatusPageReportResourceEntry {
  const resource: StatusPageResource = new StatusPageResource();
  resource.displayName = data.resourceName;

  if (data.groupId) {
    resource.statusPageGroupId = data.groupId;
  }

  const uptimePercent: number =
    data.uptimePercent === undefined ? 100 : data.uptimePercent;

  return {
    statusPageResource: resource,
    reportItem: {
      resourceName: data.resourceName,
      totalIncidentCount: 1,
      uptimePercent: uptimePercent,
      uptimePercentAsString: `${uptimePercent}%`,
      downtimeInHoursAndMinutes: "0 minutes",
    },
  };
}

function buildReport(data: {
  entries: Array<StatusPageReportResourceEntry>;
  statusPageGroups: Array<StatusPageGroup>;
  groupMetricsByGroupId?: Dictionary<StatusPageReportGroupMetrics> | undefined;
}): StatusPageReport {
  const structure: StatusPageReportStructure = StatusPageReportTreeUtil.build({
    entries: data.entries,
    statusPageGroups: data.statusPageGroups,
    groupMetricsByGroupId: data.groupMetricsByGroupId || {},
  });

  return {
    reportDates: "Jul 1, 2026 - Jul 31, 2026",
    reportPeriodName: "July 2026",
    reportStartDate: "Jul 1, 2026",
    reportEndDate: "Jul 31, 2026",
    reportTimezone: "UTC",
    totalResources: structure.resources.length,
    totalIncidents: 3,
    averageUptimePercent: "97.85%",
    totalDowntimeInHoursAndMinutes: "2 days, 0 minutes",
    resources: structure.resources,
    groups: structure.groups,
    ungroupedResources: structure.resourcesWithoutGroup,
    rows: structure.rows,
    hasGroups: structure.groups.length > 0,
  };
}

/*
 * The hierarchy from the bug report:
 *
 *   Corporate Unit's
 *     Region 001
 *       Market 001
 *         Unit 0660
 *           Router
 *           Switch 01
 *   (ungrouped) WBHQ website
 */
function nestedGroups(): Array<StatusPageGroup> {
  return [
    makeGroup({ id: CORPORATE, name: "Corporate Unit's" }),
    makeGroup({ id: REGION_ONE, name: "Region 001", parentId: CORPORATE }),
    makeGroup({ id: MARKET_ONE, name: "Market 001", parentId: REGION_ONE }),
    makeGroup({ id: UNIT_0660, name: "Unit 0660", parentId: MARKET_ONE }),
  ];
}

function nestedEntries(): Array<StatusPageReportResourceEntry> {
  return [
    makeEntry({
      resourceName: "Router",
      groupId: UNIT_0660,
      uptimePercent: 85.71,
    }),
    makeEntry({ resourceName: "WBHQ website" }),
    makeEntry({ resourceName: "Switch 01", groupId: UNIT_0660 }),
  ];
}

function nestedMetrics(): Dictionary<StatusPageReportGroupMetrics> {
  const rolledUp: StatusPageReportGroupMetrics = {
    uptimePercent: 92.85,
    uptimePercentAsString: "92.85%",
    downtimeInHoursAndMinutes: "2 days, 0 minutes",
    totalIncidentCount: 2,
  };

  return {
    [CORPORATE.toString()]: rolledUp,
    [REGION_ONE.toString()]: rolledUp,
    [MARKET_ONE.toString()]: rolledUp,
    [UNIT_0660.toString()]: rolledUp,
  };
}

/*
 * The names of the rows the breakdown table renders, in document order. Every
 * row's name sits in a `<div>` with `margin-left` inside the first cell,
 * which is also where the indent lives.
 */
function renderedRows(html: string): Array<{ name: string; indent: number }> {
  const rows: Array<{ name: string; indent: number }> = [];
  const pattern: RegExp = /<div\b[^>]*style="margin-left:\s*(\d+)px;">([^<]*)/g;

  let match: RegExpExecArray | null = pattern.exec(html);

  while (match) {
    rows.push({
      indent: Number(match[1]),
      name: match[2]!.trim(),
    });

    match = pattern.exec(html);
  }

  return rows;
}

function renderReportTemplate(vars: Record<string, unknown>): string {
  const templateSource: string = fs.readFileSync(
    Path.resolve(TEMPLATES_DIR, "StatusPageSubscriberReport.hbs"),
    { encoding: "utf8" },
  );

  return Handlebars.compile(templateSource)(vars);
}

beforeAll(() => {
  /*
   * Mirrors what FeatureSet/Notification/Utils/Handlebars.ts does at runtime:
   * every file in Templates/Partials becomes a partial, plus the small helper
   * set the templates use. Registered here (rather than importing that module)
   * so the test does not depend on the process working directory - the module
   * resolves the partials directory from process.cwd(). The
   * "registers every helper" test below keeps the two in step.
   */
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

/*
 * The supporting stat strip under the hero (Downtime, Incidents,
 * Resources): its three tiles, each from its <td> on, as rendered.
 */
function statTiles(html: string): Array<string> {
  return html
    .split("<td ")
    .filter((part: string): boolean => {
      return part.startsWith('width="33%"') || part.startsWith('width="34%"');
    })
    .map((part: string): string => {
      return part.slice(0, part.indexOf("</td>"));
    });
}

/*
 * Each tile names what it counts before its number - a screen reader and
 * the text part read "Downtime: 21m" (st-Stat-label) - and sits at the top
 * of the strip, so the three labels line up however long a value wraps.
 */
function expectLabelsFirstAndLinedUp(
  html: string,
  values: Array<[string, string]>,
): void {
  const tiles: Array<string> = statTiles(html);

  expect(tiles).toHaveLength(3);

  tiles.forEach((tile: string, index: number): void => {
    const [label, value] = values[index]!;
    const labelAt: number = tile.indexOf(`class="st-Stat-label"`);

    expect(tile).toContain('valign="top"');
    expect(labelAt).toBeGreaterThan(-1);
    expect(tile.indexOf(`>${label}</p>`)).toBeGreaterThan(labelAt);
    expect(tile.indexOf(`>${value}</div>`)).toBeGreaterThan(
      tile.indexOf(`>${label}</p>`),
    );
  });
}

interface NumberSize {
  fontSize: string | undefined;
  lineHeight: string | undefined;
}

// How big a stat tile draws its number: the value <div>'s own style.
function readNumberSize(tile: string): NumberSize {
  const valueAt: number = tile.indexOf("<div ");

  expect(valueAt).toBeGreaterThan(-1);

  const value: string = tile.slice(valueAt, tile.indexOf(">", valueAt));
  const styleAt: number = value.indexOf('style="');

  expect(styleAt).toBeGreaterThan(-1);

  const declarations: Map<string, string> = new Map();

  for (const declaration of value
    .slice(styleAt + 'style="'.length, value.lastIndexOf('"'))
    .split(";")) {
    const colonAt: number = declaration.indexOf(":");

    if (colonAt > -1) {
      declarations.set(
        declaration.slice(0, colonAt).trim().toLowerCase(),
        declaration.slice(colonAt + 1).trim(),
      );
    }
  }

  return {
    fontSize: declarations.get("font-size"),
    lineHeight: declarations.get("line-height"),
  };
}

describe("StatusPageSubscriberReport.hbs", () => {
  test("each supporting stat names what it counts first, at the top of its tile", () => {
    const report: StatusPageReport = buildReport({
      entries: nestedEntries(),
      statusPageGroups: nestedGroups(),
      groupMetricsByGroupId: nestedMetrics(),
    });

    expectLabelsFirstAndLinedUp(
      renderReportTemplate({
        statusPageName: "WBHQ Status Page",
        hasResources: "true",
        statusPageUrl: "https://status.example.com",
        detailsUrl: "https://status.example.com",
        report: report,
      }),
      [
        ["Downtime", "2 days, 0 minutes"],
        ["Incidents", "3"],
        ["Resources", String(report.totalResources)],
      ],
    );
  });

  describe("a status page with nested groups", () => {
    let html: string = "";

    beforeAll(() => {
      html = renderReportTemplate({
        statusPageName: "WBHQ Status Page",
        hasResources: "true",
        statusPageUrl: "https://status.example.com",
        detailsUrl: "https://status.example.com",
        report: buildReport({
          entries: nestedEntries(),
          statusPageGroups: nestedGroups(),
          groupMetricsByGroupId: nestedMetrics(),
        }),
      });
    });

    test("renders every level of the hierarchy, in the order the live page shows it", () => {
      expect(
        renderedRows(html).map(
          (row: { name: string; indent: number }): string => {
            return row.name;
          },
        ),
      ).toEqual([
        "WBHQ website",
        "Corporate Unit&#x27;s",
        "Region 001",
        "Market 001",
        "Unit 0660",
        "Router",
        "Switch 01",
      ]);
    });

    test("indents each level so the nesting is readable", () => {
      const indentByName: Dictionary<number> = {};

      for (const row of renderedRows(html)) {
        indentByName[row.name] = row.indent;
      }

      expect(indentByName["WBHQ website"]).toBe(0);
      expect(indentByName["Corporate Unit&#x27;s"]).toBe(0);
      expect(indentByName["Region 001"]).toBe(16);
      expect(indentByName["Market 001"]).toBe(32);
      expect(indentByName["Unit 0660"]).toBe(48);
      expect(indentByName["Router"]).toBe(64);
      expect(indentByName["Switch 01"]).toBe(64);
    });

    test("lets deeply nested names use the full name cell on mobile", () => {
      /*
       * The deepest resources retain their 64px desktop hierarchy while the
       * mobile rule releases that space in the narrow four-column report.
       */
      expect(html).toMatch(
        /<div[^>]*class="[^"]*st-ReportIndent[^"]*"[^>]*style="margin-left:\s*64px;">Router/,
      );
      expect(html.match(/class="[^"]*st-ReportIndent/g)).toHaveLength(7);
      expect(html).toMatch(
        /@media[^{}]*\(max-width:\s*600px\)\s*\{[\s\S]*?body\[override\] \.st-ReportIndent\s*\{\s*margin-left:\s*0 !important;/,
      );
    });

    test("shows the uptime rolled up over each group", () => {
      /*
       * Every group in this fixture rolls up the same two resources, so the
       * rolled up figure appears once per group row.
       */
      expect(html.split("92.85%")).toHaveLength(5);
      // and the resources still report their own numbers.
      expect(html).toContain("85.71%");
    });

    test("tells the reader how many resources each group covers", () => {
      expect(html).toContain("2 resources");
    });

    test("titles the table as a group breakdown", () => {
      expect(html).toContain("Breakdown by group");
      expect(html).toContain("Group / Resource");
      expect(html).not.toContain("Per-resource breakdown");
    });

    test("escapes group and resource names", () => {
      const injected: string = renderReportTemplate({
        statusPageName: "WBHQ Status Page",
        hasResources: "true",
        report: buildReport({
          entries: [
            makeEntry({
              resourceName: "<script>alert(1)</script>",
              groupId: CORPORATE,
            }),
          ],
          statusPageGroups: [
            makeGroup({ id: CORPORATE, name: "<img src=x onerror=1>" }),
          ],
        }),
      });

      expect(injected).not.toContain("<script>alert(1)</script>");
      expect(injected).not.toContain("<img src=x onerror=1>");
      expect(injected).toContain("&lt;script&gt;");
      expect(injected).toContain("&lt;img src");
    });
  });

  describe("a status page with no groups", () => {
    let html: string = "";

    beforeAll(() => {
      html = renderReportTemplate({
        statusPageName: "WBHQ Status Page",
        hasResources: "true",
        report: buildReport({
          entries: [
            makeEntry({ resourceName: "Router", uptimePercent: 85.71 }),
            makeEntry({ resourceName: "WBHQ website" }),
          ],
          statusPageGroups: [],
        }),
      });
    });

    test("falls back to the flat per-resource table", () => {
      expect(html).toContain("Per-resource breakdown");
      expect(html).not.toContain("Breakdown by group");
      expect(html).not.toContain("Group / Resource");
    });

    test("lists every resource, unindented", () => {
      expect(renderedRows(html)).toEqual([
        { name: "Router", indent: 0 },
        { name: "WBHQ website", indent: 0 },
      ]);
    });
  });

  describe("a status page with no resources", () => {
    test("says there is nothing to report instead of rendering an empty table", () => {
      const html: string = renderReportTemplate({
        statusPageName: "WBHQ Status Page",
        hasResources: "false",
        report: buildReport({ entries: [], statusPageGroups: [] }),
      });

      expect(html).toContain(
        "No resources have been added to this status page",
      );
      expect(renderedRows(html)).toEqual([]);
    });
  });

  test("only uses helpers the notification Handlebars util registers", () => {
    const templateSource: string = fs.readFileSync(
      Path.resolve(TEMPLATES_DIR, "StatusPageSubscriberReport.hbs"),
      { encoding: "utf8" },
    );

    const utilSource: string = fs.readFileSync(HANDLEBARS_UTIL_PATH, {
      encoding: "utf8",
    });

    for (const helper of ["ifCond", "ifNotCond", "concat"]) {
      if (!templateSource.includes(helper)) {
        continue;
      }

      expect(utilSource).toContain(`registerHelper("${helper}"`);
    }
  });
});

describe("the default report template offered to customers", () => {
  function renderDefaultBody(report: StatusPageReport): string {
    const body: string =
      getDefaultSubscriberNotificationTemplate(
        StatusPageSubscriberNotificationEventType.SubscriberReport,
        StatusPageSubscriberNotificationMethod.Email,
      )?.body || "";

    expect(body).not.toBe("");

    return Handlebars.compile(body)({
      statusPageName: "WBHQ Status Page",
      detailsUrl: "https://status.example.com",
      report: report,
    });
  }

  test("names each supporting stat first, at the top of its tile, as the built-in report does", () => {
    const report: StatusPageReport = buildReport({
      entries: nestedEntries(),
      statusPageGroups: nestedGroups(),
      groupMetricsByGroupId: nestedMetrics(),
    });

    expectLabelsFirstAndLinedUp(renderDefaultBody(report), [
      ["Downtime", "2 days, 0 minutes"],
      ["Incidents", "3"],
      ["Resources", String(report.totalResources)],
    ]);
  });

  /*
   * A phone's tile is about 90 pixels wide. At 24px a bold "minutes" was
   * wider than that, and the template's overflow-wrap broke it in two
   * ("minute" over "s"); at the built-in report's 22px it fits whole.
   */
  test("draws each stat's number at the built-in report's size, so a word such as 'minutes' fits a phone's tile whole", () => {
    const report: StatusPageReport = buildReport({
      entries: nestedEntries(),
      statusPageGroups: nestedGroups(),
      groupMetricsByGroupId: nestedMetrics(),
    });

    const builtIn: Array<NumberSize> = statTiles(
      renderReportTemplate({
        statusPageName: "WBHQ Status Page",
        hasResources: "true",
        statusPageUrl: "https://status.example.com",
        detailsUrl: "https://status.example.com",
        report: report,
      }),
    ).map(readNumberSize);
    const starter: Array<NumberSize> = statTiles(renderDefaultBody(report)).map(
      readNumberSize,
    );

    expect(builtIn).toEqual([
      { fontSize: "22px", lineHeight: "28px" },
      { fontSize: "22px", lineHeight: "28px" },
      { fontSize: "22px", lineHeight: "28px" },
    ]);
    expect(starter).toEqual(builtIn);
  });

  test("renders the same nested hierarchy", () => {
    const html: string = renderDefaultBody(
      buildReport({
        entries: nestedEntries(),
        statusPageGroups: nestedGroups(),
        groupMetricsByGroupId: nestedMetrics(),
      }),
    );

    expect(
      renderedRows(html).map(
        (row: { name: string; indent: number }): string => {
          return row.name;
        },
      ),
    ).toEqual([
      "WBHQ website",
      "Corporate Unit&#x27;s",
      "Region 001",
      "Market 001",
      "Unit 0660",
      "Router",
      "Switch 01",
    ]);

    expect(html).toContain("Breakdown by group");
  });

  test("includes its own mobile indentation reset for deeply nested names", () => {
    const html: string = renderDefaultBody(
      buildReport({
        entries: nestedEntries(),
        statusPageGroups: nestedGroups(),
        groupMetricsByGroupId: nestedMetrics(),
      }),
    );

    expect(html).toContain('class="st-StandaloneReport"');
    expect(html).toMatch(
      /<div[^>]*class="st-ReportIndent"[^>]*style="margin-left:\s*64px;">Router/,
    );
    expect(html.match(/class="st-ReportIndent"/g)).toHaveLength(7);
    expect(html).toMatch(
      /@media[^{}]*\(max-width:\s*600px\)\s*\{\s*\.st-StandaloneReport \.st-ReportIndent\s*\{\s*margin-left:\s*0 !important;/,
    );
  });

  test("falls back to a flat table when the page has no groups", () => {
    const html: string = renderDefaultBody(
      buildReport({
        entries: [makeEntry({ resourceName: "Router" })],
        statusPageGroups: [],
      }),
    );

    expect(html).toContain("Per-resource breakdown");
    expect(renderedRows(html)).toEqual([{ name: "Router", indent: 0 }]);
  });
});

const PHONE_MEDIA_QUERY: string = "@media only screen and (max-width: 600px)";

/*
 * The rules of an email's phone block (PHONE_MEDIA_QUERY), each selector
 * with its declarations, read with indexOf - never a pattern over markup.
 */
function phoneRules(html: string): Map<string, Map<string, string>> {
  const mediaAt: number = html.indexOf(PHONE_MEDIA_QUERY);

  expect(mediaAt).toBeGreaterThan(-1);

  const blockStart: number = html.indexOf("{", mediaAt) + 1;
  let depth: number = 1;
  let blockEnd: number = blockStart;

  while (depth > 0 && blockEnd < html.length) {
    if (html[blockEnd] === "{") {
      depth++;
    } else if (html[blockEnd] === "}") {
      depth--;
    }

    blockEnd++;
  }

  const rules: Map<string, Map<string, string>> = new Map();

  for (const rule of html.slice(blockStart, blockEnd - 1).split("}")) {
    const openAt: number = rule.indexOf("{");

    if (openAt === -1) {
      continue;
    }

    const declarations: Map<string, string> = new Map();

    for (const declaration of rule.slice(openAt + 1).split(";")) {
      const colonAt: number = declaration.indexOf(":");

      if (colonAt > -1) {
        declarations.set(
          declaration.slice(0, colonAt).trim(),
          declaration.slice(colonAt + 1).trim(),
        );
      }
    }

    rules.set(rule.slice(0, openAt).trim(), declarations);
  }

  return rules;
}

/*
 * What makes the stat strip three rows on a phone, by the selector after
 * each template's own prefix: the cells stack, full width, without the
 * tiles' inline dividers (stacked, they would run down the strip's right
 * edge), each label on the left and its value - a little smaller - on the
 * right.
 */
const PHONE_STAT_RULES: Array<[string, Record<string, string>]> = [
  [
    "td.st-Stat",
    {
      display: "block !important",
      width: "auto !important",
      "border-right": "0 !important",
      "text-align": "right !important",
    },
  ],
  [
    ".st-Stat .st-Stat-label",
    { float: "left !important", margin: "0 16px 0 0 !important" },
  ],
  [
    ".st-Stat .st-Stat-value",
    { "font-size": "18px !important", "line-height": "26px !important" },
  ],
];

// The starter a status page is offered for its own report template, rendered.
function renderStarter(report: StatusPageReport): string {
  const body: string =
    getDefaultSubscriberNotificationTemplate(
      StatusPageSubscriberNotificationEventType.SubscriberReport,
      StatusPageSubscriberNotificationMethod.Email,
    )?.body || "";

  expect(body).not.toBe("");

  return Handlebars.compile(body)({
    statusPageName: "WBHQ Status Page",
    detailsUrl: "https://status.example.com",
    report: report,
  });
}

/*
 * ON A PHONE, THE UPTIME REPORT'S THREE STATS ARE ROWS.
 *
 * Side by side, each stat has a third of the strip: about 90 pixels on a
 * phone, where "4 hours, 39 minutes" took three lines and a wider font
 * broke "minutes" in two. Under 600 pixels both the built-in report and
 * the starter make the strip three rows - DOWNTIME on the left, "4 hours,
 * 39 minutes" on the right - the way the text part reads it. A mail client
 * without media queries keeps the three tiles.
 */
describe("on a phone, the uptime report's three stats are rows", () => {
  const report: () => StatusPageReport = (): StatusPageReport => {
    return buildReport({
      entries: nestedEntries(),
      statusPageGroups: nestedGroups(),
      groupMetricsByGroupId: nestedMetrics(),
    });
  };

  const renderBuiltIn: () => string = (): string => {
    return renderReportTemplate({
      statusPageName: "WBHQ Status Page",
      hasResources: "true",
      statusPageUrl: "https://status.example.com",
      detailsUrl: "https://status.example.com",
      report: report(),
    });
  };

  const renderOffered: () => string = (): string => {
    return renderStarter(report());
  };

  test.each([
    { name: "the built-in report", prefix: "body[override] " },
    { name: "the starter", prefix: ".st-StandaloneReport " },
  ])(
    "$name stacks its stat cells into rows, label left and value right",
    (template: { name: string; prefix: string }) => {
      const rules: Map<string, Map<string, string>> = phoneRules(
        template.name === "the starter" ? renderOffered() : renderBuiltIn(),
      );

      for (const [selector, declarations] of PHONE_STAT_RULES) {
        const rule: Map<string, string> | undefined = rules.get(
          template.prefix + selector,
        );

        expect(rule).toBeDefined();

        for (const [property, value] of Object.entries(declarations)) {
          expect(`${selector} ${property}: ${rule?.get(property)}`).toBe(
            `${selector} ${property}: ${value}`,
          );
        }
      }

      /*
       * And no rule of the phone block draws a divider: a client that
       * drops the block would not draw it, so dividers are inline, above a
       * row (EmailDetailCardDividers holds Style.hbs to it).
       */
      for (const [selector, declarations] of rules) {
        for (const property of declarations.keys()) {
          expect(`${selector} ${property}`).not.toContain("border-top");
          expect(`${selector} ${property}`).not.toContain("border-bottom");
        }
      }
    },
  );

  test.each([
    { name: "the built-in report", render: renderBuiltIn },
    { name: "the starter", render: renderOffered },
  ])(
    "$name marks each stat for those rules, and only the stats",
    (template: { name: string; render: () => string }) => {
      const html: string = template.render();
      const tiles: Array<string> = statTiles(html);

      expect(tiles).toHaveLength(3);

      // Each cell is a stat, its label and its value marked as such.
      for (const tile of tiles) {
        expect(tile.slice(0, tile.indexOf(">"))).toContain('class="st-Stat"');
        expect(tile).toContain('<p class="st-Stat-label" ');
        expect(tile).toContain('<div class="st-Stat-value" ');
      }

      /*
       * The hero's "Average Uptime" is a stat label too - the text part
       * reads it - but in no stat cell: on a phone it stays centered above
       * its number.
       */
      const heroAt: number = html.indexOf(">Average Uptime</p>");
      const heroBoxAt: number = Math.max(
        html.lastIndexOf("<td ", heroAt),
        html.lastIndexOf("<div ", heroAt),
      );

      expect(heroAt).toBeGreaterThan(-1);
      expect(heroAt).toBeLessThan(html.indexOf('class="st-Stat"'));
      expect(html.slice(heroBoxAt, html.indexOf(">", heroBoxAt))).not.toContain(
        "st-Stat",
      );
    },
  );
});

/*
 * THE REPORT IN ITS READER'S LANGUAGE.
 *
 * StatusPageService.sendEmailReport puts each subscriber's language on the
 * email (MailService.render gives the template emailLanguage, and for
 * Persian emailDirection and isEmailRightToLeft), and hands it the report
 * written in that language (Common/Utils/StatusPage/ReportText). The
 * template words its own text in it, writes its counts the language's way
 * (tNumber), and in an email read from the right lays its table and stat
 * strip out from the right. An English email reads exactly as it did.
 */
describe("the uptime report in its reader's language", () => {
  // The fixture's report, rendered as an email in `language`.
  const renderIn: (
    language: string,
    report?: StatusPageReport | undefined,
  ) => string = (
    language: string,
    report?: StatusPageReport | undefined,
  ): string => {
    return renderReportTemplate({
      statusPageName: "WBHQ Status Page",
      hasResources: "true",
      statusPageUrl: "https://status.example.com",
      detailsUrl: "https://status.example.com",
      report:
        report ||
        buildReport({
          entries: nestedEntries(),
          statusPageGroups: nestedGroups(),
          groupMetricsByGroupId: nestedMetrics(),
        }),
      ...getEmailLanguageVariables(language),
    });
  };

  // The English words a report email used to be written in.
  const ENGLISH_WORDS: Array<string> = [
    "Uptime Report:",
    "Here is your status summary for",
    ">Average Uptime<",
    ">Downtime<",
    ">Resources<",
    "Breakdown by group",
    ">Group / Resource<",
    ">Uptime<",
    " resources<",
    "View Full Status Page",
    'aria-label="Uptime by resource"',
    "uptime report",
  ];

  test("German: every word of the email is German", () => {
    const html: string = renderIn("de");

    for (const words of [
      "Verfügbarkeitsbericht: WBHQ Status Page",
      "Hier ist Ihre Statusübersicht für July 2026.",
      ">Durchschnittliche Verfügbarkeit</p>",
      ">Ausfallzeit</p>",
      ">Vorfälle</p>",
      ">Ressourcen</p>",
      "Aufschlüsselung nach Gruppe",
      ">Gruppe / Ressource</th>",
      ">Verfügbarkeit</th>",
      ">Ausfallzeit</th>",
      ">Vorfälle</th>",
      " &middot; 2 Ressourcen</span>",
      'aria-label="Verfügbarkeit nach Ressource"',
      "Vollständige Statusseite ansehen",
      "WBHQ Status Page: Verfügbarkeitsbericht",
    ]) {
      expect([words, html.includes(words)]).toEqual([words, true]);
    }

    for (const words of ENGLISH_WORDS) {
      expect([words, html.includes(words)]).toEqual([words, false]);
    }
  });

  test("German: a page without groups says so in German", () => {
    const html: string = renderIn(
      "de",
      buildReport({
        entries: [makeEntry({ resourceName: "Router" })],
        statusPageGroups: [],
      }),
    );

    expect(html).toContain("Aufschlüsselung nach Ressource");
    expect(html).toContain(">Ressource</th>");
    expect(html).not.toContain("Per-resource breakdown");
  });

  test("German: a page without resources says so in German", () => {
    const html: string = renderReportTemplate({
      statusPageName: "WBHQ Status Page",
      hasResources: "false",
      report: buildReport({ entries: [], statusPageGroups: [] }),
      ...getEmailLanguageVariables("de"),
    });

    expect(html).toContain(
      "Dieser Statusseite wurden noch keine Ressourcen hinzugefügt",
    );
    expect(html).not.toContain("No resources have been added");
  });

  test.each([...STATUS_PAGE_LANGUAGES])(
    "%s words the title, the summary and the button",
    (language: string) => {
      const html: string = renderIn(language);

      for (const words of [
        "Uptime Report:",
        "Here is your status summary for",
        "View Full Status Page",
        "Breakdown by group",
      ]) {
        expect([language, words, html.includes(words)]).toEqual([
          language,
          words,
          false,
        ]);
      }

      expect(html).toContain(`lang="${language}"`);
    },
  );

  test("English: one resource is one resource", () => {
    const html: string = renderIn(
      "en",
      buildReport({
        entries: [makeEntry({ resourceName: "Router", groupId: CORPORATE })],
        statusPageGroups: [makeGroup({ id: CORPORATE, name: "Corporate" })],
      }),
    );

    expect(html).toContain(" &middot; 1 resource</span>");
    expect(html).not.toContain("1 resources");
    // And two are two, as they always were.
    expect(renderIn("en")).toContain(" &middot; 2 resources</span>");
  });

  test("English: the email has no direction and its counts are as written", () => {
    const html: string = renderIn("en");

    expect(html).not.toContain('dir="rtl"');
    expect(html).not.toContain("<span dir=");
    expect(html).toContain('<th scope="col" align="left" width="34%"');
    expect(html).toContain(">3</div>");
  });

  describe("in Persian, read from the right", () => {
    let html: string = "";

    beforeAll(() => {
      html = renderIn("fa");
    });

    test("is laid out from the right", () => {
      expect(html).toContain('lang="fa" dir="rtl"');
    });

    test("puts the name column at the right and the figures at the left", () => {
      expect(html).toContain(
        '<th scope="col" align="right" width="34%" bgcolor="#f8fafc" style="background-color:#f8fafc;color:#64748b;padding:14px 10px;font-size:12px;line-height:18px;font-weight:600;text-align:right;">',
      );
      expect(html).toContain(
        '<th scope="col" align="left" width="22%" bgcolor="#f8fafc" style="background-color:#f8fafc;color:#64748b;padding:14px 10px;font-size:12px;line-height:18px;font-weight:600;text-align:left;">',
      );
      expect(html).not.toContain('align="left" width="34%"');
    });

    test("indents each level from the right", () => {
      expect(html).toContain('style="margin-right:16px;">');
      expect(html).toContain('style="margin-right:64px;">');
      expect(html).not.toContain("margin-left:16px");
    });

    test("an English name reads left to right, set apart in its line", () => {
      expect(html).toContain('<span dir="ltr">Region 001</span>');
      expect(html).toContain('<span dir="ltr">Router</span>');
    });

    test("a Persian name reads right to left", () => {
      const persian: string = renderIn(
        "fa",
        buildReport({
          entries: [makeEntry({ resourceName: "درگاه پرداخت" })],
          statusPageGroups: [],
        }),
      );

      expect(persian).toContain('<span dir="rtl">درگاه پرداخت</span>');
    });

    test("its counts are in Persian digits", () => {
      // The page's three incidents, and a group's two resources.
      expect(html).toContain(">۳</div>");
      expect(html).toContain("۲ منبع");
    });

    test("the report's time zone reads left to right in its brackets", () => {
      expect(html).toContain('(<span dir="ltr">UTC</span>)');
    });

    test("the middle tile draws both of the strip's dividers, the outer ones none", () => {
      const tiles: Array<string> = statTiles(html);

      expect(tiles).toHaveLength(3);

      const style: (tile: string) => string = (tile: string): string => {
        const at: number = tile.indexOf('style="');
        return tile.slice(at, tile.indexOf('"', at + 'style="'.length));
      };

      expect(style(tiles[0]!)).not.toContain("border");
      expect(style(tiles[1]!)).toContain("border-left:1px solid #e2e8f0;");
      expect(style(tiles[1]!)).toContain("border-right:1px solid #e2e8f0;");
      expect(style(tiles[2]!)).not.toContain("border");
    });

    test("on a phone, each stat's label is on the right and its value on the left", () => {
      const rules: Map<string, Map<string, string>> = phoneRules(html);
      const cell: Map<string, string> | undefined = rules.get(
        "body[override] td.st-Stat",
      );
      const label: Map<string, string> | undefined = rules.get(
        "body[override] .st-Stat .st-Stat-label",
      );

      expect(cell?.get("text-align")).toBe("left !important");
      expect(cell?.get("border-left")).toBe("0 !important");
      expect(cell?.get("border-right")).toBe("0 !important");
      expect(label?.get("float")).toBe("right !important");
      expect(label?.get("margin")).toBe("0 0 0 16px !important");
      expect(
        rules.get("body[override] .st-ReportIndent")?.get("margin-right"),
      ).toBe("0 !important");
    });
  });
});

/*
 * WHAT A SUBSCRIBER SEES BEFORE THEY OPEN THE REPORT, AND ON A PHONE.
 *
 * The inbox shows a line of the email beside its subject: the hidden
 * preview at its top. A page with no resources has no uptime to sum up -
 * its report's "average" is a 0% - so its preview says what the email
 * says, never "0% average uptime", which reads as an outage.
 *
 * On a phone each figure column has about 60 pixels, narrower than a
 * heading such as "Verfügbarkeit" or "Доступность": a heading breaks where
 * the email's language hyphenates it ("Verfüg-barkeit"; Start.hbs puts the
 * language on <html lang>), not anywhere inside the word, and the columns
 * keep their widths.
 */
describe("the uptime report's inbox preview, and its headings on a phone", () => {
  const PREVIEW_START: string =
    '<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">';

  // The report's one hidden preview line, as an inbox shows it.
  const previewOf: (html: string) => string = (html: string): string => {
    const at: number = html.indexOf(PREVIEW_START);

    expect(at).toBeGreaterThan(-1);
    expect(html.indexOf(PREVIEW_START, at + 1)).toBe(-1);

    const start: number = at + PREVIEW_START.length;

    return html.slice(start, html.indexOf("</div>", start));
  };

  const renderEmpty: (language: string) => string = (
    language: string,
  ): string => {
    return renderReportTemplate({
      statusPageName: "WBHQ Status Page",
      hasResources: "false",
      report: {
        ...buildReport({ entries: [], statusPageGroups: [] }),
        // What StatusPageService builds for a page with no resources.
        averageUptimePercent: "0%",
        totalResources: 0,
      },
      ...getEmailLanguageVariables(language),
    });
  };

  const renderWithResources: (language: string) => string = (
    language: string,
  ): string => {
    return renderReportTemplate({
      statusPageName: "WBHQ Status Page",
      hasResources: "true",
      statusPageUrl: "https://status.example.com",
      detailsUrl: "https://status.example.com",
      report: buildReport({
        entries: nestedEntries(),
        statusPageGroups: nestedGroups(),
        groupMetricsByGroupId: nestedMetrics(),
      }),
      ...getEmailLanguageVariables(language),
    });
  };

  test("a page with resources previews its average uptime for the period", () => {
    expect(previewOf(renderWithResources("en"))).toBe(
      "WBHQ Status Page uptime report — 97.85% average uptime for July 2026.",
    );
  });

  test("a page without resources previews that there is nothing to report, never a 0% uptime", () => {
    const preview: string = previewOf(renderEmpty("en"));

    expect(preview).toBe(
      "No resources have been added to this status page yet, so there is nothing to report this period.",
    );
    expect(preview).not.toContain("0%");
    expect(preview).not.toContain("average uptime");
  });

  test("and says so in the reader's language", () => {
    const preview: string = previewOf(renderEmpty("de"));

    expect(preview).toBe(
      "Dieser Statusseite wurden noch keine Ressourcen hinzugefügt, daher gibt es für diesen Zeitraum nichts zu berichten.",
    );
    expect(preview).not.toContain("0 %");
  });

  test.each(["en", "de", "ru", "nl", "pt", "fa"])(
    "%s: on a phone, a heading breaks where the email's language hyphenates it",
    (language: string) => {
      const html: string = renderWithResources(language);
      const heading: Map<string, string> | undefined = phoneRules(html).get(
        "body[override] .st-ReportTable th",
      );

      expect(heading?.get("hyphens")).toBe("auto !important");
      expect(heading?.get("-webkit-hyphens")).toBe("auto !important");
      // In the email's language, which the hyphenation follows.
      expect(html).toContain(`lang="${language}"`);
    },
  );

  test("on a phone the columns keep their widths, so the names keep theirs", () => {
    const html: string = renderWithResources("de");

    for (const [selector, declarations] of phoneRules(html)) {
      if (!selector.includes("st-ReportTable")) {
        continue;
      }

      expect(`${selector} ${declarations.get("table-layout")}`).toBe(
        `${selector} undefined`,
      );
      expect(`${selector} ${declarations.get("width")}`).toBe(
        `${selector} undefined`,
      );
    }

    expect(html).toContain('<th scope="col" align="left" width="34%"');
    expect(html).toContain('<th scope="col" align="right" width="22%"');
  });
});
