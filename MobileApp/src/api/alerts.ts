import type { AxiosResponse } from "axios";
import apiClient from "./client";
import type {
  ListResponse,
  AlertItem,
  AlertState,
  StateTimelineItem,
  FeedItem,
} from "./types";

export async function fetchAlerts(
  projectId: string,
  options: { skip?: number; limit?: number; unresolvedOnly?: boolean } = {},
): Promise<ListResponse<AlertItem>> {
  const { skip = 0, limit = 20, unresolvedOnly = false } = options;

  const query: Record<string, unknown> = {};
  if (unresolvedOnly) {
    query.currentAlertState = { isResolvedState: false };
  }

  const response: AxiosResponse = await apiClient.post(
    `/api/alert/get-list?skip=${skip}&limit=${limit}`,
    {
      query,
      select: {
        _id: true,
        title: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        description: true,
        createdAt: true,
        currentAlertState: { _id: true, name: true, color: true },
        alertSeverity: { _id: true, name: true, color: true },
        monitor: { _id: true, name: true },
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data;
}

export async function fetchAllAlerts(
  options: { skip?: number; limit?: number; unresolvedOnly?: boolean } = {},
): Promise<ListResponse<AlertItem>> {
  const { skip = 0, limit = 100, unresolvedOnly = false } = options;

  const query: Record<string, unknown> = {};
  if (unresolvedOnly) {
    query.currentAlertState = { isResolvedState: false };
  }

  const response: AxiosResponse = await apiClient.post(
    `/api/alert/get-list?skip=${skip}&limit=${limit}`,
    {
      query,
      select: {
        _id: true,
        title: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        description: true,
        createdAt: true,
        currentAlertState: { _id: true, name: true, color: true },
        alertSeverity: { _id: true, name: true, color: true },
        monitor: { _id: true, name: true },
        projectId: true,
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { "is-multi-tenant-query": "true" },
    },
  );
  return response.data;
}

export async function fetchAlertById(
  projectId: string,
  alertId: string,
): Promise<AlertItem> {
  const response: AxiosResponse = await apiClient.post(
    "/api/alert/get-list?skip=0&limit=1",
    {
      query: { _id: alertId },
      select: {
        _id: true,
        title: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        description: true,
        createdAt: true,
        currentAlertState: { _id: true, name: true, color: true },
        alertSeverity: { _id: true, name: true, color: true },
        monitor: { _id: true, name: true },
      },
      sort: {},
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data[0];
}

export async function fetchAlertStates(
  projectId: string,
): Promise<AlertState[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/alert-state/get-list?skip=0&limit=20",
    {
      query: {},
      select: {
        _id: true,
        name: true,
        color: true,
        isResolvedState: true,
        isAcknowledgedState: true,
        isCreatedState: true,
        order: true,
      },
      sort: { order: "ASC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data;
}

export async function fetchAlertStateTimeline(
  projectId: string,
  alertId: string,
): Promise<StateTimelineItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/alert-state-timeline/get-list?skip=0&limit=50",
    {
      query: { alertId },
      select: {
        _id: true,
        createdAt: true,
        alertState: { _id: true, name: true, color: true },
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data;
}

export async function fetchAlertFeed(
  projectId: string,
  alertId: string,
): Promise<FeedItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/alert-feed/get-list?skip=0&limit=50",
    {
      query: { alertId },
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

export async function changeAlertState(
  projectId: string,
  alertId: string,
  alertStateId: string,
): Promise<void> {
  await apiClient.post(
    "/api/alert-state-timeline",
    {
      data: {
        alertId,
        alertStateId,
        projectId,
      },
    },
    {
      headers: { tenantid: projectId },
    },
  );
}
