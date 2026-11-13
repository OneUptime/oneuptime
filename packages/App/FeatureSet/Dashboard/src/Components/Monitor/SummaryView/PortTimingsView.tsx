import PortMonitorTimings from "Common/Types/Monitor/PortMonitor/PortMonitorTimings";
import React, { FunctionComponent, ReactElement } from "react";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { formatMilliseconds } from "../../../Utils/Milliseconds";
import {
  TIMING_BAR_TRACK_CLASS_NAME,
  TIMING_LABEL_CLASS_NAME,
  TIMING_ROW_CLASS_NAME,
  TIMING_ROW_TEST_ID,
  TIMING_ROWS_CLASS_NAME,
  TIMING_VALUE_CLASS_NAME,
} from "./SummaryFacts";

export interface ComponentProps {
  portTimings: PortMonitorTimings;
}

interface ConnectionPhase {
  label: string;
  valueInMs: number;
  colorClassName: string;
}

// A phase's time in the reader's language, to two decimals: "8.12 ms".
const formatDurationInMs: (
  translator: Translator,
  durationInMs: number,
) => string = (translator: Translator, durationInMs: number): string => {
  return formatMilliseconds(translator, durationInMs, {
    maximumFractionDigits: 2,
  });
};

/*
 * A compact waterfall for a Port check. The total remains in the summary
 * card because it is the stable responseTimeInMs value used by existing
 * charts and criteria; this view explains how DNS and TCP contributed to it.
 */
const PortTimingsView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const timings: PortMonitorTimings = props.portTimings;

  const phases: Array<ConnectionPhase> = [
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
        {translator.translateText("Connection Phase Breakdown")}
      </div>
      <div className="text-xs text-gray-500 mb-3">
        {translator.translateText(
          "Time spent resolving the target and establishing the TCP connection.",
        )}
      </div>
      <div className={TIMING_ROWS_CLASS_NAME}>
        {phases.map((phase: ConnectionPhase) => {
          const percent: number =
            totalConnectionInMs > 0
              ? (phase.valueInMs / totalConnectionInMs) * 100
              : 0;

          return (
            <div
              key={phase.label}
              className={TIMING_ROW_CLASS_NAME}
              data-testid={TIMING_ROW_TEST_ID}
            >
              <div className={TIMING_LABEL_CLASS_NAME}>
                {translator.translateText(phase.label)}
              </div>
              <div className={TIMING_BAR_TRACK_CLASS_NAME}>
                <div
                  className={`h-3 rounded ${phase.colorClassName}`}
                  style={{ width: `${Math.max(percent, 1)}%` }}
                ></div>
              </div>
              <div className={TIMING_VALUE_CLASS_NAME}>
                {formatDurationInMs(translator, phase.valueInMs)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PortTimingsView;
