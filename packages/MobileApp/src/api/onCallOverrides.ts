import type { AxiosResponse } from "axios";
import apiClient from "./client";
import { toPlainText } from "../utils/text";
import type { OnCallOverrideItem, OnCallUserRef } from "./types";

/*
 * Overrides are the only WRITE the on-call feature makes, and the only reason
 * the app can answer "I cannot take this page" with something other than a
 * phone call to a colleague.
 *
 * The server enforces the rules that matter (start strictly before end, and
 * the two users must differ); this module does not re-implement them, it just
 * makes sure the request it sends is the shape the server validates.
 */

interface CreateOnCallOverrideInput {
  projectId: string;

  /* Whose pages are being redirected - the person going off-grid. */
  overrideUserId: string;

  /* Who receives them instead. The server rejects these being equal. */
  routeAlertsToUserId: string;

  startsAt: Date;
  endsAt: Date;

  /*
   * Omitted for a project-wide override, which is what the app creates.
   * Covering someone on one policy and leaving them paged by the rest is not
   * what "cover for me" means to the person asking for it. The server takes
   * a permission to add overrides over the whole project for one; someone
   * whose permission covers only some policies gets one override on each
   * policy they may cover instead (fetchOverrideAddAccess).
   */
  onCallDutyPolicyId?: string;
}

/*
 * Where the signed-in person may add a user override in a project: whether
 * a global one, and on which of the policies asked about. The server's own
 * answer (POST /api/on-call-duty-policy-user-override/add-access), from
 * running a create's checks on each - only the server can tell which
 * policies a permission limited to labels or to owned policies reaches.
 */
export interface OverrideAddAccess {
  global: boolean;
  onCallDutyPolicyIds: string[];
}

// An on-call policy cover can be arranged on, as the person sees it named.
export interface CoverPolicy {
  policyId: string;
  policyName: string;
}

// The answer, read so that nothing it does not plainly say grants anything.
export function toOverrideAddAccess(raw: unknown): OverrideAddAccess {
  const record: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const ids: unknown = record["onCallDutyPolicyIds"];

  return {
    global: record["global"] === true,
    onCallDutyPolicyIds: Array.isArray(ids)
      ? ids.filter((id: unknown): id is string => {
          return typeof id === "string" && id.trim().length > 0;
        })
      : [],
  };
}

/**
 * Where the person may add an override in `projectId`, about
 * `onCallDutyPolicyIds` - or null from a server older than the question,
 * which answers 404: the sheet keeps its lock there, as before.
 */
export async function fetchOverrideAddAccess(
  projectId: string,
  onCallDutyPolicyIds: string[],
): Promise<OverrideAddAccess | null> {
  try {
    const response: AxiosResponse = await apiClient.post(
      "/api/on-call-duty-policy-user-override/add-access",
      { onCallDutyPolicyIds },
      {
        headers: { tenantid: projectId },
      },
    );

    return toOverrideAddAccess(response.data);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      (err as { isAxiosError?: unknown }).isAxiosError === true &&
      (err as { response?: { status?: unknown } }).response?.status === 404
    ) {
      return null;
    }

    throw err;
  }
}

/*
 * The project's on-call policies the person can see, by name: what cover
 * arranged from "Cover for me" or "I'll take over" may be added on, before
 * the server says which they may cover. At most as many as the server
 * answers about at once.
 */
export async function fetchCoverPolicies(
  projectId: string,
): Promise<CoverPolicy[]> {
  const response: AxiosResponse = await apiClient.post(
    "/api/on-call-duty-policy/get-list?skip=0&limit=100",
    {
      query: {},
      select: { _id: true, name: true },
      sort: { name: "ASC" },
    },
    {
      headers: { tenantid: projectId },
    },
  );

  const rows: Array<unknown> = Array.isArray(response.data?.data)
    ? response.data.data
    : [];

  const policies: CoverPolicy[] = [];

  rows.forEach((row: unknown) => {
    if (!row || typeof row !== "object") {
      return;
    }

    const record: Record<string, unknown> = row as Record<string, unknown>;
    const policyId: string = toPlainText(record["_id"]);

    if (policyId) {
      policies.push({
        policyId,
        policyName: toPlainText(record["name"]) || policyId,
      });
    }
  });

  return policies;
}

function toUserRef(raw: unknown): OnCallUserRef | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const user: Record<string, unknown> = raw as Record<string, unknown>;
  const id: string = toPlainText(user["_id"]);

  if (!id) {
    return null;
  }

  return {
    _id: id,
    name: toPlainText(user["name"]) || undefined,
    email: toPlainText(user["email"]) || undefined,
  };
}

export function toOnCallOverrideItem(
  raw: unknown,
  project: { projectId: string; projectName: string },
): OnCallOverrideItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const item: Record<string, unknown> = raw as Record<string, unknown>;
  const id: string = toPlainText(item["_id"]);

  if (!id) {
    return null;
  }

  const policyRaw: unknown = item["onCallDutyPolicy"];
  const policyName: string = policyRaw
    ? toPlainText((policyRaw as Record<string, unknown>)["name"])
    : "";

  return {
    _id: id,
    projectId: project.projectId,
    projectName: project.projectName,
    overrideUser: toUserRef(item["overrideUser"]),
    routeAlertsToUser: toUserRef(item["routeAlertsToUser"]),
    onCallDutyPolicy: policyName
      ? {
          _id:
            toPlainText((policyRaw as Record<string, unknown>)["_id"]) ||
            undefined,
          name: policyName,
        }
      : null,
    startsAt: toPlainText(item["startsAt"]) || null,
    endsAt: toPlainText(item["endsAt"]) || null,
    createdAt: toPlainText(item["createdAt"]),
  };
}

export async function fetchOnCallOverrides(
  project: { projectId: string; projectName: string },
  options: { limit?: number } = {},
): Promise<OnCallOverrideItem[]> {
  const { limit = 50 } = options;

  const response: AxiosResponse = await apiClient.post(
    `/api/on-call-duty-policy-user-override/get-list?skip=0&limit=${limit}`,
    {
      query: {},
      select: {
        _id: true,
        createdAt: true,
        startsAt: true,
        endsAt: true,
        overrideUser: { _id: true, name: true, email: true },
        routeAlertsToUser: { _id: true, name: true, email: true },
        onCallDutyPolicy: { _id: true, name: true },
      },
      sort: { startsAt: "DESC" },
    },
    {
      headers: { tenantid: project.projectId },
    },
  );

  const rows: Array<unknown> = Array.isArray(response.data?.data)
    ? response.data.data
    : [];

  const overrides: OnCallOverrideItem[] = [];

  rows.forEach((row: unknown) => {
    const override: OnCallOverrideItem | null = toOnCallOverrideItem(
      row,
      project,
    );

    if (override) {
      overrides.push(override);
    }
  });

  return overrides;
}

export async function createOnCallOverride(
  input: CreateOnCallOverrideInput,
): Promise<void> {
  await apiClient.post(
    "/api/on-call-duty-policy-user-override",
    {
      data: {
        projectId: input.projectId,
        overrideUserId: input.overrideUserId,
        routeAlertsToUserId: input.routeAlertsToUserId,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        ...(input.onCallDutyPolicyId
          ? { onCallDutyPolicyId: input.onCallDutyPolicyId }
          : {}),
      },
    },
    {
      headers: { tenantid: input.projectId },
    },
  );
}

export async function deleteOnCallOverride(
  projectId: string,
  overrideId: string,
): Promise<void> {
  await apiClient.delete(
    `/api/on-call-duty-policy-user-override/${overrideId}`,
    {
      headers: { tenantid: projectId },
    },
  );
}
