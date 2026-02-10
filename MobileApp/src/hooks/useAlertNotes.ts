import { useQuery } from "@tanstack/react-query";
import { fetchAlertNotes } from "../api/alertNotes";

export function useAlertNotes(projectId: string, alertId: string) {
  return useQuery({
    queryKey: ["alert-notes", projectId, alertId],
    queryFn: () => {
      return fetchAlertNotes(projectId, alertId);
    },
    enabled: Boolean(projectId) && Boolean(alertId),
  });
}
