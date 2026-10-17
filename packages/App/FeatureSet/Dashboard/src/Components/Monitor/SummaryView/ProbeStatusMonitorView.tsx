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
 * Disconnected probes are listed first: they are why anyone is looking.
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
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100"
          title="Connected"
          value={translator.translateTemplate("{{connected}} of {{total}}", {
            connected: response.connectedProbeCount.toString(),
            total: total.toString(),
          })}
        />
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100"
          title="Disconnected"
          value={response.disconnectedProbeCount.toString()}
        />
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100"
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
        <div className="border rounded-md overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {translator.translateText("Probe")}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {translator.translateText("Status")}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {translator.translateText("Last Heard From")}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {probes.map((probe: ProbeStatusMonitorProbe): ReactElement => {
                return (
                  <tr
                    key={probe.probeId}
                    data-testid="probe-status-monitor-probe-row"
                  >
                    <td className="px-4 py-2 text-sm text-gray-900">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span>{probe.probeName}</span>
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
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm">
                      <Statusbubble
                        text={probe.isConnected ? "Connected" : "Disconnected"}
                        color={probe.isConnected ? Green : Red}
                        shouldAnimate={probe.isConnected}
                      />
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-500">
                      {probe.lastAliveAt
                        ? OneUptimeDate.fromNow(probe.lastAliveAt)
                        : translator.translateText("Never")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
