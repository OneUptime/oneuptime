import { translationKey } from "Common/Types/Translator";

/*
 * WHAT A RESOURCE OVERVIEW'S DETAILS CARD SAYS, when its facts are the
 * record's own columns: a Docker or Podman host's, a Kubernetes cluster's, a
 * vCenter's, a Proxmox or Ceph cluster's, a storage array's and a host's
 * (ResourceRecordDetailsCard). The Overviews built on ResourceOverview - a
 * service's, a database's, a queue's - draw theirs from rows the page works
 * out, by the same rules (ResourceOverviewDetails).
 *
 * These cards repeated what the page had already said (#5298's UI review):
 * the hero's name, its Last Seen and its description, and the header's
 * labels, as "Display Name", "Last Seen", "Description" and "Labels" rows,
 * with "Not reported" for every fact a new resource had not sent yet - in
 * one column on some pages and two on others. One rule now:
 *
 *   - The hero says who the resource is: its name, its status, its
 *     identifier, its description and when it was last seen. The page's
 *     header lists its labels (on a phone, where the header has no room
 *     for them, a Labels card of their own under the Details).
 *   - The Details card says the rest, in two columns from 640px: what the
 *     resource reported about itself - its platform, its versions, its
 *     agent - and only what it reported. Its identifier keeps a row, under
 *     the name the telemetry matches it by ("Host Name (host.name)"), whole
 *     and to copy: the hero cuts it to one line.
 *   - Nothing reported yet is one line that says so; the card ends with the
 *     record's ID line, as every details card does.
 *
 * App/Tests/Dashboard/ResourceDetailsCardsSayWhatIsNew holds every resource
 * Overview to it. Plain logic, free of React, so App/Tests can read it.
 */

/*
 * The columns the hero and the page's header already say, which no Details
 * card repeats: the name (the hero's title and the page's), the description
 * (the hero's line under the name), when it was last seen, its labels and
 * its connection status (the hero's pill).
 */
export const HERO_AND_HEADER_COLUMNS: ReadonlyArray<string> = [
  "name",
  "description",
  "lastSeenAt",
  "labels",
  "otelCollectorStatus",
];

// Two columns from 640px, one on a phone (DetailGridLayout).
export const RESOURCE_RECORD_DETAILS_COLUMNS: number = 2;

// What a card with nothing reported yet says, in place of an empty grid.
export const RESOURCE_RECORD_DETAILS_EMPTY_MESSAGE: string = translationKey(
  "No details reported yet.",
);

/*
 * Whether a column holds something to say: a non-blank string, a number, a
 * boolean, a date, a non-empty list or an object. Nothing, an empty string
 * and an empty list are what a resource that never reported the fact holds,
 * and draw no row.
 */
export function isReportedDetailValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

// Whether a Details card may show a column: not one the hero or header says.
export function isRepeatedHeroColumn(column: string): boolean {
  return HERO_AND_HEADER_COLUMNS.includes(column);
}
