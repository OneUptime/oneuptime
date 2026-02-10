import { useQuery } from "@tanstack/react-query";
import {
  fetchIncidentEpisodeById,
  fetchIncidentEpisodeStates,
  fetchIncidentEpisodeStateTimeline,
  fetchIncidentEpisodeNotes,
} from "../api/incidentEpisodes";

export function useIncidentEpisodeDetail(projectId: string, episodeId: string) {
  return useQuery({
    queryKey: ["incident-episode", projectId, episodeId],
    queryFn: () => {
      return fetchIncidentEpisodeById(projectId, episodeId);
    },
    enabled: Boolean(projectId) && Boolean(episodeId),
  });
}

export function useIncidentEpisodeStates(projectId: string) {
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
) {
  return useQuery({
    queryKey: ["incident-episode-state-timeline", projectId, episodeId],
    queryFn: () => {
      return fetchIncidentEpisodeStateTimeline(projectId, episodeId);
    },
    enabled: Boolean(projectId) && Boolean(episodeId),
  });
}

export function useIncidentEpisodeNotes(projectId: string, episodeId: string) {
  return useQuery({
    queryKey: ["incident-episode-notes", projectId, episodeId],
    queryFn: () => {
      return fetchIncidentEpisodeNotes(projectId, episodeId);
    },
    enabled: Boolean(projectId) && Boolean(episodeId),
  });
}
