import { useQuery } from "@tanstack/react-query";
import {
  fetchAlertEpisodeById,
  fetchAlertEpisodeStates,
  fetchAlertEpisodeStateTimeline,
  fetchAlertEpisodeNotes,
} from "../api/alertEpisodes";

export function useAlertEpisodeDetail(
  projectId: string,
  episodeId: string,
) {
  return useQuery({
    queryKey: ["alert-episode", projectId, episodeId],
    queryFn: () => fetchAlertEpisodeById(projectId, episodeId),
    enabled: !!projectId && !!episodeId,
  });
}

export function useAlertEpisodeStates(projectId: string) {
  return useQuery({
    queryKey: ["alert-states", projectId],
    queryFn: () => fetchAlertEpisodeStates(projectId),
    enabled: !!projectId,
  });
}

export function useAlertEpisodeStateTimeline(
  projectId: string,
  episodeId: string,
) {
  return useQuery({
    queryKey: ["alert-episode-state-timeline", projectId, episodeId],
    queryFn: () => fetchAlertEpisodeStateTimeline(projectId, episodeId),
    enabled: !!projectId && !!episodeId,
  });
}

export function useAlertEpisodeNotes(
  projectId: string,
  episodeId: string,
) {
  return useQuery({
    queryKey: ["alert-episode-notes", projectId, episodeId],
    queryFn: () => fetchAlertEpisodeNotes(projectId, episodeId),
    enabled: !!projectId && !!episodeId,
  });
}
