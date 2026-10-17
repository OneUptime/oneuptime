import { describe, expect, it } from "@jest/globals";
import ProbeStatusProbeChoices, {
  CUSTOM_PROBES_GROUP_LABEL,
  DELETED_PROBE_LABEL,
  GLOBAL_PROBES_GROUP_LABEL,
  NO_LONGER_AVAILABLE_GROUP_LABEL,
  ProbeStatusProbeChoice,
  ProbeStatusProbeOption,
  ProbeStatusProbeOptionGroup,
  WATCH_PROBE_QUERY_PARAM,
} from "../../FeatureSet/Dashboard/src/Components/Form/Monitor/ProbeStatusMonitor/ProbeStatusProbeChoices";

/*
 * The probe picker of a Probe Status monitor. What a new monitor watches
 * before anyone touches it decides whether it is useful the moment it is
 * saved, so the defaults are pinned for each kind of installation:
 *
 *   - a project with probes of its own watches those;
 *   - a self-hosted installation with none watches its global probes - the
 *     bundled probe every monitor there runs on (issue #2486);
 *   - a OneUptime Cloud project with none watches nothing until it picks:
 *     Cloud's global probes are OneUptime's to run;
 *   - "Monitor this probe" watches exactly the probe it came from.
 */

const OFFICE: ProbeStatusProbeChoice = {
  id: "78000000-0000-4000-8000-000000000001",
  name: "Office LAN",
  isGlobalProbe: false,
};
const DATA_CENTER: ProbeStatusProbeChoice = {
  id: "78000000-0000-4000-8000-000000000002",
  name: "Data Center",
  isGlobalProbe: false,
};
const BUNDLED: ProbeStatusProbeChoice = {
  id: "78000000-0000-4000-8000-000000000003",
  name: "Probe",
  isGlobalProbe: true,
};
const SINGAPORE: ProbeStatusProbeChoice = {
  id: "78000000-0000-4000-8000-000000000004",
  name: "Asia (Singapore)",
  isGlobalProbe: true,
};
const DELETED_ID: string = "78000000-0000-4000-8000-000000000099";

const ALL: Array<ProbeStatusProbeChoice> = [
  OFFICE,
  BUNDLED,
  DATA_CENTER,
  SINGAPORE,
];

function labels(options: Array<ProbeStatusProbeOption>): Array<string> {
  return options.map((option: ProbeStatusProbeOption): string => {
    return option.label;
  });
}

describe("ProbeStatusProbeChoices.getDefaultProbeIds", () => {
  it("a project with probes of its own watches all of them, by name", () => {
    for (const isBillingEnabled of [true, false]) {
      expect(
        ProbeStatusProbeChoices.getDefaultProbeIds({
          probes: ALL,
          isBillingEnabled: isBillingEnabled,
        }),
      ).toEqual([DATA_CENTER.id, OFFICE.id]);
    }
  });

  it("self-hosted, with no probe of its own, it watches the global probes", () => {
    expect(
      ProbeStatusProbeChoices.getDefaultProbeIds({
        probes: [SINGAPORE, BUNDLED],
        isBillingEnabled: false,
      }),
    ).toEqual([SINGAPORE.id, BUNDLED.id]);
  });

  it("on OneUptime Cloud, with no probe of its own, it watches nothing until one is picked", () => {
    expect(
      ProbeStatusProbeChoices.getDefaultProbeIds({
        probes: [SINGAPORE, BUNDLED],
        isBillingEnabled: true,
      }),
    ).toEqual([]);
  });

  it("no probes at all, nothing to watch", () => {
    expect(
      ProbeStatusProbeChoices.getDefaultProbeIds({
        probes: [],
        isBillingEnabled: false,
      }),
    ).toEqual([]);
  });

  it("Monitor this probe watches the probe it came from, and only it", () => {
    for (const probe of [OFFICE, SINGAPORE]) {
      expect(
        ProbeStatusProbeChoices.getDefaultProbeIds({
          probes: ALL,
          isBillingEnabled: true,
          requestedProbeId: probe.id,
        }),
      ).toEqual([probe.id]);
    }
  });

  it("the link's id is matched without regard to case or spaces", () => {
    expect(
      ProbeStatusProbeChoices.getDefaultProbeIds({
        probes: ALL,
        isBillingEnabled: false,
        requestedProbeId: `  ${OFFICE.id.toUpperCase()} `,
      }),
    ).toEqual([OFFICE.id]);
  });

  it("a link to a probe this project cannot see falls back to the defaults", () => {
    expect(
      ProbeStatusProbeChoices.getDefaultProbeIds({
        probes: ALL,
        isBillingEnabled: false,
        requestedProbeId: DELETED_ID,
      }),
    ).toEqual([DATA_CENTER.id, OFFICE.id]);
    expect(
      ProbeStatusProbeChoices.getDefaultProbeIds({
        probes: ALL,
        isBillingEnabled: false,
        requestedProbeId: "",
      }),
    ).toEqual([DATA_CENTER.id, OFFICE.id]);
  });

  it("never reorders the list it was given", () => {
    const probes: Array<ProbeStatusProbeChoice> = [...ALL];

    ProbeStatusProbeChoices.getDefaultProbeIds({
      probes: probes,
      isBillingEnabled: false,
    });

    expect(probes).toEqual(ALL);
  });
});

describe("ProbeStatusProbeChoices.getOptionGroups", () => {
  it("lists the project's probes, then the global ones, each by name", () => {
    const groups: Array<ProbeStatusProbeOptionGroup> =
      ProbeStatusProbeChoices.getOptionGroups({
        probes: ALL,
        selectedProbeIds: [],
      });

    expect(
      groups.map((group: ProbeStatusProbeOptionGroup) => {
        return [group.label, labels(group.options)];
      }),
    ).toEqual([
      [CUSTOM_PROBES_GROUP_LABEL, ["Data Center", "Office LAN"]],
      [GLOBAL_PROBES_GROUP_LABEL, ["Asia (Singapore)", "Probe"]],
    ]);
    expect(groups[0]!.options[0]).toEqual({
      value: DATA_CENTER.id,
      label: "Data Center",
    });
  });

  it("leaves out a group with nothing in it", () => {
    expect(
      ProbeStatusProbeChoices.getOptionGroups({
        probes: [SINGAPORE],
        selectedProbeIds: [],
      }).map((group: ProbeStatusProbeOptionGroup): string => {
        return group.label;
      }),
    ).toEqual([GLOBAL_PROBES_GROUP_LABEL]);
    expect(
      ProbeStatusProbeChoices.getOptionGroups({
        probes: [],
        selectedProbeIds: [],
      }),
    ).toEqual([]);
  });

  it("a watched probe that was deleted shows, picked, at the end, so it can be removed", () => {
    const groups: Array<ProbeStatusProbeOptionGroup> =
      ProbeStatusProbeChoices.getOptionGroups({
        probes: [OFFICE],
        selectedProbeIds: [OFFICE.id, DELETED_ID],
      });

    expect(groups[groups.length - 1]).toEqual({
      label: NO_LONGER_AVAILABLE_GROUP_LABEL,
      options: [{ value: DELETED_ID, label: DELETED_PROBE_LABEL }],
    });
    expect(
      labels(
        ProbeStatusProbeChoices.getSelectedOptions({
          groups: groups,
          selectedProbeIds: [OFFICE.id, DELETED_ID],
        }),
      ),
    ).toEqual(["Office LAN", DELETED_PROBE_LABEL]);
  });
});

describe("ProbeStatusProbeChoices helpers", () => {
  it("names a monitor made from Monitor this probe after the probe", () => {
    expect(ProbeStatusProbeChoices.getMonitorNameForProbe("Office LAN")).toBe(
      "Office LAN status",
    );
    expect(
      ProbeStatusProbeChoices.getMonitorNameForProbe("  Office LAN  "),
    ).toBe("Office LAN status");
    expect(ProbeStatusProbeChoices.getMonitorNameForProbe(undefined)).toBe("");
    expect(ProbeStatusProbeChoices.getMonitorNameForProbe("   ")).toBe("");
  });

  it("finds the picked probes no option lists, each once, in the order picked", () => {
    expect(
      ProbeStatusProbeChoices.getUnavailableProbeIds({
        probes: ALL,
        selectedProbeIds: [
          DELETED_ID,
          OFFICE.id.toUpperCase(),
          DELETED_ID.toUpperCase(),
          "78000000-0000-4000-8000-000000000098",
        ],
      }),
    ).toEqual([DELETED_ID, "78000000-0000-4000-8000-000000000098"]);
  });

  it("shows the picked options in the order picked, matched without regard to case", () => {
    const groups: Array<ProbeStatusProbeOptionGroup> =
      ProbeStatusProbeChoices.getOptionGroups({
        probes: ALL,
        selectedProbeIds: [],
      });

    expect(
      labels(
        ProbeStatusProbeChoices.getSelectedOptions({
          groups: groups,
          selectedProbeIds: [
            SINGAPORE.id.toUpperCase(),
            OFFICE.id,
            SINGAPORE.id,
          ],
        }),
      ),
    ).toEqual(["Asia (Singapore)", "Office LAN"]);
  });

  it("the link's query parameter keeps its name: probe pages link with it", () => {
    expect(WATCH_PROBE_QUERY_PARAM).toBe("watchProbeId");
  });
});
