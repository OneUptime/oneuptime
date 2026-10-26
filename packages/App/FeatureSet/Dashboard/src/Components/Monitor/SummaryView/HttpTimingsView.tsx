import HttpPhaseTimings from "Common/Types/Monitor/HttpPhaseTimings";
import React, { FunctionComponent, ReactElement } from "react";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  TIMING_LABEL_CLASS_NAME,
  TIMING_VALUE_CLASS_NAME,
} from "./SummaryFacts";

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
  const translator: Translator = useTranslator();
  const timings: HttpPhaseTimings = props.httpTimings;

  const phases: Array<TimingPhase> = [
    {
      label: translationKey("DNS Lookup"),
      valueInMs: timings.dnsLookupInMs ?? -1,
      colorClassName: "bg-indigo-400",
    },
    {
      label: translationKey("TCP Connect"),
      valueInMs: timings.tcpConnectInMs ?? -1,
      colorClassName: "bg-sky-400",
    },
    {
      label: translationKey("TLS Handshake"),
      valueInMs: timings.tlsHandshakeInMs ?? -1,
      colorClassName: "bg-teal-400",
    },
    {
      label: translationKey("Waiting (TTFB)"),
      valueInMs: timings.timeToFirstByteInMs ?? -1,
      colorClassName: "bg-amber-400",
    },
    {
      label: translationKey("Download"),
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
        {translator.translateText("Request Phase Breakdown")}
      </div>
      <div className="text-xs text-gray-500 mb-3">
        {translator.translateText(
          "Where this check spent its time, from DNS lookup to the last byte.",
        )}
      </div>
      <div className="space-y-2">
        {phases.map((phase: TimingPhase) => {
          const percent: number =
            totalInMs > 0 ? (phase.valueInMs / totalInMs) * 100 : 0;

          return (
            <div key={phase.label} className="flex items-center text-sm">
              <div className={TIMING_LABEL_CLASS_NAME}>
                {translator.translateText(phase.label)}
              </div>
              <div className="flex-1 mx-2">
                <div
                  className={`h-3 rounded ${phase.colorClassName}`}
                  style={{ width: `${Math.max(percent, 1)}%` }}
                ></div>
              </div>
              <div className={TIMING_VALUE_CLASS_NAME}>
                {translator.translateTemplate("{{value}} ms", {
                  value: Math.round(phase.valueInMs * 100) / 100,
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HttpTimingsView;
