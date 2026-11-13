import {
  formatStatusTimelineCompactDuration,
  formatStatusTimelineShare,
  MONITORING_OFF_CLASS_NAME,
  MONITORING_OFF_STRIPES,
  StatusTimelineSummary,
  StatusTimelineSummaryItem,
} from "./StatusTimelineLayout";
import { MONITORING_OFF_TEXT } from "../StateTimeline/MonitoringOffIndicator";
import { getInlineSeparator, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import IsolatedText from "../IsolatedText/IsolatedText";
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
 * A status's figures - its share, how long it lasted, how many times - one
 * after the other, set apart the reader's way (a bullet beside Persian
 * digits), each in an isolate of its own. Written as one line, an Arabic
 * share ("99.96%", which Intl writes with left-to-right marks so its sign
 * stays after the number) took the duration's first number with it: the
 * line drew "99.96% · 30" beside the status's name and "يومًا و23 س" after
 * it, the 30 days cut from their days. An English status name in an Arabic
 * or Persian legend did the same, so the name is set apart too.
 */
const StatusTimelineLegendFigures: FunctionComponent<{
  parts: Array<string>;
  separator: string;
}> = (props: { parts: Array<string>; separator: string }): ReactElement => {
  return (
    <>
      {props.parts
        .filter(Boolean)
        .map((part: string, index: number): ReactElement => {
          return (
            <React.Fragment key={index}>
              {index > 0 ? props.separator : ""}
              <IsolatedText text={part} />
            </React.Fragment>
          );
        })}
    </>
  );
};

/*
 * The band's legend: what each colour is, and how long the record spent in
 * it during the period - "Offline 0.14% · 1 hour 2 mins · 31 times". The
 * colours are named here, so the band never relies on colour alone.
 *
 * Time with monitoring off (issue #6480) comes last, as long as it lasted
 * and with no share: nothing checked the monitor then, so it is in no
 * status's time, and the shares are of the rest - as uptime counts it.
 */
const StatusTimelineLegend: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const hasMonitoringOff: boolean = props.summary.monitoringOffCount > 0;

  if (props.summary.items.length === 0 && !hasMonitoringOff) {
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
            item.durationMs / 1000,
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
                <IsolatedText text={item.name} />
              </span>
              <span className="tabular-nums text-gray-500">
                <StatusTimelineLegendFigures
                  parts={[
                    props.showShare
                      ? formatStatusTimelineShare(item.share, translator)
                      : "",
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
                  ]}
                  separator={getInlineSeparator(translator.language)}
                />
              </span>
            </li>
          );
        },
      )}
      {hasMonitoringOff && (
        <li
          className="min-w-0 text-sm"
          data-testid="status-timeline-legend-monitoring-off"
        >
          <span
            className={`mr-2 inline-block h-2.5 w-2.5 rounded-full align-baseline ${MONITORING_OFF_CLASS_NAME}`}
            style={{ backgroundImage: MONITORING_OFF_STRIPES }}
            aria-hidden="true"
          ></span>
          <span className="mr-2 font-medium text-gray-900">
            {translator.translateText(MONITORING_OFF_TEXT) ||
              MONITORING_OFF_TEXT}
          </span>
          <span className="tabular-nums text-gray-500">
            {formatStatusTimelineCompactDuration(
              props.summary.monitoringOffMs / 1000,
            )}
          </span>
        </li>
      )}
    </ul>
  );
};

export default StatusTimelineLegend;
