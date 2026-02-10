import apiClient from "./client";
import type {
  ListResponse,
  IncidentEpisodeItem,
  IncidentState,
  StateTimelineItem,
  NoteItem,
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

  const response = await apiClient.post(
    `/api/incident-episode/get-list?skip=${skip}&limit=${limit}`,
    {
      query,
      select: {
        _id: true,
        title: true,
        episodeNumber: true,
        episodeNumberWithPrefix: true,
        description: true,
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

export async function fetchIncidentEpisodeById(
  projectId: string,
  episodeId: string,
): Promise<IncidentEpisodeItem> {
  const response = await apiClient.post(
    "/api/incident-episode/get-list?skip=0&limit=1",
    {
      query: { _id: episodeId },
      select: {
        _id: true,
        title: true,
        episodeNumber: true,
        episodeNumberWithPrefix: true,
        description: true,
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
  return response.data.data[0];
}

export async function fetchIncidentEpisodeStates(
  projectId: string,
): Promise<IncidentState[]> {
  const response = await apiClient.post(
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
  const response = await apiClient.post(
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
  const response = await apiClient.post(
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
