/*
 * WHAT A MANAGED DEVICE RUNS (#9837).
 *
 * Esper enrolled Android devices only until it managed Apple's too, and
 * Intune, Workspace ONE and SOTI MobiControl manage phones, tablets and
 * computers of every kind. Each read keeps a device's platform
 * (ManagedDevice.platform), which decides:
 *
 *   - its operating system in Inventory (the host's `os.name`): "Android",
 *     "iOS", "iPadOS", "macOS", "Windows" - what every machine in Inventory
 *     is described by (InventoryAssetDetails);
 *   - how long it may go without checking in before it is offline
 *     (ManagedDeviceStatus): an Esper Android device sends a heartbeat every
 *     few minutes, an iPad checks in when Apple's push wakes it, hours
 *     apart, and Esper says so of its own Apple devices;
 *   - which device facts mean anything: the security patch level is
 *     Android's alone.
 *
 * A row written before the platform was kept has none: every device then
 * was an Esper Android device, so no platform reads as Android.
 */

export enum ManagedDevicePlatform {
  Android = "android",
  // An iPhone or an iPod touch.
  IOS = "ios",
  IPadOS = "ipados",
  TvOS = "tvos",
  MacOS = "macos",
  Windows = "windows",
  Linux = "linux",
  // A platform OneUptime does not name: its operating system is the service's word for it.
  Other = "other",
}

export const MANAGED_DEVICE_PLATFORMS: ReadonlyArray<ManagedDevicePlatform> =
  Object.values(ManagedDevicePlatform);

export function isManagedDevicePlatform(
  value: unknown,
): value is ManagedDevicePlatform {
  return (
    typeof value === "string" &&
    (MANAGED_DEVICE_PLATFORMS as ReadonlyArray<string>).includes(value)
  );
}

// The platform a stored value names: none (a row written before the platform was kept) is Android.
export function readManagedDevicePlatform(
  value: unknown,
): ManagedDevicePlatform {
  if (value === undefined || value === null || value === "") {
    return ManagedDevicePlatform.Android;
  }

  return isManagedDevicePlatform(value) ? value : ManagedDevicePlatform.Other;
}

/*
 * The operating system's name, as its maker writes it: what a device's host
 * in Inventory says it runs (os.name). A product name, the same in every
 * language.
 */
export const MANAGED_DEVICE_OPERATING_SYSTEM_NAMES: Readonly<
  Record<Exclude<ManagedDevicePlatform, ManagedDevicePlatform.Other>, string>
> = {
  [ManagedDevicePlatform.Android]: "Android",
  [ManagedDevicePlatform.IOS]: "iOS",
  [ManagedDevicePlatform.IPadOS]: "iPadOS",
  [ManagedDevicePlatform.TvOS]: "tvOS",
  [ManagedDevicePlatform.MacOS]: "macOS",
  [ManagedDevicePlatform.Windows]: "Windows",
  [ManagedDevicePlatform.Linux]: "Linux",
};

/*
 * The operating system a device runs: its platform's name, or - for a
 * platform OneUptime does not name - the service's own word for it, as the
 * read kept it ("" when it gave none).
 */
export function getManagedDeviceOperatingSystemName(data: {
  platform: unknown;
  serviceOperatingSystem?: string | undefined | null;
}): string {
  const platform: ManagedDevicePlatform = readManagedDevicePlatform(
    data.platform,
  );

  if (platform === ManagedDevicePlatform.Other) {
    return (data.serviceOperatingSystem || "").trim();
  }

  return MANAGED_DEVICE_OPERATING_SYSTEM_NAMES[platform];
}

// Apple's platforms: a device that checks in when Apple's push service wakes it.
const APPLE_PLATFORMS: ReadonlySet<ManagedDevicePlatform> =
  new Set<ManagedDevicePlatform>([
    ManagedDevicePlatform.IOS,
    ManagedDevicePlatform.IPadOS,
    ManagedDevicePlatform.TvOS,
    ManagedDevicePlatform.MacOS,
  ]);

export function isAppleManagedDevicePlatform(platform: unknown): boolean {
  return APPLE_PLATFORMS.has(readManagedDevicePlatform(platform));
}

/*
 * The platform an operating system's name says, as the services write it:
 * Esper's "iOS", "iPadOS", "tvOS"; Intune's "Android", "AndroidEnterprise",
 * "iOS", "iPadOS", "macOS", "Windows", "Linux"; Workspace ONE's and SOTI's
 * names too ("Apple", "AppleOsX", "WinRT", "Windows Desktop"). Read without
 * case, spaces or punctuation, so "Mac OS X" and "macOS" are one. Other for
 * a name it does not know, and for none.
 */
export function readManagedDevicePlatformFromName(
  value: unknown,
): ManagedDevicePlatform {
  if (typeof value !== "string") {
    return ManagedDevicePlatform.Other;
  }

  let name: string = "";

  for (const character of value.toLowerCase()) {
    if (
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9")
    ) {
      name += character;
    }
  }

  if (!name) {
    return ManagedDevicePlatform.Other;
  }

  if (name.startsWith("android")) {
    return ManagedDevicePlatform.Android;
  }

  if (name === "ipados" || name === "ipad") {
    return ManagedDevicePlatform.IPadOS;
  }

  if (
    name === "ios" ||
    name === "iphone" ||
    name === "ipod" ||
    name === "iphoneos" ||
    name === "apple"
  ) {
    return ManagedDevicePlatform.IOS;
  }

  if (name === "tvos" || name === "appletv") {
    return ManagedDevicePlatform.TvOS;
  }

  if (
    name === "macos" ||
    name === "macosx" ||
    name === "osx" ||
    name === "appleosx" ||
    name === "mac"
  ) {
    return ManagedDevicePlatform.MacOS;
  }

  if (name.startsWith("windows") || name === "winrt" || name === "win") {
    return ManagedDevicePlatform.Windows;
  }

  if (name.startsWith("linux")) {
    return ManagedDevicePlatform.Linux;
  }

  return ManagedDevicePlatform.Other;
}
