import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * ADDING A NETWORK CONTROLLER'S DEVICES AS NETWORK DEVICES (the first
 * follow-up of #5392: "Create network devices from Meraki, for the devices
 * Meraki knows that OneUptime does not yet").
 *
 * A Meraki connection reads the organization's device list on every read
 * and fills in the details of the devices that are network devices here
 * (NetworkControllerInventory). The rest - the switches, access points and
 * gateways Meraki manages that nobody added - had to be added one by one
 * from Add Device, an address typed for each, and their clients had nothing
 * to hang from on the map. A connection adds them now, when asked:
 *
 *   - every read counts the organization's devices that are no network
 *     device here, by kind, with how many of them cannot be added and why
 *     (NetworkControllerReadSummary.unaddedDevices), so the connection's row
 *     can say so and offer to add them;
 *   - Add devices asks for the kinds picked to be added
 *     (POST /network-controller-connection/:id/add-devices), and a worker
 *     job lists the organization's devices again and adds every one of those
 *     kinds that is still no device here - as the person who asked, at the
 *     address Meraki manages it at, in a site named after its Meraki
 *     network, with Meraki's reading of it already in place - writing how
 *     far it got on the connection as it goes
 *     (NetworkControllerConnection.lastDeviceAdd).
 *
 * ONCE PER ASK, NOT FOR EVER. A device someone deletes stays deleted: a
 * connection that kept adding whatever Meraki lists would bring it back on
 * its next read, as an agent brings back a deleted host (#5214). A device
 * Meraki gets later is counted on the connection's row, and one press adds
 * it.
 *
 * These are the shapes the API, the worker and the Dashboard share, and the
 * rules all three read them by. React-free and database-free, so every rule
 * is tested on its own.
 */

/*
 * The kinds of Meraki device that can become network devices, in the order
 * they are listed: the switching and wireless that make up most of an
 * estate first, then the gateways, then cameras. Each is a box on the
 * network with an address of its own.
 *
 * Never offered: a sensor (it reports through a gateway and has no address
 * on the network), a Systems Manager endpoint (a laptop or phone Meraki
 * manages, not a device of the network) and Secure Connect (a cloud
 * service). They are not counted either.
 */
export const ADDABLE_CONTROLLER_PRODUCT_TYPES: ReadonlyArray<string> = [
  "switch",
  "wireless",
  "appliance",
  "cellularGateway",
  "wirelessController",
  "campusGateway",
  "camera",
];

/*
 * What Add devices starts with: the network gear. Cameras are boxes on the
 * network too, but a store can have dozens of them, and most people who
 * watch a network do not watch its cameras there: they are added when
 * someone ticks them.
 */
export const DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD: ReadonlyArray<string> =
  ADDABLE_CONTROLLER_PRODUCT_TYPES.filter((productType: string): boolean => {
    return productType !== "camera";
  });

export function isAddableControllerProductType(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    ADDABLE_CONTROLLER_PRODUCT_TYPES.includes(value)
  );
}

/*
 * Devices one ask adds at most. Each is a full create - its site, its owner
 * and label rules, its alert policies - so a few thousand already take
 * minutes; an organization with more is added over several asks, and the
 * connection says how many are left.
 */
export const MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD: number = 5000;

// ---- What a person asks for.

export interface NetworkControllerDeviceAddRequest {
  // The kinds to add (ADDABLE_CONTROLLER_PRODUCT_TYPES), at least one.
  productTypes: Array<string>;
  /*
   * Put each device in the site named after its Meraki network - the
   * project's site of that name, or a new one. Off: no site, and the
   * project's site rules place each device as they place any new one.
   */
  groupBySite: boolean;
  /*
   * The probe that pings each device, and walks it over SNMP once it has
   * credentials. None: nothing polls them (a site's default probe still
   * applies), and they show what Meraki says about them.
   */
  probeId?: string | undefined;
}

export const DEFAULT_NETWORK_CONTROLLER_DEVICE_ADD_REQUEST: NetworkControllerDeviceAddRequest =
  {
    productTypes: [...DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD],
    groupBySite: true,
  };

export const DEVICE_ADD_REQUEST_NOT_AN_OBJECT: string =
  "Say which Meraki devices to add.";
export const DEVICE_ADD_REQUEST_NO_KINDS: string =
  "Pick at least one kind of Meraki device to add.";
export const DEVICE_ADD_REQUEST_UNKNOWN_KIND: string =
  "Pick the kinds of device from the list: switch, wireless, appliance, cellularGateway, wirelessController, campusGateway or camera.";
export const DEVICE_ADD_REQUEST_GROUP_BY_SITE: string =
  "groupBySite must be true or false.";
export const DEVICE_ADD_REQUEST_PROBE: string =
  "Pick a probe from the list, or none.";

function isPlainObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * A request as a person (or an API client) sent it, checked: a kind that is
 * not one, a probe that is not an ID and a site choice that is not a yes or
 * no are refused with a sentence, never quietly dropped, so what is added is
 * what was asked for. The kinds come back once each, in the order they are
 * listed.
 */
export function readNetworkControllerDeviceAddRequest(
  value: unknown,
): NetworkControllerDeviceAddRequest {
  if (!isPlainObject(value)) {
    throw new BadDataException(DEVICE_ADD_REQUEST_NOT_AN_OBJECT);
  }

  const kinds: unknown = value["productTypes"];

  if (!Array.isArray(kinds) || kinds.length === 0) {
    throw new BadDataException(DEVICE_ADD_REQUEST_NO_KINDS);
  }

  for (const kind of kinds) {
    if (!isAddableControllerProductType(kind)) {
      throw new BadDataException(DEVICE_ADD_REQUEST_UNKNOWN_KIND);
    }
  }

  const groupBySite: unknown = value["groupBySite"];

  if (
    groupBySite !== undefined &&
    groupBySite !== null &&
    typeof groupBySite !== "boolean"
  ) {
    throw new BadDataException(DEVICE_ADD_REQUEST_GROUP_BY_SITE);
  }

  const probe: unknown = value["probeId"];
  let probeId: string | undefined = undefined;

  if (probe !== undefined && probe !== null && probe !== "") {
    if (typeof probe !== "string" || !ObjectID.isValidUUID(probe.trim())) {
      throw new BadDataException(DEVICE_ADD_REQUEST_PROBE);
    }

    probeId = probe.trim();
  }

  return {
    productTypes: ADDABLE_CONTROLLER_PRODUCT_TYPES.filter(
      (productType: string): boolean => {
        return (kinds as Array<unknown>).includes(productType);
      },
    ),
    groupBySite: groupBySite !== false,
    ...(probeId ? { probeId: probeId } : {}),
  };
}

/*
 * A request as it was stored, read without trusting it: undefined for one
 * that is not a request any more.
 */
export function readStoredNetworkControllerDeviceAddRequest(
  value: unknown,
): NetworkControllerDeviceAddRequest | undefined {
  try {
    return readNetworkControllerDeviceAddRequest(value);
  } catch {
    return undefined;
  }
}

// ---- How an ask went (NetworkControllerConnection.lastDeviceAdd).

/*
 * Where the last ask is.
 *
 *  - Queued: asked for, waiting for a worker.
 *  - Adding: a worker is listing the organization's devices and adding them.
 *  - Done: every device it found was dealt with. Some may not have been
 *    added, each counted with its reason; the ask as a whole is done.
 *  - Failed: the ask as a whole could not go on - Meraki could not be read,
 *    the person who asked may no longer add devices. Its message says why.
 */
export enum NetworkControllerDeviceAddStatus {
  Queued = "queued",
  Adding = "adding",
  Done = "done",
  Failed = "failed",
}

export const ALL_NETWORK_CONTROLLER_DEVICE_ADD_STATUSES: ReadonlyArray<NetworkControllerDeviceAddStatus> =
  [
    NetworkControllerDeviceAddStatus.Queued,
    NetworkControllerDeviceAddStatus.Adding,
    NetworkControllerDeviceAddStatus.Done,
    NetworkControllerDeviceAddStatus.Failed,
  ];

function isDeviceAddStatus(
  value: unknown,
): value is NetworkControllerDeviceAddStatus {
  return (
    typeof value === "string" &&
    (ALL_NETWORK_CONTROLLER_DEVICE_ADD_STATUSES as ReadonlyArray<string>).includes(
      value,
    )
  );
}

// A device that could not be added, by the name it would have had.
export interface NetworkControllerDeviceAddFailure {
  name: string;
  reason: string;
}

// Failures an ask keeps, with their reasons: the rest are counted.
export const MAX_DEVICE_ADD_FAILURES_KEPT: number = 10;
export const MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH: number = 300;

export interface NetworkControllerDeviceAddState {
  status: NetworkControllerDeviceAddStatus;
  request: NetworkControllerDeviceAddRequest;
  // ISO-8601, UTC.
  requestedAt: string;
  requestedByUserId: string;
  startedAt?: string | undefined;
  // The last time the worker wrote: what tells a running ask from a lost one.
  updatedAt: string;
  finishedAt?: string | undefined;
  /*
   * Of the kinds asked for, the devices that were no device here when the
   * worker listed them: the ones it set out to add, and how it went.
   */
  toAddCount: number;
  addedCount: number;
  failedCount: number;
  // Sites added for Meraki networks the project had no site for.
  createdSiteCount: number;
  // Devices of the kinds asked for that it did not try to add, by why.
  withoutAddressCount: number;
  takenCount: number;
  archivedCount: number;
  // Past this ask's limit: a further ask adds them.
  remainingCount: number;
  failures: Array<NetworkControllerDeviceAddFailure>;
  // Why the ask as a whole failed.
  message?: string | undefined;
}

/*
 * An ask whose worker has written nothing for this long has lost its worker
 * (a deploy, a crash): it is not shown as under way, and a new ask replaces
 * it. A healthy one writes every couple of seconds while it adds.
 */
export const NETWORK_CONTROLLER_DEVICE_ADD_STALE_MS: number = 5 * 60 * 1000;

/*
 * An ask still Queued after this long never reached a worker: a new ask
 * replaces it too.
 */
export const NETWORK_CONTROLLER_DEVICE_ADD_QUEUED_STALE_MS: number =
  10 * 60 * 1000;

function readCount(value: unknown): number {
  const parsed: number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function readTime(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }

  const time: number = Date.parse(value);

  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function readShortText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().substring(0, maxLength) : "";
}

function readFailures(
  value: unknown,
): Array<NetworkControllerDeviceAddFailure> {
  if (!Array.isArray(value)) {
    return [];
  }

  const failures: Array<NetworkControllerDeviceAddFailure> = [];

  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const name: string = readShortText(
      entry["name"],
      MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH,
    );
    const reason: string = readShortText(
      entry["reason"],
      MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH,
    );

    if (!name && !reason) {
      continue;
    }

    failures.push({ name, reason });

    if (failures.length >= MAX_DEVICE_ADD_FAILURES_KEPT) {
      break;
    }
  }

  return failures;
}

/*
 * A stored state read back without trusting its shape; undefined for a
 * connection nobody asked to add devices from, or one whose state cannot be
 * read.
 */
export function readNetworkControllerDeviceAddState(
  value: unknown,
): NetworkControllerDeviceAddState | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const status: unknown = value["status"];
  const request: NetworkControllerDeviceAddRequest | undefined =
    readStoredNetworkControllerDeviceAddRequest(value["request"]);
  const requestedAt: string | undefined = readTime(value["requestedAt"]);
  const requestedByUserId: string = readShortText(
    value["requestedByUserId"],
    64,
  );

  if (
    !isDeviceAddStatus(status) ||
    !request ||
    !requestedAt ||
    !ObjectID.isValidUUID(requestedByUserId)
  ) {
    return undefined;
  }

  const startedAt: string | undefined = readTime(value["startedAt"]);
  const finishedAt: string | undefined = readTime(value["finishedAt"]);
  const message: string = readShortText(
    value["message"],
    MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH,
  );

  return {
    status: status,
    request: request,
    requestedAt: requestedAt,
    requestedByUserId: requestedByUserId,
    ...(startedAt ? { startedAt: startedAt } : {}),
    updatedAt: readTime(value["updatedAt"]) || requestedAt,
    ...(finishedAt ? { finishedAt: finishedAt } : {}),
    toAddCount: readCount(value["toAddCount"]),
    addedCount: readCount(value["addedCount"]),
    failedCount: readCount(value["failedCount"]),
    createdSiteCount: readCount(value["createdSiteCount"]),
    withoutAddressCount: readCount(value["withoutAddressCount"]),
    takenCount: readCount(value["takenCount"]),
    archivedCount: readCount(value["archivedCount"]),
    remainingCount: readCount(value["remainingCount"]),
    failures: readFailures(value["failures"]),
    ...(message ? { message: message } : {}),
  };
}

// The JSON a state is stored as: what the reader above reads back.
export function toNetworkControllerDeviceAddStateJson(
  state: NetworkControllerDeviceAddState,
): JSONObject {
  const json: JSONObject = {
    status: state.status,
    request: {
      productTypes: [...state.request.productTypes],
      groupBySite: state.request.groupBySite,
      ...(state.request.probeId ? { probeId: state.request.probeId } : {}),
    },
    requestedAt: state.requestedAt,
    requestedByUserId: state.requestedByUserId,
    updatedAt: state.updatedAt,
    toAddCount: state.toAddCount,
    addedCount: state.addedCount,
    failedCount: state.failedCount,
    createdSiteCount: state.createdSiteCount,
    withoutAddressCount: state.withoutAddressCount,
    takenCount: state.takenCount,
    archivedCount: state.archivedCount,
    remainingCount: state.remainingCount,
    failures: state.failures
      .slice(0, MAX_DEVICE_ADD_FAILURES_KEPT)
      .map((failure: NetworkControllerDeviceAddFailure): JSONObject => {
        return {
          name: failure.name.substring(0, MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH),
          reason: failure.reason.substring(
            0,
            MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH,
          ),
        };
      }),
  };

  if (state.startedAt) {
    json["startedAt"] = state.startedAt;
  }

  if (state.finishedAt) {
    json["finishedAt"] = state.finishedAt;
  }

  if (state.message) {
    json["message"] = state.message.substring(
      0,
      MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH,
    );
  }

  return json;
}

/*
 * A new ask's state: queued, nothing found or added yet.
 */
export function buildQueuedNetworkControllerDeviceAddState(data: {
  request: NetworkControllerDeviceAddRequest;
  requestedByUserId: string;
  now: Date;
}): NetworkControllerDeviceAddState {
  const now: string = data.now.toISOString();

  return {
    status: NetworkControllerDeviceAddStatus.Queued,
    request: data.request,
    requestedAt: now,
    requestedByUserId: data.requestedByUserId,
    updatedAt: now,
    toAddCount: 0,
    addedCount: 0,
    failedCount: 0,
    createdSiteCount: 0,
    withoutAddressCount: 0,
    takenCount: 0,
    archivedCount: 0,
    remainingCount: 0,
    failures: [],
  };
}

/*
 * Whether an ask is still going: queued or adding, and its worker has
 * written lately (a queued ask, that it was asked for lately). A lost one is
 * neither shown as under way nor in the way of a new ask.
 */
export function isNetworkControllerDeviceAddUnderWay(
  state: NetworkControllerDeviceAddState | undefined,
  now: Date,
): boolean {
  if (!state) {
    return false;
  }

  if (state.status === NetworkControllerDeviceAddStatus.Queued) {
    return (
      now.getTime() - Date.parse(state.requestedAt) <
      NETWORK_CONTROLLER_DEVICE_ADD_QUEUED_STALE_MS
    );
  }

  if (state.status === NetworkControllerDeviceAddStatus.Adding) {
    return (
      now.getTime() - Date.parse(state.updatedAt) <
      NETWORK_CONTROLLER_DEVICE_ADD_STALE_MS
    );
  }

  return false;
}

// ---- What every read counts (NetworkControllerReadSummary.unaddedDevices).

/*
 * The devices of one kind that are no network device here, by what Add
 * devices can do about them.
 */
export interface NetworkControllerUnaddedDeviceCount {
  productType: string;
  // Nothing in the way: what Add devices adds.
  addable: number;
  /*
   * Meraki lists no management address for them (an MX lists none: its
   * addresses are its VLANs'), so there is nothing to poll them at.
   */
  withoutAddress: number;
  /*
   * Another network device here has its address, MAC address or serial
   * number: adding it would make two devices of one address.
   */
  taken: number;
  // The same box is archived here, and is not added again.
  archived: number;
}

/*
 * Counts as a read stored them, read back without trusting them: known
 * kinds only, once each, in the order they are listed, and only those with
 * a device to count.
 */
export function readNetworkControllerUnaddedDeviceCounts(
  value: unknown,
): Array<NetworkControllerUnaddedDeviceCount> {
  if (!Array.isArray(value)) {
    return [];
  }

  const byType: Map<string, NetworkControllerUnaddedDeviceCount> = new Map();

  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const productType: unknown = entry["productType"];

    if (
      !isAddableControllerProductType(productType) ||
      byType.has(productType)
    ) {
      continue;
    }

    const count: NetworkControllerUnaddedDeviceCount = {
      productType: productType,
      addable: readCount(entry["addable"]),
      withoutAddress: readCount(entry["withoutAddress"]),
      taken: readCount(entry["taken"]),
      archived: readCount(entry["archived"]),
    };

    if (
      count.addable + count.withoutAddress + count.taken + count.archived >
      0
    ) {
      byType.set(productType, count);
    }
  }

  return ADDABLE_CONTROLLER_PRODUCT_TYPES.filter(
    (productType: string): boolean => {
      return byType.has(productType);
    },
  ).map((productType: string): NetworkControllerUnaddedDeviceCount => {
    return byType.get(productType)!;
  });
}

// The devices Add devices would add of the kinds given.
export function getAddableControllerDeviceCount(
  counts: Array<NetworkControllerUnaddedDeviceCount>,
  productTypes: ReadonlyArray<string>,
): number {
  return counts.reduce(
    (total: number, count: NetworkControllerUnaddedDeviceCount): number => {
      return productTypes.includes(count.productType)
        ? total + count.addable
        : total;
    },
    0,
  );
}

/*
 * The kinds a connection's next ask starts with: the ones its last ask
 * picked, or the defaults for a connection never asked. What its row counts
 * as "not network devices here" too, so a kind someone chose to leave out
 * is not counted at them again.
 */
export function getControllerProductTypesToOffer(
  last: NetworkControllerDeviceAddState | undefined,
): Array<string> {
  return last
    ? [...last.request.productTypes]
    : [...DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD];
}
