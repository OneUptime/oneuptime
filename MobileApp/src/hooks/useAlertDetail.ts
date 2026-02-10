import { useQuery } from "@tanstack/react-query";
import {
  fetchAlertById,
  fetchAlertStates,
  fetchAlertStateTimeline,
} from "../api/alerts";

export function useAlertDetail(projectId: string, alertId: string) {
  return useQuery({
    queryKey: ["alert", projectId, alertId],
    queryFn: () => fetchAlertById(projectId, alertId),
    enabled: !!projectId && !!alertId,
  });
}

export function useAlertStates(projectId: string) {
  return useQuery({
    queryKey: ["alert-states", projectId],
    queryFn: () => fetchAlertStates(projectId),
    enabled: !!projectId,
  });
}

export function useAlertStateTimeline(projectId: string, alertId: string) {
  return useQuery({
    queryKey: ["alert-state-timeline", projectId, alertId],
    queryFn: () => fetchAlertStateTimeline(projectId, alertId),
    enabled: !!projectId && !!alertId,
  });
}
