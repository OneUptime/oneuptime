/*
 * NAMING RULES FOR NETWORK DEVICES (OneUptime issue #6619).
 *
 * Discovery names a device by what it finds: its SNMP name, its NetBIOS
 * name, its DNS name, or its address (Utils/NetworkDevice/DeviceNameRule).
 * An estate that names its devices by a convention of its own - "UN1216
 * MNUPLR01" is the menu player of unit 1216 - got a list of "Samsung",
 * "dmb-5" and bare addresses, and renamed every device by hand.
 *
 * A naming rule says what the devices it matches are called: which devices
 * (conditions on their address, MAC, vendor, discovered name and site) and a
 * name pattern ("UN{site.code}MNUPLR{nn}"). Rules are kept in order, and the
 * first rule that matches a device and can fill in its pattern names it. An
 * import names each device it creates that way, the name discovery found is
 * kept as the device's Discovered Name, and the same rules can be applied to
 * the devices already in the project, after a preview of every rename.
 *
 * These are the shapes the server, the workers and the Dashboard share.
 * React-free and database-free, so every rule is tested on its own.
 */

/*
 * What a rule's lookup table is keyed by: the value of the device a table
 * row is looked up with. The customer's table (issue #6619) maps the last
 * number of each device's address in a unit's subnet to its role - .51 is
 * the menu player, .151 the left screen - so the last part of the address
 * comes first.
 */
export enum NamingLookupKey {
  LastIpOctet = "lastIpOctet",
  IpAddress = "ipAddress",
  MacAddress = "macAddress",
  DiscoveredName = "discoveredName",
}

export const ALL_NAMING_LOOKUP_KEYS: ReadonlyArray<NamingLookupKey> = [
  NamingLookupKey.LastIpOctet,
  NamingLookupKey.IpAddress,
  NamingLookupKey.MacAddress,
  NamingLookupKey.DiscoveredName,
];

export function isNamingLookupKey(value: unknown): value is NamingLookupKey {
  return (
    typeof value === "string" &&
    (ALL_NAMING_LOOKUP_KEYS as ReadonlyArray<string>).includes(value)
  );
}

// One row of a rule's lookup table: the device's value, and what it stands for.
export interface NamingLookupEntry {
  key: string;
  value: string;
}

/*
 * The longest a lookup table may be. A table maps the positions of one kind
 * of site, or the MACs of an asset list: hundreds of rows at most. A rule is
 * read on every import, so the ceiling keeps one rule from being megabytes.
 */
export const MAX_NAMING_LOOKUP_ENTRIES: number = 5000;

// The longest a lookup row's key and value may be.
export const MAX_NAMING_LOOKUP_KEY_LENGTH: number = 100;
export const MAX_NAMING_LOOKUP_VALUE_LENGTH: number = 80;

// The longest a name pattern may be (it is stored as LongText).
export const MAX_NAME_PATTERN_LENGTH: number = 255;

/*
 * What the naming rules made of one device.
 *
 *  - Named: a rule gives it a name - for a device being imported, the name
 *    it is created under; for one already in the project, a new name.
 *  - FollowsRules: a device already in the project is already called what
 *    the rules call it (with a counter, any free number of the pattern).
 *  - NoMatchingRule: no enabled rule matches it, so it keeps the name it has
 *    (or, being imported, the name discovery found).
 *  - MissingValue: a rule matches it, but the device lacks a value the
 *    rule's pattern needs - no site code, no MAC, no row in the lookup
 *    table - and no rule after it could name it either.
 *  - NameTaken: a rule names it, but another device already has that name
 *    and the pattern has no counter to make it unique.
 *  - NameTooLong: the name the rule gives it is longer than a device name
 *    may be.
 */
export enum DeviceNamingOutcome {
  Named = "Named",
  FollowsRules = "FollowsRules",
  NoMatchingRule = "NoMatchingRule",
  MissingValue = "MissingValue",
  NameTaken = "NameTaken",
  NameTooLong = "NameTooLong",
}

export const ALL_DEVICE_NAMING_OUTCOMES: ReadonlyArray<DeviceNamingOutcome> = [
  DeviceNamingOutcome.Named,
  DeviceNamingOutcome.FollowsRules,
  DeviceNamingOutcome.NoMatchingRule,
  DeviceNamingOutcome.MissingValue,
  DeviceNamingOutcome.NameTaken,
  DeviceNamingOutcome.NameTooLong,
];

export function isDeviceNamingOutcome(
  value: unknown,
): value is DeviceNamingOutcome {
  return (
    typeof value === "string" &&
    (ALL_DEVICE_NAMING_OUTCOMES as ReadonlyArray<string>).includes(value)
  );
}

/*
 * One device's answer, as the planner gives it and the API hands it over.
 * `missing` is the placeholder the device had no value for, written as the
 * pattern writes it ("site.code"); `takenName` is the name another device
 * already has.
 */
export interface DeviceNamingResult {
  outcome: DeviceNamingOutcome;
  name?: string | undefined;
  ruleId?: string | undefined;
  ruleName?: string | undefined;
  missing?: string | undefined;
  takenName?: string | undefined;
}

/*
 * THE IMPORT'S PREVIEW (Review Results and Add to Monitoring): for each host
 * being chosen, the name it will be created under. Keyed like the import's
 * own results (getDiscoveryImportHostKey): the address for a scan's host,
 * "endpoint:<id>" for a discovered device.
 */
export interface DeviceNamingPreviewItem extends DeviceNamingResult {
  key: string;
  // The name discovery found: what the device is called without the rules.
  discoveredName: string;
}

export interface DeviceNamingPreview {
  // The project has at least one enabled naming rule.
  hasRules: boolean;
  items: Array<DeviceNamingPreviewItem>;
}

/*
 * APPLYING THE RULES TO DEVICES ALREADY IN THE PROJECT: every device that
 * does not follow the rules, with what it would be called.
 */
export interface DeviceNamingPlanItem extends DeviceNamingResult {
  deviceId: string;
  currentName: string;
  /*
   * The device's name was typed by a person: it is neither the name
   * discovery gave it nor the name a naming rule gave it. Such a device is
   * listed, but left unticked: renaming what someone chose is their call.
   */
  isNamedByPerson: boolean;
}

export interface DeviceNamingPlan {
  hasRules: boolean;
  // Every device the plan looked at.
  devicesChecked: number;
  // The devices that do not follow the rules: Named and every problem.
  items: Array<DeviceNamingPlanItem>;
  // The devices that already follow the rules.
  followingCount: number;
  // The plan stopped at the limit: more devices were left unchecked.
  isTruncated: boolean;
}

// How many devices one plan checks. A project with more is planned per selection.
export const MAX_DEVICES_PER_NAMING_PLAN: number = 20000;

// How many renames one apply carries.
export const MAX_RENAMES_PER_NAMING_APPLY: number = 5000;

export interface DeviceNamingRename {
  deviceId: string;
  // The name the person saw: a device renamed since is left alone.
  fromName: string;
  // The name the person confirmed: applied only if the rules still give it.
  toName: string;
}

export interface DeviceNamingApplyResult {
  renamed: number;
  skipped: Array<{ deviceId: string; reason: string }>;
}

// The reasons an apply leaves a device alone, worded once for the tests.
export const NAMING_APPLY_DEVICE_GONE_REASON: string =
  "The device was deleted, or is no longer in this project.";
export const NAMING_APPLY_NAME_CHANGED_REASON: string =
  "The device was renamed since the preview, so it was left alone.";
export const NAMING_APPLY_RULES_CHANGED_REASON: string =
  "The naming rules give this device another name now. Preview again to see it.";

/*
 * The device's name, its discovered name and its rule-given name: which of
 * them is the one it has. True when the name was typed by a person - it is
 * neither what discovery recorded nor what a naming rule gave it. A device
 * with neither record was added by hand, so its name is a person's too.
 */
export function isDeviceNamedByPerson(device: {
  name?: unknown;
  discoveredName?: unknown;
  ruleAssignedName?: unknown;
}): boolean {
  const name: string = typeof device.name === "string" ? device.name.trim() : "";

  if (!name) {
    return false;
  }

  const discoveredName: string =
    typeof device.discoveredName === "string"
      ? device.discoveredName.trim()
      : "";
  const ruleAssignedName: string =
    typeof device.ruleAssignedName === "string"
      ? device.ruleAssignedName.trim()
      : "";

  return name !== discoveredName && name !== ruleAssignedName;
}

/*
 * True when the device is still called exactly what a naming rule called it
 * - so the rules, not a person, decide its name, and discovery leaves it
 * alone (DiscoveredNameUpgrade, RunImportedDeviceNaming).
 */
export function isDeviceStillNamedByRule(device: {
  name?: unknown;
  ruleAssignedName?: unknown;
}): boolean {
  if (
    typeof device.name !== "string" ||
    typeof device.ruleAssignedName !== "string"
  ) {
    return false;
  }

  const name: string = device.name.trim();

  return Boolean(name) && name === device.ruleAssignedName.trim();
}

/*
 * READING THE SERVER'S ANSWERS. The Dashboard reads every answer through
 * these, so an answer from a newer server - an outcome this build does not
 * know, a field missing - is read as what it can be, never drawn as
 * something it is not: an item with an unknown outcome is dropped.
 */
function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function readDeviceNamingResult(
  value: unknown,
): DeviceNamingResult | null {
  const record: Record<string, unknown> = readRecord(value);

  if (!isDeviceNamingOutcome(record["outcome"])) {
    return null;
  }

  const result: DeviceNamingResult = { outcome: record["outcome"] };

  for (const key of [
    "name",
    "ruleId",
    "ruleName",
    "missing",
    "takenName",
  ] as const) {
    const text: string | undefined = readOptionalString(record[key]);

    if (text) {
      result[key] = text;
    }
  }

  return result;
}

export function readDeviceNamingPreview(value: unknown): DeviceNamingPreview {
  const record: Record<string, unknown> = readRecord(value);
  const items: Array<DeviceNamingPreviewItem> = [];

  if (Array.isArray(record["items"])) {
    for (const item of record["items"]) {
      const result: DeviceNamingResult | null = readDeviceNamingResult(item);
      const itemRecord: Record<string, unknown> = readRecord(item);
      const key: string | undefined = readOptionalString(itemRecord["key"]);

      if (!result || !key) {
        continue;
      }

      items.push({
        ...result,
        key: key,
        discoveredName: readOptionalString(itemRecord["discoveredName"]) || "",
      });
    }
  }

  return { hasRules: record["hasRules"] === true, items: items };
}

export function readDeviceNamingPlan(value: unknown): DeviceNamingPlan {
  const record: Record<string, unknown> = readRecord(value);
  const items: Array<DeviceNamingPlanItem> = [];

  if (Array.isArray(record["items"])) {
    for (const item of record["items"]) {
      const result: DeviceNamingResult | null = readDeviceNamingResult(item);
      const itemRecord: Record<string, unknown> = readRecord(item);
      const deviceId: string | undefined = readOptionalString(
        itemRecord["deviceId"],
      );

      if (!result || !deviceId) {
        continue;
      }

      items.push({
        ...result,
        deviceId: deviceId,
        currentName: readOptionalString(itemRecord["currentName"]) || "",
        isNamedByPerson: itemRecord["isNamedByPerson"] === true,
      });
    }
  }

  return {
    hasRules: record["hasRules"] === true,
    devicesChecked: readCount(record["devicesChecked"]),
    items: items,
    followingCount: readCount(record["followingCount"]),
    isTruncated: record["isTruncated"] === true,
  };
}

export function readDeviceNamingApplyResult(
  value: unknown,
): DeviceNamingApplyResult {
  const record: Record<string, unknown> = readRecord(value);
  const skipped: Array<{ deviceId: string; reason: string }> = [];

  if (Array.isArray(record["skipped"])) {
    for (const item of record["skipped"]) {
      const itemRecord: Record<string, unknown> = readRecord(item);
      const deviceId: string | undefined = readOptionalString(
        itemRecord["deviceId"],
      );

      if (deviceId) {
        skipped.push({
          deviceId: deviceId,
          reason: readOptionalString(itemRecord["reason"]) || "",
        });
      }
    }
  }

  return { renamed: readCount(record["renamed"]), skipped: skipped };
}

/*
 * The renames a plan's ticked devices ask for: the Named ones, each with
 * the name it has and the name the rules give it.
 */
export function getRenamesForPlanItems(
  items: ReadonlyArray<DeviceNamingPlanItem>,
  selectedDeviceIds: ReadonlySet<string>,
): Array<DeviceNamingRename> {
  const renames: Array<DeviceNamingRename> = [];

  for (const item of items) {
    if (
      item.outcome !== DeviceNamingOutcome.Named ||
      !item.name ||
      !selectedDeviceIds.has(item.deviceId)
    ) {
      continue;
    }

    renames.push({
      deviceId: item.deviceId,
      fromName: item.currentName,
      toName: item.name,
    });
  }

  return renames;
}

/*
 * The devices ticked when a plan opens: every one the rules rename, except
 * the ones a person named - renaming what someone chose is their call.
 */
export function getInitialPlanSelection(
  items: ReadonlyArray<DeviceNamingPlanItem>,
): Set<string> {
  const selected: Set<string> = new Set<string>();

  for (const item of items) {
    if (item.outcome === DeviceNamingOutcome.Named && !item.isNamedByPerson) {
      selected.add(item.deviceId);
    }
  }

  return selected;
}
