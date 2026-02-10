import { useQuery } from "@tanstack/react-query";
import {
  fetchIncidentById,
  fetchIncidentStates,
  fetchIncidentStateTimeline,
} from "../api/incidents";

export function useIncidentDetail(projectId: string, incidentId: string) {
  return useQuery({
    queryKey: ["incident", projectId, incidentId],
    queryFn: () => fetchIncidentById(projectId, incidentId),
    enabled: !!projectId && !!incidentId,
  });
}

export function useIncidentStates(projectId: string) {
  return useQuery({
    queryKey: ["incident-states", projectId],
    queryFn: () => fetchIncidentStates(projectId),
    enabled: !!projectId,
  });
}

export function useIncidentStateTimeline(
  projectId: string,
  incidentId: string,
) {
  return useQuery({
    queryKey: ["incident-state-timeline", projectId, incidentId],
    queryFn: () => fetchIncidentStateTimeline(projectId, incidentId),
    enabled: !!projectId && !!incidentId,
  });
}
