import Span from "Common/Models/AnalyticsModels/Span";
import Log from "Common/Models/AnalyticsModels/Log";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Dictionary from "Common/Types/Dictionary";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  APP_JANK_EVENT_NAME,
  APP_START_SPAN_NAME,
  EVENT_NAME_ATTRIBUTE,
} from "Common/Types/Rum/MobileAppTelemetry";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  MOBILE_SIGNAL_LOOKBACK_DAYS,
  MobileAppStarts,
  MobileFaultCount,
  MobileFaults,
  MobileFrames,
  MobileSessions,
  MobileSignalScope,
  buildAnrFilterBody,
  buildAppStartSeriesBody,
  buildAppStartTableBody,
  buildCrashFilterBody,
  buildFaultSessionCountBody,
  buildFrameSeriesBody,
  buildFramesByScreenBody,
  buildSessionCountBody,
  emptyAppStarts,
  emptyFrames,
  readFaultInstalls,
  readFaultSessions,
  readSessionCount,
  summarizeAppStarts,
  summarizeFaultBuckets,
  summarizeFrameSeries,
  summarizeFramesByScreen,
} from "./MobileRumSignalData";

/*
 * The reads behind a mobile RUM application's Overview (#9588). The
 * requests and the folds are MobileRumSignalData's; this sends them. Each
 * read stands alone: one that fails comes back marked failed, so its tile
 * says "could not load" and the others still draw. None throws.
 */

async function post(path: string, body: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(path),
      data: body,
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data;
}

// The rows of an analytics answer, null when the read failed.
async function readRows(path: string, body: JSONObject): Promise<unknown> {
  return (await post(path, body))["data"];
}

export async function fetchMobileAppStarts(
  scope: MobileSignalScope,
): Promise<MobileAppStarts> {
  try {
    const [tableRows, countRows, p95Rows]: [unknown, unknown, unknown] =
      await Promise.all([
        readRows("/telemetry/traces/analytics", buildAppStartTableBody(scope)),
        readRows(
          "/telemetry/traces/analytics",
          buildAppStartSeriesBody(scope, "count"),
        ),
        readRows(
          "/telemetry/traces/analytics",
          buildAppStartSeriesBody(scope, "p95Duration"),
        ),
      ]);

    return summarizeAppStarts({ tableRows, countRows, p95Rows });
  } catch {
    return emptyAppStarts(true);
  }
}

export async function fetchMobileSessions(
  scope: MobileSignalScope,
): Promise<MobileSessions> {
  try {
    return readSessionCount(
      await post(
        "/telemetry/traces/session-count",
        buildSessionCountBody(scope),
      ),
    );
  } catch {
    return { sessions: 0, spans: 0, installs: null, failed: true };
  }
}

async function fetchFaultCount(body: JSONObject): Promise<MobileFaultCount> {
  const [histogram, reach]: [
    unknown,
    { sessions: number; installs: number | null } | null,
  ] = await Promise.all([
    post("/telemetry/exceptions/histogram", body)
      .then((answer: JSONObject): unknown => {
        return answer["buckets"];
      })
      .catch((): null => {
        return null;
      }),
    post(
      "/telemetry/exceptions/session-count",
      buildFaultSessionCountBody(body),
    )
      .then(
        (answer: JSONObject): { sessions: number; installs: number | null } => {
          return {
            sessions: readFaultSessions(answer),
            installs: readFaultInstalls(answer),
          };
        },
      )
      .catch((): null => {
        return null;
      }),
  ]);

  if (histogram === null) {
    return {
      total: 0,
      series: [],
      sessions: null,
      installs: null,
      failed: true,
    };
  }

  return {
    ...summarizeFaultBuckets(histogram),
    sessions: reach ? reach.sessions : null,
    installs: reach ? reach.installs : null,
    failed: false,
  };
}

export async function fetchMobileFaults(
  scope: MobileSignalScope,
): Promise<MobileFaults> {
  const [crashes, anrs]: [MobileFaultCount, MobileFaultCount] =
    await Promise.all([
      fetchFaultCount(buildCrashFilterBody(scope)),
      fetchFaultCount(buildAnrFilterBody(scope)),
    ]);

  return { crashes, anrs };
}

export async function fetchMobileFrames(
  scope: MobileSignalScope,
): Promise<MobileFrames> {
  const [seriesRows, screenRows]: [unknown, unknown] = await Promise.all([
    readRows("/telemetry/logs/analytics", buildFrameSeriesBody(scope)).catch(
      (): null => {
        return null;
      },
    ),
    readRows("/telemetry/logs/analytics", buildFramesByScreenBody(scope)).catch(
      (): null => {
        return null;
      },
    ),
  ]);

  if (seriesRows === null) {
    return emptyFrames(true);
  }

  return {
    ...summarizeFrameSeries(seriesRows),
    byScreen: screenRows === null ? [] : summarizeFramesByScreen(screenRows),
    failed: false,
    byScreenFailed: screenRows === null,
  };
}

function lookbackWindow(now: Date): InBetween<Date> {
  return new InBetween<Date>(
    OneUptimeDate.addRemoveDays(now, -MOBILE_SIGNAL_LOOKBACK_DAYS),
    now,
  );
}

/*
 * When the app's newest AppStart span in the past 30 days started, or null
 * for none: read only while the range has no app start, so an empty chart
 * can tell "none in this range" from "never reported". One row: the newest
 * granules first, the span name's token index skipping the rest. Throws
 * when the read fails.
 */
export async function fetchNewestAppStartAt(data: {
  primaryEntityId: ObjectID;
  now: Date;
}): Promise<Date | null> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const result: ListResult<Span> = await AnalyticsModelAPI.getList<Span>({
    modelType: Span,
    query: {
      ...(projectId ? { projectId: projectId } : {}),
      primaryEntityId: data.primaryEntityId,
      name: APP_START_SPAN_NAME,
      startTime: lookbackWindow(data.now),
    },
    select: { startTime: true },
    sort: { startTime: SortOrder.Descending },
    skip: 0,
    limit: 1,
  });

  const at: unknown = result.data[0]?.startTime;

  return at ? OneUptimeDate.fromString(at as Date) : null;
}

/*
 * When the app's newest app.jank event in the past 30 days was sent, or
 * null for none. The SDK sends one only when a frame was slow, so none in a
 * range is good news; none in a month means nothing reports them.
 */
export async function fetchNewestFrameEventAt(data: {
  primaryEntityId: ObjectID;
  now: Date;
}): Promise<Date | null> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // Typed once: an inline literal is too deep for the compiler to check.
  const query: Query<Log> = {
    primaryEntityId: data.primaryEntityId,
    time: lookbackWindow(data.now),
  };

  if (projectId) {
    query.projectId = projectId;
  }

  const attributes: Dictionary<string> = {
    [EVENT_NAME_ATTRIBUTE]: APP_JANK_EVENT_NAME,
  };
  query.attributes = attributes;

  const result: ListResult<Log> = await AnalyticsModelAPI.getList<Log>({
    modelType: Log,
    query: query,
    select: { time: true },
    sort: { time: SortOrder.Descending },
    skip: 0,
    limit: 1,
  });

  const at: unknown = result.data[0]?.time;

  return at ? OneUptimeDate.fromString(at as Date) : null;
}
