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
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
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
 * card, no empty state cluttering the exception page.
 */

const FOR_EXCEPTION_ROUTE: string =
  "/telemetry/rum/session-replay/for-exception";

/*
 * How far before the error playback starts. Long enough to see what the user
 * did to cause it, short enough not to make someone sit through unrelated
 * navigation.
 */
const PRE_ROLL_SECONDS: number = 10;

export interface ReplayCardProps {
  /* The RUM application the session belongs to; also its primaryEntityId. */
  rumApplicationId?: ObjectID | undefined;
  /* Exact session, when the caller already has one (an exception instance). */
  sessionId?: string | undefined;
  /* Exception group fingerprint, when the caller only has the group. */
  fingerprint?: string | undefined;
  /* Absolute time of the error, used to position playback. */
  errorTimeUnixMs?: number | undefined;
  className?: string | undefined;
}

const ReplayCard: FunctionComponent<ReplayCardProps> = (
  props: ReplayCardProps,
): ReactElement => {
  const [sessions, setSessions] = useState<Array<SessionReplaySummary>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasFailed, setHasFailed] = useState<boolean>(false);

  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const { rumApplicationId, sessionId, fingerprint } = props;
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
      if (!rumApplicationIdString || !fingerprint) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setHasFailed(false);

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              FOR_EXCEPTION_ROUTE,
            ),
            data: {
              rumApplicationId: rumApplicationIdString,
              ...(sessionId ? { sessionId: sessionId } : {}),
              fingerprint: fingerprint,
            },
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (generation !== loadGenerationRef.current) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const rows: JSONArray = (response.data["sessions"] as JSONArray) || [];

        setSessions(rows.map(parseSessionReplaySummary));
      } catch {
        if (generation === loadGenerationRef.current) {
          /*
           * Swallowed to a quiet flag rather than surfaced as an error.
           * This card is an aside on somebody else's page; a replay lookup
           * failing must not make the exception they came to read look
           * broken.
           */
          setHasFailed(true);
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          setIsLoading(false);
        }
      }
    },
    [rumApplicationIdString, sessionId, fingerprint],
  );

  useEffect(() => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);

    return () => {
      loadGenerationRef.current += 1;
    };
  }, [load]);

  if (isLoading) {
    return (
      <div className={`mb-5 ${props.className || ""}`}>
        <ComponentLoader />
      </div>
    );
  }

  const primary: SessionReplaySummary | undefined = sessions[0];

  if (hasFailed || !primary || !rumApplicationId) {
    return <></>;
  }

  /*
   * Offset of the error within the recording. When the caller did not supply
   * an error time we start at the beginning rather than guessing - landing a
   * viewer at an arbitrary point and implying the error is there would be
   * worse than making them scrub.
   */
  let startAtSeconds: number = 0;

  if (props.errorTimeUnixMs && primary.startTime) {
    const sessionStart: Date = OneUptimeDate.fromString(primary.startTime);

    if (!isNaN(sessionStart.getTime())) {
      startAtSeconds = Math.max(
        0,
        Math.floor(
          (props.errorTimeUnixMs - sessionStart.getTime()) / 1000 -
            PRE_ROLL_SECONDS,
        ),
      );
    }
  }

  let watchRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW] as Route,
    {
      modelId: rumApplicationId,
      subModelId: primary.sessionId,
    },
  );

  if (startAtSeconds > 0) {
    watchRoute = watchRoute.addQueryParams({ t: String(startAtSeconds) });
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

  return (
    <div className={`mb-5 ${props.className || ""}`}>
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
              {[primary.browserName, primary.osName]
                .filter(Boolean)
                .join(" on ") || "Unknown device"}
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
              {sessions.length > 1
                ? ` ${sessions.length - 1} more session${
                    sessions.length === 2 ? "" : "s"
                  } hit this error.`
                : ""}
            </div>
          </div>

          <div className="shrink-0">
            <AppLink
              to={watchRoute}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
            >
              <span>
                {startAtSeconds > 0
                  ? `Watch ${PRE_ROLL_SECONDS}s before the error`
                  : "Watch session"}
              </span>
            </AppLink>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReplayCard;
