import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import TelemetryFieldReadersList, {
  TelemetryFieldReadersWords,
} from "../FieldReaders/TelemetryFieldReadersList";
import {
  HIDE_DETAILS,
  IMPACT_UNCHECKED,
  MATCHED_LINES,
  NO_MATCH_HEADLINES,
  NO_MATCH_LINES,
  MATCHED_ONLY_HEADLINES,
  READER_CONSEQUENCES,
  READER_HEADLINES,
  READER_UNCHECKED,
  READERS_HEADINGS,
  SCOPED_LINES,
  SECURITY_EVENTS_FOLLOWS_SPANS,
  SECURITY_EVENTS_HEADLINES,
  SECURITY_EVENTS_KEPT_BY_DEFAULT,
  SECURITY_EVENTS_LOSSES,
  SECURITY_EVENTS_NONE_TAKEN,
  SECURITY_EVENTS_TITLE,
  SECURITY_EVENTS_UNCHECKED,
  SHOW_DETAILS,
  THRESHOLD_RULE_LINE,
  THRESHOLD_RULES_INTRO,
  THRESHOLD_RULES_MORE_HIDDEN,
  THRESHOLD_RULES_ONLY_HIDDEN,
  THRESHOLD_RULES_TITLE,
  THRESHOLD_RULES_UNCHECKED,
  UNCOUNTED_LINES,
  UNREAD_HEADLINES,
  UNREADABLE_HEADLINE,
} from "./DropFilterImpactWords";
import Route from "Common/Types/API/Route";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import IconProp from "Common/Types/Icon/IconProp";
import {
  countReadersOfKind,
  DropFilterImpact,
  DropFilterImpactAction,
  DropFilterImpactHeadline,
  DropFilterRecordCountState,
  DropFilterThresholdRule,
  getDropFilterHeadlineKind,
  getDropFilterImpactHeadline,
  getSecurityEventsRecordsTaken,
  isDropFilterImpactRead,
} from "Common/Types/Telemetry/DropFilterImpact";
import {
  SecurityEventsTelemetrySource,
  TELEMETRY_FIELD_READER_KINDS,
  TelemetryFieldReaderKind,
  TelemetryFieldReaders,
} from "Common/Types/Telemetry/TelemetryFieldReaders";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * WHAT A DROP OR SAMPLE FILTER WOULD TAKE, DRAWN THE ONE WAY (#10436).
 *
 * One line for the most important effect (getDropFilterImpactLine):
 * Security Events reading what the filter takes, then the monitors, SLOs,
 * dashboards, recording rules or saved views that read it, then how many
 * records it matches with nothing else reading them. Amber when something
 * reads what it takes, plain otherwise. Under it, folded behind Show
 * details:
 *
 *   - how many of the last day's records it matches, and of how many;
 *   - what Security Events loses of them, and for a sample the rules that
 *     fire at a count, with about how many each then needs;
 *   - every reader, kind by kind, each a link, the ones the person cannot
 *     open counted (TelemetryFieldReadersList, in a filter's words);
 *   - and what could not be checked, never said to be nothing.
 *
 * The form draws it as the filter is written (DropFilterImpactPreview), and
 * the question before a save opens it (useDropFilterImpactConfirmation).
 */

// Whether every kind of reader, and Security Events, could be read: only then is "nothing reads it" true.
function isEverythingChecked(impact: DropFilterImpact): boolean {
  return (
    impact.securityEvents.isChecked &&
    TELEMETRY_FIELD_READER_KINDS.every(
      (kind: TelemetryFieldReaderKind): boolean => {
        return impact.readers[kind].isChecked;
      },
    )
  );
}

// What a count says when it has no number.
function getUncountedLine(
  translator: Translator,
  impact: DropFilterImpact,
): string {
  const state: DropFilterRecordCountState = impact.count.state;

  if (state === DropFilterRecordCountState.Counted) {
    return "";
  }

  return translator.translateTemplate(UNCOUNTED_LINES[impact.signal][state], {
    seconds: translator.formatNumber(impact.count.timeLimitInSeconds),
  });
}

// The one line: the most important thing the filter takes, in the reader's words.
export function getDropFilterImpactLine(
  translator: Translator,
  impact: DropFilterImpact,
): string {
  const headline: DropFilterImpactHeadline =
    getDropFilterImpactHeadline(impact);

  switch (headline) {
    case DropFilterImpactHeadline.SecurityEvents:
      return translator.translatePlural(
        SECURITY_EVENTS_HEADLINES[impact.signal][impact.action],
        getSecurityEventsRecordsTaken(impact),
      );
    case DropFilterImpactHeadline.Readers: {
      const kind: TelemetryFieldReaderKind | null =
        getDropFilterHeadlineKind(impact);

      return kind
        ? translator.translatePlural(
            READER_HEADLINES[impact.action][kind],
            countReadersOfKind(impact.readers[kind]),
          )
        : "";
    }
    case DropFilterImpactHeadline.Unread:
      return translator.translatePlural(
        isEverythingChecked(impact)
          ? UNREAD_HEADLINES[impact.signal]
          : MATCHED_ONLY_HEADLINES[impact.signal],
        impact.count.matched,
      );
    case DropFilterImpactHeadline.NoMatch:
      return translator.translateText(
        isEverythingChecked(impact)
          ? NO_MATCH_HEADLINES[impact.signal]
          : NO_MATCH_LINES[impact.signal],
      ) as string;
    case DropFilterImpactHeadline.Unreadable:
      return translator.translateText(UNREADABLE_HEADLINE) as string;
    case DropFilterImpactHeadline.Uncounted:
    default:
      return getUncountedLine(translator, impact);
  }
}

// The share of the window's records a count is, in the reader's digits.
function getShare(matched: number, total: number): string {
  const percent: number = total > 0 ? (matched / total) * 100 : 0;

  return formatReaderFigure(percent, {
    decimals: percent > 0 && percent < 1 ? 2 : 1,
    isPercent: true,
    dropTrailingZeros: true,
  });
}

const CountDetails: FunctionComponent<{ impact: DropFilterImpact }> = (props: {
  impact: DropFilterImpact;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const impact: DropFilterImpact = props.impact;
  let line: string;

  if (impact.count.state !== DropFilterRecordCountState.Counted) {
    line = getUncountedLine(translator, impact);
  } else if (impact.count.matched === 0) {
    line = translator.translateText(NO_MATCH_LINES[impact.signal]) as string;
  } else {
    line = translator.translatePlural(
      MATCHED_LINES[impact.signal],
      impact.count.matched,
      {
        total: translator.formatNumber(impact.count.total),
        share: getShare(impact.count.matched, impact.count.total),
      },
    );
  }

  return (
    <div data-testid="drop-filter-impact-count">
      <p className="text-gray-700">{line}</p>
      {impact.count.isScoped ? (
        <p
          className="mt-0.5 text-xs text-gray-500"
          data-testid="drop-filter-impact-count-scoped"
        >
          {translator.translateText(SCOPED_LINES[impact.signal])}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

const ThresholdRules: FunctionComponent<{
  impact: DropFilterImpact;
}> = (props: { impact: DropFilterImpact }): ReactElement => {
  const translator: Translator = useTranslator();
  const impact: DropFilterImpact = props.impact;
  const rules: Array<DropFilterThresholdRule> =
    impact.securityEvents.thresholdRules.rules;
  const hiddenCount: number = impact.securityEvents.thresholdRules.hiddenCount;
  const percent: string = translator.formatNumber(impact.keepPercentage);

  if (!impact.securityEvents.thresholdRules.isChecked) {
    return (
      <p
        className="text-gray-600"
        data-testid="drop-filter-impact-threshold-rules-unchecked"
      >
        {translator.translateText(THRESHOLD_RULES_UNCHECKED)}
      </p>
    );
  }

  if (rules.length === 0 && hiddenCount === 0) {
    return <></>;
  }

  const rulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_DETECTION_RULES] as Route,
  );

  return (
    <div data-testid="drop-filter-impact-threshold-rules">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(THRESHOLD_RULES_TITLE)}
      </div>
      <p className="mt-0.5 text-gray-600">
        {translator.translateTemplate(THRESHOLD_RULES_INTRO, { percent })}
      </p>
      <ul className="mt-1 space-y-1">
        {rules.map((rule: DropFilterThresholdRule): ReactElement => {
          return (
            <li key={rule.id} data-testid="drop-filter-impact-threshold-rule">
              <AppLink
                className="font-medium text-indigo-600 hover:underline [overflow-wrap:anywhere]"
                to={rulesRoute}
              >
                {rule.name || rule.id}
              </AppLink>
              <span className="block text-xs text-gray-500">
                {translator.translatePlural(
                  THRESHOLD_RULE_LINE,
                  rule.windowInMinutes,
                  {
                    threshold: translator.formatNumber(rule.threshold),
                    percent,
                    needed: translator.formatNumber(rule.neededWhenSampled),
                  },
                )}
              </span>
            </li>
          );
        })}
        {hiddenCount > 0 ? (
          <li
            className="text-gray-500"
            data-testid="drop-filter-impact-threshold-rules-hidden"
          >
            {translator.translatePlural(
              rules.length > 0
                ? THRESHOLD_RULES_MORE_HIDDEN
                : THRESHOLD_RULES_ONLY_HIDDEN,
              hiddenCount,
            )}
          </li>
        ) : (
          <></>
        )}
      </ul>
    </div>
  );
};

// Whether the scan that reads this signal's records reads them in this project.
function isScannedBySecurityEvents(impact: DropFilterImpact): boolean {
  return impact.securityEvents.sources.includes(
    impact.signal === "log"
      ? SecurityEventsTelemetrySource.Logs
      : SecurityEventsTelemetrySource.Traces,
  );
}

const SecurityEventsDetails: FunctionComponent<{
  impact: DropFilterImpact;
}> = (props: { impact: DropFilterImpact }): ReactElement => {
  const translator: Translator = useTranslator();
  const impact: DropFilterImpact = props.impact;
  const lines: Array<ReactElement> = [];
  const taken: number = getSecurityEventsRecordsTaken(impact);

  if (impact.securityEvents.keepsWhatSecurityEventsReads) {
    lines.push(
      <p key="kept" data-testid="drop-filter-impact-security-events-kept">
        {translator.translateText(SECURITY_EVENTS_KEPT_BY_DEFAULT)}
      </p>,
    );
  } else if (taken > 0) {
    lines.push(
      <p key="loses" data-testid="drop-filter-impact-security-events-loses">
        {translator.translateTemplate(
          SECURITY_EVENTS_LOSSES[impact.signal][impact.action],
          { percent: translator.formatNumber(impact.keepPercentage) },
        )}
      </p>,
    );
  } else if (
    isScannedBySecurityEvents(impact) &&
    impact.count.state === DropFilterRecordCountState.Counted
  ) {
    lines.push(
      <p key="none" data-testid="drop-filter-impact-security-events-none">
        {translator.translateText(SECURITY_EVENTS_NONE_TAKEN[impact.signal])}
      </p>,
    );
  }

  if (
    impact.signal === "trace" &&
    impact.securityEvents.sources.includes(SecurityEventsTelemetrySource.Logs)
  ) {
    lines.push(
      <p key="follows" data-testid="drop-filter-impact-security-events-spans">
        {translator.translateText(SECURITY_EVENTS_FOLLOWS_SPANS)}
      </p>,
    );
  }

  if (!impact.securityEvents.isChecked) {
    lines.push(
      <p
        key="unchecked"
        data-testid="drop-filter-impact-security-events-unchecked"
      >
        {translator.translateText(SECURITY_EVENTS_UNCHECKED)}
      </p>,
    );
  }

  const showsRules: boolean =
    impact.action === DropFilterImpactAction.Sample &&
    !impact.securityEvents.keepsWhatSecurityEventsReads;

  if (lines.length === 0 && !showsRules) {
    return <></>;
  }

  return (
    <div className="space-y-3" data-testid="drop-filter-impact-security-events">
      {lines.length > 0 ? (
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {translator.translateText(SECURITY_EVENTS_TITLE)}
          </div>
          <div className="mt-0.5 space-y-1 text-gray-600">{lines}</div>
        </div>
      ) : (
        <></>
      )}
      {showsRules ? <ThresholdRules impact={impact} /> : <></>}
    </div>
  );
};

export interface ComponentProps {
  impact: DropFilterImpact;
  // Start with the details open: the question before a save shows them all.
  isDetailsOpen?: boolean | undefined;
  // Drawn while a newer answer is on its way.
  isUpdating?: boolean | undefined;
  dataTestId?: string | undefined;
}

const DropFilterImpactSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const impact: DropFilterImpact = props.impact;
  const [isOpen, setIsOpen] = useState<boolean>(Boolean(props.isDetailsOpen));
  const dataTestId: string = props.dataTestId || "drop-filter-impact";
  const isRead: boolean = isDropFilterImpactRead(impact);
  const hasDetails: boolean = impact.isQueryReadable;
  const line: string = getDropFilterImpactLine(translator, impact);
  const readers: TelemetryFieldReaders = {
    kinds: impact.readers,
    // Security Events is said above, in a filter's words.
    securityEvents: { isChecked: true, sources: [], loses: [] },
  };
  const words: TelemetryFieldReadersWords = {
    heading: READERS_HEADINGS[impact.action],
    consequences: READER_CONSEQUENCES[impact.action],
    unchecked: READER_UNCHECKED,
    values: { percent: translator.formatNumber(impact.keepPercentage) },
  };

  return (
    <div
      className={`rounded-md border px-3 py-2.5 text-sm transition-opacity ${
        isRead ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50"
      } ${props.isUpdating ? "opacity-60" : ""}`}
      aria-busy={props.isUpdating ? true : undefined}
      data-testid={dataTestId}
      data-impact={getDropFilterImpactHeadline(impact)}
    >
      <div className="flex items-start gap-2">
        <Icon
          icon={isRead ? IconProp.Alert : IconProp.Info}
          className={`mt-0.5 h-4 w-4 shrink-0 ${
            isRead ? "text-amber-700" : "text-gray-500"
          }`}
        />
        <div className="min-w-0 flex-1">
          <p
            className={`[overflow-wrap:anywhere] ${
              isRead ? "font-medium text-amber-900" : "text-gray-700"
            }`}
            data-testid={`${dataTestId}-line`}
          >
            {line || translator.translateText(IMPACT_UNCHECKED)}
          </p>
          {hasDetails ? (
            <div className="mt-1">
              <Button
                title={isOpen ? HIDE_DETAILS : SHOW_DETAILS}
                buttonStyle={ButtonStyleType.SECONDARY_LINK}
                icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
                ariaExpanded={isOpen}
                dataTestId={`${dataTestId}-toggle`}
                onClick={() => {
                  setIsOpen(!isOpen);
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
      {hasDetails && isOpen ? (
        <div
          className="mt-3 space-y-3 border-t border-gray-200 pt-3"
          data-testid={`${dataTestId}-details`}
        >
          <CountDetails impact={impact} />
          <SecurityEventsDetails impact={impact} />
          <TelemetryFieldReadersList readers={readers} words={words} />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default DropFilterImpactSummary;
