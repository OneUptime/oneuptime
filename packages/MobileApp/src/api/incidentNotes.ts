import apiClient from "./client";
import type { AxiosResponse } from "axios";
import type { NoteItem } from "./types";

export async function fetchIncidentNotes(
  projectId: string,
  incidentId: string,
): Promise<NoteItem[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/incident-internal-note/get-list?skip=0&limit=50",
    {
      query: { incidentId },
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

export async function createIncidentNote(
  projectId: string,
  incidentId: string,
  note: string,
): Promise<void> {
  await apiClient.post(
    "/api/incident-internal-note",
    {
      data: {
        incidentId,
        note,
        projectId,
      },
    },
    {
      headers: { tenantid: projectId },
    },
  );
}
