import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Includes from "Common/Types/BaseDatabase/Includes";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  CloudAppSignalRead,
  CloudAppSignalRow,
  CloudAppSignalSource,
  CloudAppSignals,
  getCloudAppSignalReads,
  matchCloudAppSignals,
} from "./CloudApps";
import {
  CLOUD_INSTANCE_LIVE_WINDOW_MINUTES,
  CloudResourceScopeSource,
  getCloudResourceAttributeFilters,
  isCloudResourceScoped,
} from "./CloudResourceTelemetryScope";

/*
 * What a list of App Platforms apps reads beside their rows: each app's
 * requests, errors and p95 over the last hour, and its live instances.
 *
 * The signals take ONE read per environment and set of naming attributes,
 * not three per app: /telemetry/traces/analytics groups an environment's
 * entry spans by the attributes that name its apps (getCloudAppSignalReads)
 * and answers every app's numbers at once.
 */

// The window a list's requests, error rate and p95 are over.
export const CLOUD_APP_SIGNAL_WINDOW_MINUTES: number = 60;

// The most groups one read returns: far more apps than one environment has.
export const CLOUD_APP_SIGNAL_ROW_LIMIT: number = 1000;

export interface CloudAppSignalResult {
  signals: Map<string, CloudAppSignals>;
  // Some read failed (e.g. no access to traces): those apps show unknown.
  failed: boolean;
}

// The body of one environment's grouped read. Exported for tests.
export function buildCloudAppSignalRequest(data: {
  read: Pick<CloudAppSignalRead, "groupBy">;
  environment: CloudResourceScopeSource;
  start: Date;
  end: Date;
  // Extra filters: one app's own attributes, for its revisions' read.
  attributes?: Record<string, string> | undefined;
}): JSONObject {
  return {
    startTime: data.start.toISOString(),
    endTime: data.end.toISOString(),
    chartType: "table",
    metric: "count",
    groupBy: data.read.groupBy,
    attributes: {
      ...getCloudResourceAttributeFilters(data.environment),
      ...(data.attributes || {}),
    },
    // Requests: where work enters a service, not every span under it.
    entryOnly: true,
    limit: CLOUD_APP_SIGNAL_ROW_LIMIT,
  };
}

// One grouped read's rows; null when the read failed.
export async function fetchCloudAppSignalRows(
  body: JSONObject,
): Promise<Array<CloudAppSignalRow> | null> {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/traces/analytics",
        ),
        data: body,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      return null;
    }

    const rows: unknown = response.data["data"];

    return Array.isArray(rows) ? (rows as Array<CloudAppSignalRow>) : [];
  } catch {
    return null;
  }
}

/*
 * The signals of a list of apps, each environment's apps in one read. An
 * app whose environment has no platform yet, or no stored attributes, has
 * none - the list shows a dash.
 */
export async function fetchCloudAppSignals(data: {
  apps: ReadonlyArray<CloudAppSignalSource>;
  environments: ReadonlyMap<string, CloudResourceScopeSource>;
  now?: Date | undefined;
}): Promise<CloudAppSignalResult> {
  const end: Date = data.now || OneUptimeDate.getCurrentDate();
  const start: Date = OneUptimeDate.addRemoveMinutes(
    end,
    -CLOUD_APP_SIGNAL_WINDOW_MINUTES,
  );

  const signals: Map<string, CloudAppSignals> = new Map<
    string,
    CloudAppSignals
  >();
  let failed: boolean = false;

  const reads: Array<CloudAppSignalRead> = getCloudAppSignalReads(data.apps);

  await Promise.all(
    reads.map(async (read: CloudAppSignalRead): Promise<void> => {
      const environment: CloudResourceScopeSource | undefined =
        data.environments.get(read.environmentId);

      if (!environment || !isCloudResourceScoped(environment)) {
        return;
      }

      const rows: Array<CloudAppSignalRow> | null =
        await fetchCloudAppSignalRows(
          buildCloudAppSignalRequest({ read, environment, start, end }),
        );

      if (rows === null) {
        failed = true;
        return;
      }

      const apps: Array<CloudAppSignalSource> = data.apps.filter(
        (app: CloudAppSignalSource): boolean => {
          return read.appIds.includes(String(app._id ?? app.id ?? ""));
        },
      );

      for (const [appId, appSignals] of matchCloudAppSignals({ apps, rows })) {
        signals.set(appId, appSignals);
      }
    }),
  );

  return { signals, failed };
}

/*
 * The live instances of these apps - seen inside the live window - with the
 * app and revision each runs. A stale task is left on the server: the lists
 * count only the ones running now.
 */
export async function fetchCloudAppInstances(
  appIds: ReadonlyArray<string>,
): Promise<Array<CloudResourceInstance>> {
  const ids: Array<string> = appIds.filter((id: string): boolean => {
    return Boolean(id);
  });

  if (ids.length === 0) {
    return [];
  }

  const result: { data: Array<CloudResourceInstance> } =
    await ModelAPI.getList<CloudResourceInstance>({
      modelType: CloudResourceInstance,
      query: {
        cloudAppId: new Includes(
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
        lastSeenAt: new GreaterThan<Date>(
          OneUptimeDate.getSomeMinutesAgo(CLOUD_INSTANCE_LIVE_WINDOW_MINUTES),
        ),
      },
      select: {
        cloudAppId: true,
        revision: true,
        lastSeenAt: true,
      },
      sort: {},
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

  return result.data;
}
