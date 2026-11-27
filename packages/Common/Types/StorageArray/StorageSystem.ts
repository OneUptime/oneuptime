/*
 * The storage platforms OneUptime ships, by the value that names each.
 *
 * The value is what the OneUptime Storage Array Agent stamps in the
 * `storage.system` resource attribute and what StorageArray.storageSystem
 * stores. It follows the OpenTelemetry `db.system.name` style: the vendor,
 * a dot, then the product (`aws.dynamodb`, `microsoft.sql_server`).
 *
 * Everything else about a platform - its names and aliases, the metrics it
 * reads, its inventory kinds, catalog and templates - is its
 * StorageArrayPlatform (Platforms/<Vendor>/<Product>/), listed in
 * Platforms/StorageArrayPlatforms.ts. StorageSystemUtil answers from that
 * registry, so a platform registered there is known everywhere, whether
 * or not it has a value here: a platform adds its value to this enum only
 * so its own code can name it.
 *
 * This file imports nothing on purpose: platform definitions import it, and
 * it must never lead back to the registry that imports them (see
 * StorageArrayPlatformImportsGuard.test.ts).
 *
 * Pure Storage renamed itself Everpure in February 2026. FlashArray and
 * FlashBlade kept their names, as did their metric namespaces, so the
 * values keep the name every operator knows; the `everpure.*` spellings are
 * accepted as aliases.
 */
enum StorageSystem {
  PureStorageFlashArray = "purestorage.flasharray",
  PureStorageFlashBlade = "purestorage.flashblade",
  DellPowerStore = "dell.powerstore",
}

export default StorageSystem;
