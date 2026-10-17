import { Gray500, Green, Red } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import ProbeStatusMonitorResponse, {
  ProbeStatusMonitorProbe,
} from "Common/Types/Monitor/ProbeStatusMonitor/ProbeStatusMonitorResponse";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeStatusMonitorResponse: ProbeStatusMonitorResponse;
}

/*
 * What a Probe Status monitor found on one evaluation: how many of its probes
 * were connected, and each probe with when it was last heard from. Drawn on
 * the monitor's overview (its newest evaluation), on an incident or alert it
 * opened (the evaluation that opened it) and in its Monitoring Logs.
 *
 * Disconnected probes are listed first: they are why anyone is looking. The
 * counts stack and each probe is one wrapping row, so the card fits a phone
 * without scrolling sideways, where the other summaries' quarter-width tiles
 * do not.
 */
const ProbeStatusMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const response: ProbeStatusMonitorResponse = props.probeStatusMonitorResponse;

  const total: number =
    response.connectedProbeCount + response.disconnectedProbeCount;

  const probes: Array<ProbeStatusMonitorProbe> = [...response.probes].sort(
    (a: ProbeStatusMonitorProbe, b: ProbeStatusMonitorProbe): number => {
      if (a.isConnected !== b.isConnected) {
        return a.isConnected ? 1 : -1;
      }

      return a.probeName.localeCompare(b.probeName);
    },
  );

  const missingCount: number = response.missingProbeIds.length;
  const hasCheckedAt: boolean = response.checkedAt.getTime() > 0;

  return (
    <div className="space-y-5" data-testid="probe-status-monitor-summary">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <InfoCard
          className="shadow-none border-2 border-gray-100"
          title="Connected"
          value={translator.translateTemplate("{{connected}} of {{total}}", {
            connected: response.connectedProbeCount.toString(),
            total: total.toString(),
          })}
        />
        <InfoCard
          className="shadow-none border-2 border-gray-100"
          title="Disconnected"
          value={response.disconnectedProbeCount.toString()}
        />
        <InfoCard
          className="shadow-none border-2 border-gray-100"
          title="Checked At"
          value={
            hasCheckedAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  response.checkedAt,
                )
              : "-"
          }
        />
      </div>

      {probes.length > 0 ? (
        <ul
          className="divide-y divide-gray-200 rounded-md border border-gray-200"
          aria-label={translator.translateText("Probes")}
        >
          {probes.map((probe: ProbeStatusMonitorProbe): ReactElement => {
            return (
              <li
                key={probe.probeId}
                data-testid="probe-status-monitor-probe-row"
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                    <span className="break-words">{probe.probeName}</span>
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
                  <div className="mt-0.5 text-xs text-gray-500">
                    {probe.lastAliveAt
                      ? translator.translateTemplate(
                          "Last heard from {{time}}",
                          { time: OneUptimeDate.fromNow(probe.lastAliveAt) },
                        )
                      : translator.translateText("Never heard from")}
                  </div>
                </div>
                <Statusbubble
                  text={probe.isConnected ? "Connected" : "Disconnected"}
                  color={probe.isConnected ? Green : Red}
                  shouldAnimate={probe.isConnected}
                />
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
