import apiClient from "./client";
import type { AxiosResponse } from "axios";
import type {
  ListResponse,
  AlertEpisodeItem,
  AlertState,
  StateTimelineItem,
  NoteItem,
  FeedItem,
} from "./types";

export async function fetchAlertEpisodes(
  projectId: string,
  options: { skip?: number; limit?: number; unresolvedOnly?: boolean } = {},
): Promise<ListResponse<AlertEpisodeItem>> {
  const { skip = 0, limit = 20, unresolvedOnly = false } = options;

  const query: Record<string, unknown> = {};
  if (unresolvedOnly) {
    query.currentAlertState = { isResolvedState: false };
  }

  const response: AxiosResponse = await apiClient.post(
    `/api/alert-episode/get-list?skip=${skip}&limit=${limit}`,
    {
      query,
      select: {
        _id: true,
        title: true,
        episodeNumber: true,
        episodeNumberWithPrefix: true,
        description: true,
        createdAt: true,
        alertCount: true,
        currentAlertState: { _id: true, name: true, color: true },
        alertSeverity: { _id: true, name: true, color: true },
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data;
}

export async function fetchAllAlertEpisodes(
  options: { skip?: number; limit?: number; unresolvedOnly?: boolean } = {},
): Promise<ListResponse<AlertEpisodeItem>> {
  const { skip = 0, limit = 100, unresolvedOnly = false } = options;

  const query: Record<string, unknown> = {};
  if (unresolvedOnly) {
    query.currentAlertState = { isResolvedState: false };
  }

  const response: AxiosResponse = await apiClient.post(
    `/api/alert-episode/get-list?skip=${skip}&limit=${limit}`,
    {
      query,
      select: {
        _id: true,
        title: true,
        episodeNumber: true,
        episodeNumberWithPrefix: true,
        description: true,
        createdAt: true,
        alertCount: true,
        currentAlertState: { _id: true, name: true, color: true },
        alertSeverity: { _id: true, name: true, color: true },
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

export async function fetchAlertEpisodeById(
  projectId: string,
  episodeId: string,
): Promise<AlertEpisodeItem> {
  const response: AxiosResponse = await apiClient.post(
    "/api/alert-episode/get-list?skip=0&limit=1",
    {
      query: { _id: episodeId },
      select: {
        _id: true,
        title: true,
        episodeNumber: true,
        episodeNumberWithPrefix: true,
        description: true,
        createdAt: true,
        alertCount: true,
        currentAlertState: { _id: true, name: true, color: true },
        alertSeverity: { _id: true, name: true, color: true },
      },
      sort: {},
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data[0];
}

export async function fetchAlertEpisodeStates(
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

export async function fetchAlertEpisodeStateTimeline(
  projectId: string,
  episodeId: string,
): Promise<StateTimelineItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/alert-episode-state-timeline/get-list?skip=0&limit=50",
    {
      query: { alertEpisodeId: episodeId },
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

export async function fetchAlertEpisodeFeed(
  projectId: string,
  episodeId: string,
): Promise<FeedItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/alert-episode-feed/get-list?skip=0&limit=50",
    {
      query: { alertEpisodeId: episodeId },
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

export async function changeAlertEpisodeState(
  projectId: string,
  episodeId: string,
  alertStateId: string,
): Promise<void> {
  await apiClient.post(
    "/api/alert-episode-state-timeline",
    {
      data: {
        alertEpisodeId: episodeId,
        alertStateId,
        projectId,
      },
    },
    {
      headers: { tenantid: projectId },
    },
  );
}

export async function fetchAlertEpisodeNotes(
  projectId: string,
  episodeId: string,
): Promise<NoteItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/alert-episode-internal-note/get-list?skip=0&limit=50",
    {
      query: { alertEpisodeId: episodeId },
      select: {
        _id: true,
        note: true,
        createdAt: true,
        createdByUser: { _id: true, name: true },
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data;
}

export async function createAlertEpisodeNote(
  projectId: string,
  episodeId: string,
  note: string,
): Promise<void> {
  await apiClient.post(
    "/api/alert-episode-internal-note",
    {
      data: {
        alertEpisodeId: episodeId,
        note,
        projectId,
      },
    },
    {
      headers: { tenantid: projectId },
    },
  );
}
