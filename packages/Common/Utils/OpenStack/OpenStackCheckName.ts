/*
 * WHAT EVERYTHING THE LIFECYCLE CHECK MAKES IS CALLED, AND THE ONLY WAY ANYTHING IS TOLD APART AS
 * ITS OWN.
 *
 * The janitor deletes what it finds by this name, in a customer's cloud, and an earlier run may
 * have died without saying what it made. So a name is written and read by exactly one rule, and
 * nearly right is wrong: a person's "oneuptime-check-web" or a copy someone named
 * "oneuptime-check-...-server-old" is not the check's, whatever it looks like.
 *
 *   oneuptime-check-<check key>-<when>-<random>-<part>
 *
 *   check key  twelve lowercase hex characters, a hash of the check's id: two checks that share
 *              a project never touch what the other made
 *   when       the moment the run started, UTC, YYYYMMDDHHMMSS
 *   random     six lowercase hex characters, so two runs in one second differ
 *   part       server, volume, sg or fip, so a volume with a server's name is not the check's
 *
 * Read with loops and fixed lengths, never a regular expression: names come from a cloud's API,
 * where anyone with a project can write one (Docs/notifications/README.md, "Megabyte-long
 * values").
 *
 * Pure, for the probe that makes and deletes them and for the guide and tests that describe them.
 */

export const OPENSTACK_CHECK_NAME_PREFIX: string = "oneuptime-check-";

export const OPENSTACK_CHECK_KEY_LENGTH: number = 12;

const STAMP_LENGTH: number = 14;
const RANDOM_LENGTH: number = 6;

// The longest name there is: anything longer was not written here.
const MAX_NAME_LENGTH: number =
  OPENSTACK_CHECK_NAME_PREFIX.length +
  OPENSTACK_CHECK_KEY_LENGTH +
  1 +
  STAMP_LENGTH +
  1 +
  RANDOM_LENGTH +
  1 +
  6;

export type OpenStackCheckNamePart = "server" | "volume" | "sg" | "fip";

const NAME_PARTS: ReadonlyArray<OpenStackCheckNamePart> = [
  "server",
  "volume",
  "sg",
  "fip",
];

export interface ParsedOpenStackCheckName {
  checkKey: string;
  // The run: <when>-<random>.
  runId: string;
  // When the run started, in milliseconds.
  startedAt: number;
  part: OpenStackCheckNamePart;
}

function isLowerHex(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) {
      return false;
    }
  }

  return text.length > 0;
}

function isDigits(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return text.length > 0;
}

// A real moment, or null: month 13 and the 31st of June are not.
function readStamp(stamp: string): number | null {
  if (stamp.length !== STAMP_LENGTH || !isDigits(stamp)) {
    return null;
  }

  const year: number = Number(stamp.substring(0, 4));
  const month: number = Number(stamp.substring(4, 6));
  const day: number = Number(stamp.substring(6, 8));
  const hour: number = Number(stamp.substring(8, 10));
  const minute: number = Number(stamp.substring(10, 12));
  const second: number = Number(stamp.substring(12, 14));

  const time: number = Date.UTC(year, month - 1, day, hour, minute, second);
  const date: Date = new Date(time);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }

  return time;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

export function getOpenStackCheckStamp(at: number): string {
  const date: Date = new Date(at);

  return [
    pad(date.getUTCFullYear(), 4),
    pad(date.getUTCMonth() + 1, 2),
    pad(date.getUTCDate(), 2),
    pad(date.getUTCHours(), 2),
    pad(date.getUTCMinutes(), 2),
    pad(date.getUTCSeconds(), 2),
  ].join("");
}

export function isOpenStackCheckKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === OPENSTACK_CHECK_KEY_LENGTH &&
    isLowerHex(value)
  );
}

// A run's id, from when it started and its random part.
export function buildOpenStackCheckRunId(data: {
  startedAt: number;
  random: string;
}): string {
  return `${getOpenStackCheckStamp(data.startedAt)}-${data.random}`;
}

/*
 * What a name says, or null when it is anything but exactly what buildOpenStackCheckName writes.
 * This is the one question the janitor asks of a name.
 */
export function parseOpenStackCheckName(
  name: unknown,
): ParsedOpenStackCheckName | null {
  if (
    typeof name !== "string" ||
    name.length > MAX_NAME_LENGTH ||
    !name.startsWith(OPENSTACK_CHECK_NAME_PREFIX)
  ) {
    return null;
  }

  const rest: string = name.substring(OPENSTACK_CHECK_NAME_PREFIX.length);
  const pieces: Array<string> = rest.split("-");

  if (pieces.length !== 4) {
    return null;
  }

  const checkKey: string = pieces[0] as string;
  const stamp: string = pieces[1] as string;
  const random: string = pieces[2] as string;
  const part: string = pieces[3] as string;

  if (!isOpenStackCheckKey(checkKey)) {
    return null;
  }

  if (random.length !== RANDOM_LENGTH || !isLowerHex(random)) {
    return null;
  }

  const startedAt: number | null = readStamp(stamp);

  if (startedAt === null) {
    return null;
  }

  if (!NAME_PARTS.includes(part as OpenStackCheckNamePart)) {
    return null;
  }

  return {
    checkKey: checkKey,
    runId: `${stamp}-${random}`,
    startedAt: startedAt,
    part: part as OpenStackCheckNamePart,
  };
}

/*
 * The name of one thing a run makes. Throws on a key or a run id it would not read back,
 * because a resource it could never find again is one it could never delete.
 */
export function buildOpenStackCheckName(data: {
  checkKey: string;
  runId: string;
  part: OpenStackCheckNamePart;
}): string {
  const name: string = `${OPENSTACK_CHECK_NAME_PREFIX}${data.checkKey}-${data.runId}-${data.part}`;

  if (!parseOpenStackCheckName(name)) {
    throw new Error(
      `"${name}" is not a name the lifecycle check can read back.`,
    );
  }

  return name;
}
