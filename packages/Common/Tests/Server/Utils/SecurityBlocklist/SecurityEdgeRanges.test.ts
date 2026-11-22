import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import logger from "../../../../Server/Utils/Logger";
import SecurityEdgeRanges, {
  CLOUDFLARE_EDGE,
  EDGE_RANGES_REFRESH_IN_MS,
  EDGE_RANGES_RETRY_IN_MS,
  SECURITY_EDGES,
  SecurityEdge,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityEdgeRanges";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import NetworkAddressBlockUtil from "../../../../Utils/NetworkTraffic/NetworkAddressBlock";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// A list that cannot be read is logged; the tests read the ranges that stand in.
jest.mock("../../../../Server/Utils/Logger");

/*
 * The edge in front of the app (#10338): while a project has connected one,
 * its published ranges are never blocked, as a block of one of them takes
 * the site down for everyone the edge serves. The ranges are read from where
 * the edge publishes them, at most once a day; when they cannot be read, the
 * copy they were written with stands in, and they are read again within the
 * hour. No test reaches the network: each says what the edge publishes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const NOW: number = new Date("2026-11-20T10:00:00.000Z").getTime();
const IPV4_LIST: string = "https://www.cloudflare.com/ips-v4";
const IPV6_LIST: string = "https://www.cloudflare.com/ips-v6";

type Spy = ReturnType<typeof getJestSpyOn>;

/*
 * What the edge publishes, by the address of each list - a list it does not
 * publish fails to read - and every address read, in order.
 */
function publish(lists: Record<string, string>): Array<string> {
  const read: Array<string> = [];

  SecurityEdgeRanges.setFetchForTests(async (url: string): Promise<string> => {
    read.push(url);

    const text: string | undefined = lists[url];

    if (text === undefined) {
      throw new Error(`${url} answered 503`);
    }

    return text;
  });

  return read;
}

function rangesAt(
  now: number,
  edge: SecurityEdge = CLOUDFLARE_EDGE,
): Promise<Array<string>> {
  return SecurityEdgeRanges.getRanges(edge, now);
}

// The connections that say a project is behind Cloudflare, as each test leaves them.
let cloudflareProviders: Array<SecurityEventConnectorProvider> = [];

beforeEach(() => {
  // The logger's calls, from the test before.
  jest.clearAllMocks();
  cloudflareProviders = CLOUDFLARE_EDGE.connectorProviders;
});

afterEach(() => {
  CLOUDFLARE_EDGE.connectorProviders = cloudflareProviders;
  // The real fetch back, and the ranges read so far forgotten.
  SecurityEdgeRanges.setFetchForTests(null);
  jest.restoreAllMocks();
});

describe("SecurityEdgeRanges.findConnectedEdges", () => {
  test("an edge that names no connection is behind no project, and nothing is read", async () => {
    CLOUDFLARE_EDGE.connectorProviders = [];

    const count: Spy = getJestSpyOn(
      SecurityEventConnectionService,
      "countBy",
    ).mockResolvedValue(new PositiveNumber(1) as never);

    await expect(
      SecurityEdgeRanges.findConnectedEdges(PROJECT_ID),
    ).resolves.toEqual([]);
    expect(count).not.toHaveBeenCalled();
  });

  test("Cloudflare's edge is the one its connection says a project sits behind (#10565)", () => {
    expect(CLOUDFLARE_EDGE.connectorProviders).toEqual([
      SecurityEventConnectorProvider.Cloudflare,
    ]);
    expect(SECURITY_EDGES).toContain(CLOUDFLARE_EDGE);
  });

  test("a project is behind Cloudflare while it has a Cloudflare connection, enabled or paused", async () => {
    const count: Spy = getJestSpyOn(
      SecurityEventConnectionService,
      "countBy",
    ).mockResolvedValue(new PositiveNumber(1) as never);

    await expect(
      SecurityEdgeRanges.findConnectedEdges(PROJECT_ID),
    ).resolves.toEqual([CLOUDFLARE_EDGE]);

    expect(count).toHaveBeenCalledTimes(1);

    const input: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = count.mock.calls[0]?.[0] as {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };

    // The project's own connections, whoever asks, a paused one too: no isEnabled.
    expect(Object.keys(input.query).sort()).toEqual(["projectId", "provider"]);
    expect(input.query["projectId"]).toEqual(PROJECT_ID);
    // Cloudflare's connections only: the provider IN (Cloudflare).
    expect(
      Object.values(
        (
          input.query["provider"] as {
            objectLiteralParameters: Record<string, unknown>;
          }
        ).objectLiteralParameters,
      ),
    ).toEqual([[SecurityEventConnectorProvider.Cloudflare]]);
    expect(input.props).toEqual({ isRoot: true });

    count.mockResolvedValue(new PositiveNumber(0) as never);

    await expect(
      SecurityEdgeRanges.findConnectedEdges(PROJECT_ID),
    ).resolves.toEqual([]);
  });

  test("a count that fails is not taken for no edge: it throws, for the caller to fail toward a person", async () => {
    getJestSpyOn(SecurityEventConnectionService, "countBy").mockRejectedValue(
      new Error("database is down") as never,
    );

    await expect(
      SecurityEdgeRanges.findConnectedEdges(PROJECT_ID),
    ).rejects.toThrow("database is down");
  });
});

describe("SecurityEdgeRanges.getRanges", () => {
  test("reads every list the edge publishes, blank lines and comments left out", async () => {
    const read: Array<string> = publish({
      [IPV4_LIST]: "173.245.48.0/20\n103.21.244.0/22\n\n# IPv4\n",
      [IPV6_LIST]: "2400:cb00::/32\r\n  2606:4700::/32  \n",
    });

    await expect(rangesAt(NOW)).resolves.toEqual([
      "173.245.48.0/20",
      "103.21.244.0/22",
      "2400:cb00::/32",
      "2606:4700::/32",
    ]);
    expect(read).toEqual([IPV4_LIST, IPV6_LIST]);
  });

  test("reads them at most once a day", async () => {
    const read: Array<string> = publish({
      [IPV4_LIST]: "173.245.48.0/20",
      [IPV6_LIST]: "2400:cb00::/32",
    });

    await rangesAt(NOW);
    await expect(
      rangesAt(NOW + EDGE_RANGES_REFRESH_IN_MS - 1),
    ).resolves.toEqual(["173.245.48.0/20", "2400:cb00::/32"]);
    expect(read).toEqual([IPV4_LIST, IPV6_LIST]);

    await rangesAt(NOW + EDGE_RANGES_REFRESH_IN_MS);
    expect(read).toEqual([IPV4_LIST, IPV6_LIST, IPV4_LIST, IPV6_LIST]);
  });

  test("each edge's ranges are its own", async () => {
    const other: SecurityEdge = {
      name: "Other Edge",
      rangeUrls: ["https://edge.example.com/ranges"],
      knownRanges: ["192.0.2.0/24"],
      connectorProviders: [],
    };
    const read: Array<string> = publish({
      [IPV4_LIST]: "173.245.48.0/20",
      [IPV6_LIST]: "2400:cb00::/32",
      "https://edge.example.com/ranges": "198.51.100.0/24",
    });

    await expect(rangesAt(NOW)).resolves.toEqual([
      "173.245.48.0/20",
      "2400:cb00::/32",
    ]);
    await expect(rangesAt(NOW, other)).resolves.toEqual(["198.51.100.0/24"]);
    expect(read).toEqual([
      IPV4_LIST,
      IPV6_LIST,
      "https://edge.example.com/ranges",
    ]);
  });

  test("when a list cannot be read, the ranges the edge was written with stand in", async () => {
    publish({ [IPV4_LIST]: "173.245.48.0/20" });

    await expect(rangesAt(NOW)).resolves.toEqual(CLOUDFLARE_EDGE.knownRanges);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("could not read Cloudflare's ranges"),
    );
  });

  test("a list with a line that is no range is no list of ranges", async () => {
    publish({
      [IPV4_LIST]: "173.245.48.0/20\n<html>Access denied</html>",
      [IPV6_LIST]: "2400:cb00::/32",
    });

    await expect(rangesAt(NOW)).resolves.toEqual(CLOUDFLARE_EDGE.knownRanges);
  });

  test("nor is an empty list, or one longer than any edge publishes", async () => {
    publish({ [IPV4_LIST]: "# none\n", [IPV6_LIST]: "" });

    await expect(rangesAt(NOW)).resolves.toEqual(CLOUDFLARE_EDGE.knownRanges);

    publish({
      [IPV4_LIST]: "",
      [IPV6_LIST]: Array.from(
        { length: 1001 },
        (_: unknown, index: number): string => {
          return `2001:db8:${index.toString(16)}::/48`;
        },
      ).join("\n"),
    });

    await expect(rangesAt(NOW)).resolves.toEqual(CLOUDFLARE_EDGE.knownRanges);
  });

  test("after a failure they are read again within the hour, not in a day", async () => {
    const lists: Record<string, string> = { [IPV4_LIST]: "173.245.48.0/20" };
    const read: Array<string> = publish(lists);

    await expect(rangesAt(NOW)).resolves.toEqual(CLOUDFLARE_EDGE.knownRanges);
    expect(read).toEqual([IPV4_LIST, IPV6_LIST]);

    await expect(rangesAt(NOW + EDGE_RANGES_RETRY_IN_MS - 1)).resolves.toEqual(
      CLOUDFLARE_EDGE.knownRanges,
    );
    expect(read).toEqual([IPV4_LIST, IPV6_LIST]);

    lists[IPV6_LIST] = "2400:cb00::/32";

    await expect(rangesAt(NOW + EDGE_RANGES_RETRY_IN_MS)).resolves.toEqual([
      "173.245.48.0/20",
      "2400:cb00::/32",
    ]);
    expect(read).toEqual([IPV4_LIST, IPV6_LIST, IPV4_LIST, IPV6_LIST]);
  });

  test("the copy Cloudflare was written with is its ranges, as it publishes them", () => {
    expect(CLOUDFLARE_EDGE.rangeUrls).toEqual([IPV4_LIST, IPV6_LIST]);
    expect(CLOUDFLARE_EDGE.knownRanges.length).toBeGreaterThan(0);

    for (const range of CLOUDFLARE_EDGE.knownRanges) {
      expect(NetworkAddressBlockUtil.parse(range)?.text).toBe(range);
    }
  });
});
