import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import { ProbeBehindWork } from "Common/Types/Probe/ProbeBehind";
import ProbeStatusMonitorResponse, {
  ProbeStatusMonitorProbe,
} from "Common/Types/Monitor/ProbeStatusMonitor/ProbeStatusMonitorResponse";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import { translationKey } from "Common/Types/Translator";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ProbeStatusMonitorUtil, {
  ProbeSilence,
} from "Common/Utils/Monitor/ProbeStatusMonitorUtil";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeStatusMonitorResponse: ProbeStatusMonitorResponse;
}

/*
 * What a probe that is behind is behind on, and since when (#9501): its
 * monitors checked, its network devices polled, or both, later than set.
 */
export const PROBE_BEHIND_WORDS: {
  status: string;
  monitors: string;
  devices: string;
  both: string;
} = {
  status: translationKey("Behind"),
  monitors: translationKey(
    "Since {{time}}, its monitors are checked less often than set.",
  ),
  devices: translationKey(
    "Since {{time}}, its network devices are polled less often than set.",
  ),
  both: translationKey(
    "Since {{time}}, its monitors and network devices are checked less often than set.",
  ),
};

// "No heartbeat for 15 minutes", in the unit getSilence picked.
const SILENCE_TEMPLATES: Record<ProbeSilence["unit"], PluralTemplate> = {
  minute: {
    one: "No heartbeat for {{count}} minute",
    other: "No heartbeat for {{count}} minutes",
  },
  hour: {
    one: "No heartbeat for {{count}} hour",
    other: "No heartbeat for {{count}} hours",
  },
  day: {
    one: "No heartbeat for {{count}} day",
    other: "No heartbeat for {{count}} days",
  },
};

/*
 * What a Probe Status monitor found on one evaluation: each probe it watches
 * and whether it was connected, and keeping up. Drawn on the monitor's
 * overview (its newest evaluation), on an incident or alert it opened (the
 * evaluation that opened it) and in its Monitoring Logs, always with that
 * evaluation's Evaluation Logs under it - which already count the probes and
 * say when it ran, so this card does neither.
 *
 * Disconnected probes come first, then the ones behind (#9501): they are
 * why anyone is looking. A disconnected one says how long it had gone
 * without a heartbeat when the evaluation ran; one behind says since when,
 * and whether its monitors or its network devices wait.
 * That is measured to the evaluation, not to now, so a three-day-old
 * incident does not claim its probe was silent for three days. A connected
 * probe needs no time: connected means a heartbeat in the last three
 * minutes. The dots do not pulse: this is a record of one evaluation, not a
 * live feed.
 */
const ProbeStatusMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const response: ProbeStatusMonitorResponse = props.probeStatusMonitorResponse;

  // Disconnected first, then behind, then connected and keeping up.
  const rankOf: (probe: ProbeStatusMonitorProbe) => number = (
    probe: ProbeStatusMonitorProbe,
  ): number => {
    if (!probe.isConnected) {
      return 0;
    }

    return probe.isBehind ? 1 : 2;
  };

  const probes: Array<ProbeStatusMonitorProbe> = [...response.probes].sort(
    (a: ProbeStatusMonitorProbe, b: ProbeStatusMonitorProbe): number => {
      if (rankOf(a) !== rankOf(b)) {
        return rankOf(a) - rankOf(b);
      }

      return a.probeName.localeCompare(b.probeName);
    },
  );

  const missingCount: number = response.missingProbeIds.length;

  const getProbeDetail: (
    probe: ProbeStatusMonitorProbe,
  ) => ReactElement | null = (
    probe: ProbeStatusMonitorProbe,
  ): ReactElement | null => {
    if (probe.isConnected && probe.isBehind) {
      const work: Array<ProbeBehindWork> = probe.behindOn || [];
      const isOnDevices: boolean = work.includes(ProbeBehindWork.DevicePolls);
      const isOnMonitors: boolean =
        work.length === 0 || work.includes(ProbeBehindWork.MonitorChecks);
      const words: string =
        isOnMonitors && isOnDevices
          ? PROBE_BEHIND_WORDS.both
          : isOnDevices
            ? PROBE_BEHIND_WORDS.devices
            : PROBE_BEHIND_WORDS.monitors;

      return (
        <div
          className="mt-0.5 break-words text-xs text-gray-600"
          data-testid="probe-status-monitor-probe-behind"
        >
          {translator.translateTemplate(words, {
            time: probe.behindSince
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  probe.behindSince,
                )
              : "—",
          })}
        </div>
      );
    }

    if (probe.isConnected) {
      return null;
    }

    if (!probe.lastAliveAt) {
      return (
        <div
          className="mt-0.5 text-xs text-gray-500"
          data-testid="probe-status-monitor-probe-detail"
        >
          {translator.translateText("No heartbeat yet")}
        </div>
      );
    }

    const silence: ProbeSilence | null = ProbeStatusMonitorUtil.getSilence({
      lastAliveAt: probe.lastAliveAt,
      checkedAt: response.checkedAt,
    });

    return (
      <div
        className="mt-0.5 text-xs text-gray-500"
        data-testid="probe-status-monitor-probe-detail"
      >
        <time
          dateTime={probe.lastAliveAt.toISOString()}
          title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            probe.lastAliveAt,
          )}
        >
          {silence
            ? translator.translatePlural(
                SILENCE_TEMPLATES[silence.unit],
                silence.count,
              )
            : translator.translateTemplate("Last heartbeat {{time}}", {
                time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  probe.lastAliveAt,
                ),
              })}
        </time>
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="probe-status-monitor-summary">
      {probes.length > 0 ? (
        <ul
          className="divide-y divide-gray-200 rounded-lg border border-gray-200"
          aria-label={translator.translateText("Probes")}
        >
          {probes.map((probe: ProbeStatusMonitorProbe): ReactElement => {
            return (
              <li
                key={probe.probeId}
                data-testid="probe-status-monitor-probe-row"
                /*
                 * The status sits at the end from sm up and under the name
                 * below it, by breakpoint rather than by wrapping, so one
                 * long name never moves its own status alone.
                 */
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 sm:flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-gray-900">
                    <span
                      className="break-words"
                      data-testid="probe-status-monitor-probe-name"
                    >
                      {probe.probeName}
                    </span>
                    {probe.isGlobalProbe ? (
                      <Pill
                        text="Global"
                        color={Gray500}
                        size={PillSize.Small}
                        isMinimal={true}
                      />
                    ) : (
                      <></>
                    )}
                  </div>
                  {getProbeDetail(probe)}
                </div>
                <div className="sm:flex-none">
                  <Statusbubble
                    text={
                      !probe.isConnected
                        ? "Disconnected"
                        : probe.isBehind
                          ? PROBE_BEHIND_WORDS.status
                          : "Connected"
                    }
                    color={
                      !probe.isConnected ? Red : probe.isBehind ? Yellow : Green
                    }
                    shouldAnimate={false}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <></>
      )}

      {missingCount > 0 ? (
        <p
          className="text-sm text-gray-500"
          data-testid="probe-status-monitor-missing-probes"
        >
          {translator.translatePlural(
            {
              one: "{{count}} probe this monitor watches no longer exists, so it is not counted. Pick probes again under Criteria.",
              other:
                "{{count}} probes this monitor watches no longer exist, so they are not counted. Pick probes again under Criteria.",
            },
            missingCount,
          )}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ProbeStatusMonitorView;
