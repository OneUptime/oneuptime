import MonitorProbeSelectionUtil, {
  ProbeSelectionCandidate,
} from "../../../Utils/Monitor/MonitorProbeSelectionUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * The monitor create form pre-selects the probe picker with the set the server
 * would have attached on its own (MonitorService.addDefaultProbesToMonitor).
 * If these two ever disagree, opening the form and pressing Create silently
 * changes which probes watch the monitor - so the rule is pinned here:
 *
 *   - only probes that opted in via shouldAutoEnableProbeOnNewMonitors,
 *   - minus every global probe when the project turned global probes off,
 *   - deduplicated, because MonitorProbe has no unique index and the second
 *     insert is rejected with "Probe is already added to this monitor."
 */

const GLOBAL_PROBE: ProbeSelectionCandidate = {
  id: "11111111-1111-4111-8111-111111111111",
  isGlobalProbe: true,
  shouldAutoEnableProbeOnNewMonitors: true,
};

const CUSTOM_PROBE: ProbeSelectionCandidate = {
  id: "22222222-2222-4222-8222-222222222222",
  isGlobalProbe: false,
  shouldAutoEnableProbeOnNewMonitors: true,
};

const OPTED_OUT_CUSTOM_PROBE: ProbeSelectionCandidate = {
  id: "33333333-3333-4333-8333-333333333333",
  isGlobalProbe: false,
  shouldAutoEnableProbeOnNewMonitors: false,
};

const OPTED_OUT_GLOBAL_PROBE: ProbeSelectionCandidate = {
  id: "44444444-4444-4444-8444-444444444444",
  isGlobalProbe: true,
  shouldAutoEnableProbeOnNewMonitors: false,
};

describe("MonitorProbeSelectionUtil.getDefaultSelectedProbeIds", () => {
  it("selects every probe flagged to auto-enable on new monitors", () => {
    expect(
      MonitorProbeSelectionUtil.getDefaultSelectedProbeIds({
        probes: [GLOBAL_PROBE, CUSTOM_PROBE],
      }),
    ).toEqual([GLOBAL_PROBE.id, CUSTOM_PROBE.id]);
  });

  it("leaves out probes that did not opt in, global or custom", () => {
    expect(
      MonitorProbeSelectionUtil.getDefaultSelectedProbeIds({
        probes: [
          GLOBAL_PROBE,
          OPTED_OUT_GLOBAL_PROBE,
          CUSTOM_PROBE,
          OPTED_OUT_CUSTOM_PROBE,
        ],
      }),
    ).toEqual([GLOBAL_PROBE.id, CUSTOM_PROBE.id]);
  });

  it("drops global probes when the project disabled them for new monitors", () => {
    expect(
      MonitorProbeSelectionUtil.getDefaultSelectedProbeIds({
        probes: [GLOBAL_PROBE, CUSTOM_PROBE],
        doNotAddGlobalProbesByDefaultOnNewMonitors: true,
      }),
    ).toEqual([CUSTOM_PROBE.id]);
  });

  it("keeps global probes when the project setting is false or unset", () => {
    expect(
      MonitorProbeSelectionUtil.getDefaultSelectedProbeIds({
        probes: [GLOBAL_PROBE],
        doNotAddGlobalProbesByDefaultOnNewMonitors: false,
      }),
    ).toEqual([GLOBAL_PROBE.id]);

    expect(
      MonitorProbeSelectionUtil.getDefaultSelectedProbeIds({
        probes: [GLOBAL_PROBE],
        doNotAddGlobalProbesByDefaultOnNewMonitors: undefined,
      }),
    ).toEqual([GLOBAL_PROBE.id]);
  });

  it("returns an empty list when nothing opted in", () => {
    expect(
      MonitorProbeSelectionUtil.getDefaultSelectedProbeIds({
        probes: [OPTED_OUT_GLOBAL_PROBE, OPTED_OUT_CUSTOM_PROBE],
      }),
    ).toEqual([]);
  });

  it("returns an empty list for an empty probe list", () => {
    expect(
      MonitorProbeSelectionUtil.getDefaultSelectedProbeIds({
        probes: [],
      }),
    ).toEqual([]);
  });

  it("deduplicates a probe that appears in more than one source list", () => {
    expect(
      MonitorProbeSelectionUtil.getDefaultSelectedProbeIds({
        probes: [GLOBAL_PROBE, { ...GLOBAL_PROBE }, CUSTOM_PROBE],
      }),
    ).toEqual([GLOBAL_PROBE.id, CUSTOM_PROBE.id]);
  });

  it("ignores probes with no id rather than sending an empty id to the server", () => {
    expect(
      MonitorProbeSelectionUtil.getDefaultSelectedProbeIds({
        probes: [
          {
            id: "",
            isGlobalProbe: false,
            shouldAutoEnableProbeOnNewMonitors: true,
          },
          CUSTOM_PROBE,
        ],
      }),
    ).toEqual([CUSTOM_PROBE.id]);
  });
});

describe("MonitorProbeSelectionUtil.dedupeProbeIds", () => {
  it("keeps the first occurrence and preserves order", () => {
    expect(
      MonitorProbeSelectionUtil.dedupeProbeIds(["a", "b", "a", "c", "b"]),
    ).toEqual(["a", "b", "c"]);
  });

  it("drops empty ids", () => {
    expect(MonitorProbeSelectionUtil.dedupeProbeIds(["", "a", ""])).toEqual([
      "a",
    ]);
  });

  it("handles an empty list", () => {
    expect(MonitorProbeSelectionUtil.dedupeProbeIds([])).toEqual([]);
  });
});
