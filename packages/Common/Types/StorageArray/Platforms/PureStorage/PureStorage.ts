import { StorageArrayResourceScope } from "../../../Monitor/MonitorStepStorageArrayMonitor";
import { translationKey } from "../../../Translator";

/*
 * What Pure Storage's two platforms, FlashArray and FlashBlade, share: the
 * vendor, the semantic conventions of their exporters (an object's name in
 * a `name` label, a host's in `host`), and the words their pages use about
 * Pure's own tools.
 *
 * Pure Storage renamed itself Everpure in February 2026. FlashArray,
 * FlashBlade, Purity and the purefa_ / purefb_ metric namespaces kept their
 * names, so the platforms keep the names every operator knows; the
 * `everpure.*` spellings are accepted as aliases.
 */

export const PURE_STORAGE_VENDOR_NAME: string = "Pure Storage";

/*
 * The label that names one object of each scope on Pure's series. Replica
 * link series name their pod `local_pod` and a FlashBlade's hardware is
 * named by `name`: those are each catalog entry's and platform's own.
 */
export const PURE_STORAGE_OBJECT_LABELS: Readonly<
  Partial<Record<StorageArrayResourceScope, string>>
> = {
  [StorageArrayResourceScope.Host]: "host",
  [StorageArrayResourceScope.Hardware]: "component_name",
  [StorageArrayResourceScope.Volume]: "name",
  [StorageArrayResourceScope.Pod]: "name",
  [StorageArrayResourceScope.FileSystem]: "name",
  [StorageArrayResourceScope.Bucket]: "name",
};

// The Overview's Capacity Used panel, on either platform.
export const PURE_STORAGE_CAPACITY_USED_DESCRIPTION: string = translationKey(
  "Share of the array's usable capacity in use. Pure raises its own capacity alerts at 80%, 90% and 100%.",
);

// The Active Alerts card, when the alerts' details cannot be read.
export const PURE_STORAGE_ALERT_DETAILS_UNAVAILABLE: string = translationKey(
  "Alert details are unavailable right now. Open Pure1 or run purealert list on the array for the full list.",
);
