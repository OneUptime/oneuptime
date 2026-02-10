import { useQuery } from "@tanstack/react-query";
import { fetchAlertNotes } from "../api/alertNotes";

export function useAlertNotes(projectId: string, alertId: string) {
  return useQuery({
    queryKey: ["alert-notes", projectId, alertId],
    queryFn: () => fetchAlertNotes(projectId, alertId),
    enabled: !!projectId && !!alertId,
  });
}
