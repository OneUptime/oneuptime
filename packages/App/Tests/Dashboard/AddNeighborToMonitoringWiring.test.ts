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
    expect(MODAL).toContain('getSnmpConfigFormFields({ stepId: "snmp",');
    expect(MODAL).toContain("description: HOSTNAME_FIELD_DESCRIPTION");
    /*
     * Roles are a per-project table now, so the shared helper is the
     * model-backed dropdown wiring rather than a static option list. Still one
     * helper, still shared with the Devices create form.
     */
    expect(MODAL).toContain("DEVICE_ROLE_DROPDOWN_MODAL");
    expect(MODAL).toContain("DEVICE_ROLE_FIELD_TITLE");
    expect(MODAL).not.toContain("DEVICE_ROLE_OPTIONS");
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
   * There is no monitoring-method question to ask: every neighbour the
   * dialog adopts is probe-polled. The step, the field, the option list and
   * the two predicates that used to branch the form on it are all gone —
   * and gone from the IMPORTS too, so a half-removed branch cannot survive
   * as a dead helper that the next edit reaches for.
   */
  test("asks no monitoring-method question", () => {
    expect(MODAL).not.toContain('id: "monitoring-method"');
    expect(MODAL).not.toContain("monitoringMethod: true");
    expect(MODAL).not.toContain("MONITORING_METHOD_OPTIONS");
    expect(MODAL).not.toContain("MONITORING_METHOD_FIELD_DESCRIPTION");
    expect(MODAL).not.toContain("isSnmpDevice");
    expect(MODAL).not.toContain("isMonitorBackedDevice");
  });

  /*
   * ModelForm sends only the fields it renders, and this form renders no
   * method field — so the method is written explicitly on the way out, from
   * the draft, rather than left to a column default that may not have been
   * migrated on every deployment.
   */
  test("writes the draft's method on the way out", () => {
    expect(MODAL).toContain(
      "device.monitoringMethod = draft.monitoringMethod;",
    );
  });

  /*
   * Every device walks through the SNMP step, and none is made to fill it
   * in: a neighbour adopted with no credentials is pinged by its probe. The
   * step used to be hidden wholesale for a monitor-backed device; a showIf
   * on it now would hide the one step that explains "ping only".
   */
  test("walks every device through the SNMP step, unconditionally", () => {
    expect(MODAL).toMatch(/id: "snmp", \}/);
    expect(MODAL).not.toMatch(/id: "snmp", showIf:/);
    expect(MODAL).toContain("SNMP_STEP_DESCRIPTION");
  });

  /*
   * The probe is required for every device, a phone included — a Probe
   * device with no probe is claimed by nothing and never polls — and it is
   * never hidden behind a predicate. The Monitor binding field is gone with
   * the branch it belonged to: the override for gear a probe cannot reach is
   * chosen on Settings, not offered to a neighbour the probe just reached.
   */
  test("requires the probe and offers no monitor binding", () => {
    expect(MODAL).toMatch(
      /field: \{ probe: true, \}, title: "Probe", stepId: "probe-and-site",[\s\S]*?required: true, placeholder: "Probe",/,
    );
    expect(MODAL).not.toMatch(/field: \{ probe: true, \},[\s\S]{0,200}showIf:/);
    expect(MODAL).not.toContain("monitor: true");
    expect(MODAL).not.toContain("MONITOR_BINDING_FIELD_PLACEHOLDER");
    expect(MODAL).not.toContain("MONITOR_BINDING_FIELD_DESCRIPTION");
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
