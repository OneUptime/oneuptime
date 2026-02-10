import { useQuery } from "@tanstack/react-query";
import {
  fetchIncidentEpisodeById,
  fetchIncidentEpisodeStates,
  fetchIncidentEpisodeStateTimeline,
  fetchIncidentEpisodeNotes,
} from "../api/incidentEpisodes";

export function useIncidentEpisodeDetail(
  projectId: string,
  episodeId: string,
) {
  return useQuery({
    queryKey: ["incident-episode", projectId, episodeId],
    queryFn: () => fetchIncidentEpisodeById(projectId, episodeId),
    enabled: !!projectId && !!episodeId,
  });
}

export function useIncidentEpisodeStates(projectId: string) {
  return useQuery({
    queryKey: ["incident-states", projectId],
    queryFn: () => fetchIncidentEpisodeStates(projectId),
    enabled: !!projectId,
  });
}

export function useIncidentEpisodeStateTimeline(
  projectId: string,
  episodeId: string,
) {
  return useQuery({
    queryKey: ["incident-episode-state-timeline", projectId, episodeId],
    queryFn: () => fetchIncidentEpisodeStateTimeline(projectId, episodeId),
    enabled: !!projectId && !!episodeId,
  });
}

export function useIncidentEpisodeNotes(
  projectId: string,
  episodeId: string,
) {
  return useQuery({
    queryKey: ["incident-episode-notes", projectId, episodeId],
    queryFn: () => fetchIncidentEpisodeNotes(projectId, episodeId),
    enabled: !!projectId && !!episodeId,
  });
}
