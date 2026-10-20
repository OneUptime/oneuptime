import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import { TrustedProxyHops } from "../../EnvironmentConfig";
import { isPrivateNetworkAddress } from "../PrivateNetworkAddress";
import { DataSource } from "typeorm";

/*
 * MANY PEOPLE AT ONE PRIVATE ADDRESS.
 *
 * OneUptime counts a visitor by the address its ingress accepted the
 * connection from (Utils/ClientIp): the sign-in and two-factor limits, every
 * other per-address limit and the status page and dashboard IP allowlists
 * all read it. Where something in front of OneUptime hands the ingress every
 * visitor from an address of its own, all of them look like one visitor:
 * one person's failed sign-ins lock the others out, and an allowlist sees
 * that address instead of theirs. In the setups OneUptime ships that is
 *
 *   - Docker Compose with visitors over IPv6 on a network without IPv6
 *     (turned on in docker-compose.override.yml): Docker passes them on
 *     from the network's gateway;
 *   - a proxy of the operator's own in front that TRUSTED_PROXY_HOPS does
 *     not count: everyone is the proxy;
 *   - the Helm chart's gateway Service under Kubernetes' default
 *     externalTrafficPolicy: everyone is the node they came through, and
 *     behind a load balancer that ends the connection itself, the load
 *     balancer.
 *
 * Only the operator can change any of these, so OneUptime says so on the
 * Admin Dashboard's Health page. What gives it away is where people sign in
 * from: a session records the address each sign-in came from, and a private
 * network address (Utils/PrivateNetworkAddress) that several different
 * people signed in from recently is almost always one of the above. A
 * public address several people share - an office, a mobile carrier - is
 * the honest case, which nothing in OneUptime's setup can change, and is
 * left out. So are the people of a network whose members each have an
 * address of their own: one person per address.
 *
 * Read from the sessions of the dashboard's users and of status pages'
 * private users. Only a sign-in makes a session, so nobody without an
 * account can make an address show up here.
 */

// How far back the sessions looked at go.
export const SHARED_VISITOR_ADDRESS_WINDOW_DAYS: number = 30;

// How many different people at one private address OneUptime speaks up for.
export const SHARED_VISITOR_ADDRESS_MINIMUM_PEOPLE: number = 2;

// How many such addresses the Health page lists, the most shared first.
export const SHARED_VISITOR_ADDRESS_LIST_LIMIT: number = 5;

/*
 * How many shared addresses are read before the private ones are picked out:
 * a busy installation has many public ones (offices, carriers), and the
 * private ones that matter carry the most people, so they come first.
 */
export const SHARED_VISITOR_ADDRESS_READ_LIMIT: number = 1000;

export interface SharedVisitorAddress {
  address: string;
  people: number;
  // When one of them was last seen there, as ISO 8601.
  lastSeenAt: string | null;
}

export interface SharedVisitorAddressesReport {
  // False when the sessions could not be read: nothing is known.
  checked: boolean;
  windowDays: number;
  minimumPeople: number;
  trustedProxyHops: number;
  // The private addresses several people signed in from, most shared first.
  addresses: Array<SharedVisitorAddress>;
  // How many such addresses there are in all, listed or not.
  addressCount: number;
}

// One address and the people who signed in from it, as the query returns it.
export interface SignInAddressRow {
  address: unknown;
  people: unknown;
  lastSeenAt: unknown;
}

const toCount: (value: unknown) => number = (value: unknown): number => {
  const count: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

const toIsoString: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === "string" && value) {
    const parsed: Date = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
};

/*
 * The private network addresses among the rows that several people signed in
 * from, most shared first (then the most recently seen, then by address, so
 * the order is the same every time).
 */
export const findSharedPrivateAddresses: (
  rows: Array<SignInAddressRow>,
  minimumPeople?: number,
) => Array<SharedVisitorAddress> = (
  rows: Array<SignInAddressRow>,
  minimumPeople: number = SHARED_VISITOR_ADDRESS_MINIMUM_PEOPLE,
): Array<SharedVisitorAddress> => {
  const shared: Array<SharedVisitorAddress> = [];

  for (const row of rows) {
    const address: string =
      typeof row.address === "string" ? row.address.trim() : "";
    const people: number = toCount(row.people);

    if (!address || people < minimumPeople) {
      continue;
    }

    if (!isPrivateNetworkAddress(address)) {
      continue;
    }

    shared.push({
      address,
      people,
      lastSeenAt: toIsoString(row.lastSeenAt),
    });
  }

  return shared.sort(
    (a: SharedVisitorAddress, b: SharedVisitorAddress): number => {
      if (a.people !== b.people) {
        return b.people - a.people;
      }

      const lastSeenOrder: number = (b.lastSeenAt || "").localeCompare(
        a.lastSeenAt || "",
      );

      return lastSeenOrder !== 0
        ? lastSeenOrder
        : a.address.localeCompare(b.address);
    },
  );
};

/*
 * Each address a sign-in came from within the window, with how many
 * different people signed in from it: the dashboard's users and status
 * pages' private users, each person counted once however many sessions they
 * have. Sessions that were removed are left out; revoked ones still say
 * where somebody signed in from.
 */
export const SHARED_VISITOR_ADDRESSES_QUERY: string = `SELECT "address", COUNT(DISTINCT "person")::int AS "people", MAX("seenAt") AS "lastSeenAt"
FROM (
  SELECT "ipAddress" AS "address", 'user:' || "userId"::text AS "person", COALESCE("lastActiveAt", "createdAt") AS "seenAt"
  FROM "UserSession"
  WHERE "deletedAt" IS NULL AND "ipAddress" IS NOT NULL AND COALESCE("lastActiveAt", "createdAt") >= $1
  UNION ALL
  SELECT "ipAddress" AS "address", 'status-page-user:' || "statusPagePrivateUserId"::text AS "person", COALESCE("lastActiveAt", "createdAt") AS "seenAt"
  FROM "StatusPagePrivateUserSession"
  WHERE "deletedAt" IS NULL AND "ipAddress" IS NOT NULL AND COALESCE("lastActiveAt", "createdAt") >= $1
) AS "signIns"
GROUP BY "address"
HAVING COUNT(DISTINCT "person") >= $2
ORDER BY "people" DESC, "address" ASC
LIMIT $3`;

/*
 * What the Health page shows about where people sign in from. `now` is the
 * end of the window (the current time unless a caller says otherwise).
 */
export const getSharedVisitorAddresses: (options?: {
  now?: Date | undefined;
}) => Promise<SharedVisitorAddressesReport> = async (options?: {
  now?: Date | undefined;
}): Promise<SharedVisitorAddressesReport> => {
  const report: SharedVisitorAddressesReport = {
    checked: false,
    windowDays: SHARED_VISITOR_ADDRESS_WINDOW_DAYS,
    minimumPeople: SHARED_VISITOR_ADDRESS_MINIMUM_PEOPLE,
    trustedProxyHops: TrustedProxyHops,
    addresses: [],
    addressCount: 0,
  };

  const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

  if (!dataSource || !PostgresAppInstance.isConnected()) {
    return report;
  }

  const now: Date = options?.now || new Date();
  const windowStart: Date = new Date(
    now.getTime() - SHARED_VISITOR_ADDRESS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const rows: Array<SignInAddressRow> = await dataSource.query(
    SHARED_VISITOR_ADDRESSES_QUERY,
    [
      windowStart,
      SHARED_VISITOR_ADDRESS_MINIMUM_PEOPLE,
      SHARED_VISITOR_ADDRESS_READ_LIMIT,
    ],
  );

  const shared: Array<SharedVisitorAddress> = findSharedPrivateAddresses(
    Array.isArray(rows) ? rows : [],
  );

  report.checked = true;
  report.addressCount = shared.length;
  report.addresses = shared.slice(0, SHARED_VISITOR_ADDRESS_LIST_LIMIT);

  return report;
};
