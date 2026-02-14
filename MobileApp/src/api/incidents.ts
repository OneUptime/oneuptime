import type { AxiosResponse } from "axios";
import apiClient from "./client";
import type {
  ListResponse,
  IncidentItem,
  IncidentState,
  StateTimelineItem,
  FeedItem,
} from "./types";

export async function fetchIncidents(
  projectId: string,
  options: { skip?: number; limit?: number; unresolvedOnly?: boolean } = {},
): Promise<ListResponse<IncidentItem>> {
  const { skip = 0, limit = 20, unresolvedOnly = false } = options;

  const query: Record<string, unknown> = {};
  if (unresolvedOnly) {
    query.currentIncidentState = { isResolvedState: false };
  }

  const response: AxiosResponse = await apiClient.post(
    `/api/incident/get-list?skip=${skip}&limit=${limit}`,
    {
      query,
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        description: true,
        rootCause: true,
        declaredAt: true,
        createdAt: true,
        currentIncidentState: { _id: true, name: true, color: true },
        incidentSeverity: { _id: true, name: true, color: true },
        monitors: { _id: true, name: true },
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data;
}

export async function fetchAllIncidents(
  options: { skip?: number; limit?: number; unresolvedOnly?: boolean } = {},
): Promise<ListResponse<IncidentItem>> {
  const { skip = 0, limit = 100, unresolvedOnly = false } = options;

  const query: Record<string, unknown> = {};
  if (unresolvedOnly) {
    query.currentIncidentState = { isResolvedState: false };
  }

  const response: AxiosResponse = await apiClient.post(
    `/api/incident/get-list?skip=${skip}&limit=${limit}`,
    {
      query,
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        description: true,
        rootCause: true,
        declaredAt: true,
        createdAt: true,
        currentIncidentState: { _id: true, name: true, color: true },
        incidentSeverity: { _id: true, name: true, color: true },
        monitors: { _id: true, name: true },
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

export async function fetchIncidentById(
  projectId: string,
  incidentId: string,
): Promise<IncidentItem> {
  const response: AxiosResponse = await apiClient.post(
    "/api/incident/get-list?skip=0&limit=1",
    {
      query: { _id: incidentId },
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        description: true,
        rootCause: true,
        declaredAt: true,
        createdAt: true,
        currentIncidentState: { _id: true, name: true, color: true },
        incidentSeverity: { _id: true, name: true, color: true },
        monitors: { _id: true, name: true },
      },
      sort: {},
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data[0];
}

export async function fetchIncidentStates(
  projectId: string,
): Promise<IncidentState[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/incident-state/get-list?skip=0&limit=20",
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

export async function fetchIncidentStateTimeline(
  projectId: string,
  incidentId: string,
): Promise<StateTimelineItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/incident-state-timeline/get-list?skip=0&limit=50",
    {
      query: { incidentId },
      select: {
        _id: true,
        createdAt: true,
        incidentState: { _id: true, name: true, color: true },
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data;
}

export async function fetchIncidentFeed(
  projectId: string,
  incidentId: string,
): Promise<FeedItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/incident-feed/get-list?skip=0&limit=50",
    {
      query: { incidentId },
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

export async function changeIncidentState(
  projectId: string,
  incidentId: string,
  incidentStateId: string,
): Promise<void> {
  await apiClient.post(
    "/api/incident-state-timeline",
    {
      data: {
        incidentId,
        incidentStateId,
        projectId,
      },
    },
    {
      headers: { tenantid: projectId },
    },
  );
}
