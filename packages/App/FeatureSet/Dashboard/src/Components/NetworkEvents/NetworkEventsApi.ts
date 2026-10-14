import {
  NETWORK_DEVICE_ID_ATTRIBUTE,
  NETWORK_EVENTS_PAGE_LIMIT,
  NETWORK_EVENT_SOURCES_LOG_LIMIT,
  NetworkEventCounts,
  NetworkEventRow,
  NetworkEventSource,
  NetworkEventsFilters,
  NetworkEventsScope,
  buildNetworkEventAttributes,
  buildNetworkEventFacetsRequest,
  buildNetworkEventSourcesAttributes,
  parseNetworkEventCounts,
  toNetworkEventRows,
  toNetworkEventSources,
} from "./NetworkEventsModel";
import Log from "Common/Models/AnalyticsModels/Log";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import SyslogAttribute from "Common/Types/Syslog/SyslogAttribute";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * The network half of the Events pages: events are logs, so they are read
 * through the logs' own list and facets endpoints - no endpoint of their
 * own, and the same access rules as every other log. NetworkEventsModel
 * holds what is asked for and how the answers are read.
 */

export const NETWORK_EVENTS_FACETS_PATH: string = "/telemetry/logs/facets";

// How far back a page looks for the last event when its own range has none.
export const NETWORK_EVENTS_LOOKBACK_IN_DAYS: number = 7;

async function listLogs(data: {
  window: InBetween<Date>;
  attributes: Dictionary<string>;
  limit: number;
}): Promise<ListResult<Log>> {
  /*
   * `any`: an inline attributes map makes Query<Log> too deep for the
   * compiler (TS2589), as on the device's Logs page.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: any = {
    modelType: Log,
    query: {
      projectId: ProjectUtil.getCurrentProjectId()!.toString(),
      time: data.window,
      attributes: data.attributes,
    },
    limit: data.limit,
    skip: 0,
    select: {
      time: true,
      body: true,
      severityText: true,
      attributes: true,
    },
    sort: {
      time: SortOrder.Descending,
    },
    requestOptions: {},
  };

  return await AnalyticsModelAPI.getList<Log>(options);
}

async function postApi(
  path: string,
  data: JSONObject,
): Promise<HTTPResponse<JSONObject>> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(path),
      data,
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response;
}

export interface NetworkEventsPage {
  // The newest events of the window, at most NETWORK_EVENTS_PAGE_LIMIT.
  rows: Array<NetworkEventRow>;
  // True when the window holds more events than were read.
  hasMore: boolean;
  // What the kind buttons and the pickers count, over the whole window.
  counts: NetworkEventCounts;
}

/*
 * The events of a window and the counts over it. The counts leave the kind
 * filter out, so the button of a kind that is not picked still says how
 * many of it there are.
 */
export async function fetchNetworkEvents(data: {
  scope: NetworkEventsScope;
  filters: NetworkEventsFilters;
  window: InBetween<Date>;
}): Promise<NetworkEventsPage> {
  const [logs, facets]: [ListResult<Log>, HTTPResponse<JSONObject>] =
    await Promise.all([
      listLogs({
        window: data.window,
        attributes: buildNetworkEventAttributes({
          scope: data.scope,
          filters: data.filters,
        }),
        limit: NETWORK_EVENTS_PAGE_LIMIT,
      }),
      postApi(
        NETWORK_EVENTS_FACETS_PATH,
        buildNetworkEventFacetsRequest({
          window: data.window,
          attributes: buildNetworkEventAttributes({
            scope: data.scope,
            filters: data.filters,
            withoutKind: true,
          }),
        }),
      ),
    ]);

  return {
    rows: toNetworkEventRows(logs.data.slice(0, NETWORK_EVENTS_PAGE_LIMIT)),
    // The list endpoint reads one row past the limit to say so.
    hasMore: logs.hasMore === true,
    counts: parseNetworkEventCounts(facets.data),
  };
}

/*
 * What a page with no events in its range needs to know to say something
 * useful instead of nothing: when the last event was, and whether syslog
 * is arriving at all.
 */
export interface NetworkEventsBackground {
  // The newest event of the scope in the last week, if there was one.
  lastEventAt: Date | null;
  // Whether the scope has received any syslog or trap in the last week.
  isReceivingLogs: boolean;
}

export async function fetchNetworkEventsBackground(
  scope: NetworkEventsScope,
): Promise<NetworkEventsBackground> {
  const end: Date = OneUptimeDate.getCurrentDate();
  const window: InBetween<Date> = new InBetween<Date>(
    OneUptimeDate.addRemoveDays(end, -NETWORK_EVENTS_LOOKBACK_IN_DAYS),
    end,
  );

  const lastEvent: Array<Log> = (
    await listLogs({
      window: window,
      attributes: buildNetworkEventAttributes({ scope: scope, filters: {} }),
      limit: 1,
    })
  ).data;

  if (lastEvent.length > 0) {
    return {
      lastEventAt: lastEvent[0]?.time || null,
      isReceivingLogs: true,
    };
  }

  if (scope.kind === "device") {
    // Anything at all on the device's log: syslog and traps both carry its id.
    const anyLog: Array<Log> = (
      await listLogs({
        window: window,
        attributes: { [NETWORK_DEVICE_ID_ATTRIBUTE]: scope.networkDeviceId },
        limit: 1,
      })
    ).data;

    return { lastEventAt: null, isReceivingLogs: anyLog.length > 0 };
  }

  /*
   * The network: any log a probe heard as syslog. A facet is asked for
   * because it counts the logs that HAVE the attribute, whatever its value.
   */
  const facets: HTTPResponse<JSONObject> = await postApi(
    NETWORK_EVENTS_FACETS_PATH,
    buildNetworkEventFacetsRequest({
      window: window,
      attributes: {},
      facetKeys: [SyslogAttribute.SourceIp],
      limit: 1,
    }),
  );

  const senders: unknown = ((facets.data["facets"] as JSONObject | undefined) ||
    {})[SyslogAttribute.SourceIp];

  return {
    lastEventAt: null,
    isReceivingLogs: Array.isArray(senders) && senders.length > 0,
  };
}

/*
 * The addresses that sent syslog in the window without being a device:
 * what the network's page offers to make devices of.
 */
export async function fetchNetworkEventSources(
  window: InBetween<Date>,
): Promise<Array<NetworkEventSource>> {
  const logs: Array<Log> = (
    await listLogs({
      window: window,
      attributes: buildNetworkEventSourcesAttributes(),
      limit: NETWORK_EVENT_SOURCES_LOG_LIMIT,
    })
  ).data;

  return toNetworkEventSources(logs);
}
