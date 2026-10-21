import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { Service as MetricRecordingRuleService } from "Common/Server/Services/MetricRecordingRuleService";
import LogRecordingRuleQuery from "Common/Server/Utils/Telemetry/LogRecordingRuleQuery";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import LogRecordingRuleDefinition, {
  LOG_RECORDING_RULE_ID_ATTRIBUTE,
  LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES,
  LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE,
  LogRecordingRuleAggregationOption,
  LogRecordingRuleDefinitionUtil,
} from "Common/Types/Log/LogRecordingRuleDefinition";
import { getOutputMetricNameFromRuleName } from "Common/Types/Metrics/RecordingRuleOutputMetricName";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import LogRecordingRuleWindowUtil, {
  LOG_RECORDING_RULE_BUCKET_SIZE_IN_MINUTES,
  LOG_RECORDING_RULE_EVALUATION_LAG_IN_SECONDS,
  LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES,
  LogRecordingRuleWindow,
} from "Common/Utils/Telemetry/LogRecordingRuleWindow";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Log Recording Rules docs page against the product it describes.
 *
 * Markdown is not compiled, so nothing else notices when the worker's
 * cadence or catch-up changes and the page still promises the old numbers,
 * an aggregation is added that the table never lists, the definition JSON
 * the page tells API users to send stops validating, or the Sophos example
 * names an output metric the server would refuse. Each test reads the
 * source of truth - the definition util, the window util, the statement
 * builder, the permission catalogue, the dashboard's side menu, the nav -
 * and checks the page still tells the same story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const PAGE_URL: string = "/docs/telemetry/log-recording-rules";
const PAGE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/en/telemetry/log-recording-rules.md",
);
const METRICS_MONITOR_PAGE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/en/monitor/metrics-monitor.md",
);
const LOGS_SETTINGS_SIDE_MENU_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Logs/Settings/SideMenu.tsx",
);
const ROUTE_MAP_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Utils/RouteMap.ts",
);

const FENCE_LINE: RegExp = /^\s*```/;

const page: string = fs.readFileSync(PAGE_FILE, "utf8");

// The fenced code blocks of a markdown page, with the language they declare.
function codeBlocks(
  markdown: string,
): Array<{ language: string; code: string }> {
  const blocks: Array<{ language: string; code: string }> = [];
  let current: { language: string; lines: Array<string> } | null = null;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (current) {
        blocks.push({
          language: current.language,
          code: current.lines.join("\n"),
        });
        current = null;
      } else {
        current = { language: line.trim().slice(3).trim(), lines: [] };
      }
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  return blocks;
}

const HEADING_LINE: RegExp = /^#{1,6} /;

function headings(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return HEADING_LINE.test(line);
    })
    .map((line: string): string => {
      return line.replace(HEADING_LINE, "").trim();
    });
}

// The definition JSON the page tells API, MCP and Terraform users to send.
function documentedDefinition(): LogRecordingRuleDefinition {
  const json: Array<{ language: string; code: string }> = codeBlocks(
    page,
  ).filter((block: { language: string }): boolean => {
    return block.language === "json";
  });

  expect(json).toHaveLength(1);

  return JSON.parse(json[0]!.code) as LogRecordingRuleDefinition;
}

describe("the Log Recording Rules docs page", () => {
  it("is in the Telemetry nav, right after Syslog, the source of the example", () => {
    const telemetry: NavGroup | undefined = DocsNav.find(
      (group: NavGroup): boolean => {
        return group.title === "Telemetry";
      },
    );

    expect(telemetry).toBeDefined();

    const urls: Array<string> = telemetry!.links.map((link: NavLink) => {
      return link.url;
    });
    const index: number = urls.indexOf(PAGE_URL);

    expect(index).toBeGreaterThan(0);
    expect(urls[index - 1]).toBe("/docs/telemetry/syslog");
    expect(telemetry!.links[index]!.title).toBe("Log Recording Rules");
    expect(fs.existsSync(PAGE_FILE)).toBe(true);
    expect(headings(page)[0]).toBe("Log Recording Rules");
  });

  it("names the page the dashboard has, where the dashboard has it", () => {
    const sideMenu: string = fs.readFileSync(
      LOGS_SETTINGS_SIDE_MENU_FILE,
      "utf8",
    );
    const routeMap: string = fs.readFileSync(ROUTE_MAP_FILE, "utf8");

    expect(page).toContain("**Logs → Settings → Recording Rules**");
    expect(sideMenu).toContain('title: "Recording Rules"');
    expect(sideMenu).toContain("PageMap.LOGS_SETTINGS_RECORDING_RULES");
    expect(routeMap).toContain(
      '[PageMap.LOGS_SETTINGS_RECORDING_RULES]: "settings/recording-rules"',
    );
    expect(page).toContain("**Create Log Recording Rule**");
  });

  it("states the cadence, the lag and the catch-up the worker uses", () => {
    expect(LOG_RECORDING_RULE_BUCKET_SIZE_IN_MINUTES).toBe(1);
    expect(page).toContain("1-minute buckets");
    expect(page).toContain(
      `Computed ${LOG_RECORDING_RULE_EVALUATION_LAG_IN_SECONDS} seconds after the minute ends.`,
    );
    expect(page).toContain(
      `up to ${LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES} minutes back`,
    );
    expect(page).toContain("**Computed Until**");

    // "Catches up ... and never writes the same minute twice" holds.
    const window: LogRecordingRuleWindow | null =
      LogRecordingRuleWindowUtil.getWindow({
        now: new Date("2026-10-07T10:05:40.000Z"),
        computedUntil: new Date("2026-10-07T10:05:00.000Z"),
      });

    expect(window).toBeNull();
  });

  it("states the group-by and series caps the definition enforces", () => {
    expect(page).toContain(
      `up to ${LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES} attribute keys`,
    );
    expect(page).toContain(
      `at most ${LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE.toLocaleString("en-US")} series per minute`,
    );
  });

  it("lists every aggregation the editor offers, under the editor's names", () => {
    const options: Array<LogRecordingRuleAggregationOption> =
      LogRecordingRuleDefinitionUtil.getAggregationOptions();

    for (const option of options) {
      expect({
        label: option.label,
        inTable: page.includes(`| ${option.label} `),
      }).toEqual({
        label: option.label,
        inTable: true,
      });
    }
  });

  it("names the attribute every point carries", () => {
    expect(page).toContain(`\`${LOG_RECORDING_RULE_ID_ATTRIBUTE}\``);
  });

  it("makes the output metric name the way the server makes it", () => {
    expect(getOutputMetricNameFromRuleName("SD-WAN gateway latency")).toBe(
      "sd_wan_gateway_latency",
    );
    expect(page).toContain(
      "_SD-WAN gateway latency_ writes `sd_wan_gateway_latency`",
    );
  });

  it("documents numeric attributes the way the statement reads them", () => {
    const statement: Statement = LogRecordingRuleQuery.buildStatement({
      projectId: ObjectID.generate(),
      definition: LogRecordingRuleDefinitionUtil.normalize(
        documentedDefinition(),
      ),
      window: {
        startTime: new Date("2026-10-07T10:00:00.000Z"),
        endTime: new Date("2026-10-07T10:01:00.000Z"),
        minutes: 1,
        skippedMinutes: 0,
      },
    });

    // "never counted as 0": non-numbers are filtered out, not coerced.
    expect(statement.query).toContain("isFinite(toFloat64OrNull(");
    expect(page).toContain("It is never counted as `0`");
  });

  describe("the Sophos SD-WAN example", () => {
    it("sends a definition the server accepts: avg of latency by gateway and profile", () => {
      const definition: LogRecordingRuleDefinition = documentedDefinition();

      expect(
        LogRecordingRuleDefinitionUtil.getValidationError(definition),
      ).toBeNull();
      expect(definition.aggregationType).toBe(AggregationType.Avg);
      expect(definition.valueAttribute).toBe("latency");
      expect(definition.groupByAttributes).toEqual(["gw_name", "profile_name"]);
      expect(definition.unit).toBe("ms");
      expect(LogRecordingRuleDefinitionUtil.describe(definition)).toBe(
        "avg(latency) by gw_name, profile_name",
      );
      expect(page).toContain("`avg(latency) by gw_name, profile_name`");
    });

    it("filters on the fields of the SLA summary it quotes", () => {
      const summary: string | undefined = codeBlocks(page)
        .map((block: { code: string }): string => {
          return block.code;
        })
        .find((code: string): boolean => {
          return code.startsWith('log_type="SD-WAN"');
        });

      expect(summary).toBeDefined();

      for (const filter of documentedDefinition().filter.attributeFilters ||
        []) {
        expect(summary).toMatch(
          new RegExp(`(^| )${filter.key}="?${filter.value}"?( |$)`),
        );
      }

      for (const key of [
        "latency",
        ...(documentedDefinition().groupByAttributes || []),
      ]) {
        expect(summary).toMatch(new RegExp(`(^| )${key}=`));
      }
    });

    it("writes output metrics the server lets a recording rule write", () => {
      for (const name of [
        "sdwan.gateway.latency.ms",
        "sdwan.gateway.jitter.ms",
        "sdwan.gateway.packet_loss.percent",
      ]) {
        expect(page).toContain(`\`${name}\``);
        expect(() => {
          MetricRecordingRuleService.assertOutputMetricNameAllowed(name);
        }).not.toThrow();
      }
    });

    it("alerts per gateway with a Metrics monitor's Group By, linking to where that is explained", () => {
      const metricsMonitorPage: string = fs.readFileSync(
        METRICS_MONITOR_PAGE_FILE,
        "utf8",
      );
      const anchor: string = slugify("Per-Series Alerting (Group By)");

      expect(headings(metricsMonitorPage)).toContain(
        "Per-Series Alerting (Group By)",
      );
      expect(page).toContain(`(/docs/monitor/metrics-monitor#${anchor})`);
      expect(page).toContain("**Group By** `gw_name` and `profile_name`");

      // The aggregation strategies it names are the monitor's own.
      for (const strategy of ["All Values", "Average"]) {
        expect(metricsMonitorPage).toContain(`| ${strategy} `);
        expect(page).toContain(`**${strategy}**`);
      }
    });
  });

  it("lists the four permissions under their catalogue titles", () => {
    const props: Array<PermissionProps> =
      PermissionHelper.getAllPermissionProps();

    for (const permission of [
      Permission.CreateProjectLogRecordingRule,
      Permission.EditProjectLogRecordingRule,
      Permission.DeleteProjectLogRecordingRule,
      Permission.ReadProjectLogRecordingRule,
    ]) {
      const entry: PermissionProps | undefined = props.find(
        (candidate: PermissionProps): boolean => {
          return candidate.permission === permission;
        },
      );

      expect(entry).toBeDefined();
      expect(page).toContain(`| ${entry!.title} `);
    }
  });
});
