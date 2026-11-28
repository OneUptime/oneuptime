import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityLogSource from "../../../../Models/DatabaseModels/SecurityLogSource";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import LogService, {
  FindSecurityLogCandidatesData,
} from "../../../../Server/Services/LogService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import SecurityLogSourceService from "../../../../Server/Services/SecurityLogSourceService";
import logger from "../../../../Server/Utils/Logger";
import SecurityEdgeRanges, {
  CLOUDFLARE_EDGE,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityEdgeRanges";
import SecurityLogScanner, {
  LOG_SCAN_SETTLE_IN_SECONDS,
  SECURITY_LOGS_SERVICE_NAME,
} from "../../../../Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";
import SecurityLogLineCheckReader from "../../../../Server/Utils/SecurityEvent/SecurityLogLineCheck";
import SecurityTrustedProxies from "../../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import ThreatIntelEnricher from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import { CloudRelationshipKind } from "../../../../Types/Cloud/CloudInventory";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SecurityLogLineCheckResult } from "../../../../Types/SecurityEvent/SecurityLogLineCheck";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import {
  AZURE_PUBLIC_IP_ADDRESS_TYPE,
  GCP_FORWARDING_RULE_TYPE,
} from "../../../../Utils/SecurityEvent/OwnLoadBalancers";
import { TrustedProxySource } from "../../../../Utils/SecurityEvent/TrustedProxySources";
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
 * #11046: CHECK A LOG LINE NAMES THE CLIENT THE SCAN STORES.
 *
 * Each case below hands one line to both: the every-minute log scan, end to
 * end over a stubbed Log table and the real SecurityTrustedProxies, which
 * stores a row; and Check a log line's server reader, over the same stubbed
 * project, edges and cloud inventory. The client each names - its address,
 * how it was known, what the request only claimed and the proxies it came
 * through - must be the same, for every source of trust: a private proxy
 * with the Access Logs switch on and off, a listed public proxy, a
 * connected edge, the project's own load balancers with Your Load Balancers
 * on and off, Google's front ends, and a forged X-Forwarded-For from a
 * first field nobody trusts.
 */

const NOW: Date = new Date("2026-11-27T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11046000-0000-4000-8000-000000000001",
);
const SOURCE_ID: ObjectID = new ObjectID(
  "11046000-0000-4000-8000-000000000002",
);
const LOGS_SERVICE_ID: ObjectID = new ObjectID(
  "11046000-0000-4000-8000-000000000003",
);

const PRIVATE_PROXY: string = "10.0.0.5";
const CLIENT: string = "198.51.100.7";
const INNOCENT: string = "192.0.2.44";
const LISTED_PROXY: string = "203.0.113.10";
const CLOUDFLARE_ADDRESS: string = "104.16.1.1";
const GATEWAY_ADDRESS: string = "20.50.1.7";
const UNTRUSTED_HOST: string = "203.0.113.50";
const GOOGLE_LB: string = "34.120.1.2";
const GOOGLE_FRONT_END: string = "35.191.7.8";

// The issue's line: a SQL injection, behind `first`, forwarded for `forwardedFor`.
function combinedLine(first: string, forwardedFor: string = CLIENT): string {
  return `${first} - - [10/Oct/2026:13:55:36 +0000] "GET /?id=1' OR '1'='1 HTTP/1.1" 200 512 "-" "curl/8.0" "${forwardedFor}"`;
}

function toClickhouse(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

interface Setup {
  project?: Partial<Project> | undefined;
  edges?: Array<typeof CLOUDFLARE_EDGE> | undefined;
  inventory?: Array<CloudResource> | undefined;
}

function resource(data: Record<string, unknown>): CloudResource {
  const row: CloudResource = new CloudResource();

  Object.assign(row, {
    _id: ObjectID.generate().toString(),
    cloudConnection: { name: "Production" },
    ...data,
  });

  return row;
}

// The project's Azure Application Gateway, by its public IP address.
const GATEWAY: CloudResource = resource({
  name: "web-pip",
  cloudResourceType: AZURE_PUBLIC_IP_ADDRESS_TYPE,
  cloudEndpoints: [GATEWAY_ADDRESS],
  cloudRelationships: [
    {
      kind: CloudRelationshipKind.AttachedTo,
      target:
        "/subscriptions/1111/resourceGroups/web/providers/Microsoft.Network/applicationGateways/web-agw",
    },
  ],
});

// The project's Google Cloud global external Application Load Balancer.
const GOOGLE_ALB: CloudResource = resource({
  name: "shop-https",
  cloudResourceType: GCP_FORWARDING_RULE_TYPE,
  providerResourceId:
    "//compute.googleapis.com/projects/shop/global/forwardingRules/shop-https",
  cloudProperties: {
    IPAddress: GOOGLE_LB,
    loadBalancingScheme: "EXTERNAL_MANAGED",
  },
  cloudRelationships: [
    {
      kind: CloudRelationshipKind.RoutesTo,
      target: "//compute.googleapis.com/projects/shop/global/urlMaps/shop",
      targetType: "https_lb_rule",
    },
  ],
});

// The project, its edges and its cloud inventory, as both the scan and the check read them.
function useProject(setup: Setup): void {
  const project: Project = new Project();
  Object.assign(project, setup.project || {});

  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
    project as never,
  );
  getJestSpyOn(SecurityEdgeRanges, "findConnectedEdges").mockResolvedValue(
    (setup.edges || []) as never,
  );
  getJestSpyOn(SecurityEdgeRanges, "getRanges").mockResolvedValue([
    "104.16.0.0/13",
  ] as never);
  getJestSpyOn(CloudResourceService, "findBy").mockResolvedValue(
    (setup.inventory || []) as never,
  );

  SecurityTrustedProxies.clearCache();
}

// The scan, end to end over one log line: the row it stores.
async function scan(body: string): Promise<JSONObject> {
  const inserted: Array<JSONObject> = [];
  const arrivedAt: Date = new Date(NOW.getTime() - 90 * 1000);

  getJestSpyOn(LogService, "findSecurityLogCandidates").mockImplementation(
    (async (
      data: FindSecurityLogCandidatesData,
    ): Promise<Array<JSONObject>> => {
      // The line arrived in one window: read there, once.
      const isInWindow: boolean =
        arrivedAt.getTime() > data.arrivedAfter.getTime() &&
        arrivedAt.getTime() <= data.arrivedUntil.getTime();

      return data.offset > 0 || !isInWindow
        ? []
        : [
            {
              _id: "11046000-0000-4000-8000-0000000000aa",
              time: toClickhouse(arrivedAt),
              createdAt: toClickhouse(arrivedAt),
              attributes: {},
              body,
              traceId: "",
              spanId: "",
              sessionId: "",
            },
          ];
    }) as never,
  );
  getJestSpyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue(
    {
      serviceName: SECURITY_LOGS_SERVICE_NAME,
      primaryEntityId: LOGS_SERVICE_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: 15,
      projectRetentionConfig: null,
      projectRetentionInDays: 30,
    } as unknown as TelemetryServiceMetadata as never,
  );
  getJestSpyOn(ThreatIntelEnricher, "enrichNormalizedEvents").mockResolvedValue(
    { eventsMatched: 0, valuesLookedUp: 0 } as never,
  );
  getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(
    (async (rows: Array<JSONObject>): Promise<void> => {
      inserted.push(...rows);
    }) as never,
  );
  getJestSpyOn(SecurityLogSourceService, "updateOneById").mockResolvedValue(
    1 as never,
  );

  const source: SecurityLogSource = new SecurityLogSource();
  source.id = SOURCE_ID;
  source.projectId = PROJECT_ID;
  source.isEnabled = true;
  source.cursor = new Date(
    NOW.getTime() - (LOG_SCAN_SETTLE_IN_SECONDS + 600) * 1000,
  ).toISOString();

  await SecurityLogScanner.scanSource(source);

  expect(inserted).toHaveLength(1);

  return inserted[0]!;
}

// Check a log line, as the server answers it.
async function checkLine(body: string): Promise<SecurityLogLineCheckResult> {
  SecurityTrustedProxies.clearCache();

  return await SecurityLogLineCheckReader.check({
    projectId: PROJECT_ID,
    text: body,
  });
}

// The client a stored row or an event names, and how it was known.
interface NamedClient {
  principalIp: string;
  trust: string;
  claimed: string;
  forwardedBy: string;
}

function namedBy(
  principalIp: unknown,
  attributes: Record<string, unknown>,
): NamedClient {
  const text: (key: string) => string = (key: string): string => {
    const value: unknown = attributes[key];
    return typeof value === "string" ? value : "";
  };

  return {
    principalIp: typeof principalIp === "string" ? principalIp : "",
    trust: text(SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust),
    claimed: text(SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress),
    forwardedBy: text(SECURITY_REQUEST_ATTRIBUTES.forwardedBy),
  };
}

// The line through both: what the stored row names, and that the check names the same.
async function bothName(body: string): Promise<{
  stored: NamedClient;
  checked: SecurityLogLineCheckResult;
}> {
  const row: JSONObject = await scan(body);
  const stored: NamedClient = namedBy(
    row["principalIp"],
    (row["attributes"] || {}) as Record<string, unknown>,
  );
  const checked: SecurityLogLineCheckResult = await checkLine(body);

  expect(checked.events).toHaveLength(1);

  const event: NormalizedSecurityEvent = checked.events[0]!;

  expect(namedBy(event.principalIp, event.attributes)).toEqual(stored);

  return { stored, checked };
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  SecurityTrustedProxies.clearCache();
  jest.restoreAllMocks();
});

describe("a private proxy", () => {
  test("with Logs End With X-Forwarded-For on, both name the client it forwarded", async () => {
    useProject({ project: { securityReadAccessLogForwardedFor: true } });

    const { stored, checked } = await bothName(combinedLine(PRIVATE_PROXY));

    expect(stored).toEqual({
      principalIp: CLIENT,
      trust: "trusted-proxy",
      claimed: "",
      forwardedBy: PRIVATE_PROXY,
    });
    expect(checked.trustedProxies).toEqual([
      {
        address: PRIVATE_PROXY,
        source: TrustedProxySource.Private,
        edgeName: "",
      },
    ]);
  });

  test("with it off, both name the proxy, the line's first field", async () => {
    useProject({ project: { securityReadAccessLogForwardedFor: false } });

    const { stored } = await bothName(combinedLine(PRIVATE_PROXY));

    expect(stored).toEqual({
      principalIp: PRIVATE_PROXY,
      trust: "peer",
      claimed: "",
      forwardedBy: "",
    });
  });

  test("a JSON access log's X-Forwarded-For, which needs no switch", async () => {
    useProject({});

    const { stored } = await bothName(
      JSON.stringify({
        remote_addr: PRIVATE_PROXY,
        http_x_forwarded_for: `${INNOCENT}, ${CLIENT}`,
        request: "GET /?id=1' OR '1'='1 HTTP/1.1",
        status: 200,
      }),
    );

    expect(stored).toEqual({
      principalIp: CLIENT,
      trust: "trusted-proxy",
      claimed: INNOCENT,
      forwardedBy: PRIVATE_PROXY,
    });
  });
});

describe("a public proxy", () => {
  test("listed under Trusted Proxies: both name the client", async () => {
    useProject({
      project: {
        securityReadAccessLogForwardedFor: true,
        securityTrustedProxies: "203.0.113.0/24",
      },
    });

    const { stored, checked } = await bothName(combinedLine(LISTED_PROXY));

    expect(stored.principalIp).toBe(CLIENT);
    expect(checked.trustedProxies[0]!.source).toBe(TrustedProxySource.Listed);
  });

  test("not listed: both name the proxy", async () => {
    useProject({ project: { securityReadAccessLogForwardedFor: true } });

    const { stored } = await bothName(combinedLine(LISTED_PROXY));

    expect(stored.principalIp).toBe(LISTED_PROXY);
  });
});

describe("a connected edge", () => {
  test("Cloudflare's address: both name the client it forwarded", async () => {
    useProject({
      project: { securityReadAccessLogForwardedFor: true },
      edges: [CLOUDFLARE_EDGE],
    });

    const { stored, checked } = await bothName(
      combinedLine(CLOUDFLARE_ADDRESS),
    );

    expect(stored.principalIp).toBe(CLIENT);
    expect(checked.trustedProxies).toEqual([
      {
        address: CLOUDFLARE_ADDRESS,
        source: TrustedProxySource.Edge,
        edgeName: "Cloudflare",
      },
    ]);
  });

  test("an edge the project never connected: both name the edge's address", async () => {
    useProject({ project: { securityReadAccessLogForwardedFor: true } });

    const { stored } = await bothName(combinedLine(CLOUDFLARE_ADDRESS));

    expect(stored.principalIp).toBe(CLOUDFLARE_ADDRESS);
  });
});

describe("the project's own load balancers", () => {
  test("an Application Gateway: both name the client it forwarded", async () => {
    useProject({
      project: { securityReadAccessLogForwardedFor: true },
      inventory: [GATEWAY],
    });

    const { stored, checked } = await bothName(combinedLine(GATEWAY_ADDRESS));

    expect(stored.principalIp).toBe(CLIENT);
    expect(checked.trustedProxies[0]!.source).toBe(
      TrustedProxySource.OwnLoadBalancer,
    );
  });

  test("with Your Load Balancers off: both name the load balancer", async () => {
    useProject({
      project: {
        securityReadAccessLogForwardedFor: true,
        securityTrustOwnLoadBalancers: false,
      },
      inventory: [GATEWAY],
    });

    const { stored } = await bothName(combinedLine(GATEWAY_ADDRESS));

    expect(stored.principalIp).toBe(GATEWAY_ADDRESS);
  });

  test("an inventory that cannot be read: both trust the rest, and name the load balancer", async () => {
    useProject({
      project: { securityReadAccessLogForwardedFor: true },
      inventory: [GATEWAY],
    });
    getJestSpyOn(CloudResourceService, "findBy").mockRejectedValue(
      new Error("connection refused") as never,
    );

    const { stored } = await bothName(combinedLine(GATEWAY_ADDRESS));

    expect(stored.principalIp).toBe(GATEWAY_ADDRESS);
  });
});

describe("a forged X-Forwarded-For", () => {
  test("from a first field nobody trusts: both keep the first field, and the forgery is only claimed", async () => {
    useProject({ project: { securityReadAccessLogForwardedFor: true } });

    const { stored } = await bothName(combinedLine(UNTRUSTED_HOST, INNOCENT));

    expect(stored).toEqual({
      principalIp: UNTRUSTED_HOST,
      trust: "peer",
      claimed: "",
      forwardedBy: "",
    });
  });

  test("behind a trusted proxy: both verify only the rightmost hop no trusted proxy wrote", async () => {
    useProject({ project: { securityReadAccessLogForwardedFor: true } });

    const { stored } = await bothName(
      combinedLine(PRIVATE_PROXY, `${INNOCENT}, ${CLIENT}`),
    );

    expect(stored).toEqual({
      principalIp: CLIENT,
      trust: "trusted-proxy",
      claimed: INNOCENT,
      forwardedBy: PRIVATE_PROXY,
    });
  });
});

describe("a project that cannot be read", () => {
  test("both trust only private addresses", async () => {
    useProject({});
    getJestSpyOn(ProjectService, "findOneById").mockRejectedValue(
      new Error("database down") as never,
    );

    const { stored } = await bothName(combinedLine(LISTED_PROXY));

    expect(stored.principalIp).toBe(LISTED_PROXY);
  });
});

// Google's front ends are trusted with the load balancer that brings them (#11047).
describe("Google's front ends", () => {
  test("behind the project's global external Application Load Balancer: both name the client", async () => {
    useProject({
      project: { securityReadAccessLogForwardedFor: true },
      inventory: [GOOGLE_ALB],
    });

    const { stored, checked } = await bothName(
      combinedLine(GOOGLE_FRONT_END, `${CLIENT}, ${GOOGLE_LB}`),
    );

    expect(stored).toEqual({
      principalIp: CLIENT,
      trust: "trusted-proxy",
      claimed: "",
      forwardedBy: `${GOOGLE_LB}, ${GOOGLE_FRONT_END}`,
    });
    expect(checked.trustedProxies).toEqual([
      {
        address: GOOGLE_LB,
        source: TrustedProxySource.OwnLoadBalancer,
        edgeName: "",
      },
      {
        address: GOOGLE_FRONT_END,
        source: TrustedProxySource.GoogleFrontEnd,
        edgeName: "",
      },
    ]);
  });

  test("with Your Load Balancers off: both name the front end", async () => {
    useProject({
      project: {
        securityReadAccessLogForwardedFor: true,
        securityTrustOwnLoadBalancers: false,
      },
      inventory: [GOOGLE_ALB],
    });

    const { stored } = await bothName(
      combinedLine(GOOGLE_FRONT_END, `${CLIENT}, ${GOOGLE_LB}`),
    );

    expect(stored.principalIp).toBe(GOOGLE_FRONT_END);
  });
});

// A line in the project's own log format is read field by field (#11048).
describe("the project's own log format", () => {
  const TIMED: string = `log_format timed '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$http_x_forwarded_for" $request_time';`;

  function timedLine(first: string, forwardedFor: string): string {
    return `${first} - - [10/Oct/2026:13:55:36 +0000] "GET /?id=1' OR '1'='1 HTTP/1.1" 200 512 "-" "curl/8.0" "${forwardedFor}" 0.004`;
  }

  test("X-Forwarded-For before $request_time: both name the client it forwarded", async () => {
    useProject({ project: { securityAccessLogFormat: TIMED } });

    const { stored } = await bothName(
      timedLine(PRIVATE_PROXY, `${INNOCENT}, ${CLIENT}`),
    );

    expect(stored).toEqual({
      principalIp: CLIENT,
      trust: "trusted-proxy",
      claimed: INNOCENT,
      forwardedBy: PRIVATE_PROXY,
    });
  });

  test("not given: both name the proxy, as the combined format is read", async () => {
    useProject({ project: { securityReadAccessLogForwardedFor: true } });

    const { stored } = await bothName(timedLine(PRIVATE_PROXY, CLIENT));

    expect(stored.principalIp).toBe(PRIVATE_PROXY);
  });

  test("a forged header from a first field nobody trusts: both keep the first field", async () => {
    useProject({ project: { securityAccessLogFormat: TIMED } });

    const { stored } = await bothName(timedLine(UNTRUSTED_HOST, INNOCENT));

    expect(stored.principalIp).toBe(UNTRUSTED_HOST);
    expect(stored.trust).toBe("peer");
  });
});
