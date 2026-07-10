import HttpPhaseTimings from "Common/Types/Monitor/HttpPhaseTimings";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  httpTimings: HttpPhaseTimings;
}

interface TimingPhase {
  label: string;
  valueInMs: number;
  colorClassName: string;
}

/*
 * Waterfall of the HTTP(S) request phases: DNS → TCP → TLS → waiting (TTFB)
 * → download. Bar widths are proportional to each phase's share of the total.
 */
const HttpTimingsView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const timings: HttpPhaseTimings = props.httpTimings;

  const phases: Array<TimingPhase> = [
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
    {
      label: "TLS Handshake",
      valueInMs: timings.tlsHandshakeInMs ?? -1,
      colorClassName: "bg-teal-400",
    },
    {
      label: "Waiting (TTFB)",
      valueInMs: timings.timeToFirstByteInMs ?? -1,
      colorClassName: "bg-amber-400",
    },
    {
      label: "Download",
      valueInMs: timings.downloadInMs ?? -1,
      colorClassName: "bg-emerald-400",
    },
  ].filter((phase: TimingPhase) => {
    return phase.valueInMs >= 0;
  });

  if (phases.length === 0) {
    return null;
  }

  const totalInMs: number = phases.reduce((sum: number, phase: TimingPhase) => {
    return sum + phase.valueInMs;
  }, 0);

  return (
    <div className="rounded-md border-2 border-gray-100 p-4">
      <div className="text-sm font-medium text-gray-900 mb-1">
        Request Phase Breakdown
      </div>
      <div className="text-xs text-gray-500 mb-3">
        Where this check spent its time, from DNS lookup to the last byte.
      </div>
      <div className="space-y-2">
        {phases.map((phase: TimingPhase) => {
          const percent: number =
            totalInMs > 0 ? (phase.valueInMs / totalInMs) * 100 : 0;

          return (
            <div key={phase.label} className="flex items-center text-sm">
              <div className="w-36 shrink-0 text-gray-700">{phase.label}</div>
              <div className="flex-1 mx-2">
                <div
                  className={`h-3 rounded ${phase.colorClassName}`}
                  style={{ width: `${Math.max(percent, 1)}%` }}
                ></div>
              </div>
              <div className="w-24 shrink-0 text-right text-gray-700 font-mono">
                {Math.round(phase.valueInMs * 100) / 100} ms
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HttpTimingsView;
