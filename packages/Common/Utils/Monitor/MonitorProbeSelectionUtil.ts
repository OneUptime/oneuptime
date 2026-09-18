/*
 * Which probes a brand-new monitor starts out with.
 *
 * The server applies this same rule in
 * MonitorService.addDefaultProbesToMonitor (as a database query rather than a
 * filter over a list). The create form uses it to pre-select the probe picker,
 * so what the user sees before pressing "Create Monitor" is what they would
 * have got anyway - and can now change.
 */

export interface ProbeSelectionCandidate {
  id: string;
  isGlobalProbe: boolean;
  shouldAutoEnableProbeOnNewMonitors: boolean;
}

export default class MonitorProbeSelectionUtil {
  /*
   * A probe is auto-enabled on new monitors when it opts in with
   * shouldAutoEnableProbeOnNewMonitors - except that global probes are skipped
   * entirely for projects that turned off "add global probes by default".
   */
  public static getDefaultSelectedProbeIds(data: {
    probes: Array<ProbeSelectionCandidate>;
    doNotAddGlobalProbesByDefaultOnNewMonitors?: boolean | undefined;
  }): Array<string> {
    const skipGlobalProbes: boolean =
      data.doNotAddGlobalProbesByDefaultOnNewMonitors === true;

    const selected: Array<string> = [];

    for (const probe of data.probes || []) {
      if (!probe || !probe.id) {
        continue;
      }

      if (!probe.shouldAutoEnableProbeOnNewMonitors) {
        continue;
      }

      if (probe.isGlobalProbe && skipGlobalProbes) {
        continue;
      }

      selected.push(probe.id);
    }

    return MonitorProbeSelectionUtil.dedupeProbeIds(selected);
  }

  /*
   * Probe ids reach the server as plain strings and the same probe can be
   * offered by more than one source, so duplicates have to go: MonitorProbe
   * has no unique index and MonitorProbeService rejects the second insert with
   * "Probe is already added to this monitor."
   */
  public static dedupeProbeIds(probeIds: Array<string>): Array<string> {
    const seen: Set<string> = new Set<string>();
    const deduped: Array<string> = [];

    for (const probeId of probeIds || []) {
      if (!probeId || seen.has(probeId)) {
        continue;
      }

      seen.add(probeId);
      deduped.push(probeId);
    }

    return deduped;
  }
}
