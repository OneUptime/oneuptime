/*
 * The kinds of object a storage array's inventory holds
 * (StorageArrayResource.kind), in singular PascalCase like CephResource's
 * `Osd` / `Pool`. Stored as plain strings, so adding a kind never needs a
 * migration.
 *
 * These are the kinds more than one platform can share: a NetApp volume and
 * a Pure volume are both a Volume, and look and alert alike. A kind only one
 * platform has (NetApp's aggregates, PowerScale's quotas) need not be added
 * here: its platform declares it, with its words, in its own
 * StorageArrayPlatform.kindDefinitions. Which kinds a platform reports, and
 * their words, are answered by StorageArrayResourceKindUtil.
 *
 * This file imports nothing on purpose: platform definitions import it, and
 * it must never lead back to the registry that imports them (see
 * StorageArrayPlatformImportsGuard.test.ts).
 */
enum StorageArrayResourceKind {
  Volume = "Volume",
  Host = "Host",
  Pod = "Pod",
  Hardware = "Hardware",
  Drive = "Drive",
  Controller = "Controller",
  NetworkInterface = "NetworkInterface",
  Directory = "Directory",
  FileSystem = "FileSystem",
  Bucket = "Bucket",
}

export default StorageArrayResourceKind;
