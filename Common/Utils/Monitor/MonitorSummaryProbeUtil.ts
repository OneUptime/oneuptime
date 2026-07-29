/*
 * The rules behind the "Monitor Summary" probe picker.
 *
 * That card used to be fed every probe in the project plus every global probe,
 * not the probes attached to the monitor being viewed. Choosing one of the
 * strangers answered "No summary available for the selected probe. Should be
 * few minutes for summary to show up." about data that could never arrive -
 * and because the list is project-probes-first, the card frequently *opened*
 * on one. Users read that as "I changed the probe and it was not applied".
 *
 * The picker is a view filter over data that already exists. It cannot change
 * which probe monitors a resource (that is a MonitorProbe row, edited under
 * Monitor > Probes), so it must never offer a probe that does not.
 */

export interface AttachedProbe {
  id: string;
  name: string;
  isEnabled: boolean;
}

export enum MonitorSummaryProbeState {
  // Nothing is monitoring this resource at all.
  NoProbesAttached = "NoProbesAttached",
  // The selected probe is attached but switched off, so it will never report.
  SelectedProbeDisabled = "SelectedProbeDisabled",
  // Attached and enabled, but it has not reported yet. Waiting is the answer.
  AwaitingFirstResult = "AwaitingFirstResult",
  // There is something to render.
  HasResults = "HasResults",
}

export default class MonitorSummaryProbeUtil {
  /*
   * Which probe the card should show. Keeps the user's choice as long as that
   * probe is still attached: this runs whenever the probe list is handed down
   * again, and unconditionally resetting to the first entry is indistinguishable
   * from a selection that refuses to stick.
   *
   * With no usable previous choice it prefers an enabled probe, because a
   * disabled one has nothing to show and opening there reads as broken.
   */
  public static resolveSelectedProbeId(data: {
    probes: Array<AttachedProbe>;
    currentlySelectedProbeId?: string | null | undefined;
  }): string | null {
    const probes: Array<AttachedProbe> = (data.probes || []).filter(
      (probe: AttachedProbe) => {
        return Boolean(probe && probe.id);
      },
    );

    if (probes.length === 0) {
      return null;
    }

    if (data.currentlySelectedProbeId) {
      const stillAttached: AttachedProbe | undefined = probes.find(
        (probe: AttachedProbe) => {
          return probe.id === data.currentlySelectedProbeId;
        },
      );

      if (stillAttached) {
        return stillAttached.id;
      }
    }

    const firstEnabledProbe: AttachedProbe | undefined = probes.find(
      (probe: AttachedProbe) => {
        return probe.isEnabled;
      },
    );

    return (firstEnabledProbe || (probes[0] as AttachedProbe)).id;
  }

  /*
   * The option labels. A disabled probe stays on the list - the user may well
   * want to look at what it collected before it was switched off - but saying
   * so is what stops "no summary" from looking like a bug.
   */
  public static getProbeDropdownOptions(data: {
    probes: Array<AttachedProbe>;
  }): Array<{ label: string; value: string }> {
    return (data.probes || [])
      .filter((probe: AttachedProbe) => {
        return Boolean(probe && probe.id);
      })
      .map((probe: AttachedProbe) => {
        const name: string = probe.name || "Unknown";

        return {
          label: probe.isEnabled ? name : `${name} (disabled)`,
          value: probe.id,
        };
      });
  }

  /*
   * Why the card has nothing to render. "No data yet", "this probe is off" and
   * "nothing is watching this monitor" are three different situations, and
   * telling the user to wait a few minutes for the last two is exactly how a
   * probe change comes to look like it never applied.
   */
  public static getProbeState(data: {
    isProbeableMonitor: boolean;
    attachedProbeCount: number;
    isSelectedProbeEnabled: boolean;
    probeResponseCount: number;
  }): MonitorSummaryProbeState {
    if (data.probeResponseCount > 0) {
      return MonitorSummaryProbeState.HasResults;
    }

    /*
     * Non-probeable monitors (server, incoming request, telemetry...) have no
     * probes by design, so their empty state is not a probe problem.
     */
    if (data.isProbeableMonitor && data.attachedProbeCount === 0) {
      return MonitorSummaryProbeState.NoProbesAttached;
    }

    if (!data.isSelectedProbeEnabled) {
      return MonitorSummaryProbeState.SelectedProbeDisabled;
    }

    return MonitorSummaryProbeState.AwaitingFirstResult;
  }
}
