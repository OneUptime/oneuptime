import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { fetchIncidentNotes } from "../api/incidentNotes";
import type { NoteItem } from "../api/types";

export function useIncidentNotes(
  projectId: string,
  incidentId: string,
): UseQueryResult<NoteItem[], Error> {
  return useQuery({
    queryKey: ["incident-notes", projectId, incidentId],
    queryFn: () => {
      return fetchIncidentNotes(projectId, incidentId);
    },
    enabled: Boolean(projectId) && Boolean(incidentId),
  });
}
