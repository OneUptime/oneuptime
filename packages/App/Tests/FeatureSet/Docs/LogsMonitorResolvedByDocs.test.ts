import { readPage, scanMarkdown, DocsHeading } from "./DocsContentSupport";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import LogSeverity from "Common/Types/Log/LogSeverity";
import MonitorStepLogMonitor, {
  MAX_LOG_MONITOR_RESOLVED_BY_ATTRIBUTES,
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import NetworkEventAlertTemplates, {
  NetworkEventAlertTemplate,
  NetworkEventAlertTemplateId,
} from "Common/Types/NetworkEvent/NetworkEventAlertTemplates";
import NetworkEventAttribute from "Common/Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "Common/Types/NetworkEvent/NetworkEventType";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Resolved by a log" section of the English Logs monitor page, held to
 * the code that makes it true (#4728).
 *
 * The section says when the field is there, how many attributes it takes,
 * which of the monitor's filters a resolving log must still meet, and walks
 * through a VPN tunnel whose alert stays open until the tunnel is reported
 * up - the monitor the Network Events page creates. Each is read from its
 * source here: the step's own helpers in Common, the form the Dashboard
 * draws (read as text), and the alert the Events page offers. The
 * translations are held to the English page by
 * TelemetryMonitorAndStatusPageDocsTranslations.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const PAGE_NAME: string = "monitor/logs-monitor";
const PAGE: string = readPage("en", PAGE_NAME);
const FORM: string = fs.readFileSync(
  path.join(
    PACKAGES_DIR,
    "App/FeatureSet/Dashboard/src/Components/Form/Monitor/LogMonitor/LogMonitorStepFrom.tsx",
  ),
  "utf8",
);

const SECTION_HEADING: string = "### Resolved by a log";
const FIELD: string = "Resolved by Attributes";

// The section's lines: from its heading to the next heading.
const SECTION: string = ((): string => {
  const lines: Array<string> = PAGE.split("\n");
  const start: number = lines.indexOf(SECTION_HEADING);
  const end: number = lines.findIndex(
    (line: string, index: number): boolean => {
      return index > start && line.startsWith("#");
    },
  );

  return start < 0 ? "" : lines.slice(start, end).join("\n");
})();

// The form shows the field only once the monitor is grouped.
const SHOWN_ONCE_GROUPED: RegExp =
  /title: "Resolved by Attributes",[\s\S]*?showIf: \([\s\S]*?MonitorStepLogMonitorUtil\.getGroupByAttributes\(\{[\s\S]*?\}\)\.length > 0/;

function step(
  overrides: Partial<MonitorStepLogMonitor>,
): MonitorStepLogMonitor {
  return { ...MonitorStepLogMonitorUtil.getDefault(), ...overrides };
}

describe("the Logs monitor page: Resolved by a log", () => {
  it("has the section, in Per-group alerting, after the rule it is the exception to", () => {
    const headings: Array<string> = scanMarkdown(PAGE).headings.map(
      (heading: DocsHeading): string => {
        return `${"#".repeat(heading.level)} ${heading.text}`;
      },
    );
    const at: number = headings.indexOf(SECTION_HEADING);

    expect(at).toBeGreaterThan(-1);
    expect(headings[at - 1]).toBe("### Independent resolution");
    expect(
      headings
        .slice(0, at)
        .reverse()
        .find((heading: string): boolean => {
          return heading.startsWith("## ");
        }),
    ).toBe("## Per-group alerting (Group By)");
    expect(PAGE).toContain(
      "whether or not the tunnel is back - unless the monitor names the log that says it is back, as below.",
    );
  });

  it("names the field as the form does, and lists it among the fields the form shows", () => {
    expect(FORM).toContain(`title: "${FIELD}",`);
    expect(SECTION).toContain(`**${FIELD}** names that log`);
    expect(PAGE).toContain(
      `| **${FIELD}** | Not a filter: the log that resolves a group. Shows once **Group by Attributes** has an attribute; see [Resolved by a log](#resolved-by-a-log). | Empty: a group resolves when its logs stop |`,
    );
  });

  it("says the field shows once the monitor is grouped, as the form and the step agree", () => {
    expect(FORM).toMatch(SHOWN_ONCE_GROUPED);
    expect(SECTION).toContain(
      "The field shows once **Group by Attributes** has an attribute.",
    );

    const attributes: Record<string, string> = {
      [NetworkEventAttribute.Name]: NetworkEventType.VpnTunnelUp,
    };

    // Ungrouped, the setting is ignored whole: there is no group to resolve.
    expect(
      MonitorStepLogMonitorUtil.isResolvedByLog(
        step({ groupByAttributes: [], resolvedByAttributes: attributes }),
      ),
    ).toBe(false);
    expect(
      MonitorStepLogMonitorUtil.isResolvedByLog(
        step({
          groupByAttributes: [NetworkEventAttribute.VpnTunnelName],
          resolvedByAttributes: attributes,
        }),
      ),
    ).toBe(true);
    // Empty: a group resolves when its logs stop.
    expect(
      MonitorStepLogMonitorUtil.isResolvedByLog(
        step({
          groupByAttributes: [NetworkEventAttribute.VpnTunnelName],
          resolvedByAttributes: {},
        }),
      ),
    ).toBe(false);
  });

  it("gives the number of attributes the step keeps", () => {
    const many: Record<string, string> = {};

    for (
      let index: number = 0;
      index < MAX_LOG_MONITOR_RESOLVED_BY_ATTRIBUTES + 5;
      index++
    ) {
      many[`attribute.${index}`] = "value";
    }

    expect(
      Object.keys(
        MonitorStepLogMonitorUtil.getResolvedByAttributes(
          step({
            groupByAttributes: [NetworkEventAttribute.Device],
            resolvedByAttributes: many,
          }),
        ),
      ),
    ).toHaveLength(MAX_LOG_MONITOR_RESOLVED_BY_ATTRIBUTES);
    expect(SECTION).toContain(
      `It takes up to ${MAX_LOG_MONITOR_RESOLVED_BY_ATTRIBUTES} attributes, and a resolving log carries all of them.`,
    );
  });

  it("looks for resolving logs in the monitor's services and window, without its text and severity filters", () => {
    const monitor: MonitorStepLogMonitor = step({
      body: "terminated",
      severityTexts: [LogSeverity.Error],
      telemetryServiceIds: [ObjectID.generate()],
      attributes: {
        [NetworkEventAttribute.Name]: NetworkEventType.VpnTunnelDown,
      },
      groupByAttributes: [NetworkEventAttribute.VpnTunnelName],
      resolvedByAttributes: {
        [NetworkEventAttribute.Name]: NetworkEventType.VpnTunnelUp,
      },
      lastXSecondsOfLogs: 300,
    });
    const counted: Record<string, unknown> = MonitorStepLogMonitorUtil.toQuery(
      monitor,
    ) as Record<string, unknown>;
    const resolving: Record<string, unknown> =
      MonitorStepLogMonitorUtil.toResolvedByQuery(monitor) as Record<
        string,
        unknown
      >;

    // The problem's own filters are on the logs it counts...
    expect(counted["body"]).toBeDefined();
    expect(counted["severityText"]).toBeDefined();
    // ...and not on the logs that resolve it.
    expect(resolving["body"]).toBeUndefined();
    expect(resolving["severityText"]).toBeUndefined();
    expect(resolving["attributes"]).toEqual({
      [NetworkEventAttribute.Name]: NetworkEventType.VpnTunnelUp,
    });
    // The services and the window are the monitor's.
    expect(resolving["primaryEntityId"]).toBeInstanceOf(Includes);
    expect(resolving["time"]).toBeInstanceOf(InBetween);
    expect(SECTION).toContain(
      "The monitor's telemetry services and time window apply to resolving logs too. Its text and severity filters do not: they describe the problem.",
    );
  });

  it("walks through the monitor the Network Events page creates for a VPN tunnel", () => {
    const template: NetworkEventAlertTemplate = NetworkEventAlertTemplates.get(
      NetworkEventAlertTemplateId.VpnTunnelDown,
    ) as NetworkEventAlertTemplate;

    expect(template.attributes[NetworkEventAttribute.Name]).toBe(
      NetworkEventType.VpnTunnelDown,
    );
    expect(template.groupByAttributes).toEqual([
      NetworkEventAttribute.Device,
      NetworkEventAttribute.VpnTunnelName,
    ]);
    expect(template.resolvedByAttributes[NetworkEventAttribute.Name]).toBe(
      NetworkEventType.VpnTunnelUp,
    );
    expect(SECTION).toContain(
      `Take a monitor that counts logs with \`${NetworkEventAttribute.Name}\` = \`${NetworkEventType.VpnTunnelDown}\`, grouped by \`${NetworkEventAttribute.Device}\` and \`${NetworkEventAttribute.VpnTunnelName}\`, with **${FIELD}** set to \`${NetworkEventAttribute.Name}\` = \`${NetworkEventType.VpnTunnelUp}\`.`,
    );
    expect(SECTION).toContain(
      "[Network Events](/docs/monitor/network-events) creates these monitors for you, one click per alert.",
    );
  });

  it("is the heading the Network Events page sends its readers to", () => {
    const anchor: string | undefined = scanMarkdown(PAGE).headings.find(
      (heading: DocsHeading): boolean => {
        return `### ${heading.text}` === SECTION_HEADING;
      },
    )?.slug;

    expect(anchor).toBe("resolved-by-a-log");
    expect(readPage("en", "monitor/network-events")).toContain(
      `](/docs/${PAGE_NAME}#${anchor})`,
    );
  });
});
