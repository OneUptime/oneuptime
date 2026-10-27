import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import Log from "Common/Models/AnalyticsModels/Log";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Service from "Common/Models/DatabaseModels/Service";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { resolveReplayMomentRouteForSession } from "../../Utils/RumSessionLookup";
import {
  FROM_A_LOG_LINE,
  FROM_A_LOG_LINE_OF,
  LOG_LINE_LABEL,
  LOG_LINE_NOT_FOUND,
  LOG_LINE_NOT_PERMITTED,
  NO_TRACE_FOR_LOG_LINE,
  SHOW_LESS,
  SHOW_WHOLE_LINE,
  VIEW_EXCEPTION,
  VIEW_EXCEPTION_HINT,
  VIEW_LOGS_AROUND,
  VIEW_LOGS_AROUND_HINT,
  VIEW_REQUEST_LOGS,
  VIEW_REQUEST_LOGS_HINT,
  VIEW_TRACE,
  VIEW_TRACE_HINT,
  WATCH_SESSION,
  WATCH_SESSION_HINT,
  WHERE_IT_CAME_FROM_TITLE,
} from "./SecurityEventRequestCopy";
import { SecurityEventRequestFacts } from "./SecurityEventRequestStory";
import {
  SecurityEventLogsLink,
  getSecurityEventExceptionRoute,
  getSecurityEventLogId,
  getSecurityEventLogServiceId,
  getSecurityEventLogsLink,
  getSecurityEventTraceRoute,
} from "./SecurityEventTelemetryLinks";

export const WHERE_IT_CAME_FROM_TEST_ID: string =
  "security-event-where-it-came-from";
export const SECURITY_EVENT_LOG_LINE_TEST_ID: string =
  "security-event-log-line";

// A log line is found by its id within this far of the event's time.
export const LOG_LINE_WINDOW_IN_HOURS: number = 24;

// How much of a log line is drawn folded, and at most unfolded.
export const LOG_LINE_FOLDED_LENGTH: number = 600;
export const LOG_LINE_MAX_LENGTH: number = 20000;

export interface ComponentProps {
  securityEvent: SecurityEvent;
  facts: SecurityEventRequestFacts;
}

type LogLineState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "found"; body: string }
  | { status: "not-found" }
  | { status: "not-permitted" };

function isNotPermitted(error: unknown): boolean {
  const status: unknown = (error as { statusCode?: unknown })?.statusCode;

  return status === 401 || status === 403;
}

const SourceLink: FunctionComponent<{
  route: Route;
  icon: IconProp;
  label: string;
  hint: string;
  testId: string;
}> = (props: {
  route: Route;
  icon: IconProp;
  label: string;
  hint: string;
  testId: string;
}): ReactElement => {
  return (
    <Link
      to={props.route}
      title={props.hint}
      dataTestId={props.testId}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
    >
      <Icon icon={props.icon} className="h-3.5 w-3.5 text-gray-400" />
      {props.label}
    </Link>
  );
};

/*
 * Where a security event came from, and the way to everything around it:
 * the log line it was read from, shown right here; the trace of the request
 * it happened in; the exception that request threw; the replay of the
 * browser session it was part of; and the request's other log lines.
 *
 * Every read is the reader's own (the log line, the service's name, the
 * replay's application), so a link to something they may not open is not
 * offered. Shown for events made from a log line or naming a request; a
 * product's alert says where it came from in its Product and Vendor rows.
 */
const SecurityEventSourceSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const event: SecurityEvent = props.securityEvent;
  const logId: string = getSecurityEventLogId(event);
  const serviceId: string = getSecurityEventLogServiceId(event);
  const traceId: string = (event.traceId || "").trim();
  const sessionId: string = (event.sessionId || "").trim();
  const time: Date | null = event.time ? new Date(event.time) : null;
  const timeKey: number = time ? time.getTime() : NaN;

  const [logLine, setLogLine] = useState<LogLineState>({ status: "none" });
  const [isLineUnfolded, setIsLineUnfolded] = useState<boolean>(false);
  const [serviceName, setServiceName] = useState<string>("");
  const [replayRoute, setReplayRoute] = useState<Route | null>(null);

  // The line itself, read by its id around the event's time.
  useEffect(() => {
    setIsLineUnfolded(false);

    if (!logId || !Number.isFinite(timeKey)) {
      setLogLine({ status: "none" });
      return;
    }

    let isCurrent: boolean = true;
    setLogLine({ status: "loading" });

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    AnalyticsModelAPI.getList<Log>({
      modelType: Log,
      query: {
        ...(projectId ? { projectId } : {}),
        _id: logId,
        time: new InBetween<Date>(
          new Date(timeKey - LOG_LINE_WINDOW_IN_HOURS * 60 * 60 * 1000),
          new Date(timeKey + LOG_LINE_WINDOW_IN_HOURS * 60 * 60 * 1000),
        ),
      } as Query<Log>,
      limit: 1,
      skip: 0,
      select: { body: true } as Select<Log>,
      sort: {},
      requestOptions: {},
    })
      .then((result: ListResult<Log>): void => {
        if (!isCurrent) {
          return;
        }

        const body: unknown = result.data[0]?.body;

        setLogLine(
          typeof body === "string" && body
            ? { status: "found", body }
            : { status: "not-found" },
        );
      })
      .catch((error: unknown): void => {
        if (isCurrent) {
          setLogLine(
            isNotPermitted(error)
              ? { status: "not-permitted" }
              : { status: "none" },
          );
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [logId, timeKey]);

  // The name of the service the line was sent under.
  useEffect(() => {
    setServiceName("");

    if (!serviceId) {
      return;
    }

    let isCurrent: boolean = true;

    ModelAPI.getItem<Service>({
      modelType: Service,
      id: new ObjectID(serviceId),
      select: { name: true },
    })
      .then((service: Service | null): void => {
        if (isCurrent && service?.name) {
          setServiceName(service.name);
        }
      })
      .catch((): void => {
        // The reader may not read services: the sentence says "your telemetry".
      });

    return () => {
      isCurrent = false;
    };
  }, [serviceId]);

  // The replay of the session, when one was recorded and the reader may watch it.
  useEffect(() => {
    setReplayRoute(null);

    if (!sessionId) {
      return;
    }

    let isCurrent: boolean = true;

    resolveReplayMomentRouteForSession({
      sessionId,
      at: Number.isFinite(timeKey) ? new Date(timeKey) : null,
    })
      .then((route: Route | undefined): void => {
        if (isCurrent && route) {
          setReplayRoute(route);
        }
      })
      .catch((): void => {
        // No replay to offer.
      });

    return () => {
      isCurrent = false;
    };
  }, [sessionId, timeKey]);

  const traceRoute: Route | null = useMemo(() => {
    return getSecurityEventTraceRoute({
      event,
      serverSpanId: props.facts.serverSpanId,
    });
  }, [event, props.facts.serverSpanId]);

  const exceptionRoute: Route | null = useMemo(() => {
    return getSecurityEventExceptionRoute(props.facts.exceptionFingerprint);
  }, [props.facts.exceptionFingerprint]);

  const logsLink: SecurityEventLogsLink | null = useMemo(() => {
    return getSecurityEventLogsLink(event);
  }, [event]);

  if (!logId && !traceId && !sessionId) {
    return <></>;
  }

  const lineBody: string =
    logLine.status === "found"
      ? logLine.body.length > LOG_LINE_MAX_LENGTH
        ? `${logLine.body.slice(0, LOG_LINE_MAX_LENGTH)}…`
        : logLine.body
      : "";
  const isLineLong: boolean = lineBody.length > LOG_LINE_FOLDED_LENGTH;
  const shownBody: string =
    isLineLong && !isLineUnfolded
      ? `${lineBody.slice(0, LOG_LINE_FOLDED_LENGTH)}…`
      : lineBody;

  const sourceSentence: string = logId
    ? serviceName
      ? translator.translateTemplate(FROM_A_LOG_LINE_OF, {
          service: serviceName,
        })
      : translator.translateText(FROM_A_LOG_LINE) || FROM_A_LOG_LINE
    : "";

  const links: Array<ReactElement> = [];

  if (traceRoute) {
    links.push(
      <SourceLink
        key="trace"
        route={traceRoute}
        icon={IconProp.Waterfall}
        label={translator.translateText(VIEW_TRACE) || VIEW_TRACE}
        hint={translator.translateText(VIEW_TRACE_HINT) || VIEW_TRACE_HINT}
        testId="security-event-view-trace"
      />,
    );
  }

  if (exceptionRoute) {
    links.push(
      <SourceLink
        key="exception"
        route={exceptionRoute}
        icon={IconProp.Bug}
        label={translator.translateText(VIEW_EXCEPTION) || VIEW_EXCEPTION}
        hint={
          translator.translateText(VIEW_EXCEPTION_HINT) || VIEW_EXCEPTION_HINT
        }
        testId="security-event-view-exception"
      />,
    );
  }

  if (replayRoute) {
    links.push(
      <SourceLink
        key="session"
        route={replayRoute}
        icon={IconProp.Play}
        label={translator.translateText(WATCH_SESSION) || WATCH_SESSION}
        hint={translator.translateText(WATCH_SESSION_HINT) || WATCH_SESSION_HINT}
        testId="security-event-watch-session"
      />,
    );
  }

  if (logsLink) {
    const isRequest: boolean = logsLink.scope === "request";
    const label: string = isRequest ? VIEW_REQUEST_LOGS : VIEW_LOGS_AROUND;
    const hint: string = isRequest
      ? VIEW_REQUEST_LOGS_HINT
      : VIEW_LOGS_AROUND_HINT;

    links.push(
      <SourceLink
        key="logs"
        route={logsLink.route}
        icon={IconProp.Logs}
        label={translator.translateText(label) || label}
        hint={translator.translateText(hint) || hint}
        testId="security-event-view-logs"
      />,
    );
  }

  return (
    <section data-testid={WHERE_IT_CAME_FROM_TEST_ID}>
      <h3 className="mb-2 text-sm font-semibold text-gray-900">
        {translator.translateText(WHERE_IT_CAME_FROM_TITLE)}
      </h3>
      <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {sourceSentence && (
          <p className="px-3 py-2 text-sm text-gray-700">{sourceSentence}</p>
        )}

        {logLine.status === "loading" && (
          <div className="px-3 py-2">
            <div className="h-10 animate-pulse rounded bg-gray-100" />
          </div>
        )}

        {logLine.status === "found" && (
          <div className="px-3 py-2">
            <div className="mb-1 text-xs font-medium text-gray-500">
              {translator.translateText(LOG_LINE_LABEL)}
            </div>
            <pre
              data-testid={SECURITY_EVENT_LOG_LINE_TEST_ID}
              className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-gray-50 p-2 font-mono text-[11px] leading-relaxed text-gray-800"
            >
              {shownBody}
            </pre>
            {isLineLong && (
              <button
                type="button"
                className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                onClick={() => {
                  setIsLineUnfolded(!isLineUnfolded);
                }}
              >
                {translator.translateText(
                  isLineUnfolded ? SHOW_LESS : SHOW_WHOLE_LINE,
                )}
              </button>
            )}
          </div>
        )}

        {logLine.status === "not-found" && (
          <p className="px-3 py-2 text-xs text-gray-500">
            {translator.translateText(LOG_LINE_NOT_FOUND)}
          </p>
        )}

        {logLine.status === "not-permitted" && (
          <p className="px-3 py-2 text-xs text-gray-500">
            {translator.translateText(LOG_LINE_NOT_PERMITTED)}
          </p>
        )}

        {logId && !traceId && (
          <p className="px-3 py-2 text-xs text-gray-500">
            {translator.translateText(NO_TRACE_FOR_LOG_LINE)}
          </p>
        )}

        {links.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 py-2">{links}</div>
        )}
      </div>
    </section>
  );
};

export default SecurityEventSourceSection;
