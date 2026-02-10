import { useQuery } from "@tanstack/react-query";
import {
  fetchIncidentById,
  fetchIncidentStates,
  fetchIncidentStateTimeline,
} from "../api/incidents";

export function useIncidentDetail(projectId: string, incidentId: string) {
  return useQuery({
    queryKey: ["incident", projectId, incidentId],
    queryFn: () => {
      return fetchIncidentById(projectId, incidentId);
    },
    enabled: Boolean(projectId) && Boolean(incidentId),
  });
}

export function useIncidentStates(projectId: string) {
  return useQuery({
    queryKey: ["incident-states", projectId],
    queryFn: () => {
      return fetchIncidentStates(projectId);
    },
    enabled: Boolean(projectId),
  });
}

export function useIncidentStateTimeline(
  projectId: string,
  incidentId: string,
) {
  return useQuery({
    queryKey: ["incident-state-timeline", projectId, incidentId],
    queryFn: () => {
      return fetchIncidentStateTimeline(projectId, incidentId);
    },
    enabled: Boolean(projectId) && Boolean(incidentId),
  });
}
