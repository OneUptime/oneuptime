import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import AppLink from "../AppLink/AppLink";
import {
  ReplayCardMoment,
  getReplayCardMoment,
} from "../../Utils/ExceptionCorrelation";
import { makeExceptionSignalId } from "./Rail/ReplaySignalTypes";
import {
  REPLAY_EXCEPTION_PRE_ROLL_MS,
  buildReplayMomentRoute,
} from "./ReplayPlayerUrlState";
import {
  formatSessionDuration,
  parseSessionReplaySummary,
  SessionReplaySummary,
} from "./SessionReplayTable";

/*
 * "Watch what the user saw" - the embeddable card for the exception and
 * incident pages, and the primary product surface for this whole feature.
 *
 * Replay only earns its cost if an engineer stumbles into it while debugging
 * rather than having to remember it exists. That is what this card is for,
 * so it is deliberately quiet when there is nothing to show: no session, no
 * card, no empty state cluttering the exception page. It is NOT quiet when
 * it could not look: a viewer without the permission, or a project without
 * the plan, is told so in one muted line, because "no card" and "not
 * allowed to see the card" must not look the same.
 */

const FOR_EXCEPTION_ROUTE: string =
  "/telemetry/rum/session-replay/for-exception";

/* Sessions listed before the rest fold behind "Show all". */
export const REPLAY_CARD_SESSIONS_SHOWN: number = 5;

export type ReplayCardFailureKind = "permission" | "plan" | "error";

export interface ReplayCardFailure {
  kind: ReplayCardFailureKind;
  message: string;
}

export const REPLAY_CARD_PERMISSION_COPY: string =
  "A recording of this error may exist, but your role cannot list session replays. Ask a project admin for the Read Session Replay permission.";

export const REPLAY_CARD_PLAN_COPY: string =
  "Session replay is not included in this project's plan, so recordings of this error cannot be looked up.";

export interface ReplayCardProps {
  /*
   * Optional fallback only. The /for-exception endpoint scopes by the
   * caller's accessible applications and every returned session names its
   * own application, so callers like the exception explorer - where an
   * exception is not scoped to a single RUM application - can omit this.
   */
  rumApplicationId?: ObjectID | undefined;
  /*
   * The session the shown occurrence carries, when the caller has one. The
   * endpoint pins the search to it, and only that session may be linked
   * "at the moment of the error".
   */
  sessionId?: string | undefined;
  /* The occurrence's ExceptionInstance id -> ?signal=exc:<id> on the link. */
  exceptionInstanceId?: string | undefined;
  /* Exception group fingerprint, when the caller only has the group. */
  fingerprint?: string | undefined;
  /* Absolute time of the occurrence, used to position playback. */
  errorTimeUnixMs?: number | undefined;
  className?: string | undefined;
}

interface ReplaySessionRow {
  summary: SessionReplaySummary;
  /* From the response row; each session names the application it lives in. */
  rumApplicationId: string;
}

/*
 * Classify an endpoint failure so the card can say what happened. 401/403
 * come from the missing list permission; 402 is assertSessionReplayPlan.
 */
export function classifyReplayCardFailure(error: unknown): ReplayCardFailure {
  const statusCode: number =
    error instanceof HTTPErrorResponse ? error.statusCode : -1;

  if (statusCode === 401 || statusCode === 403) {
    return { kind: "permission", message: REPLAY_CARD_PERMISSION_COPY };
  }

  if (statusCode === 402) {
    return { kind: "plan", message: REPLAY_CARD_PLAN_COPY };
  }

  const friendly: string = API.getFriendlyMessage(error);

  return {
    kind: "error",
    message: friendly
      ? `Could not check for a recording: ${friendly}`
      : "Could not check for a recording.",
  };
}

function formatSessionStart(startTime: string): string {
  if (!startTime) {
    return "unknown start";
  }

  const date: Date = OneUptimeDate.fromString(startTime);

  if (Number.isNaN(date.getTime())) {
    return "unknown start";
  }

  return OneUptimeDate.getDateAsUserFriendlyFormattedString(date);
}

function describeDevice(summary: SessionReplaySummary): string {
  return (
    [summary.browserName, summary.osName].filter(Boolean).join(" on ") ||
    "Unknown device"
  );
}

const ReplayCard: FunctionComponent<ReplayCardProps> = (
  props: ReplayCardProps,
): ReactElement => {
  const [sessions, setSessions] = useState<Array<ReplaySessionRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [failure, setFailure] = useState<ReplayCardFailure | null>(null);
  const [isScopeTruncated, setIsScopeTruncated] = useState<boolean>(false);
  const [showAllSessions, setShowAllSessions] = useState<boolean>(false);

  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const { rumApplicationId, sessionId, fingerprint, errorTimeUnixMs } = props;
  /*
   * Navigation-derived ObjectIDs are new objects on every render, so the
   * callback below keys on the string. Otherwise every parent re-render
   * refires the lookup.
   */
  const rumApplicationIdString: string = rumApplicationId?.toString() ?? "";

  const load: (generation: number) => Promise<void> = useCallback(
    async (generation: number): Promise<void> => {
      /*
       * The endpoint keys on the exception fingerprint and rejects a request
       * without one. A caller holding only a sessionId has nothing to ask,
       * so the card stays quiet instead of firing a guaranteed 400.
       */
      if (!fingerprint) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setFailure(null);

        const post: (
          pinnedSessionId: string | undefined,
        ) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> = (
          pinnedSessionId: string | undefined,
        ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
          return API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              FOR_EXCEPTION_ROUTE,
            ),
            data: {
              fingerprint: fingerprint,
              /*
               * Pins the search to the occurrence's own session, and lets
               * the server derive a partition window from the moment
               * instead of scanning every partition the project has.
               */
              ...(pinnedSessionId ? { sessionId: pinnedSessionId } : {}),
              ...(errorTimeUnixMs && errorTimeUnixMs > 0
                ? { errorTimeUnixMs: errorTimeUnixMs }
                : {}),
            },
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });
        };

        let response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await post(sessionId);

        if (generation !== loadGenerationRef.current) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        let rows: JSONArray = (response.data["sessions"] as JSONArray) || [];

        /*
         * The pin is strict: an occurrence whose session was never recorded
         * (sampled out, consent withheld) answers with nothing. That is
         * still a page where a recording of the SAME error may exist, so
         * the search runs once more unpinned; the moment rule below then
         * refuses to promise a moment for whichever session comes back.
         */
        if (rows.length === 0 && sessionId) {
          response = await post(undefined);

          if (generation !== loadGenerationRef.current) {
            return;
          }

          if (response instanceof HTTPErrorResponse) {
            throw response;
          }

          rows = (response.data["sessions"] as JSONArray) || [];
        }

        setSessions(
          rows.map((row: JSONObject): ReplaySessionRow => {
            return {
              summary: parseSessionReplaySummary(row),
              rumApplicationId: String(row["rumApplicationId"] || ""),
            };
          }),
        );
        setIsScopeTruncated(
          response.data["isApplicationScopeTruncated"] === true,
        );
      } catch (error: unknown) {
        if (generation === loadGenerationRef.current) {
          /*
           * Never surfaced as a page-level error: this card is an aside on
           * somebody else's page. But the KIND of failure is kept, so a
           * permission or plan refusal renders as a hint rather than as
           * "no recording".
           */
          setFailure(classifyReplayCardFailure(error));
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          setIsLoading(false);
        }
      }
    },
    [rumApplicationIdString, sessionId, fingerprint, errorTimeUnixMs],
  );

  useEffect(() => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);

    return () => {
      loadGenerationRef.current += 1;
    };
  }, [load]);

  const retry: () => void = useCallback((): void => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);
  }, [load]);

  if (isLoading) {
    return (
      <div className={`mb-5 ${props.className || ""}`}>
        <ComponentLoader />
      </div>
    );
  }

  if (failure) {
    return (
      <div
        className={`mb-5 flex flex-wrap items-center gap-2 text-xs text-gray-500 ${
          props.className || ""
        }`}
        data-testid="replay-card-hint"
        data-failure-kind={failure.kind}
      >
        <Icon icon={IconProp.Film} className="h-3.5 w-3.5 text-gray-400" />
        <span>{failure.message}</span>
        {failure.kind === "error" && (
          <Button
            title="Retry"
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            buttonSize={ButtonSize.ExtraSmall}
            onClick={retry}
            dataTestId="replay-card-retry"
          />
        )}
      </div>
    );
  }

  const primaryRow: ReplaySessionRow | undefined = sessions[0];
  const primary: SessionReplaySummary | undefined = primaryRow?.summary;

  /*
   * The application the watch link points into: the one the session itself
   * names, falling back to the caller's scope when the row somehow lacks it.
   */
  const watchApplicationId: string =
    primaryRow?.rumApplicationId || rumApplicationIdString;

  if (!primary || !watchApplicationId) {
    return <></>;
  }

  /*
   * A moment is promised only for the occurrence's own session, and only
   * when its time falls inside that recording; anything else starts at the
   * beginning and says why, rather than landing a viewer at an arbitrary
   * point and implying the error is there.
   */
  const moment: ReplayCardMoment | null = getReplayCardMoment({
    errorTimeUnixMs: errorTimeUnixMs,
    instanceSessionId: sessionId,
    session: {
      sessionId: primary.sessionId,
      startTime: primary.startTime,
      endTime: primary.endTime,
      durationMs: primary.durationMs,
    },
  });

  const exceptionSignal: string | undefined =
    moment && props.exceptionInstanceId
      ? makeExceptionSignalId(props.exceptionInstanceId)
      : undefined;

  const watchRoute: Route | null = buildReplayMomentRoute({
    rumApplicationId: watchApplicationId,
    sessionId: primary.sessionId,
    ...(moment ? { at: moment.errorTimeUnixMs } : {}),
    ...(exceptionSignal ? { signal: exceptionSignal } : {}),
    rail: "errors",
    /* The 10s exception run-up, whether or not the signal id is known. */
    preRollMs: REPLAY_EXCEPTION_PRE_ROLL_MS,
  });

  if (!watchRoute) {
    return <></>;
  }

  let momentNote: string | null = null;

  if (!moment && errorTimeUnixMs && sessionId) {
    momentNote =
      primary.sessionId === sessionId
        ? "The occurrence's timestamp falls outside this recording, so playback starts at the beginning."
        : "The latest occurrence was in a session that was not recorded; this is the newest recording that hit the same error, from the beginning.";
  } else if (!moment && errorTimeUnixMs && !sessionId) {
    momentNote =
      "The latest occurrence carries no session id; this is the newest recording that hit the same error, from the beginning.";
  }

  const signals: Array<string> = [];

  if (primary.rageClickCount > 0) {
    signals.push(`${primary.rageClickCount} rage clicks`);
  }

  if (primary.deadClickCount > 0) {
    signals.push(`${primary.deadClickCount} dead clicks`);
  }

  if (primary.errorClickCount > 0) {
    signals.push(`${primary.errorClickCount} error clicks`);
  }

  if (primary.refreshRageCount > 0) {
    signals.push(`${primary.refreshRageCount} refresh rage`);
  }

  const otherSessions: Array<ReplaySessionRow> = sessions.slice(1);
  const visibleOtherSessions: Array<ReplaySessionRow> = showAllSessions
    ? otherSessions
    : otherSessions.slice(0, REPLAY_CARD_SESSIONS_SHOWN);
  const hiddenOtherSessionCount: number =
    otherSessions.length - visibleOtherSessions.length;

  return (
    <div className={`mb-5 ${props.className || ""}`} data-testid="replay-card">
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Icon icon={IconProp.Film} className="h-4 w-4 text-indigo-600" />
              <h3 className="text-sm font-semibold text-gray-900">
                Watch what the user saw
              </h3>
            </div>
            <div className="mt-1 truncate text-xs text-gray-500">
              {primary.entryUrl || "Unknown page"} ·{" "}
              {formatSessionDuration(primary.durationMs)} ·{" "}
              {describeDevice(primary)}
            </div>
            {signals.length > 0 && (
              <div className="mt-1 text-xs text-amber-700">
                Before the error: {signals.join(", ")}
              </div>
            )}
            {/*
             * Masking is stated up front. Somebody about to watch a real
             * person's screen should know which mode produced it before they
             * click, not after.
             */}
            <div className="mt-1 text-[11px] text-gray-500">
              Recorded with {primary.maskingMode || "unknown"} masking.
            </div>
            {momentNote && (
              <div
                className="mt-1 text-[11px] text-gray-500"
                data-testid="replay-card-moment-note"
              >
                {momentNote}
              </div>
            )}
          </div>

          <div className="shrink-0">
            <AppLink
              to={watchRoute}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
            >
              <span data-testid="replay-card-watch">
                {moment
                  ? `Watch ${Math.round(
                      REPLAY_EXCEPTION_PRE_ROLL_MS / 1000,
                    )}s before the error`
                  : "Watch session"}
              </span>
            </AppLink>
          </div>
        </div>

        {(otherSessions.length > 0 || isScopeTruncated) && (
          <div className="border-t border-gray-100 px-5 py-3">
            {otherSessions.length > 0 && (
              <div data-testid="replay-card-more-sessions">
                <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {otherSessions.length} more recorded{" "}
                  {otherSessions.length === 1 ? "session" : "sessions"} hit this
                  error
                </div>
                <ul className="mt-1 divide-y divide-gray-100">
                  {visibleOtherSessions.map(
                    (row: ReplaySessionRow): ReactElement => {
                      const route: Route | null = buildReplayMomentRoute({
                        rumApplicationId:
                          row.rumApplicationId || rumApplicationIdString,
                        sessionId: row.summary.sessionId,
                        rail: "errors",
                      });

                      return (
                        <li
                          key={row.summary.sessionId}
                          className="flex items-center justify-between gap-3 py-1.5 text-xs text-gray-600"
                          data-testid="replay-card-session-row"
                        >
                          <span className="min-w-0 truncate">
                            {formatSessionStart(row.summary.startTime)} ·{" "}
                            {formatSessionDuration(row.summary.durationMs)} ·{" "}
                            {describeDevice(row.summary)}
                          </span>
                          {route && (
                            <AppLink
                              to={route}
                              className="shrink-0 font-medium text-indigo-600 hover:underline"
                            >
                              Watch
                            </AppLink>
                          )}
                        </li>
                      );
                    },
                  )}
                </ul>
                {hiddenOtherSessionCount > 0 && (
                  <Button
                    title={`Show all ${otherSessions.length}`}
                    buttonStyle={ButtonStyleType.SECONDARY_LINK}
                    buttonSize={ButtonSize.ExtraSmall}
                    onClick={(): void => {
                      setShowAllSessions(true);
                    }}
                    dataTestId="replay-card-show-all"
                  />
                )}
              </div>
            )}
            {isScopeTruncated && (
              <div
                className="mt-1 text-[11px] text-amber-700"
                data-testid="replay-card-truncated"
              >
                Only the first applications your role can access were searched;
                recordings of this error in other applications may be missing.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReplayCard;
