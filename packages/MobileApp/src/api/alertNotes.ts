import apiClient from "./client";
import type { AxiosResponse } from "axios";
import type { NoteItem } from "./types";

export async function fetchAlertNotes(
  projectId: string,
  alertId: string,
): Promise<NoteItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/alert-internal-note/get-list?skip=0&limit=50",
    {
      query: { alertId },
      select: {
        _id: true,
        note: true,
        createdAt: true,
        createdByUser: { _id: true, name: true },
      },
      sort: { createdAt: "DESC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );
  return response.data.data;
}

export async function createAlertNote(
  projectId: string,
  alertId: string,
  note: string,
): Promise<void> {
  await apiClient.post(
    "/api/alert-internal-note",
    {
      data: {
        alertId,
        note,
        projectId,
      },
    },
    {
      headers: { tenantid: projectId },
    },
  );
}
