import { MAX_DEVICE_NAME_LENGTH } from "./DiscoveredDeviceBuilder";
import { normalizeReverseDnsName } from "./ReverseDnsNameUtil";
import { getShortHostname } from "./ShortHostnameUtil";

/*
 * What the Devices list's bulk "Shorten names to hostname" action does to each
 * selected device (OneUptime issue #3678).
 *
 * The scan setting fixes devices discovery imports from now on. It does
 * nothing for the hundreds already in a project under their full DNS names,
 * and re-importing does not rename them either — a host whose address is
 * already registered is skipped, by design. Editing each one by hand is what
 * the issue was filed about, so the action exists, and this is its decision
 * logic: pure, so every rule below is tested without a dashboard.
 */

// The device fields the plan reads. NetworkDevice rows satisfy it.
export interface ShortenableDevice {
  id: string;
  name?: string | null | undefined;
  hostname?: string | null | undefined;
  sysName?: string | null | undefined;
  dnsName?: string | null | undefined;
}

export interface ShortDeviceNameRename {
  kind: "rename";
  id: string;
  currentName: string;
  newName: string;
  /*
   * The full name to store as the device's DNS name, when the device has none
   * and its current name is one. Absent when there is nothing to store.
   */
  dnsName?: string | undefined;
}

export interface ShortDeviceNameSkip {
  kind: "skip";
  id: string;
  currentName: string;
  reason: string;
}

export type ShortDeviceNamePlan = ShortDeviceNameRename | ShortDeviceNameSkip;

export const SKIPPED_NO_NAME_MESSAGE: string =
  "Skipped: the device has no name to shorten.";

export const SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE: string =
  "Skipped: the name is not a fully qualified hostname, so there is no domain to remove.";

/*
 * The collision-fallback suffix import appends — " (10.0.0.5)" — split off
 * the name so a device imported as "kds01.wbhq.com (10.0.0.5)" can still be
 * shortened.
 *
 * Only when the bracketed text is exactly the device's own hostname. That is
 * the one shape DiscoveredDeviceBuilder.buildFallbackDeviceName produces, and
 * anything else in brackets — "core-sw (rack 4)", an old address after the
 * device was re-addressed — is an operator's text that this action has no
 * business reinterpreting.
 */
export function splitAddressSuffix(data: {
  name: string;
  hostname?: string | null | undefined;
}): { baseName: string; addressSuffix?: string | undefined } {
  const hostname: string =
    typeof data.hostname === "string" ? data.hostname.trim() : "";

  if (!hostname) {
    return { baseName: data.name };
  }

  const suffix: string = ` (${hostname})`;

  if (data.name.length > suffix.length && data.name.endsWith(suffix)) {
    return {
      baseName: data.name.substring(0, data.name.length - suffix.length),
      addressSuffix: suffix,
    };
  }

  return { baseName: data.name };
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.substring(0, maxLength) : value;
}

/**
 * The plan for one device, on its own — no knowledge of the rest of the
 * selection. `planShortDeviceNames` adds that.
 */
export function planShortDeviceName(
  device: ShortenableDevice,
): ShortDeviceNamePlan {
  const currentName: string =
    typeof device.name === "string" ? device.name.trim() : "";

  if (!currentName) {
    return {
      kind: "skip",
      id: device.id,
      currentName: currentName,
      reason: SKIPPED_NO_NAME_MESSAGE,
    };
  }

  const split: { baseName: string; addressSuffix?: string | undefined } =
    splitAddressSuffix({ name: currentName, hostname: device.hostname });

  const shortName: string | undefined = getShortHostname(split.baseName);

  if (!shortName) {
    return {
      kind: "skip",
      id: device.id,
      currentName: currentName,
      reason: SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE,
    };
  }

  /*
   * A suffixed name keeps its suffix: it was address-qualified because the
   * plain name was already taken, and the short name is even more likely to
   * be. The short part is clamped so the whole still fits the import ceiling.
   */
  const suffix: string = split.addressSuffix || "";

  const newName: string = truncate(
    truncate(shortName, Math.max(1, MAX_DEVICE_NAME_LENGTH - suffix.length)) +
      suffix,
    MAX_DEVICE_NAME_LENGTH,
  );

  const plan: ShortDeviceNameRename = {
    kind: "rename",
    id: device.id,
    currentName: currentName,
    newName: newName,
  };

  const dnsName: string | undefined = getDnsNameToKeep({
    device: device,
    currentName: currentName,
    baseName: split.baseName,
  });

  if (dnsName) {
    plan.dnsName = dnsName;
  }

  return plan;
}

/*
 * Whether the full name being cut away should be kept as the device's DNS
 * name — so the action does not destroy the one copy of the FQDN, which is
 * what the issue's follow-up comment asked for, and so a site rule matching
 * that FQDN still sees it afterwards.
 *
 * Every condition below guards a way the old name might NOT be a DNS name, or
 * might not be whole:
 *
 *   - The device already has a DNS name. That one came from a PTR record, and
 *     it is never overwritten with an inference.
 *   - The name equals the device's sysName. Then it is the name the device
 *     calls itself, it is still stored as sysName, and nothing is lost.
 *   - The name is at the import ceiling. DiscoveredDeviceBuilder clamps names
 *     to MAX_DEVICE_NAME_LENGTH, so a name that long may be a cut-off FQDN,
 *     and storing half a name as a DNS name would be inventing one. The rename
 *     still happens — a first label is at most 63 characters, so it survives
 *     any clamp intact.
 *
 * What is left over is a hand-typed FQDN-shaped name, which is stored as a DNS
 * name too. That is judged acceptable: it is a DNS-shaped name the operator
 * chose, and the column's description says where its value may come from.
 */
function getDnsNameToKeep(data: {
  device: ShortenableDevice;
  currentName: string;
  baseName: string;
}): string | undefined {
  const existingDnsName: string =
    typeof data.device.dnsName === "string" ? data.device.dnsName.trim() : "";

  if (existingDnsName) {
    return undefined;
  }

  const sysName: string =
    typeof data.device.sysName === "string"
      ? data.device.sysName.trim().toLowerCase()
      : "";

  if (sysName && sysName === data.baseName.trim().toLowerCase()) {
    return undefined;
  }

  if (data.currentName.length >= MAX_DEVICE_NAME_LENGTH) {
    return undefined;
  }

  return normalizeReverseDnsName(data.baseName);
}

export function buildInBatchCollisionMessage(data: {
  newName: string;
  otherNames: Array<string>;
}): string {
  const listed: string = data.otherNames
    .slice(0, 3)
    .map((name: string) => {
      return `"${name}"`;
    })
    .join(", ");

  const more: number = data.otherNames.length - 3;

  return `Skipped: ${listed}${more > 0 ? ` and ${more} more` : ""} would also be renamed "${data.newName}", and two devices cannot share a name. Rename them individually.`;
}

/**
 * The plan for a whole selection.
 *
 * On top of the per-device rules, two selected devices that would end up with
 * the SAME short name — "kds01.store-1.example.com" and
 * "kds01.store-2.example.com" — are BOTH skipped, each naming the other.
 * Renaming the first and refusing the second would make the outcome depend on
 * the order the table happened to be sorted in, and the device that kept its
 * long name would be an accident. Compared without case, because device name
 * uniqueness is case-insensitive.
 *
 * Collisions with devices OUTSIDE the selection are not visible here; the
 * action checks those against the server, device by device.
 */
export function planShortDeviceNames(
  devices: Array<ShortenableDevice>,
): Array<ShortDeviceNamePlan> {
  const plans: Array<ShortDeviceNamePlan> = devices.map(
    (device: ShortenableDevice) => {
      return planShortDeviceName(device);
    },
  );

  const renamesByName: Map<string, Array<ShortDeviceNameRename>> = new Map<
    string,
    Array<ShortDeviceNameRename>
  >();

  for (const plan of plans) {
    if (plan.kind !== "rename") {
      continue;
    }

    const key: string = plan.newName.toLowerCase();
    const group: Array<ShortDeviceNameRename> = renamesByName.get(key) || [];
    group.push(plan);
    renamesByName.set(key, group);
  }

  return plans.map((plan: ShortDeviceNamePlan) => {
    if (plan.kind !== "rename") {
      return plan;
    }

    const group: Array<ShortDeviceNameRename> =
      renamesByName.get(plan.newName.toLowerCase()) || [];

    if (group.length < 2) {
      return plan;
    }

    return {
      kind: "skip",
      id: plan.id,
      currentName: plan.currentName,
      reason: buildInBatchCollisionMessage({
        newName: plan.newName,
        otherNames: group
          .filter((other: ShortDeviceNameRename) => {
            return other !== plan;
          })
          .map((other: ShortDeviceNameRename) => {
            return other.currentName;
          }),
      }),
    };
  });
}
