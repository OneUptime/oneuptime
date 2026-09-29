import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { fetchAlertNotes } from "../api/alertNotes";
import type { NoteItem } from "../api/types";

export function useAlertNotes(
  projectId: string,
  alertId: string,
): UseQueryResult<NoteItem[], Error> {
  return useQuery({
    queryKey: ["alert-notes", projectId, alertId],
    queryFn: () => {
      return fetchAlertNotes(projectId, alertId);
    },
    enabled: Boolean(projectId) && Boolean(alertId),
  });
}
