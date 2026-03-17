import type { AxiosResponse } from "axios";
import apiClient from "./client";
import type {
  ListResponse,
  MonitorItem,
  MonitorStatusItem,
  FeedItem,
} from "./types";

export async function fetchMonitors(
  projectId: string,
  options: { skip?: number; limit?: number } = {},
): Promise<ListResponse<MonitorItem>> {
  const { skip = 0, limit = 100 } = options;

  const response: AxiosResponse = await apiClient.post(
    `/api/monitor/get-list?skip=${skip}&limit=${limit}`,
    {
      query: {},
      select: {
        _id: true,
        name: true,
        description: true,
        monitorType: true,
        currentMonitorStatus: { _id: true, name: true, color: true },
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
): Promise<MonitorItem> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor/get-list?skip=0&limit=1",
    {
      query: { _id: monitorId },
      select: {
        _id: true,
        name: true,
        description: true,
        monitorType: true,
        currentMonitorStatus: { _id: true, name: true, color: true },
        disableActiveMonitoring: true,
        createdAt: true,
      },
      sort: {},
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data[0];
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

export async function fetchMonitorCount(
  projectId: string,
): Promise<ListResponse<MonitorItem>> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor/get-list?skip=0&limit=1",
    {
      query: {},
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

export async function fetchDisabledMonitorCount(
  projectId: string,
): Promise<ListResponse<MonitorItem>> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor/get-list?skip=0&limit=1",
    {
      query: { disableActiveMonitoring: true },
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

export async function fetchInoperationalMonitorCount(
  projectId: string,
): Promise<ListResponse<MonitorItem>> {
  const response: AxiosResponse = await apiClient.post(
    "/api/monitor/get-list?skip=0&limit=1",
    {
      query: {
        currentMonitorStatus: { isOperationalState: false },
      },
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
