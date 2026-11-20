import AuditLogService from "../../../../Server/Services/AuditLogService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import HostService from "../../../../Server/Services/HostService";
import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import NetworkAddressNameService from "../../../../Server/Services/NetworkAddressNameService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import ProbeService from "../../../../Server/Services/ProbeService";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityBlockService, {
  SecurityBlockOutcome,
  SecurityBlockOutcomeStatus,
} from "../../../../Server/Services/SecurityBlockService";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import SecurityProtectedEntityService from "../../../../Server/Services/SecurityProtectedEntityService";
import logger from "../../../../Server/Utils/Logger";
import SecurityBlocklistJobs from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import SecurityEdgeRanges from "../../../../Server/Utils/SecurityBlocklist/SecurityEdgeRanges";
import SecurityProtectedAddresses from "../../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import SecurityTrustedProxies from "../../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SecurityBlockSource } from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityProtectedAddressSource } from "../../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import { ClientAddressTrust } from "../../../../Utils/SecurityEvent/ClientAddressTrust";
import {
  TraceScanSpan,
  buildTraceSecurityEvents,
} from "../../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * #10565: A CONNECTED CLOUDFLARE IS THE EDGE IN FRONT OF THE APP.
 *
 * Behind Cloudflare, every request a project's app receives comes from one
 * of Cloudflare's addresses, and the client is the address Cloudflare
 * forwards in X-Forwarded-For. #10338 protects a connected edge's published
 * ranges from blocks, and #10416 trusts them as a proxy, but the Cloudflare
 * connection (#10339) never named itself as an edge, so neither happened:
 * a project behind Cloudflare could block Cloudflare's addresses - taking
 * its own site down - and had every attack blamed on Cloudflare.
 *
 * Driven here through the real paths, with only the database in memory: a
 * block goes through SecurityBlockService.block, which asks
 * SecurityProtectedAddresses, which asks SecurityEdgeRanges, which counts
 * the project's Cloudflare connections in the connections table; a trace is
 * read with the proxies SecurityTrustedProxies reads for the project. The
 * project's other sources of addresses hold nothing, and Cloudflare
 * publishes its ranges as the test says, so nothing reaches the network.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10565000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10565000-0000-4000-8000-000000000002",
);

// One of Cloudflare's edge addresses, in 104.16.0.0/13.
const CLOUDFLARE_ADDRESS: string = "104.16.1.1";
// The client Cloudflare forwarded, after what the sender wrote.
const SENDERS_CLAIM: string = "192.0.2.44";
const FORWARDED_CLIENT: string = "203.0.113.7";

let connections: InMemoryTable;
let blocks: InMemoryTable;

function connectionRow(data: {
  id: string;
  projectId: ObjectID;
  provider: SecurityEventConnectorProvider;
  isEnabled: boolean;
}): StoredRow {
  return {
    _id: data.id,
    projectId: data.projectId.toString(),
    name: `${data.provider} connection`,
    provider: data.provider,
    isEnabled: data.isEnabled,
    config: {},
    secrets: "{}",
  };
}

function cloudflareConnection(data: {
  isEnabled: boolean;
  projectId?: ObjectID | undefined;
}): StoredRow {
  return connectionRow({
    id: ObjectID.generate().toString(),
    projectId: data.projectId || PROJECT_ID,
    provider: SecurityEventConnectorProvider.Cloudflare,
    isEnabled: data.isEnabled,
  });
}

function blockAsOneUptime(value: string): Promise<SecurityBlockOutcome> {
  return SecurityBlockService.block({
    projectId: PROJECT_ID,
    value,
    reason: "Scanning for .env files",
    source: SecurityBlockSource.Playbook,
    props: { isRoot: true },
  });
}

/*
 * A request through Cloudflare: the connection is Cloudflare's, its
 * X-Forwarded-For is the sender's claim and then the client Cloudflare
 * appended, and its URL carries an attack, so the trace scan reads it.
 */
function spanThroughCloudflare(): TraceScanSpan {
  return {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    parentSpanId: "",
    sessionId: "",
    name: "GET /download",
    kind: "SPAN_KIND_SERVER",
    durationMs: 12,
    startTime: new Date("2026-11-20T10:00:00.000Z"),
    serviceId: "0192f1a0-0000-7000-8000-00000000c001",
    serviceType: "OpenTelemetry",
    isLlmSpan: false,
    llmUserMessagePreview: "",
    llmUserId: "",
    llmSystem: "",
    llmRequestModel: "",
    llmOperation: "",
    attributes: {
      "http.request.method": "GET",
      "url.path": "/download",
      "url.query": "file=../../../../etc/passwd",
      "http.response.status_code": "404",
      "network.peer.address": CLOUDFLARE_ADDRESS,
      "client.address": SENDERS_CLAIM,
      "http.request.header.x-forwarded-for": `${SENDERS_CLAIM}, ${FORWARDED_CLIENT}`,
    },
  };
}

async function readTraceThroughCloudflare(): Promise<NormalizedSecurityEvent> {
  const events: Array<NormalizedSecurityEvent> = buildTraceSecurityEvents(
    spanThroughCloudflare(),
    {
      trustedProxies: await SecurityTrustedProxies.getForProject(PROJECT_ID),
    },
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({ projectId: PROJECT_ID });

  connections = useInMemoryTable(
    SecurityEventConnectionService as unknown as DatabaseService<BaseModel>,
    [],
  );
  blocks = useInMemoryTable(
    SecurityBlockService as unknown as DatabaseService<BaseModel>,
    [],
  );

  // The project's own addresses: none, of any kind.
  for (const service of [
    SecurityProtectedEntityService,
    ProbeService,
    NetworkAddressNameService,
    HostService,
    KubernetesResourceService,
    CloudResourceService,
    NetworkDeviceService,
    NetworkEndpointService,
  ]) {
    getJestSpyOn(service, "findBy").mockResolvedValue([] as never);
  }

  getJestSpyOn(
    SecurityProtectedAddresses,
    "getOneUptimeCloudProtections",
  ).mockReturnValue([]);

  // Cloudflare's ranges, as https://www.cloudflare.com/ips-v4 and /ips-v6 publish them.
  SecurityEdgeRanges.setFetchForTests(async (url: string): Promise<string> => {
    return url.endsWith("v6")
      ? "2400:cb00::/32\n2606:4700::/32\n"
      : "173.245.48.0/20\n104.16.0.0/13\n104.24.0.0/14\n172.64.0.0/13\n";
  });

  // The project lists no Trusted Proxies of its own.
  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
    new Project() as never,
  );

  getJestSpyOn(SecurityBlocklistJobs, "queueReconcile").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(
    undefined as never,
  );

  SecurityTrustedProxies.clearCache();
});

afterEach(() => {
  SecurityEdgeRanges.setFetchForTests(null);
  SecurityTrustedProxies.clearCache();
  jest.restoreAllMocks();
});

describe("a project with a Cloudflare connection is behind Cloudflare (#10565)", () => {
  // The connection's on-off switch only pauses its polling: the app still sits behind Cloudflare.
  const states: Array<[string, boolean]> = [
    ["enabled", true],
    ["paused", false],
  ];

  test.each(states)(
    "with its connection %s, a block of one of Cloudflare's addresses is refused, naming Cloudflare",
    async (_state: string, isEnabled: boolean) => {
      connections.rows.push(cloudflareConnection({ isEnabled }));

      const outcome: SecurityBlockOutcome =
        await blockAsOneUptime(CLOUDFLARE_ADDRESS);

      expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Protected);

      if (outcome.status !== SecurityBlockOutcomeStatus.Protected) {
        throw new Error("The block was not refused as protected.");
      }

      expect(outcome.protection).toEqual({
        source: SecurityProtectedAddressSource.Edge,
        protectedValue: "104.16.0.0/13",
        name: "Cloudflare",
      });
      expect(outcome.message).toBe(
        "104.16.1.1 is inside 104.16.0.0/13. 104.16.0.0/13 is one of Cloudflare's addresses, and Cloudflare is in front of your app: blocking it would take your site down.",
      );

      // Nothing was written.
      expect(blocks.rows).toEqual([]);
    },
  );

  test.each(states)(
    "with its connection %s, the client Cloudflare forwarded is the one an attack is blamed on",
    async (_state: string, isEnabled: boolean) => {
      connections.rows.push(cloudflareConnection({ isEnabled }));

      const event: NormalizedSecurityEvent = await readTraceThroughCloudflare();

      expect(event.principalIp).toBe(FORWARDED_CLIENT);
      expect(
        event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust],
      ).toBe(ClientAddressTrust.TrustedProxy);
      // What the sender wrote is kept as a claim, never as the address.
      expect(
        event.attributes[SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress],
      ).toBe(SENDERS_CLAIM);
    },
  );

  test("a range that holds a Cloudflare address is refused too, and so is an IPv6 address of Cloudflare's", async () => {
    connections.rows.push(cloudflareConnection({ isEnabled: true }));

    const range: SecurityBlockOutcome = await blockAsOneUptime("104.16.1.0/24");
    const ipv6: SecurityBlockOutcome = await blockAsOneUptime(
      "2606:4700::6810:84e5",
    );

    expect(range.status).toBe(SecurityBlockOutcomeStatus.Protected);
    expect(ipv6.status).toBe(SecurityBlockOutcomeStatus.Protected);
    expect(blocks.rows).toEqual([]);
  });

  test("an address that is not Cloudflare's is blocked as before, behind Cloudflare too", async () => {
    connections.rows.push(cloudflareConnection({ isEnabled: true }));

    const outcome: SecurityBlockOutcome =
      await blockAsOneUptime(FORWARDED_CLIENT);

    expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Blocked);
    expect(blocks.rows).toHaveLength(1);
    expect(blocks.rows[0]?.["value"]).toBe(FORWARDED_CLIENT);
  });
});

describe("a project without a Cloudflare connection is behind no edge", () => {
  test("it blocks a Cloudflare address as before", async () => {
    // Connections that say nothing of this project's edge.
    connections.rows.push(
      connectionRow({
        id: ObjectID.generate().toString(),
        projectId: PROJECT_ID,
        provider: SecurityEventConnectorProvider.Okta,
        isEnabled: true,
      }),
      cloudflareConnection({ isEnabled: true, projectId: OTHER_PROJECT_ID }),
    );

    const outcome: SecurityBlockOutcome =
      await blockAsOneUptime(CLOUDFLARE_ADDRESS);

    expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Blocked);
    expect(blocks.rows).toHaveLength(1);
    expect(blocks.rows[0]?.["value"]).toBe(CLOUDFLARE_ADDRESS);
  });

  test("its trace blames the address that connected: the peer", async () => {
    const event: NormalizedSecurityEvent = await readTraceThroughCloudflare();

    expect(event.principalIp).toBe(CLOUDFLARE_ADDRESS);
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust],
    ).toBe(ClientAddressTrust.Peer);
  });
});

describe("when the connections cannot be counted", () => {
  test("a block is refused, as OneUptime cannot tell whether the address is the edge's, and the trace trusts less, never more", async () => {
    getJestSpyOn(SecurityEventConnectionService, "countBy").mockRejectedValue(
      new Error("database is down") as never,
    );

    const outcome: SecurityBlockOutcome =
      await blockAsOneUptime(FORWARDED_CLIENT);

    expect(outcome.status).toBe(SecurityBlockOutcomeStatus.Refused);
    expect(blocks.rows).toEqual([]);

    const event: NormalizedSecurityEvent = await readTraceThroughCloudflare();

    expect(event.principalIp).toBe(CLOUDFLARE_ADDRESS);
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust],
    ).toBe(ClientAddressTrust.Peer);
  });
});
