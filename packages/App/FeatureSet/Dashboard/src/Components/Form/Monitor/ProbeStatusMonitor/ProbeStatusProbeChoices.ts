/*
 * The probe picker of a Probe Status monitor: how it lists the probes the
 * project may watch, and which ones a new monitor starts watching.
 *
 * React-free on purpose - App's tests read it, and App installs no React -
 * so the option shapes are written out here rather than taken from the
 * Dropdown component.
 */

export interface ProbeStatusProbeChoice {
  id: string;
  name: string;
  isGlobalProbe: boolean;
}

export interface ProbeStatusProbeOption {
  value: string;
  label: string;
}

export interface ProbeStatusProbeOptionGroup {
  label: string;
  options: Array<ProbeStatusProbeOption>;
}

/*
 * Create Monitor's link from a probe ("Monitor this probe"):
 * ?monitorType=Probe Status&watchProbeId=<probe id>. The monitor starts
 * watching that probe alone.
 */
export const WATCH_PROBE_QUERY_PARAM: string = "watchProbeId";

// The same words as the two tables under Monitors > Settings > Probes.
export const CUSTOM_PROBES_GROUP_LABEL: string = "Custom Probes";
export const GLOBAL_PROBES_GROUP_LABEL: string = "Global Probes";
// A probe the monitor still names but nobody can pick any more.
export const NO_LONGER_AVAILABLE_GROUP_LABEL: string = "No Longer Available";
export const DELETED_PROBE_LABEL: string = "Deleted probe";

const byName: (a: ProbeStatusProbeChoice, b: ProbeStatusProbeChoice) => number =
  (a: ProbeStatusProbeChoice, b: ProbeStatusProbeChoice): number => {
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  };

export default class ProbeStatusProbeChoices {
  /*
   * What a new Probe Status monitor watches before anyone touches the
   * picker. The project's own probes, when it has some: those are the ones
   * it runs and the ones it can fix. With none, an installation run on its
   * own servers watches its global probes - the bundled probe a
   * self-hosted OneUptime runs is one, and it is what every monitor there
   * depends on (issue #2486). OneUptime Cloud's global probes are
   * OneUptime's to run, so nothing is picked for a project that has no
   * probe of its own; it can still pick them.
   */
  public static getDefaultProbeIds(data: {
    probes: Array<ProbeStatusProbeChoice>;
    isBillingEnabled: boolean;
    /*
     * The probe a "Monitor this probe" link named (WATCH_PROBE_QUERY_PARAM).
     * It wins when it is one of the probes: that is what was asked for.
     */
    requestedProbeId?: string | null | undefined;
  }): Array<string> {
    const requestedProbeId: string = (data.requestedProbeId || "").trim();

    const requestedProbe: ProbeStatusProbeChoice | undefined = requestedProbeId
      ? data.probes.find((probe: ProbeStatusProbeChoice): boolean => {
          return probe.id.toLowerCase() === requestedProbeId.toLowerCase();
        })
      : undefined;

    if (requestedProbe) {
      return [requestedProbe.id];
    }

    const customProbes: Array<ProbeStatusProbeChoice> = data.probes.filter(
      (probe: ProbeStatusProbeChoice): boolean => {
        return !probe.isGlobalProbe;
      },
    );

    if (customProbes.length > 0) {
      return customProbes.sort(byName).map(
        (probe: ProbeStatusProbeChoice): string => {
          return probe.id;
        },
      );
    }

    if (data.isBillingEnabled) {
      return [];
    }

    return data.probes
      .filter((probe: ProbeStatusProbeChoice): boolean => {
        return probe.isGlobalProbe;
      })
      .sort(byName)
      .map((probe: ProbeStatusProbeChoice): string => {
        return probe.id;
      });
  }

  /*
   * The picker's options: the project's own probes, then the global ones,
   * each by name. A probe the monitor already watches that is no longer
   * listed (deleted since) gets an option of its own at the end, so it
   * shows as picked and can be removed, instead of being kept silently.
   * Empty groups are left out.
   */
  public static getOptionGroups(data: {
    probes: Array<ProbeStatusProbeChoice>;
    selectedProbeIds: Array<string>;
  }): Array<ProbeStatusProbeOptionGroup> {
    const toOption: (probe: ProbeStatusProbeChoice) => ProbeStatusProbeOption =
      (probe: ProbeStatusProbeChoice): ProbeStatusProbeOption => {
        return { value: probe.id, label: probe.name };
      };

    const groups: Array<ProbeStatusProbeOptionGroup> = [
      {
        label: CUSTOM_PROBES_GROUP_LABEL,
        options: data.probes
          .filter((probe: ProbeStatusProbeChoice): boolean => {
            return !probe.isGlobalProbe;
          })
          .sort(byName)
          .map(toOption),
      },
      {
        label: GLOBAL_PROBES_GROUP_LABEL,
        options: data.probes
          .filter((probe: ProbeStatusProbeChoice): boolean => {
            return probe.isGlobalProbe;
          })
          .sort(byName)
          .map(toOption),
      },
      {
        label: NO_LONGER_AVAILABLE_GROUP_LABEL,
        options: ProbeStatusProbeChoices.getUnavailableProbeIds(data).map(
          (probeId: string): ProbeStatusProbeOption => {
            return { value: probeId, label: DELETED_PROBE_LABEL };
          },
        ),
      },
    ];

    return groups.filter((group: ProbeStatusProbeOptionGroup): boolean => {
      return group.options.length > 0;
    });
  }

  /*
   * The name a monitor made from "Monitor this probe" starts with: the
   * probe's own, so the monitor list and the incidents read "EU Probe
   * status". Empty when the probe's name is not known.
   */
  public static getMonitorNameForProbe(probeName: string | undefined): string {
    const name: string = (probeName || "").trim();

    return name ? `${name} status` : "";
  }

  // The picked probes no option lists, each once, in the order picked.
  public static getUnavailableProbeIds(data: {
    probes: Array<ProbeStatusProbeChoice>;
    selectedProbeIds: Array<string>;
  }): Array<string> {
    const listed: Set<string> = new Set(
      data.probes.map((probe: ProbeStatusProbeChoice): string => {
        return probe.id.toLowerCase();
      }),
    );
    const seen: Set<string> = new Set<string>();
    const unavailable: Array<string> = [];

    for (const probeId of data.selectedProbeIds) {
      const key: string = probeId.toLowerCase();

      if (listed.has(key) || seen.has(key)) {
        continue;
      }

      seen.add(key);
      unavailable.push(probeId);
    }

    return unavailable;
  }

  /*
   * The picked options, in the order picked, for the picker to show. Ids
   * are matched without regard to case, as the server compares them.
   */
  public static getSelectedOptions(data: {
    groups: Array<ProbeStatusProbeOptionGroup>;
    selectedProbeIds: Array<string>;
  }): Array<ProbeStatusProbeOption> {
    const options: Array<ProbeStatusProbeOption> = data.groups.flatMap(
      (group: ProbeStatusProbeOptionGroup): Array<ProbeStatusProbeOption> => {
        return group.options;
      },
    );

    const selected: Array<ProbeStatusProbeOption> = [];

    for (const probeId of data.selectedProbeIds) {
      const option: ProbeStatusProbeOption | undefined = options.find(
        (candidate: ProbeStatusProbeOption): boolean => {
          return candidate.value.toLowerCase() === probeId.toLowerCase();
        },
      );

      if (option && !selected.includes(option)) {
        selected.push(option);
      }
    }

    return selected;
  }
}
