import PortMonitorTimings from "Common/Types/Monitor/PortMonitor/PortMonitorTimings";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  portTimings: PortMonitorTimings;
}

interface ConnectionPhase {
  label: string;
  valueInMs: number;
  colorClassName: string;
}

const formatDurationInMs: (durationInMs: number) => string = (
  durationInMs: number,
): string => {
  return `${Math.round(durationInMs * 100) / 100} ms`;
};

/*
 * A compact waterfall for a Port check. The total remains in the summary
 * card because it is the stable responseTimeInMs value used by existing
 * charts and criteria; this view explains how DNS and TCP contributed to it.
 */
const PortTimingsView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const timings: PortMonitorTimings = props.portTimings;

  const phases: Array<ConnectionPhase> = [
    {
      label: "DNS Lookup",
      valueInMs: timings.dnsLookupInMs ?? -1,
      colorClassName: "bg-indigo-400",
    },
    {
      label: "TCP Connect",
      valueInMs: timings.tcpConnectInMs ?? -1,
      colorClassName: "bg-sky-400",
    },
  ].filter((phase: ConnectionPhase) => {
    return phase.valueInMs >= 0;
  });

  if (phases.length === 0) {
    return null;
  }

  const measuredPhasesTotalInMs: number = phases.reduce(
    (sum: number, phase: ConnectionPhase) => {
      return sum + phase.valueInMs;
    },
    0,
  );
  const totalConnectionInMs: number =
    timings.totalConnectionInMs !== undefined &&
    timings.totalConnectionInMs >= measuredPhasesTotalInMs
      ? timings.totalConnectionInMs
      : measuredPhasesTotalInMs;

  return (
    <div className="rounded-md border-2 border-gray-100 p-4">
      <div className="text-sm font-medium text-gray-900 mb-1">
        Connection Phase Breakdown
      </div>
      <div className="text-xs text-gray-500 mb-3">
        Time spent resolving the target and establishing the TCP connection.
      </div>
      <div className="space-y-2">
        {phases.map((phase: ConnectionPhase) => {
          const percent: number =
            totalConnectionInMs > 0
              ? (phase.valueInMs / totalConnectionInMs) * 100
              : 0;

          return (
            <div key={phase.label} className="flex items-center text-sm">
              <div className="w-32 shrink-0 text-gray-700">{phase.label}</div>
              <div className="flex-1 mx-2">
                <div
                  className={`h-3 rounded ${phase.colorClassName}`}
                  style={{ width: `${Math.max(percent, 1)}%` }}
                ></div>
              </div>
              <div className="w-24 shrink-0 text-right text-gray-700 font-mono">
                {formatDurationInMs(phase.valueInMs)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PortTimingsView;
