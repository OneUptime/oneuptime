import { useQuery } from "@tanstack/react-query";
import {
  fetchAlertEpisodeById,
  fetchAlertEpisodeStates,
  fetchAlertEpisodeStateTimeline,
  fetchAlertEpisodeNotes,
} from "../api/alertEpisodes";

export function useAlertEpisodeDetail(projectId: string, episodeId: string) {
  return useQuery({
    queryKey: ["alert-episode", projectId, episodeId],
    queryFn: () => {
      return fetchAlertEpisodeById(projectId, episodeId);
    },
    enabled: Boolean(projectId) && Boolean(episodeId),
  });
}

export function useAlertEpisodeStates(projectId: string) {
  return useQuery({
    queryKey: ["alert-states", projectId],
    queryFn: () => {
      return fetchAlertEpisodeStates(projectId);
    },
    enabled: Boolean(projectId),
  });
}

export function useAlertEpisodeStateTimeline(
  projectId: string,
  episodeId: string,
) {
  return useQuery({
    queryKey: ["alert-episode-state-timeline", projectId, episodeId],
    queryFn: () => {
      return fetchAlertEpisodeStateTimeline(projectId, episodeId);
    },
    enabled: Boolean(projectId) && Boolean(episodeId),
  });
}

export function useAlertEpisodeNotes(projectId: string, episodeId: string) {
  return useQuery({
    queryKey: ["alert-episode-notes", projectId, episodeId],
    queryFn: () => {
      return fetchAlertEpisodeNotes(projectId, episodeId);
    },
    enabled: Boolean(projectId) && Boolean(episodeId),
  });
}
