import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * https://github.com/OneUptime/oneuptime/issues/2899
 *
 * "No Save/Discard confirmation after editing Probe settings - changes not
 * actually applied." Two distinct dead ends produced that report, and both
 * live in props and field lists rather than in extractable logic - the App
 * suite runs in a plain Node environment with no renderer, so these read the
 * sources and assert the exact expressions, the same way
 * MonitorProbeSelectionPages.test.ts does. The behaviour that *is* extractable
 * is covered properly in
 * Common/Tests/Utils/Monitor/MonitorSummaryProbeUtil.test.ts.
 *
 * 1. The Monitor Summary card's probe picker was fed ProbeUtil.getAllProbes() -
 *    every probe in the project plus every global probe - instead of the probes
 *    attached to the monitor. Picking a stranger answered "should be few
 *    minutes for summary to show up" about data that could never arrive, and
 *    since the list is project-probes-first the card often opened on one.
 *
 * 2. Monitor > Probes offered a required "Probe" dropdown on an editable table
 *    whose probe relation is create-only, so ModelForm silently dropped the
 *    field from the edit form and from the request. With deletion off too,
 *    a probe attached by mistake could never be changed or removed.
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

describe("Monitor overview feeds the summary picker only the monitor's own probes", () => {
  const source: string = readSource("Pages", "Monitor", "View", "Index.tsx");

  test("no longer pulls the whole project's probe list into this page", () => {
    /*
     * The single most important line of the fix. ProbeUtil.getAllProbes()
     * returns project probes plus global probes with no monitor filter at all.
     */
    expect(source).not.toContain("ProbeUtil.getAllProbes()");
    expect(source).not.toContain(
      'import ProbeUtil from "../../../Utils/Probe"',
    );
  });

  test("selects the probe relation on the monitor's own MonitorProbe rows", () => {
    expect(source).toContain(
      squash("probe: { name: true, iconFileId: true, },"),
    );
    expect(source).toContain(squash("isEnabled: true,"));
    expect(source).toContain(squash("query: { monitorId: modelId, },"));
  });

  test("builds the picker list from those rows", () => {
    expect(source).toContain("setProbes(attachedProbes)");
    expect(source).toContain("attachedProbes.push(probe)");
  });

  test("keys each option on the join row's probeId", () => {
    // The relation select carries _id, but the join row is the authority.
    expect(source).toContain("probe._id = monitorProbe.probeId.toString()");
  });

  test("tracks which attached probes are switched off", () => {
    /*
     * Without this the card cannot tell "no data yet" from "this probe is
     * disabled", and tells the user to wait for data that will never come.
     */
    expect(source).toContain("setDisabledProbeIds(disabledProbeIds)");
    expect(source).toContain(squash("if (monitorProbe.isEnabled === false) {"));
  });

  test("hands both down to the Summary card", () => {
    expect(source).toContain(squash("probes={probes}"));
    expect(source).toContain(squash("disabledProbeIds={disabledProbeIds}"));
  });

  test("still collects the monitoring logs it always did", () => {
    expect(source).toContain(
      "probeMonitorResponses.push(monitorProbe?.lastMonitoringLog)",
    );
    expect(source).toContain("setProbeResponses(probeMonitorResponses)");
  });
});

describe("Summary card keeps the picked probe and explains an empty summary", () => {
  const source: string = readSource(
    "Components",
    "Monitor",
    "SummaryView",
    "Summary.tsx",
  );

  test("resolves the selection through the shared rule instead of always taking probes[0]", () => {
    /*
     * The effect re-runs on every new probes array. `setSelectedProbe(
     * props.probes[0])` there is indistinguishable, to a user, from a
     * selection that refuses to stick.
     */
    expect(source).toContain(
      "MonitorSummaryProbeUtil.resolveSelectedProbeId({",
    );
    expect(source).toContain("currentlySelectedProbeId:");
    expect(source).not.toContain(squash("setSelectedProbe(props.probes[0]);"));
  });

  test("classifies the empty state instead of leaving SummaryInfo to guess", () => {
    expect(source).toContain("MonitorSummaryProbeUtil.getProbeState({");
    expect(source).toContain(squash("probeSummaryState={probeSummaryState}"));
  });

  test("passes the disabled set to the picker so it can label those options", () => {
    expect(source).toContain(
      squash("disabledProbeIds={props.disabledProbeIds}"),
    );
  });
});

describe("Probe picker reads as a view filter, not a setting", () => {
  const source: string = readSource(
    "Components",
    "Monitor",
    "SummaryView",
    "ProbePicker.tsx",
  );

  test("is not chromed as a required form field", () => {
    /*
     * FieldLabelElement with required={true} is exactly what an editable
     * required field renders, which invited users to treat changing this as
     * editing the monitor's probe - and the (unsaved, because there is nothing
     * to save) reset as a lost edit.
     */
    expect(source).not.toContain("required={true}");
    expect(source).toContain('title="Showing results from:"');
    expect(source).toContain("hideOptionalLabel={true}");
  });

  test("builds its options through the shared rule", () => {
    expect(source).toContain(
      "MonitorSummaryProbeUtil.getProbeDropdownOptions({",
    );
  });
});

describe("Summary info tells the three empty states apart", () => {
  const source: string = readSource(
    "Components",
    "Monitor",
    "SummaryView",
    "SummaryInfo.tsx",
  );

  test("says so when nothing is monitoring the resource", () => {
    expect(source).toContain("MonitorSummaryProbeState.NoProbesAttached");
    expect(source).toContain("No probes are monitoring this resource.");
  });

  test("says so when the selected probe is switched off", () => {
    expect(source).toContain("MonitorSummaryProbeState.SelectedProbeDisabled");
    expect(source).toContain("is disabled for this monitor");
  });

  test("keeps the wait-a-few-minutes message for the case where waiting helps", () => {
    expect(source).toContain(
      "No summary available for the selected probe. Should be few minutes for summary to show up.",
    );
  });
});

describe("Monitor > Probes can undo attaching the wrong probe", () => {
  const source: string = readSource("Pages", "Monitor", "View", "Probes.tsx");

  test("does not offer a Probe dropdown the edit form cannot save", () => {
    /*
     * MonitorProbe.probe is create-only, so ModelForm drops this field from an
     * Update form - and from the request - with no error at all. Declaring it
     * without doNotShowWhenEditing is what produced a "Save Changes" modal
     * with the control the user came for silently missing.
     */
    expect(source).toContain("doNotShowWhenEditing: true");
  });

  test("drops the orphaned stepId, which matches no declared form step", () => {
    expect(source).not.toContain('stepId: "incident-details"');
  });

  test("allows removing a probe from the monitor", () => {
    // Otherwise probes can only ever be added, and a mistake is permanent.
    expect(source).toContain("isDeleteable={true}");
    expect(source).not.toContain("isDeleteable={false}");
  });

  test("still allows adding one and toggling it", () => {
    expect(source).toContain("isCreateable={true}");
    expect(source).toContain("isEditable={true}");
  });

  test("explains what the Enabled toggle actually does", () => {
    expect(source).toContain(
      "When off, this probe stops monitoring this resource.",
    );
  });
});
