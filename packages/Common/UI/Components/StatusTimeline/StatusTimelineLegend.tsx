import {
  formatStatusTimelineCompactDuration,
  formatStatusTimelineShare,
  StatusTimelineSummary,
  StatusTimelineSummaryItem,
} from "./StatusTimelineLayout";
import { formatDurationInSeconds } from "../../Utils/UseLiveDuration";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  summary: StatusTimelineSummary;
  /*
   * What the figures cover, when it is not the whole period: "Since Oct
   * 14, 2:12 PM:" while older changes are not loaded.
   */
  note?: string | undefined;
  /*
   * Say each status's share of the period: right for a monitor's uptime,
   * meaningless for an incident's states, whose last runs on for ever.
   */
  showShare: boolean;
}

/*
 * The band's legend: what each colour is, and how long the record spent in
 * it during the period - "Offline 0.14% · 1 hour 2 mins · 31 times". The
 * colours are named here, so the band never relies on colour alone.
 */
const StatusTimelineLegend: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.summary.items.length === 0) {
    return <></>;
  }

  // The status the record spent most of the period in.
  let baselineStatusKey: string = "";
  let baselineDurationMs: number = -1;

  for (const item of props.summary.items) {
    if (item.durationMs > baselineDurationMs) {
      baselineDurationMs = item.durationMs;
      baselineStatusKey = item.statusKey;
    }
  }

  return (
    <ul
      role="list"
      aria-label={translator.translateText("Time in each status")}
      className="flex flex-wrap items-center gap-x-5 gap-y-1.5"
      data-testid="status-timeline-legend"
    >
      {props.note && (
        <li
          className="text-sm text-gray-500"
          data-testid="status-timeline-legend-note"
        >
          {props.note}
        </li>
      )}
      {props.summary.items.map(
        (item: StatusTimelineSummaryItem): ReactElement => {
          const duration: string = formatStatusTimelineCompactDuration(
            formatDurationInSeconds(Math.floor(item.durationMs / 1000)),
          );

          /*
           * How many times it began, for a status it came back to - "31
           * times" offline says how often it went down. Not for the status
           * the record spent most of the period in: that one simply
           * resumes after every other.
           */
          const isBaseline: boolean = item.statusKey === baselineStatusKey;

          return (
            <li
              key={item.statusKey}
              className="min-w-0 text-sm"
              data-testid="status-timeline-legend-item"
              data-status-key={item.statusKey}
            >
              <span
                className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-baseline"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              ></span>
              <span className="mr-2 font-medium text-gray-900">
                {item.name}
              </span>
              <span className="tabular-nums text-gray-500">
                {[
                  props.showShare ? formatStatusTimelineShare(item.share) : "",
                  duration,
                  item.count > 1 && !isBaseline
                    ? translator.translatePlural(
                        {
                          one: "{{count}} time",
                          other: "{{count}} times",
                        },
                        item.count,
                      )
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          );
        },
      )}
    </ul>
  );
};

export default StatusTimelineLegend;
