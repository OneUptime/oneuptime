import {
  readProjectPermissionRows,
  type ProjectPermissionRow,
} from "../oncall/globalOverrideAccess";

/*
 * The signed-in person's permission rows in each project, as the server
 * last sent them.
 *
 * Every answer the server gives about a project (a request with its
 * `tenantid`) carries the person's rows there in a `project-permissions`
 * header - the dashboard keeps the same snapshot for its locks. The app
 * never sends the hash that would let the server leave the header out, so
 * each answer carries it, and the API client hands every one here. A
 * screen that must not offer what the server would refuse reads it: the
 * cover sheet, before it lets anyone arrange cover for every policy
 * (oncall/globalOverrideAccess).
 *
 * This is what the app shows and offers, never what is allowed: the server
 * decides every request from its own copy. In memory only, like the SSO
 * denials: a fresh launch asks again, and signing out forgets it, so the
 * next person on the handset never sees the last one's rows.
 */

const headerByProjectId: Map<string, string> = new Map<string, string>();
const rowsByProjectId: Map<string, Array<ProjectPermissionRow>> = new Map<
  string,
  Array<ProjectPermissionRow>
>();

type Listener = () => void;
let listeners: Array<Listener> = [];

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function toProjectKey(projectId: string | null | undefined): string {
  return (projectId || "").trim().toLowerCase();
}

/*
 * A response header by name, whatever its casing: AxiosHeaders has a
 * case-insensitive get(), and a plain object (a test's, an adapter's) is
 * scanned.
 */
export function readResponseHeader(
  headers: unknown,
  name: string,
): string | null {
  if (!headers || typeof headers !== "object") {
    return null;
  }

  const getter: unknown = (headers as { get?: unknown }).get;

  if (typeof getter === "function") {
    const value: unknown = (getter as (headerName: string) => unknown).call(
      headers,
      name,
    );

    return typeof value === "string" ? value : null;
  }

  for (const key of Object.keys(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      const value: unknown = (headers as Record<string, unknown>)[key];

      return typeof value === "string" ? value : null;
    }
  }

  return null;
}

/*
 * Keeps the rows an answer about `projectId` carries, if it carries any. An
 * answer without the header, or with one that cannot be read, leaves what
 * was kept: it says nothing new.
 */
export function recordProjectPermissions(
  projectId: string,
  headers: unknown,
): void {
  const key: string = toProjectKey(projectId);

  if (!key) {
    return;
  }

  const header: string | null = readResponseHeader(
    headers,
    "project-permissions",
  );

  // The same snapshot again - every answer carries it - changes nothing.
  if (header === null || headerByProjectId.get(key) === header) {
    return;
  }

  const rows: Array<ProjectPermissionRow> | null = readProjectPermissionRows(
    header,
    key,
  );

  if (!rows) {
    return;
  }

  headerByProjectId.set(key, header);
  rowsByProjectId.set(key, rows);
  notify();
}

/*
 * The person's rows in `projectId`, or null before the server has said. The
 * same array until they change, so a screen can subscribe to it.
 */
export function getProjectPermissionRows(
  projectId: string | null | undefined,
): Array<ProjectPermissionRow> | null {
  return rowsByProjectId.get(toProjectKey(projectId)) ?? null;
}

// Forgets every project's rows: on signing out.
export function clearAllProjectPermissions(): void {
  if (rowsByProjectId.size === 0 && headerByProjectId.size === 0) {
    return;
  }

  rowsByProjectId.clear();
  headerByProjectId.clear();
  notify();
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribeToProjectPermissions(listener: Listener): () => void {
  listeners.push(listener);

  return (): void => {
    listeners = listeners.filter((candidate: Listener): boolean => {
      return candidate !== listener;
    });
  };
}
