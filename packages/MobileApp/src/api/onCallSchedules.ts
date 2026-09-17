import type { AxiosResponse } from "axios";
import apiClient from "./client";
import { toPlainText } from "../utils/text";
import type { OnCallScheduleItem, OnCallUserRef } from "./types";

/*
 * The roster fields on a schedule are the only place the server tells anybody
 * when a shift actually ends. Everything the on-call screens say about "you
 * are on until 6pm" and "Priya is next" is read from here - there is no
 * separate shift endpoint - so this module keeps the select list in one place
 * and hands back plain strings.
 *
 * The API client unwraps ObjectID and DateTime for us, but NOT Name and Email:
 * those arrive as `{_type, value}` and would render as "[object Object]" in a
 * row. `toPlainText` is the shared unwrapper, applied here so no screen has to
 * remember.
 */

interface RawUser {
  _id?: unknown;
  name?: unknown;
  email?: unknown;
}

function toUserRef(raw: unknown): OnCallUserRef | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const user: RawUser = raw as RawUser;
  const id: string = toPlainText(user._id);

  if (!id) {
    return null;
  }

  return {
    _id: id,
    name: toPlainText(user.name) || undefined,
    email: toPlainText(user.email) || undefined,
  };
}

function toIsoOrNull(value: unknown): string | null {
  const text: string = toPlainText(value);
  return text ? text : null;
}

export function toOnCallScheduleItem(raw: unknown): OnCallScheduleItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const item: Record<string, unknown> = raw as Record<string, unknown>;
  const id: string = toPlainText(item["_id"]);

  if (!id) {
    return null;
  }

  return {
    _id: id,
    name: toPlainText(item["name"]) || "Unnamed schedule",
    currentUserOnRoster: toUserRef(item["currentUserOnRoster"]),
    nextUserOnRoster: toUserRef(item["nextUserOnRoster"]),
    rosterStartAt: toIsoOrNull(item["rosterStartAt"]),
    rosterHandoffAt: toIsoOrNull(item["rosterHandoffAt"]),
    rosterNextStartAt: toIsoOrNull(item["rosterNextStartAt"]),
    rosterNextHandoffAt: toIsoOrNull(item["rosterNextHandoffAt"]),
  };
}

export async function fetchOnCallSchedules(
  projectId: string,
  options: { limit?: number } = {},
): Promise<OnCallScheduleItem[]> {
  const { limit = 50 } = options;

  const response: AxiosResponse = await apiClient.post(
    `/api/on-call-duty-policy-schedule/get-list?skip=0&limit=${limit}`,
    {
      query: {},
      select: {
        _id: true,
        name: true,
        currentUserOnRoster: { _id: true, name: true, email: true },
        nextUserOnRoster: { _id: true, name: true, email: true },
        rosterStartAt: true,
        rosterHandoffAt: true,
        rosterNextStartAt: true,
        rosterNextHandoffAt: true,
      },
      sort: { name: "ASC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );

  const rows: Array<unknown> = Array.isArray(response.data?.data)
    ? response.data.data
    : [];

  const schedules: OnCallScheduleItem[] = [];

  rows.forEach((row: unknown) => {
    const schedule: OnCallScheduleItem | null = toOnCallScheduleItem(row);

    if (schedule) {
      schedules.push(schedule);
    }
  });

  return schedules;
}
