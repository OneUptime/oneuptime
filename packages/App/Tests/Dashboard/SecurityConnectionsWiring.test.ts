import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SECURITY_CONNECTION_KINDS,
  SecurityConnectionKind,
} from "Common/Types/SecurityCase/SecurityConnection";

/*
 * Where Security Events' connections are drawn, as the pages' sources say:
 * the Security card on each kind of record's page, by the record the page
 * is about; the incident page's Security card; a case's Connected Signals
 * page; an event's Connected tab; an entity's card. The cards themselves
 * are drawn in Common/Tests/App/Dashboard/SecurityConnectionsCards.test.tsx;
 * what is pinned here is that every page that should carry one does, about
 * its own record - a card on the wrong page, or about the wrong record,
 * reads like the right one.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function source(...parts: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8")
    .replace(/\s+/g, " ");
}

// Each kind's page, and the record it is about.
const RECORD_PAGES: ReadonlyArray<{
  kind: SecurityConnectionKind;
  page: Array<string>;
  modelId: string;
}> = [
  {
    kind: SecurityConnectionKind.Host,
    page: ["Pages", "Host", "View", "Overview.tsx"],
    modelId: "modelId",
  },
  {
    kind: SecurityConnectionKind.DockerHost,
    page: ["Pages", "Docker", "View", "Overview.tsx"],
    modelId: "modelId",
  },
  {
    kind: SecurityConnectionKind.PodmanHost,
    page: ["Pages", "Podman", "View", "Overview.tsx"],
    modelId: "modelId",
  },
  {
    kind: SecurityConnectionKind.KubernetesCluster,
    page: ["Pages", "Kubernetes", "View", "Index.tsx"],
    modelId: "modelId",
  },
  {
    kind: SecurityConnectionKind.NetworkDevice,
    page: ["Pages", "NetworkDevice", "View", "Index.tsx"],
    modelId: "modelId",
  },
  {
    kind: SecurityConnectionKind.Service,
    page: ["Pages", "Service", "View", "Index.tsx"],
    modelId: "modelId",
  },
  {
    kind: SecurityConnectionKind.User,
    page: ["Pages", "Users", "View", "Index.tsx"],
    modelId: "userId",
  },
  {
    kind: SecurityConnectionKind.InventoryItem,
    page: ["Pages", "Inventory", "View", "Index.tsx"],
    modelId: "modelId",
  },
  {
    kind: SecurityConnectionKind.CloudResource,
    page: ["Pages", "Cloud", "View", "MonitoredResourceOverview.tsx"],
    modelId: "modelId",
  },
  {
    kind: SecurityConnectionKind.ServerlessFunction,
    page: ["Pages", "Serverless", "View", "Overview.tsx"],
    modelId: "modelId",
  },
  {
    kind: SecurityConnectionKind.Monitor,
    page: ["Pages", "Monitor", "View", "Index.tsx"],
    modelId: "modelId",
  },
];

describe("the way back: a Security card on each record's page", () => {
  test("every kind of record has a page that carries one", () => {
    expect(
      RECORD_PAGES.map((entry: { kind: SecurityConnectionKind }) => {
        return entry.kind;
      }).sort(),
    ).toEqual([...SECURITY_CONNECTION_KINDS].sort());
  });

  test.each(RECORD_PAGES)(
    "the $kind page draws it about its own record",
    (entry: {
      kind: SecurityConnectionKind;
      page: Array<string>;
      modelId: string;
    }) => {
      const page: string = source(...entry.page);

      expect(page).toContain(
        'import ResourceSecurityCard from "../../../Components/SecurityConnections/ResourceSecurityCard";',
      );
      expect(page).toMatch(
        new RegExp(
          `<ResourceSecurityCard kind=\\{SecurityConnectionKind\\.${entry.kind}\\} modelId=\\{${entry.modelId}\\}`,
        ),
      );
      // Once.
      expect(page.split("<ResourceSecurityCard").length).toBe(2);
    },
  );

  test("a monitor's page draws it only for a monitor that checks a host, read again on a Refresh rather than every poll, its header stacked as the side column's cards are", () => {
    const page: string = source("Pages", "Monitor", "View", "Index.tsx");

    expect(page).toContain(
      'import { getMonitorTargetHosts } from "Common/Utils/SecurityCase/SecurityConnectionMatch";',
    );
    /*
     * Stacked: beside Open in Security Events, the one-third column would
     * squeeze its title and description into a column a word wide.
     */
    expect(page).toContain(
      '{getMonitorTargetHosts(monitor.monitorSteps).length > 0 ? ( <ResourceSecurityCard kind={SecurityConnectionKind.Monitor} modelId={modelId} refreshToken={data.manualRefreshCount} headerLayout="stacked" />',
    );
    // In the side column, right after what is open on the monitor.
    expect(
      page.indexOf("<MonitorOpenWorkCard monitorId={modelId}"),
    ).toBeLessThan(page.indexOf("<ResourceSecurityCard"));
    expect(page.indexOf("<ResourceSecurityCard")).toBeLessThan(
      page.indexOf("<MonitorStatusChangesCard"),
    );
  });

  test("an incident's page draws the cases behind it, about itself", () => {
    const page: string = source("Pages", "Incidents", "View", "Index.tsx");

    expect(page).toContain("<IncidentSecurityCard incidentId={modelId}");
    expect(page.split("<IncidentSecurityCard").length).toBe(2);
  });
});

describe("Connected Signals", () => {
  test("a case's page reads the case's", () => {
    const page: string = source(
      "Pages",
      "SecurityEvents",
      "CaseView",
      "ConnectedSignals.tsx",
    );

    expect(page).toContain("<ConnectedSignals request={{ caseId }}");
    expect(page).toContain("description={CONNECTED_SIGNALS_CASE_DESCRIPTION}");
  });

  test("an event's tab reads the event's values, its time and its log's record, inside the drawer", () => {
    const panel: string = source(
      "Components",
      "SecurityEvents",
      "SecurityEventDetailPanel.tsx",
    );

    expect(panel).toContain(
      "<ConnectedSignals request={{ entities: connectedEntities, ...(time ? { time } : {}), logResources, }}",
    );
    expect(panel).toContain("isEmbedded={true}");
    // Drawn - and read - only while its tab is open.
    expect(panel).toContain(
      "{activeTabId === SECURITY_EVENT_DETAIL_CONNECTED_TAB_ID ? ( <ConnectedSignals",
    );
  });

  test("an entity's page reads its value around its last event, with the logs behind its events", () => {
    const page: string = source(
      "Pages",
      "SecurityEvents",
      "EntityRiskView.tsx",
    );

    expect(page).toContain(
      "{isActivityLoaded ? ( <ConnectedSignals request={{ entities: [{ type, value: risk?.entityValue || value }], ...(activity?.lastSeen ? { time: new Date(activity.lastSeen) } : {}), readLogResources: true, }}",
    );
  });
});

/*
 * In your logs and traces: one section under every Connected Signals - a
 * case's page, an event's tab, an entity's page - read with the very
 * request the records are, on a route of its own beside theirs.
 */
describe("In your logs and traces", () => {
  test("Connected Signals draws it under its records, with its own request, key and refresh, read alongside theirs", () => {
    const component: string = source(
      "Components",
      "SecurityConnections",
      "ConnectedSignals.tsx",
    );

    expect(component).toContain(
      "<TelemetryMentions request={props.request} requestKey={props.requestKey} refreshToken={props.refreshToken} className={TELEMETRY_SECTION_CLASS_NAME} />",
    );
    // Once in the card, once in the event drawer - always after the records.
    expect(component).toContain("{body} {telemetry} </div>");
    expect(component).toContain("{body} {telemetry} </>");
    expect(component.split("<TelemetryMentions").length).toBe(2);
  });

  test("its request is the records' own: a case by its id, or an event's or an entity's values and time", () => {
    const api: string = source(
      "Components",
      "SecurityCase",
      "SecurityCaseApi.ts",
    );
    const call: string = api.slice(
      api.indexOf("public static async getTelemetryMentions("),
      api.indexOf("public static async getResourceSecurity("),
    );

    expect(call).toContain('"/security-case/connections/telemetry"');
    expect(call).toContain('"caseId" in request');
    expect(call).toContain("entities: request.entities.map(");
    expect(call).toContain(
      "request.time ? { time: request.time.toISOString() }",
    );
    // The records' knobs mean nothing to it.
    expect(call).not.toContain("logResources");
    expect(call).not.toContain("readLogResources");
  });

  test("the section reads on its own, and draws nothing for a case that names nothing searched for", () => {
    const section: string = source(
      "Components",
      "SecurityConnections",
      "TelemetryMentions.tsx",
    );

    expect(section).toContain(
      "SecurityCaseApi.getTelemetryMentions(props.request)",
    );
    expect(section).toContain(
      "if (!error && mentions && mentions.values.length === 0) { return <></>; }",
    );
  });
});
