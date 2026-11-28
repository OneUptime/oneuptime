import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The array's status words as each language says them. A word the array
 * writes and this list lacks is drawn as the array writes it - a replica
 * link's Replicating, Baselining or Paused among them, as its tooltip
 * names them.
 *
 * A module of its own, with nothing but the words: the dashboard's storage
 * array widgets word a component's status by this list, and a public
 * dashboard loads them before it draws. Read from StorageArrayHealth, which
 * exports it as before, they brought the rules' platform registry with them,
 * and with it every platform's metrics and alert templates, which no widget
 * reads (packages/Common/Scripts/first-load-budgets.js).
 */
const STATUS_WORDS: Record<string, string> = {
  ok: translationKey("OK"),
  healthy: translationKey("Healthy"),
  ready: translationKey("Ready"),
  enabled: translationKey("Enabled"),
  online: translationKey("Online"),
  critical: translationKey("Critical"),
  failed: translationKey("Failed"),
  missing: translationKey("Missing"),
  unhealthy: translationKey("Unhealthy"),
  degraded: translationKey("Degraded"),
  unknown: translationKey("Unknown"),
  unrecognized: translationKey("Unrecognized"),
  "not ready": translationKey("Not Ready"),
  not_installed: translationKey("Not Installed"),
  device_off: translationKey("Device Off"),
  identifying: translationKey("Identifying"),
  empty: translationKey("Empty"),
  unused: translationKey("Unused"),
  disabled: translationKey("Disabled"),
  // NetApp ONTAP's words for its parts' states.
  offline: translationKey("Offline"),
  restricted: translationKey("Restricted"),
  inconsistent: translationKey("Inconsistent"),
  mixed: translationKey("Mixed"),
  running: translationKey("Running"),
  stopped: translationKey("Stopped"),
  starting: translationKey("Starting"),
  stopping: translationKey("Stopping"),
  // An Ethernet port's link, never a machine that is down (MeaningKeys).
  up: translationKey("Up (port link)"),
  down: translationKey("Down (port link)"),
  broken: translationKey("Broken"),
  spare: translationKey("Spare"),
  // A disk no node owns yet, never a case nobody has taken (MeaningKeys).
  unassigned: translationKey("Unassigned (disk not owned by a node)"),
  normal: translationKey("Normal"),
  error: translationKey("Error"),
  "critical-low": translationKey("Critical Low"),
  "critical-high": translationKey("Critical High"),
  "warning-low": translationKey("Warning Low"),
  "warning-high": translationKey("Warning High"),
  offlined_by_system: translationKey("Offlined by System"),
  link_not_connected: translationKey("Link Not Connected"),
  snapmirrored: translationKey("Snapmirrored"),
  "broken-off": translationKey("Broken Off"),
  uninitialized: translationKey("Uninitialized"),
  idle: translationKey("Idle"),
  transferring: translationKey("Transferring"),
};

/*
 * The key of a status word the rules know - "degraded" is "Degraded",
 * however the array cases or pads it - or undefined for a word this list
 * lacks, which is drawn as the array writes it. The dashboard's storage
 * array widgets word a component's status by this list too (#7521), so a
 * part reads the same on a board as on its array's pages. Only the list's
 * own words count: "constructor" or "toString" from an array is a word it
 * does not know, never a function of the object the list is kept in.
 */
export function getKnownStorageArrayStatusKey(
  status: unknown,
): string | undefined {
  if (typeof status !== "string") {
    return undefined;
  }
  const normalized: string = status.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_WORDS, normalized)
    ? STATUS_WORDS[normalized]
    : undefined;
}
