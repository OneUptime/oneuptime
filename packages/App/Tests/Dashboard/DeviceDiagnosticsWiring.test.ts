import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3745: Ping / Traceroute from the topology drawer and the device
 * Overview.
 *
 * What is pinned here is wiring — which surface gates on which permission,
 * that the drawer's diagnostics are hidden rather than disabled, that the
 * pure view-model stays importable without a browser — none of which a type
 * checker sees and none of which the App suite can render (App/jest.config
 * sets testEnvironment "node"). Same technique as AddNeighborToMonitoringWiring
 * and NetworkTopologyPanelLayering: read the sources, strip the comments,
 * match the code.
 *
 * The logic these files wire together is asserted directly in
 * DeviceDiagnosticsViewModel.test.ts, and what a person sees in the drawer
 * in Common/Tests/App/Dashboard/DeviceDiagnostics.test.tsx.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");

const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

const MIGRATIONS_DIR: string = path.join(
  COMMON_ROOT,
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const IMPORT_SPECIFIER_PATTERN: RegExp = /from\s+"([^"]+)"/g;
const BROWSER_BOUND_MODULE_PATTERN: RegExp =
  /Utils\/RouteMap|Utils\/PageMap|UI\/Utils\/Navigation|UI\/Utils\/ModelAPI/;
const EXPORTED_CLASS_PATTERN: RegExp = /export class (\w+)/;

function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readRaw(root: string, ...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(root, ...relativeParts), "utf8"),
  );
}

function readCode(root: string, ...relativeParts: Array<string>): string {
  return readRaw(root, ...relativeParts).replace(/\s+/g, " ");
}

const LIVE_VIEW: string = readCode(
  DASHBOARD_SRC,
  "Components",
  "Topology",
  "NetworkTopologyLiveView.tsx",
);

const PANEL: string = readCode(
  DASHBOARD_SRC,
  "Components",
  "Topology",
  "NetworkDeviceDetailPanel.tsx",
);

const OVERVIEW: string = readCode(
  DASHBOARD_SRC,
  "Pages",
  "NetworkDevice",
  "View",
  "Index.tsx",
);

const CARD: string = readCode(
  DASHBOARD_SRC,
  "Components",
  "NetworkDevice",
  "DeviceDiagnosticsCard.tsx",
);

const LATENCY_TREND: string = readCode(
  DASHBOARD_SRC,
  "Components",
  "NetworkDevice",
  "DeviceLatencyTrend.tsx",
);

const VIEW_MODEL_RAW: string = readRaw(
  DASHBOARD_SRC,
  "Components",
  "NetworkDevice",
  "DeviceDiagnosticsViewModel.ts",
);

const NETWORK_PATH_VIEW: string = readCode(
  DASHBOARD_SRC,
  "Components",
  "Monitor",
  "SummaryView",
  "NetworkPathView.tsx",
);

describe("the live view's diagnostics wiring", () => {
  /*
   * Hidden, not disabled. PermissionGate returns isAllowed:false with no
   * reason while the permission snapshot is in flight — every first paint
   * after a login or a project switch — so a disabled button would accuse
   * a permitted user of lacking a permission they hold. Same rule, same
   * shape, as the canCreateDevice gate beside it.
   */
  test("gates the drawer's buttons on the create permission for a diagnostic", () => {
    expect(LIVE_VIEW).toContain(
      'import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";',
    );
    expect(LIVE_VIEW).toMatch(
      /const canRunDiagnostics: boolean = PermissionGate\.check\( new NetworkDeviceDiagnostic\(\), ModelAction\.Create, \)\.isAllowed;/,
    );
  });

  test("hands the decision to the panel rather than deciding inside it", () => {
    expect(LIVE_VIEW).toContain("canRunDiagnostics={canRunDiagnostics}");
  });
});

describe("the detail panel's Connectivity section", () => {
  test("renders the two new children", () => {
    expect(PANEL).toContain(
      'import DeviceDiagnostics from "../NetworkDevice/DeviceDiagnostics";',
    );
    expect(PANEL).toContain(
      'import DeviceLatencyTrend from "../NetworkDevice/DeviceLatencyTrend";',
    );
    expect(PANEL).toContain('data-testid="network-topology-connectivity"');
  });

  test("takes the permission as an optional prop, so the panel still renders without it", () => {
    expect(PANEL).toContain("canRunDiagnostics?: boolean | undefined;");
  });

  /*
   * The trend is read-only and shows for everyone; only the buttons that
   * create a row are behind the permission.
   */
  test("gates the buttons, and only the buttons, on that prop", () => {
    expect(PANEL).toMatch(
      /props\.canRunDiagnostics \?[\s\S]*?<DeviceDiagnostics/,
    );
    expect(PANEL).not.toMatch(
      /props\.canRunDiagnostics[^]*?<DeviceLatencyTrend/,
    );
  });

  /*
   * The drawer is re-rendered, not remounted, for the next node the operator
   * clicks. Without a per-node key the trend and the diagnostics keep the
   * previous device's state — a fetch in flight, a run being polled — and
   * paint it under the new device's name.
   */
  test("keys the section per node so its children remount per device", () => {
    expect(PANEL).toMatch(
      /<div key=\{node\.id\} data-testid="network-topology-connectivity"\s*>/,
    );
  });

  test("decides which nodes qualify with the shared pure rule", () => {
    expect(PANEL).toContain("canRunDiagnosticsOnNode(node)");
  });

  test("sits above the Links list, where 'is it reachable' is read first", () => {
    const connectivityAt: number = PANEL.indexOf(
      'data-testid="network-topology-connectivity"',
    );
    const linksAt: number = PANEL.indexOf('translateString("Links")');

    expect(connectivityAt).toBeGreaterThan(-1);
    expect(linksAt).toBeGreaterThan(connectivityAt);
  });
});

describe("the pure view-model", () => {
  /*
   * RouteMap → ProjectUtil → Common/UI/Config reads `window` at module load
   * (LockedTelemetryScopeLink.test.ts explains the chain), and ModelAPI
   * pulls the same in. The App suite imports this module statically, so a
   * single such import would take DeviceDiagnosticsViewModel.test.ts down
   * with a ReferenceError long before any assertion ran.
   */
  /*
   * The one import outside Common/Types is the ping rows' (i) texts. That
   * module is plain data — the MetricDescriptionsCatalog test holds every
   * module in that folder to it — and the test below proves it imports
   * nothing at all, so it cannot drag `window` in either.
   */
  const METRIC_DESCRIPTIONS_SPECIFIER: string =
    "../MetricDescriptions/NetworkDeviceMetricDescriptions";

  test("imports nothing that reads window at load", () => {
    const specifiers: Array<string> = [];
    let match: RegExpExecArray | null = null;

    IMPORT_SPECIFIER_PATTERN.lastIndex = 0;
    while ((match = IMPORT_SPECIFIER_PATTERN.exec(VIEW_MODEL_RAW)) !== null) {
      specifiers.push(match[1]!);
    }

    expect(specifiers.length).toBeGreaterThan(0);

    for (const specifier of specifiers) {
      expect([
        specifier,
        specifier.startsWith("Common/Types/") ||
          specifier === METRIC_DESCRIPTIONS_SPECIFIER,
      ]).toEqual([specifier, true]);
      expect(BROWSER_BOUND_MODULE_PATTERN.test(specifier)).toBe(false);
    }
  });

  test("the metric descriptions it reads import nothing at all", () => {
    const descriptions: string = readRaw(
      DASHBOARD_SRC,
      "Components",
      "MetricDescriptions",
      "NetworkDeviceMetricDescriptions.ts",
    );

    expect(descriptions).not.toMatch(/\bimport\b/);
    expect(descriptions).not.toMatch(/\brequire\(/);
  });
});

describe("the device Overview page", () => {
  test("mounts the Connectivity tools card after Connected to", () => {
    expect(OVERVIEW).toContain(
      'import DeviceDiagnosticsCard from "../../../Components/NetworkDevice/DeviceDiagnosticsCard";',
    );

    const attachmentAt: number = OVERVIEW.indexOf("<DeviceAttachmentCard");
    const diagnosticsAt: number = OVERVIEW.indexOf("<DeviceDiagnosticsCard");

    expect(attachmentAt).toBeGreaterThan(-1);
    expect(diagnosticsAt).toBeGreaterThan(attachmentAt);
  });

  /*
   * The card is mounted for everyone who can see the device: its latency
   * trend is read-only. Only the Ping / Traceroute buttons inside it are
   * behind the create permission — hidden, not disabled, for the same
   * reason as the drawer's — and the card is handed that decision rather
   * than making it, so both surfaces gate the same way.
   */
  test("mounts the card unconditionally and hands it the permission", () => {
    expect(OVERVIEW).toMatch(
      /const canRunDiagnostics: boolean = PermissionGate\.check\( new NetworkDeviceDiagnostic\(\), ModelAction\.Create, \)\.isAllowed;/,
    );
    expect(OVERVIEW).toContain(
      "<DeviceDiagnosticsCard modelId={modelId} canRunDiagnostics={canRunDiagnostics} />",
    );
    expect(OVERVIEW).not.toMatch(
      /canRunDiagnostics \?\s*\(?\s*<DeviceDiagnosticsCard/,
    );
  });

  test("the card is the one the docs name, and gates only the buttons", () => {
    expect(CARD).toContain('title="Connectivity tools"');
    expect(CARD).toContain("canRunDiagnostics: boolean;");
    expect(CARD).toContain("<DeviceLatencyTrend");
    expect(CARD).toMatch(
      /props\.canRunDiagnostics \?[\s\S]*?<DeviceDiagnostics/,
    );
    expect(CARD).not.toMatch(
      /props\.canRunDiagnostics[^]*?<DeviceLatencyTrend/,
    );
  });

  /*
   * DeviceDiagnostics reads the device itself, so the drawer and the card
   * say "no probe assigned" from the same read; a second read here would
   * be the same request twice per page.
   */
  test("the card fetches nothing of its own", () => {
    expect(CARD).not.toContain("ModelAPI");
  });
});

describe("the traceroute hop table", () => {
  /*
   * One table for the Network monitor's failure evidence and the device
   * traceroute, so the "* * *" spelling and the red-row rule cannot drift.
   */
  test("is shared with NetworkPathView rather than copied", () => {
    expect(NETWORK_PATH_VIEW).toContain(
      'import TracerouteHopsTable from "../../NetworkDevice/TracerouteHopsTable";',
    );
    expect(NETWORK_PATH_VIEW).toContain("<TracerouteHopsTable hops=");
  });
});

describe("the ping round-trip-time metric name", () => {
  /*
   * The dashboard reads the series the server writes. Both sides spelling
   * the name from one Common/Types constant is what keeps the sparkline
   * pointed at the right series; a server-module import in the dashboard
   * would drag the telemetry SDK into the browser bundle. That the server
   * util still exports the same VALUE is asserted by value, against the
   * real module, in Common/Tests/App/Dashboard/DeviceLatencyTrend.test.tsx
   * — a source-text pin on the server file is the #3622 trap.
   */
  test("is read by the trend from Common/Types, never from Common/Server", () => {
    expect(LATENCY_TREND).toContain(
      'import { NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME } from "Common/Types/NetworkDevice/NetworkDevicePingMetricNames";',
    );
    expect(LATENCY_TREND).not.toContain("Common/Server/");
  });
});

describe("the NetworkDeviceDiagnostic migration", () => {
  /*
   * A generated migration that is not in the Index never runs, and the
   * first create then fails with "relation does not exist". Only asserted
   * when a migration exists, because the coordinator generates it after the
   * model lands.
   */
  test("is registered in the migrations Index when one has been generated", () => {
    const migrationFiles: Array<string> = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name: string): boolean => {
        return name.endsWith(".ts") && name.includes("NetworkDeviceDiagnostic");
      });

    if (migrationFiles.length === 0) {
      return;
    }

    const index: string = readCode(MIGRATIONS_DIR, "Index.ts");

    for (const file of migrationFiles) {
      const source: string = readRaw(MIGRATIONS_DIR, file);
      const match: RegExpMatchArray | null = source.match(
        EXPORTED_CLASS_PATTERN,
      );

      expect([file, match !== null]).toEqual([file, true]);
      expect([file, index.includes(match![1]!)]).toEqual([file, true]);
    }
  });
});
