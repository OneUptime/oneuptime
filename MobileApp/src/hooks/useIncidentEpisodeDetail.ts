import { useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  fetchIncidentEpisodeById,
  fetchIncidentEpisodeStates,
  fetchIncidentEpisodeStateTimeline,
  fetchIncidentEpisodeNotes,
  fetchIncidentEpisodeFeed,
} from "../api/incidentEpisodes";
import type {
  IncidentEpisodeItem,
  IncidentState,
  StateTimelineItem,
  NoteItem,
  FeedItem,
} from "../api/types";

export function useIncidentEpisodeDetail(
  projectId: string,
  episodeId: string,
): UseQueryResult<IncidentEpisodeItem, Error> {
  return useQuery({
    queryKey: ["incident-episode", projectId, episodeId],
    queryFn: () => {
      return fetchIncidentEpisodeById(projectId, episodeId);
    },
    enabled: Boolean(projectId) && Boolean(episodeId),
  });
}

export function useIncidentEpisodeStates(
  projectId: string,
): UseQueryResult<IncidentState[], Error> {
  return useQuery({
    queryKey: ["incident-states", projectId],
    queryFn: () => {
      return fetchIncidentEpisodeStates(projectId);
    },
    enabled: Boolean(projectId),
  });
}

export function useIncidentEpisodeStateTimeline(
  projectId: string,
  episodeId: string,
): UseQueryResult<StateTimelineItem[], Error> {
  return useQuery({
    queryKey: ["incident-episode-state-timeline", projectId, episodeId],
    queryFn: () => {
      return fetchIncidentEpisodeStateTimeline(projectId, episodeId);
    },
    enabled: Boolean(projectId) && Boolean(episodeId),
  });
}

export function useIncidentEpisodeNotes(
  projectId: string,
  episodeId: string,
): UseQueryResult<NoteItem[], Error> {
  return useQuery({
    queryKey: ["incident-episode-notes", projectId, episodeId],
    queryFn: () => {
      return fetchIncidentEpisodeNotes(projectId, episodeId);
    },
    enabled: Boolean(projectId) && Boolean(episodeId),
  });
}

export function useIncidentEpisodeFeed(
  projectId: string,
  episodeId: string,
): UseQueryResult<FeedItem[], Error> {
  return useQuery({
    queryKey: ["incident-episode-feed", projectId, episodeId],
    queryFn: () => {
      return fetchIncidentEpisodeFeed(projectId, episodeId);
    },
    enabled: Boolean(projectId) && Boolean(episodeId),
  });
}
