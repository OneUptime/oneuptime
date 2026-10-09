import { HuntressNamedRef } from "./HuntressWebhook";

/*
 * Which Huntress organizations a connection opens incidents for.
 *
 * An MSP's Huntress account holds one organization per client. A
 * connection watches all of them unless it lists some, one per line, by
 * name (as Huntress shows it, in any case) or by id (the number in the
 * Huntress portal's address, /org/<id>/...). The list is kept as the text
 * that was typed, so it reads back exactly as it was written.
 *
 * Pure: shared by the server, which applies it, and the dashboard, which
 * validates and summarizes it.
 */

export const HUNTRESS_MAX_WATCHED_ORGANIZATIONS: number = 1000;
export const HUNTRESS_MAX_WATCHED_ORGANIZATION_LENGTH: number = 200;

/*
 * The organizations a filter names, in the order typed, without blank lines
 * and repeats (case aside). One per line: names can hold commas.
 */
export function parseHuntressOrganizationFilter(
  text: string | null | undefined,
): Array<string> {
  if (!text) {
    return [];
  }

  const entries: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const line of text.split("\n")) {
    const entry: string = line.trim();

    if (!entry) {
      continue;
    }

    const key: string = entry.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    entries.push(entry);
  }

  return entries;
}

/*
 * Why a filter cannot be saved, or null when it can. Checked when a
 * connection is saved, so a filter that would never match reaches the
 * person typing it rather than silently watching nothing.
 */
export function getHuntressOrganizationFilterProblem(
  text: string | null | undefined,
): string | null {
  const entries: Array<string> = parseHuntressOrganizationFilter(text);

  if (entries.length > HUNTRESS_MAX_WATCHED_ORGANIZATIONS) {
    return `List at most ${HUNTRESS_MAX_WATCHED_ORGANIZATIONS} organizations, one per line.`;
  }

  for (const entry of entries) {
    if (entry.length > HUNTRESS_MAX_WATCHED_ORGANIZATION_LENGTH) {
      return `"${entry.slice(0, 40)}…" is longer than an organization name can be (${HUNTRESS_MAX_WATCHED_ORGANIZATION_LENGTH} characters). Put each organization on a line of its own.`;
    }
  }

  return null;
}

/*
 * Whether a report from `organization` is one the filter watches. An empty
 * filter watches every organization, including a report that names none.
 */
export function isHuntressOrganizationWatched(data: {
  filter: Array<string>;
  organization: HuntressNamedRef;
}): boolean {
  if (data.filter.length === 0) {
    return true;
  }

  const organizationId: string | null = data.organization.id;
  const organizationName: string | null = data.organization.name
    ? data.organization.name.trim().toLowerCase()
    : null;

  return data.filter.some((entry: string): boolean => {
    if (organizationId && entry === organizationId) {
      return true;
    }

    return Boolean(organizationName) && entry.toLowerCase() === organizationName;
  });
}
