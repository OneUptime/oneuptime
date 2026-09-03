import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3435: "Add to Monitoring" on an unmanaged neighbour in the network
 * topology.
 *
 * The decisions worth defending here are wiring, not logic — which component
 * holds which state, which variant of the refresh runs, whether the dialog is
 * mounted before it has anything to pre-fill from. None of it is expressible
 * as a type, and the App suite has no renderer (App/jest.config.json sets
 * testEnvironment "node"), so the relationships are pinned against the
 * sources — the same technique NetworkTopologyPanelLayering uses for the
 * panel's stacking order and NetworkFormStepsInvariants uses for form steps.
 *
 * The logic these files wire together is asserted directly, in
 * AdoptNeighborUtil.test.ts.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Comments are stripped before anything is matched. These files explain the
 * rules below in prose, and an assertion about the code has to read the code
 * rather than the commentary describing it.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  ).replace(/\s+/g, " ");
}

const PANEL: string = readCode(
  "Components",
  "Topology",
  "NetworkDeviceDetailPanel.tsx",
);

const LIVE_VIEW: string = readCode(
  "Components",
  "Topology",
  "NetworkTopologyLiveView.tsx",
);

const MODAL: string = readCode(
  "Components",
  "Topology",
  "AddNeighborToMonitoringModal.tsx",
);

describe("the detail panel's Add to Monitoring action", () => {
  /*
   * Optional for the same reason onHideNode is: a viewer who cannot create
   * devices is shown the panel without the action, rather than an action that
   * fails at submit.
   */
  test("is an optional prop, so the panel still renders without it", () => {
    expect(PANEL).toContain(
      "onAddToMonitoring?: ((node: NetworkTopologyNode) => void) | undefined;",
    );
  });

  test("renders the button only when the caller supplied a handler", () => {
    expect(PANEL).toContain("props.onAddToMonitoring ?");
  });

  test("carries a stable test id", () => {
    expect(PANEL).toContain('dataTestId="network-topology-add-to-monitoring"');
  });

  /*
   * The action fills the empty else-branch of the "Open -> Device details"
   * block, which is the panel's "this node has no device page" slot. Putting
   * it anywhere else would leave managed devices offering to be adopted.
   */
  test("is offered instead of the device link, never alongside it", () => {
    expect(PANEL).toMatch(
      /node\.isManaged \? \(.*?\) : props\.onAddToMonitoring \? \(/,
    );
  });
});

describe("the live view's adoption wiring", () => {
  /*
   * The panel does not decide which node kinds qualify — the same pure rule
   * the pre-fill uses decides, so the button and the form cannot disagree
   * about what is adoptable.
   */
  test("gates the action on the shared adoptability rule", () => {
    expect(LIVE_VIEW).toContain("isAdoptableNode(selectedNode)");
  });

  /*
   * Hidden, not disabled. PermissionGate returns isAllowed:false with no
   * reason when the permission snapshot has not landed yet — which is every
   * first paint after a login or a project switch — so a disabled button
   * would accuse a permitted user of lacking a permission they hold.
   */
  test("gates the action on the create permission for a device", () => {
    expect(LIVE_VIEW).toMatch(
      /PermissionGate\.check\( new NetworkDevice\(\), ModelAction\.Create, \)\.isAllowed/,
    );
    expect(LIVE_VIEW).toContain("canCreateDevice && isAdoptableNode");
  });

  /*
   * SideOver has no backdrop, so a drawer left open behind the dialog is a
   * second surface the user can still click through to. Hiding a node closes
   * the drawer the same way.
   */
  test("closes the detail drawer before opening the dialog", () => {
    expect(LIVE_VIEW).toMatch(
      /setSelectedNodeId\(null\); setNodeToAdopt\(node\);/,
    );
  });

  /*
   * BasicForm reads its initial values ONCE, on the first render in which
   * the fields exist. A dialog mounted before it has a node to pre-fill from
   * would read an empty form and never re-read it.
   */
  test("mounts the dialog only once there is a node to pre-fill from", () => {
    expect(LIVE_VIEW).toContain("{nodeToAdopt ? (");
    expect(LIVE_VIEW).toContain("key={nodeToAdopt.id}");
  });

  /*
   * Whether the new device absorbs the unmanaged node is decided server-side,
   * by re-deriving the whole graph from the neighbour reports. Patching local
   * state would show this user a map nobody else has.
   */
  test("refetches the graph after a device is created", () => {
    expect(LIVE_VIEW).toMatch(
      /onSuccess=\{\(\) => \{ setNodeToAdopt\(null\); fetchTopology\(true\)/,
    );
  });

  /*
   * The BACKGROUND variant. fetchTopology(false) shows the loader and
   * re-frames the map, which would yank the viewport out from under the
   * operator immediately after they acted. The foreground variant is
   * legitimate elsewhere in this file (the first load, the Refresh button),
   * so the assertion is scoped to the dialog's own block.
   */
  test("refetches in the background so the viewport survives", () => {
    const start: number = LIVE_VIEW.indexOf("<AddNeighborToMonitoringModal");
    const block: string = LIVE_VIEW.slice(start, start + 900);

    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("fetchTopology(true)");
    expect(block).not.toContain("fetchTopology(false)");
  });

  /*
   * A background refresh cannot fail loudly: fetchTopology swallows its own
   * errors on that path and keeps the last graph, so the promise it returns
   * always resolves. An error banner hung off that .catch would be
   * unreachable code pretending to be a safety net — and a test asserting on
   * its markup would pass forever without the banner rendering once.
   */
  test("treats a failed refresh as non-fatal, the way the scheduled one does", () => {
    expect(LIVE_VIEW).not.toContain("adoptionError");
    expect(LIVE_VIEW).not.toContain("network-topology-adoption-error");
  });
});

describe("the adoption dialog", () => {
  /*
   * Two ways of creating one kind of device would drift, and the second one
   * would be the one nobody remembers to update. The dialog reuses the same
   * helpers the Devices create form does rather than re-declaring them.
   */
  test("reuses the shared field helpers rather than re-declaring them", () => {
    expect(MODAL).toContain('getSnmpConfigFormFields({ stepId: "snmp" })');
    expect(MODAL).toContain("MONITORING_METHOD_OPTIONS");
    /*
     * Roles are a per-project table now, so the shared helper is the
     * model-backed dropdown wiring rather than a static option list. Still one
     * helper, still shared with the Devices create form.
     */
    expect(MODAL).toContain("DEVICE_ROLE_DROPDOWN_MODAL");
    expect(MODAL).toContain("DEVICE_ROLE_FIELD_TITLE");
    expect(MODAL).not.toContain("DEVICE_ROLE_OPTIONS");
    expect(MODAL).toContain("isSnmpDevice");
    expect(MODAL).toContain("isMonitorBackedDevice");
  });

  /*
   * The name is what the topology builder re-matches on. Anything computed
   * here rather than taken straight from the draft would be a second place
   * that could decorate it.
   */
  test("takes the pre-filled name straight from the draft", () => {
    expect(MODAL).toContain("name: draft.name,");
    expect(MODAL).toContain("hostname: draft.hostname,");
  });

  /*
   * A monitor-backed device has no probe and no credentials, so the SNMP
   * step is hidden wholesale — exactly as the Devices create form hides it.
   */
  test("hides the SNMP step for a device nothing will poll", () => {
    expect(MODAL).toMatch(/id: "snmp", showIf: isSnmpDevice/);
  });

  /*
   * An operator adopting a phone from the map has no Ping monitor for it
   * yet, and the server has always allowed the pair to be bound later — the
   * same contract the discovery import relies on. The binding is optional on
   * EVERY NetworkDevice form now (MonitorBindingNeverRequired.test.ts pins
   * that); what this pins is that this dialog says so with the shared
   * placeholder rather than a private one that could drift.
   */
  test("lets a monitor-backed device be recorded before a monitor exists", () => {
    expect(MODAL).toMatch(
      /showIf: isMonitorBackedDevice,[\s\S]*?required: false,[\s\S]*?placeholder: MONITOR_BINDING_FIELD_PLACEHOLDER/,
    );
  });

  /*
   * A probe that cannot reach the device produces a monitored device that is
   * permanently down, and a device filed in the wrong site is invisible in
   * the rollup it belongs to. Both are inherited only on unanimity.
   */
  test("inherits a site and a probe only when the neighbours agree", () => {
    expect(MODAL).toContain("unanimousId(");
    expect(MODAL).toMatch(/probeId: unanimousId\(/);
    expect(MODAL).toMatch(/siteId: unanimousId\(/);
  });

  test("holds the form behind a loader until the inherited values have landed", () => {
    expect(MODAL).toMatch(/if \(isLoading\) \{ return \( <ConfirmModal/);
  });

  /*
   * The map behind this dialog refreshes every sixty seconds, and a
   * refreshed graph is a new edge array and a new node map. Recomputing the
   * pre-fill from those would re-run the inheritance fetch, swap the form
   * for the loader, and discard whatever the operator had typed — mid-wizard
   * and with no explanation. A form should be a snapshot of the moment it
   * was opened.
   */
  test("computes its pre-fill once, so a map refresh cannot discard typing", () => {
    expect(MODAL).toContain("const [draft] = useState<NeighborAdoptionDraft>");
  });
});
