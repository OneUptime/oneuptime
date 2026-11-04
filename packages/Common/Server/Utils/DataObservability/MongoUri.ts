/*
 * A MONGODB CONNECTION STRING'S PARTS.
 *
 * Its hosts - one, a replica set's list, or an SRV name - and the database
 * its path names, if any. new URL cannot read a list of hosts, so the string
 * is read by hand. The credentials are skipped and never kept.
 */

export interface MongoUriHost {
  host: string;
  // Null for an SRV name, whose ports DNS says.
  port: number | null;
}

export interface MongoUri {
  hosts: Array<MongoUriHost>;
  isSrv: boolean;
  // The database the path names; null when it names none, or names one of MongoDB's own.
  database: string | null;
}

const DEFAULT_PORT: number = 27017;

// The databases MongoDB keeps for itself: never a store's collections.
const SYSTEM_DATABASES: ReadonlySet<string> = new Set([
  "admin",
  "local",
  "config",
]);

const URI_PATTERN: RegExp =
  /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?#]+)(?:\/([^?#]*))?/i;

const BRACKETED_HOST_PATTERN: RegExp = /^\[([^\]]+)\](?::(\d+))?$/;

export function isMongoSystemDatabase(name: string): boolean {
  return SYSTEM_DATABASES.has(name.trim().toLowerCase());
}

function readHost(part: string, isSrv: boolean): MongoUriHost | null {
  const text: string = part.trim();
  // An IPv6 address is bracketed: [::1]:27017.
  const bracketed: RegExpMatchArray | null = text.match(BRACKETED_HOST_PATTERN);
  const host: string = bracketed ? bracketed[1]! : text.split(":")[0] || "";
  const portText: string | undefined = bracketed
    ? bracketed[2]
    : text.split(":")[1];
  const port: number = Number(portText);

  if (!host) {
    return null;
  }

  return {
    host: host.toLowerCase(),
    port:
      Number.isInteger(port) && port > 0 && port < 65536
        ? port
        : isSrv
          ? null
          : DEFAULT_PORT,
  };
}

export function readMongoUri(value: string): MongoUri | null {
  const match: RegExpMatchArray | null = (value || "")
    .trim()
    .match(URI_PATTERN);

  if (!match) {
    return null;
  }

  const isSrv: boolean = Boolean(match[1]);
  const hosts: Array<MongoUriHost> = match[2]!
    .split(",")
    .map((part: string): MongoUriHost | null => {
      return readHost(part, isSrv);
    })
    .filter((host: MongoUriHost | null): host is MongoUriHost => {
      return host !== null;
    });
  let database: string = "";

  try {
    database = decodeURIComponent(match[3] || "").trim();
  } catch {
    database = "";
  }

  if (hosts.length === 0) {
    return null;
  }

  return {
    hosts,
    isSrv,
    database: database && !isMongoSystemDatabase(database) ? database : null,
  };
}
