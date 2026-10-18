import { translationKey } from "Common/UI/Utils/TranslateTemplate";
// A type only, so App tests (no React) can still load this module.
import type EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";

/*
 * The first run of an infrastructure list (Hosts, Kubernetes clusters,
 * Docker and Podman hosts, Docker Swarm, Proxmox, VMware, Ceph, storage
 * arrays, databases, queues, serverless functions, cloud environments, IoT
 * fleets): until the project has one, the list shows its setup guide under
 * the empty table, and the page keeps watching for the first one. React-free,
 * so App tests can read it; useFirstRecordWatch is the hook.
 */

/*
 * How often an empty list asks again whether its first record has arrived.
 * Agents report within a minute of starting, and the guide says so.
 */
export const FIRST_RECORD_POLL_INTERVAL_MS: number = 10 * 1000;

/*
 * Under the guide's title on an empty list. The empty table above it says
 * what the list is ("No Docker hosts yet" and the list's description), so
 * the guide says only what to do, and that nothing more is needed after.
 */
export const FIRST_RUN_GUIDE_DESCRIPTION: string = translationKey(
  "Follow the steps below. This list fills in on its own once data arrives.",
);

// Whether an empty list should still be watching for its first record.
export function isWatchingForFirstRecord(count: number | null): boolean {
  return count === 0;
}

/*
 * The count after a background check: the first record that arrived wins,
 * anything else (still none, a failed check) keeps what the page shows - a
 * transient failure never swaps the guide for an error.
 */
export function getCountAfterCheck(data: {
  current: number | null;
  checked: number | null;
}): number | null {
  if (data.checked !== null && data.checked > 0) {
    return data.checked;
  }

  return data.current;
}

/*
 * The empty table's options while the project has none of this resource:
 * agent-discovered lists do not repeat their Create button there - creating
 * a record by hand does not connect anything, and the guide below is the
 * way in. The card header keeps its Create button for whoever wants one by
 * hand. Lists where adding by hand is a way to connect (a vCenter through a
 * probe, a database or queue endpoint) keep theirs.
 */
export function getFirstRunEmptyState(data: {
  emptyState: EmptyStateOptions | undefined;
  count: number | null;
  isAddedByHand?: boolean | undefined;
}): EmptyStateOptions {
  const emptyState: EmptyStateOptions = data.emptyState || {};

  if (data.isAddedByHand || !isWatchingForFirstRecord(data.count)) {
    return emptyState;
  }

  return { ...emptyState, hideCreateButton: true };
}
