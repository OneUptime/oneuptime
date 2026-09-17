import MonitorSummaryProbeUtil, {
  AttachedProbe,
  MonitorSummaryProbeState,
} from "../../../Utils/Monitor/MonitorSummaryProbeUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/2899
 *
 * The Monitor Summary card carries a "Select Probe" dropdown. It was fed every
 * probe in the project plus every global probe - not the probes attached to the
 * monitor being viewed. So a project with a global probe "Probe" and a custom
 * probe "WBHQ" offered both on a monitor that only "Probe" watched, and picking
 * "WBHQ" answered "No summary available for the selected probe. Should be few
 * minutes for summary to show up." about data that was never going to arrive.
 * Worse, the list is project-probes-first, so the card often *opened* on the
 * stranger. The reporter's conclusion: "i have changed the probe, but the
 * change was not actually applied".
 *
 * These pin the three rules that make the picker honest: it only offers
 * attached probes, it keeps the user's choice, and it says which of the three
 * empty states it is in.
 */

const GLOBAL_PROBE: AttachedProbe = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Probe",
  isEnabled: true,
};

const CUSTOM_PROBE: AttachedProbe = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "WBHQ",
  isEnabled: true,
};

const DISABLED_PROBE: AttachedProbe = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Retired Probe",
  isEnabled: false,
};

describe("MonitorSummaryProbeUtil.resolveSelectedProbeId", () => {
  it("returns null when the monitor has no probes attached", () => {
    expect(
      MonitorSummaryProbeUtil.resolveSelectedProbeId({ probes: [] }),
    ).toBeNull();
  });

  it("returns null for a missing probe list rather than throwing", () => {
    expect(
      MonitorSummaryProbeUtil.resolveSelectedProbeId({
        probes: undefined as unknown as Array<AttachedProbe>,
      }),
    ).toBeNull();
  });

  it("selects the first probe when nothing is selected yet", () => {
    expect(
      MonitorSummaryProbeUtil.resolveSelectedProbeId({
        probes: [CUSTOM_PROBE, GLOBAL_PROBE],
      }),
    ).toBe(CUSTOM_PROBE.id);
  });

  it("keeps the probe the user picked when the list is handed down again", () => {
    /*
     * The effect that calls this re-runs on every new probes array. Resetting
     * to the first entry there is indistinguishable, to a user, from a
     * selection that refuses to stick.
     */
    expect(
      MonitorSummaryProbeUtil.resolveSelectedProbeId({
        probes: [CUSTOM_PROBE, GLOBAL_PROBE],
        currentlySelectedProbeId: GLOBAL_PROBE.id,
      }),
    ).toBe(GLOBAL_PROBE.id);
  });

  it("keeps the selection even when that probe has since been disabled", () => {
    // The user asked to look at it; showing something else would be surprising.
    expect(
      MonitorSummaryProbeUtil.resolveSelectedProbeId({
        probes: [GLOBAL_PROBE, DISABLED_PROBE],
        currentlySelectedProbeId: DISABLED_PROBE.id,
      }),
    ).toBe(DISABLED_PROBE.id);
  });

  it("falls back when the selected probe has been detached from the monitor", () => {
    expect(
      MonitorSummaryProbeUtil.resolveSelectedProbeId({
        probes: [GLOBAL_PROBE],
        currentlySelectedProbeId: CUSTOM_PROBE.id,
      }),
    ).toBe(GLOBAL_PROBE.id);
  });

  it("prefers an enabled probe over a disabled one when defaulting", () => {
    /*
     * A disabled probe has nothing to show, so opening the card on one reads
     * as broken even though everything is working as configured.
     */
    expect(
      MonitorSummaryProbeUtil.resolveSelectedProbeId({
        probes: [DISABLED_PROBE, GLOBAL_PROBE],
      }),
    ).toBe(GLOBAL_PROBE.id);
  });

  it("still selects something when every attached probe is disabled", () => {
    expect(
      MonitorSummaryProbeUtil.resolveSelectedProbeId({
        probes: [DISABLED_PROBE],
      }),
    ).toBe(DISABLED_PROBE.id);
  });

  it("ignores rows with no id, which cannot be selected", () => {
    const noId: AttachedProbe = { id: "", name: "Broken", isEnabled: true };

    expect(
      MonitorSummaryProbeUtil.resolveSelectedProbeId({
        probes: [noId, GLOBAL_PROBE],
      }),
    ).toBe(GLOBAL_PROBE.id);
  });

  it("treats an empty currently-selected id as no selection", () => {
    expect(
      MonitorSummaryProbeUtil.resolveSelectedProbeId({
        probes: [DISABLED_PROBE, GLOBAL_PROBE],
        currentlySelectedProbeId: "",
      }),
    ).toBe(GLOBAL_PROBE.id);
  });
});

describe("MonitorSummaryProbeUtil.getProbeDropdownOptions", () => {
  it("offers exactly the probes it is given, in order", () => {
    /*
     * The whole defect: the picker used to be handed every probe in the
     * project. It can only ever offer what actually monitors this resource.
     */
    expect(
      MonitorSummaryProbeUtil.getProbeDropdownOptions({
        probes: [GLOBAL_PROBE, CUSTOM_PROBE],
      }),
    ).toEqual([
      { label: "Probe", value: GLOBAL_PROBE.id },
      { label: "WBHQ", value: CUSTOM_PROBE.id },
    ]);
  });

  it("marks a disabled probe so its empty summary is explained", () => {
    expect(
      MonitorSummaryProbeUtil.getProbeDropdownOptions({
        probes: [DISABLED_PROBE],
      }),
    ).toEqual([
      { label: "Retired Probe (disabled)", value: DISABLED_PROBE.id },
    ]);
  });

  it("falls back to a placeholder name rather than rendering an empty option", () => {
    expect(
      MonitorSummaryProbeUtil.getProbeDropdownOptions({
        probes: [{ id: GLOBAL_PROBE.id, name: "", isEnabled: true }],
      }),
    ).toEqual([{ label: "Unknown", value: GLOBAL_PROBE.id }]);
  });

  it("drops rows with no id, which would produce an unselectable option", () => {
    expect(
      MonitorSummaryProbeUtil.getProbeDropdownOptions({
        probes: [{ id: "", name: "Broken", isEnabled: true }, GLOBAL_PROBE],
      }),
    ).toEqual([{ label: "Probe", value: GLOBAL_PROBE.id }]);
  });

  it("returns nothing for a monitor with no probes", () => {
    expect(
      MonitorSummaryProbeUtil.getProbeDropdownOptions({ probes: [] }),
    ).toEqual([]);
  });
});

describe("MonitorSummaryProbeUtil.getProbeState", () => {
  it("reports results whenever there is anything to render", () => {
    expect(
      MonitorSummaryProbeUtil.getProbeState({
        isProbeableMonitor: true,
        attachedProbeCount: 1,
        isSelectedProbeEnabled: true,
        probeResponseCount: 1,
      }),
    ).toBe(MonitorSummaryProbeState.HasResults);
  });

  it("prefers showing results over any empty-state explanation", () => {
    /*
     * A probe switched off after it reported still has data worth looking at.
     */
    expect(
      MonitorSummaryProbeUtil.getProbeState({
        isProbeableMonitor: true,
        attachedProbeCount: 1,
        isSelectedProbeEnabled: false,
        probeResponseCount: 2,
      }),
    ).toBe(MonitorSummaryProbeState.HasResults);
  });

  it("says nothing is monitoring the resource when no probe is attached", () => {
    // Not "wait a few minutes" - waiting will never help.
    expect(
      MonitorSummaryProbeUtil.getProbeState({
        isProbeableMonitor: true,
        attachedProbeCount: 0,
        isSelectedProbeEnabled: true,
        probeResponseCount: 0,
      }),
    ).toBe(MonitorSummaryProbeState.NoProbesAttached);
  });

  it("says the probe is switched off when it is attached but disabled", () => {
    expect(
      MonitorSummaryProbeUtil.getProbeState({
        isProbeableMonitor: true,
        attachedProbeCount: 1,
        isSelectedProbeEnabled: false,
        probeResponseCount: 0,
      }),
    ).toBe(MonitorSummaryProbeState.SelectedProbeDisabled);
  });

  it("asks the user to wait only when waiting is actually the answer", () => {
    expect(
      MonitorSummaryProbeUtil.getProbeState({
        isProbeableMonitor: true,
        attachedProbeCount: 1,
        isSelectedProbeEnabled: true,
        probeResponseCount: 0,
      }),
    ).toBe(MonitorSummaryProbeState.AwaitingFirstResult);
  });

  it("does not blame probes on a monitor type that has none", () => {
    /*
     * Server, incoming-request and telemetry monitors are not watched by
     * probes at all, so "no probes are monitoring this resource" would be
     * nonsense there.
     */
    expect(
      MonitorSummaryProbeUtil.getProbeState({
        isProbeableMonitor: false,
        attachedProbeCount: 0,
        isSelectedProbeEnabled: true,
        probeResponseCount: 0,
      }),
    ).toBe(MonitorSummaryProbeState.AwaitingFirstResult);
  });
});
