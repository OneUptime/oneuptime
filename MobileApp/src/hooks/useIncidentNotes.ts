import { useQuery } from "@tanstack/react-query";
import { fetchIncidentNotes } from "../api/incidentNotes";

export function useIncidentNotes(projectId: string, incidentId: string) {
  return useQuery({
    queryKey: ["incident-notes", projectId, incidentId],
    queryFn: () => {
      return fetchIncidentNotes(projectId, incidentId);
    },
    enabled: Boolean(projectId) && Boolean(incidentId),
  });
}
