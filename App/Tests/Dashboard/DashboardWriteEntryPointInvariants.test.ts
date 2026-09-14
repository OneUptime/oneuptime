import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3550: the dashboard board is a bespoke screen, so none of the generic
 * permission gates (ModelTable, ModelForm, ModelDelete) ever ran over it, and
 * a project-wide `Viewer` was handed the whole editing surface.
 *
 * The board itself is covered behaviourally, as a reader and as an editor, in
 * Common/Tests/App/Dashboard/DashboardEditPermissions.test.tsx - it renders the
 * real DashboardViewer. This file is the cheap net under the OTHER way into a
 * dashboard write, which no renderer in this repo can reach: the metric
 * explorer's "Add to dashboard", which read-modify-writes somebody else's
 * dashboardViewConfig from a menu item on a completely different page.
 * MetricExplorer pulls in the chart stack and App's test env is plain Node
 * with no DOM, so the wiring is pinned by reading the source - the same way
 * CreateEntryPointPermissionInvariants and DashboardTimeRangeZoomWiring do.
 *
 * Sources are whitespace-squashed first so prettier re-wrapping a line cannot
 * turn a real regression check into a red herring.
 */

function readSquashed(relative: string): string {
  return fs
    .readFileSync(path.join(__dirname, "../../..", relative), "utf8")
    .replace(/\s+/g, " ");
}

const METRIC_EXPLORER: string =
  "App/FeatureSet/Dashboard/src/Components/Metrics/MetricExplorer.tsx";
const DASHBOARD_VIEW: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx";
const DASHBOARD_TOOLBAR: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar.tsx";

describe("every entry point into a dashboard write is permission-gated", () => {
  test("the metric explorer gates Add to dashboard on Dashboard update", () => {
    const source: string = readSquashed(METRIC_EXPLORER);

    /*
     * The gate has to be the Dashboard's UPDATE permission specifically.
     * Appending a chart is a write to a dashboard the user may only be able
     * to read - being allowed to look at the metric explorer says nothing
     * about it.
     */
    expect(source).toContain(
      "PermissionGate.check(new Dashboard(), ModelAction.Update)",
    );

    /* The menu item is locked, and the locked item does not open the picker. */
    expect(source).toContain("isDisabled={!addToDashboardGate.isAllowed}");
    expect(source).toContain(
      "if (!addToDashboardGate.isAllowed) { return; } setShowAddToDashboardModal(true);",
    );
  });

  test("the board gates edit mode on the same permission", () => {
    const source: string = readSquashed(DASHBOARD_VIEW);

    expect(source).toContain(
      "PermissionGate.check(new Dashboard(), ModelAction.Update)",
    );

    /*
     * ANDed into the derived mode rather than only checked where the mode is
     * set, so the canvas and the toolbar cannot disagree with the gate.
     */
    expect(source).toContain(
      "dashboardMode === DashboardMode.Edit && canEditDashboard",
    );

    /* And the write path refuses on its own, not only because of the UI. */
    expect(source).toContain("if (!canEditDashboard) { setSaveError(");
  });

  test("the toolbar renders no write controls without the permission", () => {
    const source: string = readSquashed(DASHBOARD_TOOLBAR);

    /*
     * Add Widget, Variables, Cancel and Save Changes all live in this one
     * block. Gating the block is what keeps them from being reachable.
     */
    expect(source).toContain(
      "{!isSaving && isEditMode && props.canEditDashboard && (",
    );
  });

  /*
   * A save that is refused must not look like one that worked. The old code
   * dropped back to view mode unconditionally and put the failure in the
   * page-level `error`, which replaced the whole board - so the user could
   * not tell the two apart and lost their unsaved widgets either way.
   */
  test("a refused save keeps the user in edit mode with their work", () => {
    const source: string = readSquashed(DASHBOARD_VIEW);

    expect(source).toContain(
      "if (didSave) { setDashboardMode(DashboardMode.View); }",
    );
    expect(source).not.toContain(
      "saveDashboardViewConfig().catch((err: Error) => { setError(",
    );
  });
});
