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
 * row's name sits in a `<div style="margin-left: ...">` inside the first cell,
 * which is also where the indent lives.
 */
function renderedRows(html: string): Array<{ name: string; indent: number }> {
  const rows: Array<{ name: string; indent: number }> = [];
  const pattern: RegExp = /<div style="margin-left: ?(\d+)px;">([^<]*)/g;

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

describe("StatusPageSubscriberReport.hbs", () => {
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
