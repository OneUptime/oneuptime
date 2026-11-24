import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import ThreatIntelIndicatorService, {
  ActiveIndicator,
} from "../../../../../Server/Services/ThreatIntelIndicatorService";
import AddressFacts, {
  AddressFactsReading,
  getThreatIntelAddressValues,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AddressFacts";
import SecurityConnections from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
  SecurityConnectionsJson,
} from "../../../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import { getJestSpyOn } from "../../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

// A spy, as the shared helper hands it over.
type SpyInstance = ReturnType<typeof getJestSpyOn>;

/*
 * WHAT A "RULE OUT A FALSE POSITIVE" STEP IS PREFILLED WITH (#10340).
 *
 * AddressFacts reads which of the project's records holds the address
 * through the connections, which it takes from ConnectionsLoader when the
 * facts are first read: the step checks load with SecurityCaseTaskService,
 * which the services the connections read reach, so an import of the
 * connections at load closed an import cycle (ConnectionsLoadOrder). These
 * read the facts with the connections, the threat intel feeds and the
 * sign-ins stubbed where they are read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const ADDRESS: string = "203.0.113.7";
const NOW: Date = new Date("2026-11-22T09:00:00.000Z");

function connectionsHolding(data: {
  name: string;
  matchedValue: string;
}): SecurityConnectionsJson {
  return {
    windowStart: "2026-11-22T08:30:00.000Z",
    windowEnd: NOW.toISOString(),
    resources: [
      {
        kind: SecurityConnectionKind.Host,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: data.name,
        certainty: SecurityConnectionCertainty.Exact,
        matches: [
          {
            entityType: SecurityEntityType.IpAddress,
            entityValue: ADDRESS,
            certainty: SecurityConnectionCertainty.Exact,
            reason: SecurityConnectionReason.HostName,
            matchedValue: data.matchedValue,
          },
        ],
      },
    ],
    hasMoreResources: false,
    unmatched: [],
    unreadableKinds: [],
    failedKinds: [],
  } as unknown as SecurityConnectionsJson;
}

function indicator(feedId: string): ActiveIndicator {
  return {
    indicatorValue: ADDRESS,
    feedId,
    feedName: `Feed ${feedId}`,
    stixId: `indicator--${feedId}`,
    indicatorType: "ipv4-addr",
    indicatorName: ADDRESS,
    confidence: 80,
  };
}

function stubSignIns(rows: Array<Record<string, unknown>>): void {
  getJestSpyOn(SecurityEventService, "executeQuery").mockResolvedValue({
    json: async (): Promise<{ data: Array<Record<string, unknown>> }> => {
      return { data: rows };
    },
  } as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an address's facts, read through the connections taken at the first read", () => {
  test("names the record that holds the address, counts its feeds once each, and says who signed in from it", async () => {
    const forEntities: SpyInstance = getJestSpyOn(
      SecurityConnections,
      "forEntities",
    ).mockResolvedValue(
      connectionsHolding({ name: "checkout-1", matchedValue: ADDRESS }),
    );
    getJestSpyOn(
      ThreatIntelIndicatorService,
      "findActiveIndicatorsByValues",
    ).mockResolvedValue([indicator("a"), indicator("a"), indicator("b")]);
    stubSignIns([{ users: 3, user: "alice@example.com" }]);

    const reading: AddressFactsReading = await AddressFacts.read({
      projectId: PROJECT_ID,
      address: ADDRESS,
      now: NOW,
    });

    expect(reading).toEqual({
      recordName: "checkout-1",
      threatIntelFeeds: 2,
      signedInUsers: 3,
      signedInUser: "alice@example.com",
    });
    // The project's records, read as OneUptime reads them, for the address alone.
    expect(forEntities).toHaveBeenCalledTimes(1);
    expect(forEntities).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      entities: [{ type: SecurityEntityType.IpAddress, value: ADDRESS }],
      props: { isRoot: true },
      now: NOW,
    });
  });

  test("a record that matched another value does not hold the address, and nothing else read is a fact", async () => {
    getJestSpyOn(SecurityConnections, "forEntities").mockResolvedValue(
      connectionsHolding({ name: "checkout-1", matchedValue: "203.0.113.70" }),
    );
    getJestSpyOn(
      ThreatIntelIndicatorService,
      "findActiveIndicatorsByValues",
    ).mockResolvedValue([]);
    stubSignIns([]);

    await expect(
      AddressFacts.read({ projectId: PROJECT_ID, address: ADDRESS, now: NOW }),
    ).resolves.toEqual({
      recordName: "",
      threatIntelFeeds: 0,
      signedInUsers: 0,
      signedInUser: "",
    });
  });

  /*
   * A feed's indicators are kept as the feed wrote them, in lower case: an
   * IPv6 one most often compressed, while the step reads the case's
   * address written out. The facts asked the feeds for that one spelling,
   * so no feed was ever found to list an IPv6 attacker (#10744).
   */
  test.each([
    "2001:db8:0:0:0:0:0:7",
    "2001:db8::7",
    "2001:0DB8:0000:0000:0000:0000:0000:0007",
  ])(
    "the threat intel feeds are asked for an IPv6 address the case writes %s in each spelling a feed keeps",
    async (address: string) => {
      getJestSpyOn(SecurityConnections, "forEntities").mockResolvedValue(
        connectionsHolding({
          name: "checkout-1",
          matchedValue: "203.0.113.70",
        }),
      );
      const indicators: SpyInstance = getJestSpyOn(
        ThreatIntelIndicatorService,
        "findActiveIndicatorsByValues",
      ).mockResolvedValue([indicator("a")]);
      stubSignIns([]);

      const reading: AddressFactsReading = await AddressFacts.read({
        projectId: PROJECT_ID,
        address,
        now: NOW,
      });

      expect(reading.threatIntelFeeds).toBe(1);
      expect(indicators).toHaveBeenCalledTimes(1);

      const values: Array<string> = (
        indicators.mock.calls[0]![0] as { values: Array<string> }
      ).values;

      expect(values).toEqual(
        expect.arrayContaining(["2001:db8::7", "2001:db8:0:0:0:0:0:7"]),
      );
      // Feeds are kept in lower case: each spelling once, in lower case.
      expect(values).toEqual(
        Array.from(
          new Set(
            values.map((value: string): string => {
              return value.toLowerCase();
            }),
          ),
        ),
      );
    },
  );

  test("an IPv4 address is asked for as a dual-stack server maps it too", () => {
    expect(getThreatIntelAddressValues(ADDRESS)).toEqual([
      ADDRESS,
      `::ffff:${ADDRESS}`,
    ]);
  });

  test("records that cannot be read fail the facts: what is not known is not a fact", async () => {
    getJestSpyOn(SecurityConnections, "forEntities").mockRejectedValue(
      new Error("The hosts could not be read."),
    );
    getJestSpyOn(
      ThreatIntelIndicatorService,
      "findActiveIndicatorsByValues",
    ).mockResolvedValue([indicator("a")]);
    stubSignIns([{ users: 1, user: "alice@example.com" }]);

    await expect(
      AddressFacts.read({ projectId: PROJECT_ID, address: ADDRESS, now: NOW }),
    ).rejects.toThrow("The hosts could not be read.");
  });
});
