import { translationKey } from "Common/UI/Utils/TranslateTemplate";
// A type only, so App tests (no React) can still load this module.
import type EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";

/*
 * The first run of an infrastructure list (Hosts, Kubernetes clusters,
 * Docker and Podman hosts, Docker Swarm, Proxmox, VMware, Ceph, storage
 * arrays, databases, queues, serverless functions, cloud environments, IoT
 * fleets): until the project has one, the list shows what the product gives
 * under the empty table - its showcase (Components/ResourceShowcase), with
 * the list's Add button, which opens the setup guide - and the page keeps
 * watching for the first one. React-free, so App tests can read it;
 * useFirstRecordWatch is the hook.
 */

/*
 * How often an empty list asks again whether its first record has arrived.
 * Agents report within a minute of starting, and the guide says so.
 */
export const FIRST_RECORD_POLL_INTERVAL_MS: number = 10 * 1000;

/*
 * Under the title of a setup guide shown on an empty list (Cloud > All
 * Resources folds one under its Connect tiles). The empty table above it
 * says what the list is ("No cloud resources discovered yet" and the list's
 * description), so the guide says only what to do, and that nothing more is
 * needed after.
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
 * What sits over the table (its filter chips) while the project has none of
 * this resource: nothing - there is nothing to filter yet, and the showcase
 * under the table is the one thing to read. The chips come back with the
 * first record.
 */
export function getFirstRunTopContent<T>(data: {
  topContent: T;
  count: number | null;
}): T | undefined {
  return isWatchingForFirstRecord(data.count) ? undefined : data.topContent;
}

/*
 * The empty table's options while the project has none of this resource:
 * it does not repeat the list's Create button - the showcase under it has
 * the list's Add button (the setup guide, or the create form where adding
 * one by hand is the way to connect: a vCenter through a probe, a database
 * or queue endpoint), and the card header keeps its own. Once there are
 * records, the table's empty state is its own again (a search that finds
 * nothing).
 */
export function getFirstRunEmptyState(data: {
  emptyState: EmptyStateOptions | undefined;
  count: number | null;
}): EmptyStateOptions {
  const emptyState: EmptyStateOptions = data.emptyState || {};

  if (!isWatchingForFirstRecord(data.count)) {
    return emptyState;
  }

  return { ...emptyState, hideCreateButton: true };
}
