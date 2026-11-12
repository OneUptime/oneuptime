import type { AxiosResponse } from "axios";
import apiClient from "./client";
import type {
  ListResponse,
  MonitorItem,
  MonitorStatusItem,
  FeedItem,
} from "./types";
import {
  getDisabledMonitorsQuery,
  getListedMonitorsQuery,
  getMonitorIssuesQuery,
} from "../utils/monitorHealth";

/*
 * The Monitors screen's list. Archived monitors are left out, as from every
 * monitor list on the web: the count Home shows for Monitors leaves them out
 * too, and Monitor issues counts none of them, so the screen a count opens
 * lists the monitors it counted (utils/monitorHealth).
 */
export async function fetchMonitors(
  projectId: string,
  options: { skip?: number; limit?: number } = {},
): Promise<ListResponse<MonitorItem>> {
  const { skip = 0, limit = 100 } = options;

  const response: AxiosResponse = await apiClient.post(
    `/api/monitor/get-list?skip=${skip}&limit=${limit}`,
    {
      query: getListedMonitorsQuery(),
      select: {
        _id: true,
        name: true,
        description: true,
        monitorType: true,
        currentMonitorStatus: {
          _id: true,
          name: true,
          color: true,
          isOperationalState: true,
        },
        disableActiveMonitoring: true,
        createdAt: true,
        projectId: true,
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data;
}

export async function fetchMonitorById(
  projectId: string,
  monitorId: string,
): Promise<MonitorItem | null> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor/get-list?skip=0&limit=1",
    {
      query: { _id: monitorId },
      select: {
        _id: true,
        name: true,
        description: true,
        monitorType: true,
        currentMonitorStatus: {
          _id: true,
          name: true,
          color: true,
          isOperationalState: true,
        },
        disableActiveMonitoring: true,
        createdAt: true,
      },
      sort: {},
    },
    {
      headers: { tenantid: projectId },
    },
  );

  /*
   * `null` for a row that is not there, and never `undefined`.
   *
   * A monitor that was deleted, or that sits in a project this responder
   * cannot see, answers with an empty list from a request that SUCCEEDED, so
   * `data[0]` is `undefined`. React Query v5 refuses to cache `undefined` and
   * rejects the query with a synthetic `<queryHash> data is undefined` error,
   * which would turn "no such monitor" into an apparent request failure.
   * `null` caches happily and reaches MonitorDetailScreen as settled data.
   * `undefined` here is a trap, not a style choice.
   */
  return response.data.data[0] ?? null;
}

export async function fetchMonitorStatuses(
  projectId: string,
): Promise<MonitorStatusItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor-status/get-list?skip=0&limit=20",
    {
      query: {},
      select: {
        _id: true,
        name: true,
        color: true,
        isOperationalState: true,
        isOfflineState: true,
        priority: true,
      },
      sort: { priority: "ASC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data;
}

export interface MonitorStatusTimelineItem {
  _id: string;
  createdAt: string;
  startsAt?: string;
  endsAt?: string;
  monitorStatus?: {
    _id: string;
    name: string;
    color: { r: number; g: number; b: number };
  };
  rootCause?: string;
}

export async function fetchMonitorStatusTimeline(
  projectId: string,
  monitorId: string,
): Promise<MonitorStatusTimelineItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor-status-timeline/get-list?skip=0&limit=50",
    {
      query: { monitorId },
      select: {
        _id: true,
        createdAt: true,
        startsAt: true,
        endsAt: true,
        monitorStatus: { _id: true, name: true, color: true },
        rootCause: true,
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data;
}

export async function fetchMonitorFeed(
  projectId: string,
  monitorId: string,
): Promise<FeedItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor-feed/get-list?skip=0&limit=50",
    {
      query: { monitorId },
      select: {
        _id: true,
        feedInfoInMarkdown: true,
        moreInformationInMarkdown: true,
        displayColor: true,
        postedAt: true,
        createdAt: true,
      },
      sort: { postedAt: "DESC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data;
}

export interface ProbeMonitorResponse {
  isOnline?: boolean;
  monitorDestination?: string;
  monitorDestinationPort?: number;
  responseTimeInMs?: number;
  responseCode?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string | Record<string, unknown>;
  failureCause?: string;
  monitoredAt?: string;
  isTimeout?: boolean;
  hostname?: string;
  // Server monitor fields
  basicInfrastructureMetrics?: {
    cpuMetrics?: { percentUsed?: number; cores?: number };
    memoryMetrics?: {
      totalInGB?: number;
      percentUsed?: number;
      percentFree?: number;
    };
    diskMetrics?: Array<{
      diskPath?: string;
      totalInGB?: number;
      percentUsed?: number;
      percentFree?: number;
    }>;
  };
}

export interface MonitorProbeItem {
  _id: string;
  probeId?: string;
  probe?: { _id: string; name: string };
  lastMonitoringLog?: Record<string, ProbeMonitorResponse>;
}

export async function fetchMonitorProbes(
  projectId: string,
  monitorId: string,
): Promise<MonitorProbeItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor-probe/get-list?skip=0&limit=10",
    {
      query: { monitorId },
      select: {
        _id: true,
        probeId: true,
        probe: { _id: true, name: true },
        lastMonitoringLog: true,
      },
      sort: {},
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data;
}

// Every listed monitor: the archived ones are not (utils/monitorHealth).
export async function fetchMonitorCount(
  projectId: string,
): Promise<ListResponse<MonitorItem>> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor/get-list?skip=0&limit=1",
    {
      query: getListedMonitorsQuery(),
      select: {
        _id: true,
      },
      sort: {},
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data;
}

// The listed monitors whose monitoring is turned off.
export async function fetchDisabledMonitorCount(
  projectId: string,
): Promise<ListResponse<MonitorItem>> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor/get-list?skip=0&limit=1",
    {
      query: getDisabledMonitorsQuery(),
      select: {
        _id: true,
      },
      sort: {},
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data;
}

/*
 * Home's Monitor issues: a status that is not operational, among the monitors
 * that are checked - not archived, monitoring on. A monitor whose monitoring
 * is off holds only the status its last check saw, so it is no issue, as on
 * the web (Common/Utils/Monitor/NotOperationalMonitorQuery).
 */
export async function fetchInoperationalMonitorCount(
  projectId: string,
): Promise<ListResponse<MonitorItem>> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor/get-list?skip=0&limit=1",
    {
      query: getMonitorIssuesQuery(),
      select: {
        _id: true,
      },
      sort: {},
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data;
}
