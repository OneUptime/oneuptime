import apiClient from "./client";
import type { AxiosResponse } from "axios";
import type {
  ListResponse,
  IncidentEpisodeItem,
  IncidentState,
  StateTimelineItem,
  NoteItem,
  FeedItem,
} from "./types";

export async function fetchIncidentEpisodes(
  projectId: string,
  options: { skip?: number; limit?: number; unresolvedOnly?: boolean } = {},
): Promise<ListResponse<IncidentEpisodeItem>> {
  const { skip = 0, limit = 20, unresolvedOnly = false } = options;

  const query: Record<string, unknown> = {};
  if (unresolvedOnly) {
    query.currentIncidentState = { isResolvedState: false };
  }

  const response: AxiosResponse = await apiClient.post(
    `/api/incident-episode/get-list?skip=${skip}&limit=${limit}`,
    {
      query,
      select: {
        _id: true,
        title: true,
        episodeNumber: true,
        episodeNumberWithPrefix: true,
        description: true,
        rootCause: true,
        createdAt: true,
        declaredAt: true,
        incidentCount: true,
        currentIncidentState: { _id: true, name: true, color: true },
        incidentSeverity: { _id: true, name: true, color: true },
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data;
}

export async function fetchAllIncidentEpisodes(
  options: { skip?: number; limit?: number; unresolvedOnly?: boolean } = {},
): Promise<ListResponse<IncidentEpisodeItem>> {
  const { skip = 0, limit = 100, unresolvedOnly = false } = options;

  const query: Record<string, unknown> = {};
  if (unresolvedOnly) {
    query.currentIncidentState = { isResolvedState: false };
  }

  const response: AxiosResponse = await apiClient.post(
    `/api/incident-episode/get-list?skip=${skip}&limit=${limit}`,
    {
      query,
      select: {
        _id: true,
        title: true,
        episodeNumber: true,
        episodeNumberWithPrefix: true,
        description: true,
        rootCause: true,
        createdAt: true,
        declaredAt: true,
        incidentCount: true,
        currentIncidentState: { _id: true, name: true, color: true },
        incidentSeverity: { _id: true, name: true, color: true },
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

export async function fetchIncidentEpisodeById(
  projectId: string,
  episodeId: string,
): Promise<IncidentEpisodeItem | null> {
  const response: AxiosResponse = await apiClient.post(
    "/api/incident-episode/get-list?skip=0&limit=1",
    {
      query: { _id: episodeId },
      select: {
        _id: true,
        title: true,
        episodeNumber: true,
        episodeNumberWithPrefix: true,
        description: true,
        rootCause: true,
        createdAt: true,
        declaredAt: true,
        incidentCount: true,
        currentIncidentState: { _id: true, name: true, color: true },
        incidentSeverity: { _id: true, name: true, color: true },
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
   * An episode the responder has been paged about can be gone by the time they
   * tap through, and the server says so with an empty list from a request that
   * SUCCEEDED - making `data[0]` `undefined`. React Query v5 will not cache
   * `undefined`; it rejects the query with a synthetic `<queryHash> data is
   * undefined` error, which reads downstream as a failed request rather than
   * as a deleted row. `null` caches, so the miss arrives as settled data.
   * `undefined` here is a trap, not a style choice.
   */
  return response.data.data[0] ?? null;
}

export async function fetchIncidentEpisodeStates(
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

export async function fetchIncidentEpisodeStateTimeline(
  projectId: string,
  episodeId: string,
): Promise<StateTimelineItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/incident-episode-state-timeline/get-list?skip=0&limit=50",
    {
      query: { incidentEpisodeId: episodeId },
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

export async function fetchIncidentEpisodeFeed(
  projectId: string,
  episodeId: string,
): Promise<FeedItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/incident-episode-feed/get-list?skip=0&limit=50",
    {
      query: { incidentEpisodeId: episodeId },
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

export async function changeIncidentEpisodeState(
  projectId: string,
  episodeId: string,
  incidentStateId: string,
): Promise<void> {
  await apiClient.post(
    "/api/incident-episode-state-timeline",
    {
      data: {
        incidentEpisodeId: episodeId,
        incidentStateId,
        projectId,
      },
    },
    {
      headers: { tenantid: projectId },
    },
  );
}

export async function fetchIncidentEpisodeNotes(
  projectId: string,
  episodeId: string,
): Promise<NoteItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/incident-episode-internal-note/get-list?skip=0&limit=50",
    {
      query: { incidentEpisodeId: episodeId },
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

export async function createIncidentEpisodeNote(
  projectId: string,
  episodeId: string,
  note: string,
): Promise<void> {
  await apiClient.post(
    "/api/incident-episode-internal-note",
    {
      data: {
        incidentEpisodeId: episodeId,
        note,
        projectId,
      },
    },
    {
      headers: { tenantid: projectId },
    },
  );
}
