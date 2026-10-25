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
