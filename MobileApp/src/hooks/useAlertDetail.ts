import { useQuery } from "@tanstack/react-query";
import {
  fetchAlertById,
  fetchAlertStates,
  fetchAlertStateTimeline,
} from "../api/alerts";

export function useAlertDetail(projectId: string, alertId: string) {
  return useQuery({
    queryKey: ["alert", projectId, alertId],
    queryFn: () => {
      return fetchAlertById(projectId, alertId);
    },
    enabled: Boolean(projectId) && Boolean(alertId),
  });
}

export function useAlertStates(projectId: string) {
  return useQuery({
    queryKey: ["alert-states", projectId],
    queryFn: () => {
      return fetchAlertStates(projectId);
    },
    enabled: Boolean(projectId),
  });
}

export function useAlertStateTimeline(projectId: string, alertId: string) {
  return useQuery({
    queryKey: ["alert-state-timeline", projectId, alertId],
    queryFn: () => {
      return fetchAlertStateTimeline(projectId, alertId);
    },
    enabled: Boolean(projectId) && Boolean(alertId),
  });
}
