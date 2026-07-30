import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Two probe defects, both of which live in a prop or a field list rather than
 * in extractable logic - and the App suite runs in a plain Node environment
 * with no renderer, so these read the sources and assert the exact
 * expressions, the same way NetworkSitePageInvariants.test.ts does.
 *
 * 1. Monitor creation had no probe step. Probes were chosen for you afterwards
 *    (every probe flagged "auto enable on new monitors"), so a project with a
 *    global probe and a custom probe could not say which one should watch a
 *    given resource.
 *
 * 2. Editing a probe looked like it did nothing. The Probe Details form was a
 *    two-step wizard, so the modal's primary button read "Next" and a user who
 *    edited a field on step one never saw a Save button - closing the modal
 *    threw the edit away. And the card never displayed the auto-enable toggle
 *    it edits, so even a successful save left the page looking unchanged.
 *
 * Sources are whitespace-squashed first so prettier re-wrapping a line cannot
 * turn a real regression check into a red herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

describe("Monitor create page lets the user pick probes", () => {
  const source: string = readSource("Pages", "Monitor", "Create.tsx");

  test("declares a probes field", () => {
    expect(source).toContain(squash("overrideField: { probes: true, },"));
    expect(source).toContain(squash('title: "Probes",'));
  });

  test("carries the selection through miscDataProps, not as a Monitor column", () => {
    /*
     * overrideField (not field) keeps `probes` out of ModelForm's select and
     * out of the Monitor payload; overrideFieldKey is what puts it into
     * miscDataProps, where MonitorService.onCreateSuccess reads it.
     */
    expect(source).toContain(squash('overrideFieldKey: "probes",'));
    expect(source).not.toContain(squash("field: { probes: true, },"));
  });

  test("shows the field even though Monitor has no probes column", () => {
    // Without this, ModelForm drops the field for lack of column permissions.
    expect(source).toContain("showEvenIfPermissionDoesNotExist: true");
  });

  test("puts probes on the step that already gates on probeable monitor types", () => {
    /*
     * doesMonitorTypeHaveInterval is isProbableMonitor, so this step appears
     * for exactly the monitor types a probe can watch. Moving probes to a step
     * of their own would also need E2E/Tests/Dashboard/Helpers/Monitors.ts to
     * grow another submit click.
     */
    expect(source).toContain(squash('stepId: "monitoring-interval",'));
    expect(source).toContain(squash('title: "Probes & Interval",'));
    expect(source).toContain(
      squash("MonitorTypeHelper.doesMonitorTypeHaveInterval("),
    );
  });

  test("pre-selects the probes the server would have attached anyway", () => {
    /*
     * Leaving the picker alone must keep the old behaviour, so the default
     * selection comes from the same rule the server applies.
     */
    expect(source).toContain(
      "MonitorProbeSelectionUtil.getDefaultSelectedProbeIds(",
    );
    expect(source).toContain("doNotAddGlobalProbesByDefaultOnNewMonitors");
  });

  test("waits for the probe list before mounting the form", () => {
    // ModelForm reads initialValues once, on mount.
    expect(source).toContain("isLoadingProbes");
    expect(source).toContain(
      squash("{!isLoading && !isLoadingProbes && !error && ("),
    );
  });

  test("still creates the monitor when the probe list cannot be loaded", () => {
    /*
     * On failure defaultProbeIds stays null, so no "probes" value is submitted
     * and the server keeps assigning the defaults exactly as before.
     */
    expect(source).toContain(
      squash(
        "defaultProbeIds ? { ...initialValues, probes: defaultProbeIds } : initialValues",
      ),
    );
  });
});

describe("Probe list carries the flag the create form pre-selects on", () => {
  const source: string = readSource("Utils", "Probe.ts");

  test("selects shouldAutoEnableProbeOnNewMonitors for both probe sources", () => {
    const matches: number = (
      source.match(/shouldAutoEnableProbeOnNewMonitors: true/g) || []
    ).length;

    expect(matches).toBe(2);
  });

  test("marks which probes are global, since the endpoint does not return it", () => {
    expect(source).toContain("probe.isGlobalProbe = true;");
    expect(source).toContain("probe.isGlobalProbe = false;");
  });
});

describe("Probe view page makes an edit saveable and visible", () => {
  const source: string = readSource(
    "Pages",
    "Monitor",
    "Settings",
    "MonitorProbeView.tsx",
  );

  test("the Probe Details form is not a wizard, so Save is always on screen", () => {
    /*
     * ModelFormModal labels its primary button "Next" on every step but the
     * last. With steps, someone editing the name or the auto-enable toggle saw
     * only "Cancel" and "Next" and lost the edit by closing the modal.
     */
    expect(source).not.toContain("formSteps=");
    expect(source).not.toContain(squash('stepId: "basic-info",'));
    expect(source).not.toContain(squash('stepId: "more",'));
  });

  test("the card displays the auto-enable toggle the form edits", () => {
    // Otherwise a successful save is invisible and reads as "not applied".
    expect(source).toContain(
      squash(
        'field: { shouldAutoEnableProbeOnNewMonitors: true, }, title: "Enable Monitoring on New Monitors",',
      ),
    );
  });

  test("the form still edits the toggle", () => {
    expect(source).toContain(
      squash(
        'field: { shouldAutoEnableProbeOnNewMonitors: true, }, title: "Enable monitoring automatically on new monitors",',
      ),
    );
  });
});
