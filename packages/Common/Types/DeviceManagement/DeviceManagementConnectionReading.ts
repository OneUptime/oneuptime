import Dictionary from "../Dictionary";
import { getDeviceManagementProviderTitle } from "./DeviceManagementProvider";
import { ManagedDeviceCheckInAttribute } from "./ManagedDeviceCheckIn";

/*
 * HOW LONG SINCE A DEVICE MANAGEMENT CONNECTION LAST READ, AS A METRIC
 * (#10006).
 *
 * A connection's devices are alerted on from the readings its reads write
 * for them (ManagedDeviceCheckIn), and a check that finds none of them keeps
 * their alerts as they are: silence is not recovery
 * (ManagedDeviceCheckInSilence). So a connection that stops reading - its
 * API key revoked or replaced, its service's user deleted or its role
 * changed, the service down, OneUptime's reads dying before they finish -
 * leaves its devices' alerts frozen, and nothing said so but the Status
 * chip on Inventory > Managed Devices.
 *
 * So the connection writes a reading of its own: the minutes since its last
 * read that worked (a whole read or a partial one, as the chip counts
 * them), or since it was saved when none has yet. 0 at a read that worked.
 * It is written
 *
 *   - at the end of every read, whatever it came to (DeviceManagementReadRunner):
 *     0 when it worked, and how long since one did when it failed, with
 *     what failed;
 *   - whenever a read of it falls due and is queued (DeviceManagementScheduler),
 *     so a connection whose reads stop finishing - a read the workers lose
 *     before it can say how it went - still reads older at each interval.
 *
 * A recommended monitor per connection (ManagedDeviceAlertTemplates:
 * "Esper Connection Stopped Reading" and each service's) alerts once no
 * read has worked for longer than the chip's Stale rule allows
 * (getDeviceManagementStaleAfterMinutes: three of its intervals and ten
 * minutes), and resolves with the first read that works. A connection
 * turned off is not read and writes nothing, as its devices write nothing:
 * its alert, if one is open, stays open until it reads again.
 *
 * Each reading names the connection and its service as the devices'
 * readings do, its name (what the monitor groups by, so the alert says
 * which connection), what the read came to and, when it failed, its error
 * with the credentials removed - the first thing an alert's first command
 * lists.
 */

// The metric: minutes since the connection's last read that worked.
export const MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME: string =
  "oneuptime.managed_device.connection.read.age";

export const MANAGED_DEVICE_CONNECTION_READ_AGE_UNIT: string = "min";

export const MANAGED_DEVICE_CONNECTION_READ_AGE_DESCRIPTION: string =
  "Minutes since a device management connection last read its devices: 0 at a read that worked, more at each read that failed and whenever a read is due. One reading per connection at every read, and each time a read of it is queued.";

// Every metric a connection writes about itself.
export const MANAGED_DEVICE_CONNECTION_METRIC_NAMES: ReadonlyArray<string> = [
  MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
];

/*
 * The attributes of a connection's reading. Its id and its service under
 * the keys the devices' readings name them by, and the rest of its own.
 */
export enum DeviceManagementConnectionReadingAttribute {
  ConnectionId = ManagedDeviceCheckInAttribute.ConnectionId,
  Provider = ManagedDeviceCheckInAttribute.Provider,
  // The connection's name, as Managed Devices lists it: what a monitor groups by.
  ConnectionName = "oneuptime.managed_device.connection.name",
  // What the read came to (DeviceManagementConnectionReadOutcome).
  ReadOutcome = "oneuptime.managed_device.connection.read.outcome",
  // Why the read failed (LlmConnectionFailureKind): on a failed read's reading.
  FailureKind = "oneuptime.managed_device.connection.read.failure_kind",
  // The error the connection's last read failed with, its credentials removed.
  LastError = "oneuptime.managed_device.connection.last_error",
  // When its last read that worked was, as an ISO time: none when no read has.
  LastSuccessfulReadAt = "oneuptime.managed_device.connection.last_successful_read_at",
  // How often it is read, in minutes.
  ReadIntervalInMinutes = "oneuptime.managed_device.connection.read_interval",
}

// What a reading was taken at.
export enum DeviceManagementConnectionReadOutcome {
  // A read that read the whole fleet.
  Success = "success",
  // A read that worked in part: some apps or check-ins wait for the next.
  Partial = "partial",
  // A read that failed.
  Failed = "failed",
  // A read fell due and was queued: it has not finished yet.
  Due = "due",
}

/*
 * The longest error a reading carries: what a person reads in a list of
 * readings. The connection's row keeps the whole of it (View error).
 */
export const MAX_DEVICE_MANAGEMENT_CONNECTION_READING_ERROR_LENGTH: number = 500;

const WHITESPACE: RegExp = /\s+/g;

function toTime(value: Date | string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const time: number =
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  return Number.isNaN(time) ? undefined : time;
}

/*
 * Whole minutes from the connection's last read that worked - or, when none
 * has, from when it was saved - to `asOf`. Never negative (a time stamped
 * after `asOf`), and 0 when the connection says neither. Pure.
 */
export function getDeviceManagementConnectionReadAgeInMinutes(data: {
  lastSuccessfulReadAt?: Date | string | null | undefined;
  createdAt?: Date | string | null | undefined;
  asOf: Date;
}): number {
  const since: number | undefined =
    toTime(data.lastSuccessfulReadAt) ?? toTime(data.createdAt);

  if (since === undefined) {
    return 0;
  }

  return Math.max(0, Math.floor((data.asOf.getTime() - since) / (60 * 1000)));
}

/*
 * An error as a reading carries it: on one line, at most
 * MAX_DEVICE_MANAGEMENT_CONNECTION_READING_ERROR_LENGTH characters, "" for
 * none. The read runner removed its credentials already. Pure.
 */
export function getDeviceManagementConnectionReadingError(
  error: string | null | undefined,
): string {
  const text: string = (error || "").replace(WHITESPACE, " ").trim();

  if (text.length <= MAX_DEVICE_MANAGEMENT_CONNECTION_READING_ERROR_LENGTH) {
    return text;
  }

  return `${text
    .substring(0, MAX_DEVICE_MANAGEMENT_CONNECTION_READING_ERROR_LENGTH - 1)
    .trimEnd()}…`;
}

export interface DeviceManagementConnectionReadingInput {
  connectionId: string;
  connectionName: string | null | undefined;
  provider: string | null | undefined;
  readIntervalInMinutes: number;
  outcome: DeviceManagementConnectionReadOutcome;
  /*
   * The connection's last read that worked, as it stands with this reading:
   * `asOf` itself for a read that worked.
   */
  lastSuccessfulReadAt?: Date | string | null | undefined;
  // When it was saved: what a connection no read has worked for counts from.
  createdAt?: Date | string | null | undefined;
  // A failed read's: why it failed.
  failureKind?: string | null | undefined;
  /*
   * The error the connection's last read failed with: a failed read's own,
   * or, when a read falls due, the stored one of the read before it, if it
   * failed. None for a read that worked.
   */
  lastError?: string | null | undefined;
  asOf: Date;
}

export interface DeviceManagementConnectionReading {
  ageInMinutes: number;
  attributes: Dictionary<string>;
}

/*
 * The name a reading names the connection by: its own, or - for one saved
 * without a name, which its form does not allow - its service's. Pure.
 */
export function getDeviceManagementConnectionReadingName(data: {
  connectionName: string | null | undefined;
  provider: string | null | undefined;
}): string {
  const name: string = (data.connectionName || "").trim();

  return name || getDeviceManagementProviderTitle(data.provider || undefined);
}

/*
 * One reading of a connection: how long since a read of it worked, and what
 * it came to. A read that worked reads 0 and carries no error. Pure.
 */
export function getDeviceManagementConnectionReading(
  input: DeviceManagementConnectionReadingInput,
): DeviceManagementConnectionReading {
  const hasWorked: boolean =
    input.outcome === DeviceManagementConnectionReadOutcome.Success ||
    input.outcome === DeviceManagementConnectionReadOutcome.Partial;
  const lastSuccessfulReadAt: number | undefined = hasWorked
    ? input.asOf.getTime()
    : toTime(input.lastSuccessfulReadAt);

  const attributes: Dictionary<string> = {
    [DeviceManagementConnectionReadingAttribute.ConnectionId]:
      input.connectionId,
    [DeviceManagementConnectionReadingAttribute.Provider]: input.provider || "",
    [DeviceManagementConnectionReadingAttribute.ConnectionName]:
      getDeviceManagementConnectionReadingName(input),
    [DeviceManagementConnectionReadingAttribute.ReadOutcome]: input.outcome,
    [DeviceManagementConnectionReadingAttribute.ReadIntervalInMinutes]: String(
      input.readIntervalInMinutes,
    ),
  };

  if (lastSuccessfulReadAt !== undefined) {
    attributes[
      DeviceManagementConnectionReadingAttribute.LastSuccessfulReadAt
    ] = new Date(lastSuccessfulReadAt).toISOString();
  }

  if (!hasWorked) {
    const error: string = getDeviceManagementConnectionReadingError(
      input.lastError,
    );

    if (error) {
      attributes[DeviceManagementConnectionReadingAttribute.LastError] = error;
    }

    if (
      input.outcome === DeviceManagementConnectionReadOutcome.Failed &&
      input.failureKind
    ) {
      attributes[DeviceManagementConnectionReadingAttribute.FailureKind] =
        input.failureKind;
    }
  }

  return {
    ageInMinutes: hasWorked
      ? 0
      : getDeviceManagementConnectionReadAgeInMinutes({
          lastSuccessfulReadAt: input.lastSuccessfulReadAt,
          createdAt: input.createdAt,
          asOf: input.asOf,
        }),
    attributes,
  };
}
