import { TrafficSide } from "./MerakiUrlState";
import LocalStorage from "Common/UI/Utils/LocalStorage";

/*
 * THE SIDE A READER PICKED, REMEMBERED (issue #5762).
 *
 * "Allow users to switch between Flows and Meraki manually, with a
 * configurable default preference": the switch is the setting. A click on
 * Flows or Meraki is kept in this browser, per project and per kind of page
 * - the network's, a site's, a device's - and the next such page opens there
 * (MerakiUrlState.pickTrafficSide: after a link that names a side, and only
 * while the side has something to show). No settings page to find: a
 * project's Traffic pages open where its people look.
 *
 * Per kind of page, because they differ: one may read the network's
 * traffic from Meraki and a router's from the flow records it exports.
 *
 * A per-reader convenience, so the browser's storage: a private window,
 * blocked site data or anything unreadable stored reads as no choice, and
 * the page picks for itself.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

export type TrafficPageKind = "device" | "site" | "network";

export function getTrafficSideStorageKey(
  projectId: string,
  pageKind: TrafficPageKind,
): string {
  return `network-traffic-side-${projectId}-${pageKind}`;
}

export function readRememberedTrafficSide(
  projectId: string | null | undefined,
  pageKind: TrafficPageKind,
): TrafficSide | null {
  if (!projectId) {
    return null;
  }

  try {
    const stored: unknown = LocalStorage.getItem(
      getTrafficSideStorageKey(projectId, pageKind),
    );

    if (stored === TrafficSide.Flows || stored === TrafficSide.Meraki) {
      return stored;
    }

    return null;
  } catch {
    return null;
  }
}

export function rememberTrafficSide(
  projectId: string | null | undefined,
  pageKind: TrafficPageKind,
  side: TrafficSide,
): void {
  if (!projectId) {
    return;
  }

  try {
    LocalStorage.setItem(getTrafficSideStorageKey(projectId, pageKind), side);
  } catch {
    // Not remembering the choice is fine: the switch still works.
  }
}
