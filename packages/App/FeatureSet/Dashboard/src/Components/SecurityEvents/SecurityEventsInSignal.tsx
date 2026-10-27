import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SecurityEventRequestOutcomePill from "./SecurityEventRequestOutcomePill";
import SecurityEventSeverityPill, {
  getSeverityColor,
} from "./SecurityEventSeverityPill";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import {
  MORE_THAN_LIMIT_TITLE,
  OPEN_IN_SECURITY_EVENTS,
  SECURITY_EVENTS_IN_SIGNAL_LIMIT,
  SECURITY_EVENTS_IN_SIGNAL_TITLES,
  SecurityEventsInSignalKind,
  SecurityEventsInSignalScope,
  buildSecurityEventsInSignalQuery,
  buildSecurityEventsInSignalRoute,
  getSecurityEventsInSignalKind,
  getSecurityEventsInSignalWindow,
  getWorstSecurityEvent,
} from "./SecurityEventsInSignalModel";

export const SECURITY_EVENTS_IN_SIGNAL_TEST_ID: string =
  "security-events-in-signal";

export interface ComponentProps {
  scope: SecurityEventsInSignalScope;
  // When the line, the request or the session happened; unknown on a page.
  time?: Date | null | undefined;
  className?: string | undefined;
}

/*
 * A log line, a trace, a session or an exception that is part of an attack
 * says so where it is read: how many security events it is part of, the
 * worst of them with how far its request got, and the way to all of them in
 * Security Events (SecurityEventsInSignalModel).
 *
 * The read is the reader's own. Somebody who may not read security events -
 * a Telemetry role without a Security one - is refused, and sees nothing:
 * not an error, not an empty box. Nobody sees anything when there is
 * nothing to see either.
 */
const SecurityEventsInSignal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const kind: SecurityEventsInSignalKind | null = getSecurityEventsInSignalKind(
    props.scope,
  );
  const timeKey: number = props.time ? new Date(props.time).getTime() : NaN;

  const searchWindow: InBetween<Date> = useMemo(() => {
    return getSecurityEventsInSignalWindow({
      time: Number.isFinite(timeKey) ? new Date(timeKey) : null,
      now: OneUptimeDate.getCurrentDate(),
    });
    // The window moves with the moment asked about, not with each render.
  }, [timeKey, kind]);

  const scopeKey: string = [
    props.scope.traceId,
    props.scope.logId,
    props.scope.sessionId,
    props.scope.exceptionFingerprint,
  ].join("|");

  const [events, setEvents] = useState<Array<SecurityEvent>>([]);

  useEffect(() => {
    setEvents([]);

    const query: Query<SecurityEvent> | null = buildSecurityEventsInSignalQuery(
      {
        scope: props.scope,
        window: searchWindow,
        projectId: ProjectUtil.getCurrentProjectId(),
      },
    );

    if (!query) {
      return;
    }

    let isCurrent: boolean = true;

    AnalyticsModelAPI.getList<SecurityEvent>({
      modelType: SecurityEvent,
      query,
      limit: SECURITY_EVENTS_IN_SIGNAL_LIMIT,
      skip: 0,
      select: {
        time: true,
        severityName: true,
        severityId: true,
        message: true,
        className: true,
        requestOutcome: true,
      } as Select<SecurityEvent>,
      sort: { time: SortOrder.Descending } as Record<string, SortOrder>,
      requestOptions: {},
    })
      .then((result: ListResult<SecurityEvent>): void => {
        if (isCurrent) {
          setEvents(result.data);
        }
      })
      .catch((): void => {
        // Not the reader's to read, or not readable now: say nothing.
      });

    return () => {
      isCurrent = false;
    };
  }, [scopeKey, searchWindow]);

  const route: Route | null = useMemo(() => {
    return buildSecurityEventsInSignalRoute({
      scope: props.scope,
      window: searchWindow,
    });
  }, [scopeKey, searchWindow]);

  if (!kind || events.length === 0) {
    return <></>;
  }

  const worst: SecurityEvent | null = getWorstSecurityEvent(events);
  const title: string =
    events.length >= SECURITY_EVENTS_IN_SIGNAL_LIMIT
      ? translator.translateTemplate(MORE_THAN_LIMIT_TITLE, {
          count: translator.formatNumber(events.length),
        })
      : translator.translatePlural(
          SECURITY_EVENTS_IN_SIGNAL_TITLES[kind],
          events.length,
        );

  return (
    <div
      data-testid={SECURITY_EVENTS_IN_SIGNAL_TEST_ID}
      data-scope={kind}
      className={`flex flex-wrap items-start gap-3 rounded-md border border-gray-200 bg-white px-3 py-2.5 ${
        props.className || ""
      }`}
      style={{
        borderLeftWidth: 3,
        borderLeftColor: getSeverityColor(worst?.severityName).toString(),
      }}
    >
      <Icon
        icon={IconProp.ShieldExclamation}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900">{title}</div>
        {worst && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            <SecurityEventSeverityPill
              severityName={worst.severityName}
              size={PillSize.Small}
            />
            <SecurityEventRequestOutcomePill
              outcome={worst.requestOutcome}
              size={PillSize.Small}
            />
            <span
              className="min-w-0 truncate text-xs text-gray-600"
              title={worst.message || ""}
            >
              {worst.message || worst.className || ""}
            </span>
          </div>
        )}
      </div>
      {route && (
        <Link
          to={route}
          className="flex-shrink-0 self-center text-xs font-medium text-indigo-600 hover:text-indigo-700"
          dataTestId="security-events-in-signal-open"
        >
          {translator.translateText(OPEN_IN_SECURITY_EVENTS)}
        </Link>
      )}
    </div>
  );
};

export default SecurityEventsInSignal;
