import { readPage } from "./DocsContentSupport";
import KubernetesEventAttribute, {
  KUBERNETES_WARNING_EVENT_SEVERITY_NUMBER,
  ParsedKubernetesEvent,
  getKubernetesEventLogAttributes,
  getKubernetesEventSeverityNumber,
  parseKubernetesEventFromLogBody,
} from "Common/Types/Kubernetes/KubernetesEvent";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { TABLE_FOLDED_COLUMNS_BELOW_WIDTH_IN_PX } from "Common/UI/Components/Table/FoldedColumns";
import {
  KUBERNETES_WARNING_EVENTS_GROUP_BY,
  KUBERNETES_WARNING_EVENTS_WINDOW_SECONDS,
  KubernetesEventAlertTemplate,
  getKubernetesWarningEventsTemplate,
} from "Common/Types/Monitor/KubernetesEventAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import {
  KubernetesEventFields,
  issue5179Events,
  kubernetesEventObject,
  storedBody,
  watchedEventBody,
} from "Common/Tests/Helpers/KubernetesEventRecords";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English Kubernetes Agent page's "Kubernetes events" section says
 * (issue #5179), held to the product: the attributes it lists are the ones
 * ingest stamps on an Event's record, with the values it stamps for the
 * issue's OOM kill; the columns it explains are the Events table's; the
 * places it sends a reader to - the Events page under Telemetry, every
 * resource's Events tab, the Overview's Recent Warnings, the Warnings and
 * All buttons - are where the Dashboard draws them; and the troubleshooting
 * command reads the collector that watches the Events.
 * InfrastructureAgentDocsTranslations holds the 16 translations to the
 * English page, line for line.
 */

const PAGE: string = "telemetry/kubernetes-agent";
const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Dashboard/src",
);

const SECTION_HEADING: string = "## Kubernetes events";
const TABLE_DELIMITER_ROW: RegExp = /^\|\s*-/;
const COLUMN_TITLE: RegExp = /title: "([^"]+)"/g;
const BACKTICKED: RegExp = /^`([^`]+)`$/;

function dashboardFile(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

const english: string = readPage("en", PAGE);

// The section, from its heading to the next heading of its level.
function eventsSection(): string {
  const start: number = english.indexOf(`\n${SECTION_HEADING}\n`);

  if (start < 0) {
    throw new Error(`No "${SECTION_HEADING}" section on ${PAGE}`);
  }

  const end: number = english.indexOf("\n## ", start + 1);

  return english.slice(start, end < 0 ? english.length : end);
}

// The body rows of the table under a heading of the section, as cells.
function tableUnder(heading: string): Array<Array<string>> {
  const section: string = eventsSection();
  const start: number = section.indexOf(`\n${heading}\n`);

  if (start < 0) {
    throw new Error(`No "${heading}" in the Kubernetes events section`);
  }

  const lines: Array<string> = section.slice(start).split("\n").slice(2);
  const rows: Array<Array<string>> = [];
  let inTable: boolean = false;

  for (const line of lines) {
    if (line.startsWith("#")) {
      break;
    }

    if (!line.startsWith("|")) {
      if (inTable) {
        break;
      }
      continue;
    }

    inTable = true;

    if (TABLE_DELIMITER_ROW.test(line)) {
      continue;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  // The first row is the header.
  return rows.slice(1);
}

function unbacktick(cell: string): string {
  const match: RegExpExecArray | null = BACKTICKED.exec(cell);

  if (!match) {
    throw new Error(`Expected a code span, got ${cell}`);
  }

  return match[1]!;
}

// What ingest stamps on the record of the issue's OOM kill on a node.
function stampedOomKill(): Record<string, string> {
  const oom: KubernetesEventFields = issue5179Events(new Date())[0]!;
  const parsed: ParsedKubernetesEvent | null = parseKubernetesEventFromLogBody(
    storedBody(watchedEventBody("MODIFIED", kubernetesEventObject(oom))),
  );

  if (!parsed) {
    throw new Error("The issue's OOM kill did not parse");
  }

  return getKubernetesEventLogAttributes(parsed);
}

describe("the Kubernetes events section of the Kubernetes Agent page", () => {
  test("lists only attributes ingest stamps, with the values it stamps for the issue's OOM kill", () => {
    const rows: Array<Array<string>> = tableUnder(
      "### Search and alert on events",
    );
    const known: Array<string> = Object.values(KubernetesEventAttribute);
    const stamped: Record<string, string> = stampedOomKill();

    expect(rows.length).toBeGreaterThanOrEqual(8);

    for (const [attributeCell, exampleCell] of rows) {
      const attribute: string = unbacktick(attributeCell!);
      const example: string = unbacktick(exampleCell!);

      expect(known).toContain(attribute);
      expect(stamped[attribute]).toBeDefined();

      if (attribute === KubernetesEventAttribute.Message) {
        // The page shows how the message starts.
        expect(stamped[attribute]!.startsWith(example)).toBe(true);
      } else {
        expect(stamped[attribute]).toBe(example);
      }
    }

    // Every attribute a reader filters warnings by is there.
    const listed: Array<string> = rows.map((row: Array<string>): string => {
      return unbacktick(row[0]!);
    });
    expect(listed).toEqual(
      expect.arrayContaining([
        KubernetesEventAttribute.Type,
        KubernetesEventAttribute.Reason,
        KubernetesEventAttribute.Message,
        KubernetesEventAttribute.Count,
        KubernetesEventAttribute.ReportingController,
        KubernetesEventAttribute.ObjectKind,
        KubernetesEventAttribute.ObjectName,
        KubernetesEventAttribute.Namespace,
      ]),
    );
  });

  test("a warning is stored with the Warning severity, as the page says", () => {
    expect(eventsSection()).toContain(
      `A warning is stored with the **${LogSeverity.Warning}** severity`,
    );
    // An agent that sends every Event as INFO (9) still gets a Warning (13).
    expect(
      getKubernetesEventSeverityNumber({
        eventType: "Warning",
        severityNumber: 9,
      }),
    ).toBe(KUBERNETES_WARNING_EVENT_SEVERITY_NUMBER);
    expect(KUBERNETES_WARNING_EVENT_SEVERITY_NUMBER).toBe(13);
  });

  test("explains the Events table's columns, in the table's order", () => {
    const documented: Array<string> = tableUnder("### What an event shows").map(
      (row: Array<string>): string => {
        return row[0]!;
      },
    );
    const drawn: Array<string> = Array.from(
      dashboardFile("Components/Kubernetes/KubernetesEventsTable.tsx").matchAll(
        COLUMN_TITLE,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    // The namespace sits beside the object's name, not in a column of its own.
    expect(drawn).toEqual(["Event", "Object", "Count", "Last seen"]);
    expect(documented).toEqual(drawn);
    const objectRow: Array<string> | undefined = tableUnder(
      "### What an event shows",
    ).find((row: Array<string>): boolean => {
      return row[0] === "Object";
    });
    expect(objectRow?.[1]).toContain(
      "with the namespace the event is in beside its name",
    );
    // ...as the table draws it: a namespace chip inside the Object cell.
    const table: string = dashboardFile(
      "Components/Kubernetes/KubernetesEventsTable.tsx",
    );
    const objectCell: string = table.slice(
      table.indexOf("const ObjectCell"),
      table.indexOf("const KubernetesEventsTable"),
    );
    expect(objectCell).toContain("<KubernetesNamespaceChip");
    expect(objectCell).toContain('dataTestId="kubernetes-event-namespace"');
  });

  /*
   * Below lg the Events table leaves Count and Last seen out and draws them
   * in the Event's lines (Column.hideBelowLargeScreen): beside the cluster's
   * side menu at 768px its four columns ran past the card.
   */
  test("says that below 1024 pixels the Event column also shows Count and Last seen, as the table draws them", () => {
    expect(eventsSection()).toContain(
      "On a screen narrower than 1024 pixels, the **Event** column also shows **Count** and **Last seen**, which have no columns of their own there.",
    );
    expect(TABLE_FOLDED_COLUMNS_BELOW_WIDTH_IN_PX).toBe(1024);

    // Each column's definition, from its title to the next one's.
    const table: string = dashboardFile(
      "Components/Kubernetes/KubernetesEventsTable.tsx",
    );
    const folded: Record<string, boolean> = {};
    for (const title of ["Event", "Object", "Count", "Last seen"]) {
      const start: number = table.indexOf(`title: "${title}"`);
      expect([title, start >= 0]).toEqual([title, true]);
      const next: number = table.indexOf("title: ", start + 1);
      const definition: string = table.slice(
        start,
        next < 0 ? table.length : next,
      );
      folded[title] = definition.includes("hideBelowLargeScreen: true");
    }

    expect(folded).toEqual({
      Event: false,
      Object: false,
      Count: true,
      "Last seen": true,
    });
  });

  test("sends a reader where the Dashboard draws the warnings", () => {
    const section: string = eventsSection();

    // The cluster's Events page, under Telemetry in its side menu.
    expect(section).toContain(
      "The cluster's **Events** page, under **Telemetry**",
    );
    const sideMenu: string = dashboardFile(
      "Pages/Kubernetes/View/SideMenu.tsx",
    );
    const telemetryStart: number = sideMenu.indexOf(
      '<SideMenuSection title="Telemetry"',
    );
    const telemetryEnd: number = sideMenu.indexOf(
      "</SideMenuSection>",
      telemetryStart,
    );
    expect(telemetryStart).toBeGreaterThan(-1);
    const telemetry: string = sideMenu.slice(telemetryStart, telemetryEnd);
    expect(telemetry).toContain('title: "Events"');
    expect(telemetry).toContain("PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS");
    expect(
      sideMenu.split("PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS").length - 1,
    ).toBe(1);

    // Every resource's Events tab.
    expect(section).toContain("has an **Events** tab");
    expect(
      dashboardFile("Components/Kubernetes/KubernetesEventsTab.tsx"),
    ).toContain('name: "Events"');

    // The Overview's Recent Warnings.
    expect(section).toContain("**Recent Warnings**");
    expect(
      dashboardFile("Components/Kubernetes/KubernetesRecentWarningsCard.tsx"),
    ).toContain('title="Recent Warnings"');

    // The Events page's Warnings and All buttons, named in Troubleshooting.
    expect(english).toContain("choose **Warnings** or **All**");
    const eventsPage: string = dashboardFile(
      "Pages/Kubernetes/View/Events.tsx",
    );
    expect(eventsPage).toContain('translationKey("Warnings")');
    expect(eventsPage).toContain('translationKey("All")');
  });

  test("the troubleshooting command reads the logs of the collector that watches the Events", () => {
    const command: string =
      "kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector";
    expect(english).toContain(command);

    const deployment: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "HelmChart/Public/kubernetes-agent/templates/deployment.yaml",
      ),
      "utf8",
    );
    expect(deployment).toContain("component: metrics-collector");
    expect(deployment).toContain("- name: otel-collector");

    // That collector's config is the one that watches the Events.
    expect(deployment).toContain("-deployment");
    const configMap: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "HelmChart/Public/kubernetes-agent/templates/configmap-deployment.yaml",
      ),
      "utf8",
    );
    expect(configMap).toContain("- name: events\n            mode: watch");
  });
});

/*
 * Follow-up of #5201: the page tells a reader how to be alerted on warning
 * events - the Warning Events recommendation, or the Events page's line -
 * and what the alert does. Held to the template and the Dashboard.
 */
describe("the Kubernetes events section's alert", () => {
  const ALERT_PARAGRAPH_START: string = "Search them in **Logs**";

  function alertParagraph(): string {
    const line: string | undefined = eventsSection()
      .split("\n")
      .find((candidate: string): boolean => {
        return candidate.startsWith(ALERT_PARAGRAPH_START);
      });

    if (!line) {
      throw new Error("No alert paragraph in the Kubernetes events section");
    }

    return line;
  }

  test("names the recommendation as the catalog names it, and where it is", () => {
    const template: KubernetesEventAlertTemplate =
      getKubernetesWarningEventsTemplate();

    expect(alertParagraph()).toContain(
      `turn on **${template.name}** on the cluster's **Recommendations** page`,
    );
    expect(dashboardFile("Pages/Kubernetes/View/SideMenu.tsx")).toContain(
      "PageMap.KUBERNETES_CLUSTER_VIEW_RECOMMENDATIONS",
    );
  });

  test("names the Events page's link as the line draws it", () => {
    expect(alertParagraph()).toContain(
      "select **Turn on warning alerts** at the foot of its **Events** page",
    );
    expect(
      dashboardFile(
        "Components/Kubernetes/KubernetesWarningEventsAlertLine.tsx",
      ),
    ).toContain('translator.translateText("Turn on warning alerts")');
  });

  test("says what the alert does, as the template builds it", () => {
    const window: number = KUBERNETES_WARNING_EVENTS_WINDOW_SECONDS / 60;

    expect(alertParagraph()).toContain(
      `raises one alert per object and reason, and resolves it once ${window} minutes pass without a new warning about it`,
    );
    // Per object and reason: the template splits by the object and the reason.
    expect(KUBERNETES_WARNING_EVENTS_GROUP_BY).toEqual(
      expect.arrayContaining([
        KubernetesEventAttribute.ObjectKind,
        KubernetesEventAttribute.ObjectName,
        KubernetesEventAttribute.Reason,
      ]),
    );
    // A Logs monitor, as the page links it.
    expect(alertParagraph()).toContain(
      "[Logs monitor](/docs/monitor/logs-monitor)",
    );
    expect(
      getKubernetesWarningEventsTemplate().getMonitorStep({
        clusterIdentifier: "c",
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "c",
      }).data?.logMonitor,
    ).toBeDefined();
  });

  test("the reason it says to filter on is the one ingest stamps", () => {
    expect(alertParagraph()).toContain(
      `add \`${KubernetesEventAttribute.Reason}\` to its filter`,
    );
  });
});
