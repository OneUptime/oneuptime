import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NETWORK DEVICES AS AFFECTED RESOURCES, ACROSS THE DASHBOARD (issue #5341).
 *
 * A customer read Affected Resources as "a lookup against Hosts": a
 * router could not be linked to an incident at all. Now it can, and a
 * device's own pages show what is linked to it: an Incidents and an Alerts
 * tab, under Activity in its menu, the open counts on its overview, and
 * Declare Incident / Create Alert from them keep the device picked. The
 * incidents and alerts tables list it and filter by it, the incident's and
 * alert's Affected Resources card shows it, and the create forms offer it.
 *
 * App's node test environment cannot render the pages, so their wiring is
 * pinned as comment-stripped, whitespace-squashed source; what they do is
 * rendered in Common/Tests/App/Dashboard (AffectedResourcesDisplay,
 * AffectedResourcesPickerSearch, NetworkDeviceViewSideMenu and its counts).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

// The route map holds `/*`, which a comment stripper misreads: read whole.
function readWhole(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(WHITESPACE, " ");
}

describe("a device's Incidents and Alerts tabs", () => {
  test.each([
    ["NETWORK_DEVICE_VIEW_INCIDENTS", "incidents"],
    ["NETWORK_DEVICE_VIEW_ALERTS", "alerts"],
  ])(
    "%s is a page of the device at :id/%s",
    (pageKey: string, segment: string) => {
      expect(readCode("Utils/PageMap.ts")).toContain(
        `${pageKey} = "${pageKey}",`,
      );
      expect(readCode("Utils/RouteMap.ts")).toContain(
        `[PageMap.${pageKey}]: \`\${RouteParams.ModelID}/${segment}\`,`,
      );
      expect(readWhole("Utils/RouteMap.ts")).toContain(
        `[PageMap.${pageKey}]: new Route( \`/dashboard/\${RouteParams.ProjectID}/network-devices/\${ NetworkDeviceRoutePath[PageMap.${pageKey}] }\`, ),`,
      );
    },
  );

  test("each is routed to its page, in the device's own layout", () => {
    const routes: string = readCode("Routes/NetworkDeviceRoutes.tsx");

    expect(routes).toContain(
      "path={RouteUtil.getLastPathForKey( PageMap.NETWORK_DEVICE_VIEW_INCIDENTS, )} element={ <NetworkDeviceIncidents {...props} pageRoute={ RouteMap[PageMap.NETWORK_DEVICE_VIEW_INCIDENTS] as Route } /> }",
    );
    expect(routes).toContain(
      "path={RouteUtil.getLastPathForKey(PageMap.NETWORK_DEVICE_VIEW_ALERTS)} element={ <NetworkDeviceAlerts {...props} pageRoute={RouteMap[PageMap.NETWORK_DEVICE_VIEW_ALERTS] as Route} /> }",
    );
    expect(routes).toMatch(
      /NetworkDeviceIncidents[^;]*from "\.\.\/Pages\/NetworkDevice\/View\/Incidents"/,
    );
    expect(routes).toMatch(
      /NetworkDeviceAlerts[^;]*from "\.\.\/Pages\/NetworkDevice\/View\/Alerts"/,
    );

    // The device's menu and its breadcrumbs, not the network's.
    const layout: string = readCode("Pages/Network/Layout.tsx");
    expect(layout).toContain("PageMap.NETWORK_DEVICE_VIEW_INCIDENTS,");
    expect(layout).toContain("PageMap.NETWORK_DEVICE_VIEW_ALERTS,");
  });

  test("each has its breadcrumbs: Project, Network, the device, the tab", () => {
    const crumbs: string = readCode("Pages/NetworkDevice/Utils/Breadcrumbs.ts");

    expect(crumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_INCIDENTS, [ "Project", "Network", "View Device", "Incidents", ])',
    );
    expect(crumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_ALERTS, [ "Project", "Network", "View Device", "Alerts", ])',
    );
  });

  test.each([
    ["Pages/NetworkDevice/View/Incidents.tsx", "IncidentsTable", "Incident"],
    ["Pages/NetworkDevice/View/Alerts.tsx", "AlertsTable", "Alert"],
  ])(
    "%s lists what is linked to the device, and creates with it picked",
    (file: string, table: string, model: string) => {
      const page: string = readCode(file);

      expect(page).toContain(
        `const query: Query<${model}> = { projectId: ProjectUtil.getCurrentProjectId()!, };`,
      );
      expect(page).toContain("query.networkDevices = new Includes([modelId]);");
      expect(page).toContain(
        `<${table} query={query} createFrom={{ kind: CreateFromRecordKind.NetworkDevice, id: modelId }} />`,
      );
    },
  );

  test("the device's overview counts its open incidents and alerts, linking to the tabs - no maintenance card", () => {
    const overview: string = readCode("Pages/NetworkDevice/View/Index.tsx");

    expect(overview).toContain(
      '<ResourceActivityCards modelId={modelId} resourceQueryKey="networkDevices" incidentsRoute={RouteUtil.populateRouteParams( RouteMap[PageMap.NETWORK_DEVICE_VIEW_INCIDENTS] as Route, { modelId: modelId }, )} alertsRoute={RouteUtil.populateRouteParams( RouteMap[PageMap.NETWORK_DEVICE_VIEW_ALERTS] as Route, { modelId: modelId }, )} />',
    );

    const activity: string = readCode(
      "Components/ResourceActivity/ResourceActivityCards.tsx",
    );
    expect(activity).toContain('| "networkDevices"');
  });

  test("the device's menu badges each tab with its open count, once the states are known", () => {
    const menu: string = readCode("Pages/NetworkDevice/View/SideMenu.tsx");

    expect(menu).toContain('<SideMenuSection title="Activity">');
    expect(menu).toContain(
      "countQuery={getNetworkDeviceOpenIncidentCountQuery({ projectId: projectId, networkDeviceId: props.modelId, unresolvedStateIds: unresolvedIncidentStateIds, })}",
    );
    expect(menu).toContain(
      "countQuery={getNetworkDeviceOpenAlertCountQuery({ projectId: projectId, networkDeviceId: props.modelId, unresolvedStateIds: unresolvedAlertStateIds, })}",
    );
    // Activity right after the pages of every visit, before the folded ones.
    expect(menu.indexOf('title="Activity"')).toBeGreaterThan(
      menu.indexOf('title="Device"'),
    );
    expect(menu.indexOf('title="Activity"')).toBeLessThan(
      menu.indexOf('title="More"'),
    );
  });
});

describe("Declare Incident and Create Alert from a device", () => {
  test("a device is a record a create page can be opened from", () => {
    const shared: string = readCode(
      "Components/CreateFromRecord/CreateFromRecord.ts",
    );

    expect(shared).toContain('NetworkDevice = "NetworkDevice",');
    expect(shared).toContain('queryParam: "networkDeviceId",');
    expect(shared).toContain('namedRecords("networkDevices")');
    expect(shared).toContain("page: PageMap.NETWORK_DEVICE_VIEW_INCIDENTS,");
    expect(shared).toContain("page: PageMap.NETWORK_DEVICE_VIEW_ALERTS,");

    expect(
      readCode("Components/CreateFromRecord/useRecordToCreateFrom.ts"),
    ).toContain("[CreateFromRecordKind.NetworkDevice]: NetworkDevice,");
  });
});

describe("the incident and alert forms, tables and cards", () => {
  test.each(["Pages/Incidents/Create.tsx", "Pages/Alerts/Create.tsx"])(
    "%s offers network devices right after hosts",
    (file: string) => {
      expect(readCode(file)).toContain(
        'const OTHER_AFFECTED_RESOURCE_TYPES: Array<AffectedResourceType> = [ "Host", "NetworkDevice", "KubernetesCluster",',
      );
    },
  );

  test("the incident's Affected Resources field says what it holds and where monitors are picked", () => {
    const fields: string = readCode(
      "Components/Incident/IncidentAffectedResourcesFormFields.tsx",
    );

    expect(fields).toContain(
      "networkDevices={values.networkDevices as Array<NetworkDevice>}",
    );
    expect(fields).toContain('monitorFieldTitle="Monitors"');
    expect(fields).toContain(
      '"Search and attach the hosts, network devices, clusters, databases, cloud resources or services this incident affects."',
    );
  });

  test.each([
    ["Components/Incident/IncidentsTable.tsx"],
    ["Components/Alert/AlertsTable.tsx"],
  ])(
    "%s reads each record's devices, lists them, and filters by them",
    (file: string) => {
      const source: string = readCode(file);

      expect(source).toContain(
        "networkDevices: { name: true, _id: true, projectId: true, },",
      );
      expect(source).toContain("includeNetworkDevice: true,");
    },
  );

  test.each([
    ["Pages/Incidents/View/Index.tsx"],
    ["Pages/Alerts/View/Index.tsx"],
  ])("%s shows the devices on the Affected Resources card", (file: string) => {
    const source: string = readCode(file);

    expect(source).toContain("networkDevices: { name: true, _id: true, },");
    expect(source).toContain("networkDevices={item.networkDevices || []}");
  });

  test("Ask AI names a network device it linked by its kind", () => {
    expect(readCode("Components/AIChat/ChatActivityFeed.tsx")).toContain(
      'NetworkDevice: translationKey("Network device"),',
    );
  });
});
