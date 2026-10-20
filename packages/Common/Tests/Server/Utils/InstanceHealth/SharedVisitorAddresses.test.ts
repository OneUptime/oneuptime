import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import { TrustedProxyHops } from "../../../../Server/EnvironmentConfig";
import {
  findSharedPrivateAddresses,
  getSharedVisitorAddresses,
  SHARED_VISITOR_ADDRESSES_QUERY,
  SHARED_VISITOR_ADDRESS_LIST_LIMIT,
  SHARED_VISITOR_ADDRESS_MINIMUM_PEOPLE,
  SHARED_VISITOR_ADDRESS_READ_LIMIT,
  SHARED_VISITOR_ADDRESS_WINDOW_DAYS,
  SharedVisitorAddress,
  SharedVisitorAddressesReport,
  SignInAddressRow,
} from "../../../../Server/Utils/InstanceHealth/SharedVisitorAddresses";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * MANY PEOPLE AT ONE PRIVATE ADDRESS, AS THE HEALTH PAGE IS TOLD.
 *
 * Where something in front of OneUptime hands it every visitor from an
 * address of its own - Docker passing IPv6 visitors on from its network's
 * gateway, a proxy TRUSTED_PROXY_HOPS does not count, a Kubernetes node -
 * OneUptime counts all of them as one visitor, and only the operator can
 * change that. The Health page says so when several different people signed
 * in from one private network address in the last 30 days:
 *
 *   - only private network addresses: a public one several people share (an
 *     office, a carrier) is nothing the setup can change;
 *   - only two people or more at one address: a network whose people each
 *     have an address of their own says nothing;
 *   - the most shared first, five at most, with the count of all of them;
 *   - nothing is claimed when the sessions cannot be read.
 *
 * The query itself runs against a real Postgres in
 * Server/Services/SharedVisitorAddressesPostgres.test.ts.
 */

type QueryCall = { query: string; parameters: Array<unknown> };

const fakeDataSource: (
  rows: Array<SignInAddressRow>,
  calls: Array<QueryCall>,
) => DataSource = (
  rows: Array<SignInAddressRow>,
  calls: Array<QueryCall>,
): DataSource => {
  return {
    query: async (
      query: string,
      parameters: Array<unknown>,
    ): Promise<Array<SignInAddressRow>> => {
      calls.push({ query, parameters });
      return rows;
    },
  } as unknown as DataSource;
};

const connectTo: (dataSource: DataSource | null, connected: boolean) => void = (
  dataSource: DataSource | null,
  connected: boolean,
): void => {
  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(dataSource);
  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(connected);
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("findSharedPrivateAddresses", () => {
  test("keeps the private network addresses several people signed in from", () => {
    expect(
      findSharedPrivateAddresses([
        // Docker's network gateway: every IPv6 visitor of a Compose install.
        { address: "172.18.0.1", people: 4, lastSeenAt: null },
        // A Kubernetes node's pod network address.
        { address: "10.244.1.1", people: 3, lastSeenAt: null },
        // An IPv6 unique local gateway.
        { address: "fdf9:9ef6:88c2::1", people: 2, lastSeenAt: null },
      ]).map((shared: SharedVisitorAddress): [string, number] => {
        return [shared.address, shared.people];
      }),
    ).toEqual([
      ["172.18.0.1", 4],
      ["10.244.1.1", 3],
      ["fdf9:9ef6:88c2::1", 2],
    ]);
  });

  test("leaves out public addresses, however many people share them", () => {
    expect(
      findSharedPrivateAddresses([
        { address: "203.0.113.7", people: 40, lastSeenAt: null },
        { address: "2001:db8::1", people: 12, lastSeenAt: null },
        { address: "::ffff:198.51.100.4", people: 9, lastSeenAt: null },
        { address: "100.64.0.1", people: 5, lastSeenAt: null },
      ]),
    ).toEqual([]);
  });

  test("leaves out an address only one person signed in from", () => {
    expect(
      findSharedPrivateAddresses([
        { address: "192.168.1.23", people: 1, lastSeenAt: null },
        { address: "192.168.1.24", people: 1, lastSeenAt: null },
      ]),
    ).toEqual([]);
    expect(SHARED_VISITOR_ADDRESS_MINIMUM_PEOPLE).toBe(2);
  });

  test("takes a different minimum when asked", () => {
    expect(
      findSharedPrivateAddresses(
        [
          { address: "10.0.0.5", people: 2, lastSeenAt: null },
          { address: "10.0.0.6", people: 3, lastSeenAt: null },
        ],
        3,
      ).map((shared: SharedVisitorAddress): string => {
        return shared.address;
      }),
    ).toEqual(["10.0.0.6"]);
  });

  test("reads the counts and dates the driver returns, as numbers, strings or dates", () => {
    expect(
      findSharedPrivateAddresses([
        {
          address: " 10.0.0.1 ",
          people: "3",
          lastSeenAt: "2026-10-18T10:00:00.000Z",
        },
        {
          address: "10.0.0.2",
          people: 2,
          lastSeenAt: new Date("2026-10-17T09:00:00.000Z"),
        },
      ]),
    ).toEqual([
      {
        address: "10.0.0.1",
        people: 3,
        lastSeenAt: "2026-10-18T10:00:00.000Z",
      },
      {
        address: "10.0.0.2",
        people: 2,
        lastSeenAt: "2026-10-17T09:00:00.000Z",
      },
    ]);
  });

  test("skips rows that are not an address with people", () => {
    expect(
      findSharedPrivateAddresses([
        { address: null, people: 5, lastSeenAt: null },
        { address: 17, people: 5, lastSeenAt: null },
        { address: "", people: 5, lastSeenAt: null },
        { address: "unknown", people: 5, lastSeenAt: null },
        { address: "10.0.0.9", people: "many", lastSeenAt: null },
        { address: "10.0.0.10", people: -4, lastSeenAt: null },
        { address: "10.0.0.11", people: Number.NaN, lastSeenAt: null },
        {
          address: "10.0.0.12",
          people: 2,
          lastSeenAt: "not a date",
        },
      ]),
    ).toEqual([{ address: "10.0.0.12", people: 2, lastSeenAt: null }]);
  });

  test("puts the most shared first, then the most recently seen, then by address", () => {
    expect(
      findSharedPrivateAddresses([
        { address: "10.0.0.3", people: 2, lastSeenAt: "2026-10-01T00:00:00Z" },
        { address: "10.0.0.2", people: 2, lastSeenAt: "2026-10-05T00:00:00Z" },
        { address: "10.0.0.9", people: 7, lastSeenAt: "2026-09-25T00:00:00Z" },
        { address: "10.0.0.1", people: 2, lastSeenAt: "2026-10-05T00:00:00Z" },
        { address: "10.0.0.4", people: 2, lastSeenAt: null },
      ]).map((shared: SharedVisitorAddress): string => {
        return shared.address;
      }),
    ).toEqual(["10.0.0.9", "10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]);
  });
});

describe("getSharedVisitorAddresses", () => {
  const NOW: Date = new Date("2026-10-19T12:00:00.000Z");

  test("asks for the sign-ins of the last 30 days, two people or more, a bounded number of addresses", async () => {
    const calls: Array<QueryCall> = [];

    connectTo(fakeDataSource([], calls), true);

    await getSharedVisitorAddresses({ now: NOW });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe(SHARED_VISITOR_ADDRESSES_QUERY);
    expect(calls[0]?.parameters).toEqual([
      new Date("2026-09-19T12:00:00.000Z"),
      2,
      SHARED_VISITOR_ADDRESS_READ_LIMIT,
    ]);
    expect(SHARED_VISITOR_ADDRESS_WINDOW_DAYS).toBe(30);
  });

  test("reports the private addresses several people share, five at most, with the count of all of them", async () => {
    const rows: Array<SignInAddressRow> = [
      { address: "203.0.113.7", people: 50, lastSeenAt: null },
      ...[1, 2, 3, 4, 5, 6, 7].map((index: number): SignInAddressRow => {
        return {
          address: `10.244.${index}.1`,
          people: 10 - index,
          lastSeenAt: "2026-10-18T00:00:00.000Z",
        };
      }),
    ];

    connectTo(fakeDataSource(rows, []), true);

    const report: SharedVisitorAddressesReport =
      await getSharedVisitorAddresses({ now: NOW });

    expect(report.checked).toBe(true);
    expect(report.windowDays).toBe(30);
    expect(report.minimumPeople).toBe(2);
    expect(report.trustedProxyHops).toBe(TrustedProxyHops);
    expect(report.addressCount).toBe(7);
    expect(report.addresses).toHaveLength(SHARED_VISITOR_ADDRESS_LIST_LIMIT);
    expect(
      report.addresses.map((shared: SharedVisitorAddress): string => {
        return shared.address;
      }),
    ).toEqual([
      "10.244.1.1",
      "10.244.2.1",
      "10.244.3.1",
      "10.244.4.1",
      "10.244.5.1",
    ]);
  });

  test("an installation where everybody has an address of their own has nothing to report", async () => {
    connectTo(
      fakeDataSource(
        [{ address: "198.51.100.4", people: 3, lastSeenAt: null }],
        [],
      ),
      true,
    );

    const report: SharedVisitorAddressesReport =
      await getSharedVisitorAddresses({ now: NOW });

    expect(report).toEqual({
      checked: true,
      windowDays: 30,
      minimumPeople: 2,
      trustedProxyHops: TrustedProxyHops,
      addresses: [],
      addressCount: 0,
    });
  });

  test("claims nothing while Postgres is not connected", async () => {
    const calls: Array<QueryCall> = [];

    connectTo(fakeDataSource([], calls), false);

    const report: SharedVisitorAddressesReport =
      await getSharedVisitorAddresses({ now: NOW });

    expect(report.checked).toBe(false);
    expect(report.addresses).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("claims nothing without a data source", async () => {
    connectTo(null, true);

    const report: SharedVisitorAddressesReport =
      await getSharedVisitorAddresses({ now: NOW });

    expect(report.checked).toBe(false);
  });

  test("a query that fails is the caller's error, never a report that all is well", async () => {
    connectTo(
      {
        query: async (): Promise<never> => {
          throw new Error("canceling statement due to statement timeout");
        },
      } as unknown as DataSource,
      true,
    );

    await expect(getSharedVisitorAddresses({ now: NOW })).rejects.toThrow(
      "statement timeout",
    );
  });

  test("an answer that is not a list of rows reports nothing shared", async () => {
    connectTo(
      {
        query: async (): Promise<unknown> => {
          return { rows: [] };
        },
      } as unknown as DataSource,
      true,
    );

    const report: SharedVisitorAddressesReport =
      await getSharedVisitorAddresses({ now: NOW });

    expect(report.checked).toBe(true);
    expect(report.addresses).toEqual([]);
  });

  test("counts each person once per address, across the dashboard's users and status pages' private users", () => {
    // Read from the query: distinct people, both kinds of session, removed ones left out.
    expect(SHARED_VISITOR_ADDRESSES_QUERY).toContain(
      'COUNT(DISTINCT "person")',
    );
    expect(SHARED_VISITOR_ADDRESSES_QUERY).toContain('FROM "UserSession"');
    expect(SHARED_VISITOR_ADDRESSES_QUERY).toContain(
      'FROM "StatusPagePrivateUserSession"',
    );
    expect(
      SHARED_VISITOR_ADDRESSES_QUERY.match(/"deletedAt" IS NULL/g),
    ).toHaveLength(2);
    expect(SHARED_VISITOR_ADDRESSES_QUERY).toContain("'user:' || \"userId\"");
    expect(SHARED_VISITOR_ADDRESSES_QUERY).toContain(
      "'status-page-user:' || \"statusPagePrivateUserId\"",
    );
  });
});
