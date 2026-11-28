import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import Project from "../../../../Models/DatabaseModels/Project";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import ProjectService from "../../../../Server/Services/ProjectService";
import { CloudInventoryItem } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import CloudConnectionResourceSync from "../../../../Server/Utils/CloudConnection/CloudConnectionResourceSync";
import {
  GCP_BACKEND_SERVICE_TYPE,
  GCP_FORWARDING_RULE_TYPE as GCP_REGIONAL_FORWARDING_RULE_ASSET,
  GCP_GLOBAL_FORWARDING_RULE_TYPE,
  GCP_REGION_BACKEND_SERVICE_TYPE,
  GCP_URL_MAP_TYPE,
  GcpAsset,
  GcpInventoryContext,
  addGcpInventoryEdges,
  buildGcpInventoryContext,
  buildGcpInventoryItem,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpInventory";
import logger from "../../../../Server/Utils/Logger";
import SecurityEdgeRanges from "../../../../Server/Utils/SecurityBlocklist/SecurityEdgeRanges";
import SecurityOwnLoadBalancers, {
  OWN_LOAD_BALANCER_ROWS_READ,
  SecurityGoogleFrontEnds,
  SecurityOwnLoadBalancerBlocks,
  SecurityOwnLoadBalancersRead,
  readGoogleFrontEnds,
} from "../../../../Server/Utils/SecurityEvent/SecurityOwnLoadBalancers";
import SecurityTrustedProxies, {
  TrustedProxySourcesRead,
} from "../../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  SecurityAddressScope,
  getSecurityAddressScope,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import {
  ClientAddressTrust,
  TrustedProxies,
  readClaimedClientAddress,
  readClientAddressTrust,
  readForwardedBy,
} from "../../../../Utils/SecurityEvent/ClientAddressTrust";
import WebAttackLogParser from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  GCP_FORWARDING_RULE_TYPE,
  GOOGLE_FRONT_END_RANGES,
  GOOGLE_FRONT_END_RANGES_CHECKED_ON,
  GOOGLE_FRONT_END_RANGES_SOURCE,
  GoogleFrontEndUse,
  OwnLoadBalancerRecord,
  readGoogleFrontEndUse,
} from "../../../../Utils/SecurityEvent/OwnLoadBalancers";
import {
  TraceScanSpan,
  buildTraceSecurityEvents,
} from "../../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { trustedProxiesOf } from "../../../../Utils/SecurityEvent/TrustedProxySources";
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
 * #11047: GOOGLE'S FRONT ENDS ARE TRUSTED WITH THE LOAD BALANCER THAT BRINGS
 * THEM.
 *
 * Behind a Google Cloud global external Application Load Balancer, or a
 * classic one, an app's connections come from Google's front ends
 * (35.191.0.0/16, 130.211.0.0/22), and the front end forwards
 * `X-Forwarded-For: <client>, <load balancer>`. The load balancer was
 * trusted (#10546); the front ends had to be listed by hand, and until they
 * were every attack through one was blamed on a front end. Now they are
 * trusted while a connected Google Cloud project holds such a load
 * balancer - with Your Load Balancers, so its switch turns them off too.
 *
 * The forwarding rules here are the Compute API's shapes as Cloud Asset
 * returns them, read by the Google Cloud connection's own reader and kept as
 * the sync keeps them, so each kind of load balancer is decided from what
 * OneUptime really stores of it: global and regional, external and
 * internal, Application and proxy and passthrough.
 *
 * Trusting the ranges must never let anyone outside Google name a client,
 * so these forge X-Forwarded-For through each: through someone else's load
 * balancer from a front end, the event names that load balancer; and with a
 * TCP or SSL proxy load balancer in the project - which connects from the
 * same ranges and passes a request on as the client sent it - the ranges are
 * not trusted at all.
 */

const GCP_PROJECT: string = "shop-prod";
const COMPUTE: string = `https://www.googleapis.com/compute/v1/projects/${GCP_PROJECT}`;
const FULL: string = `//compute.googleapis.com/projects/${GCP_PROJECT}`;

const PROJECT_ID: ObjectID = new ObjectID(
  "11047000-0000-4000-8000-000000000001",
);

// Addresses: the project's load balancer, a front end, the client, and what others write.
const OWN_LOAD_BALANCER: string = "34.120.1.2";
const FRONT_END: string = "35.191.7.8";
const FRONT_END_OLD_RANGE: string = "130.211.1.9";
const FRONT_END_IPV6: string = "2600:2d00:1:1::17";
const CLIENT: string = "203.0.113.7";
const SENDERS_CLAIM: string = "192.0.2.44";
const SOMEONE_ELSES_LOAD_BALANCER: string = "34.98.9.9";

function asset(
  assetType: string,
  path: string,
  data: Record<string, unknown>,
  location: string = "global",
): GcpAsset {
  return {
    name: `${FULL}/${path}`,
    assetType,
    location,
    data: { name: path.split("/").pop(), ...data } as never,
  };
}

// The backends and URL maps the load balancers below route to.
const BACKENDS: Array<GcpAsset> = [
  asset(GCP_BACKEND_SERVICE_TYPE, "global/backendServices/web", {
    loadBalancingScheme: "EXTERNAL_MANAGED",
    protocol: "HTTP",
  }),
  asset(GCP_BACKEND_SERVICE_TYPE, "global/backendServices/classic-web", {
    loadBalancingScheme: "EXTERNAL",
    protocol: "HTTP",
  }),
  asset(GCP_BACKEND_SERVICE_TYPE, "global/backendServices/db", {
    loadBalancingScheme: "EXTERNAL_MANAGED",
    protocol: "TCP",
  }),
  asset(
    GCP_REGION_BACKEND_SERVICE_TYPE,
    "regions/europe-west1/backendServices/orders",
    {
      region: `${COMPUTE}/regions/europe-west1`,
      loadBalancingScheme: "INTERNAL_MANAGED",
      protocol: "HTTP",
    },
    "europe-west1",
  ),
  asset(
    GCP_REGION_BACKEND_SERVICE_TYPE,
    "regions/europe-west1/backendServices/regional-web",
    {
      region: `${COMPUTE}/regions/europe-west1`,
      loadBalancingScheme: "EXTERNAL_MANAGED",
      protocol: "HTTP",
    },
    "europe-west1",
  ),
  asset(
    GCP_REGION_BACKEND_SERVICE_TYPE,
    "regions/europe-west1/backendServices/game",
    {
      region: `${COMPUTE}/regions/europe-west1`,
      loadBalancingScheme: "EXTERNAL",
      protocol: "UDP",
    },
    "europe-west1",
  ),
  asset(GCP_URL_MAP_TYPE, "global/urlMaps/shop", {
    defaultService: `${COMPUTE}/global/backendServices/web`,
  }),
  asset(GCP_URL_MAP_TYPE, "global/urlMaps/classic", {
    defaultService: `${COMPUTE}/global/backendServices/classic-web`,
  }),
  asset(
    GCP_URL_MAP_TYPE,
    "regions/europe-west1/urlMaps/orders",
    {
      region: `${COMPUTE}/regions/europe-west1`,
      defaultService: `${COMPUTE}/regions/europe-west1/backendServices/orders`,
    },
    "europe-west1",
  ),
  asset(
    GCP_URL_MAP_TYPE,
    "regions/europe-west1/urlMaps/regional-web",
    {
      region: `${COMPUTE}/regions/europe-west1`,
      defaultService: `${COMPUTE}/regions/europe-west1/backendServices/regional-web`,
    },
    "europe-west1",
  ),
];

// The target proxies, listed only to draw the edges.
const PROXIES: Array<GcpAsset> = [
  asset(
    "compute.googleapis.com/TargetHttpsProxy",
    "global/targetHttpsProxies/shop-https",
    { urlMap: `${COMPUTE}/global/urlMaps/shop` },
  ),
  asset(
    "compute.googleapis.com/TargetHttpProxy",
    "global/targetHttpProxies/classic-http",
    { urlMap: `${COMPUTE}/global/urlMaps/classic` },
  ),
  asset("compute.googleapis.com/TargetTcpProxy", "global/targetTcpProxies/db", {
    service: `${COMPUTE}/global/backendServices/db`,
  }),
  asset(
    "compute.googleapis.com/TargetSslProxy",
    "global/targetSslProxies/mail",
    { service: `${COMPUTE}/global/backendServices/db` },
  ),
];

// One forwarding rule of each kind, as the Compute API writes them.
const RULES: Record<string, GcpAsset> = {
  globalExternalApplication: asset(
    GCP_GLOBAL_FORWARDING_RULE_TYPE,
    "global/forwardingRules/shop-https",
    {
      IPAddress: OWN_LOAD_BALANCER,
      IPProtocol: "TCP",
      portRange: "443-443",
      loadBalancingScheme: "EXTERNAL_MANAGED",
      target: `${COMPUTE}/global/targetHttpsProxies/shop-https`,
      networkTier: "PREMIUM",
    },
  ),
  classicApplication: asset(
    GCP_GLOBAL_FORWARDING_RULE_TYPE,
    "global/forwardingRules/classic-http",
    {
      IPAddress: "34.110.1.1",
      IPProtocol: "TCP",
      portRange: "80-80",
      loadBalancingScheme: "EXTERNAL",
      target: `${COMPUTE}/global/targetHttpProxies/classic-http`,
      networkTier: "PREMIUM",
    },
  ),
  classicApplicationStandardTier: asset(
    GCP_REGIONAL_FORWARDING_RULE_ASSET,
    "regions/europe-west1/forwardingRules/classic-standard",
    {
      region: `${COMPUTE}/regions/europe-west1`,
      IPAddress: "35.210.1.1",
      IPProtocol: "TCP",
      portRange: "80-80",
      loadBalancingScheme: "EXTERNAL",
      target: `${COMPUTE}/global/targetHttpProxies/classic-http`,
      networkTier: "STANDARD",
    },
    "europe-west1",
  ),
  regionalExternalApplication: asset(
    GCP_REGIONAL_FORWARDING_RULE_ASSET,
    "regions/europe-west1/forwardingRules/regional-web",
    {
      region: `${COMPUTE}/regions/europe-west1`,
      IPAddress: "34.76.1.1",
      IPProtocol: "TCP",
      portRange: "443-443",
      loadBalancingScheme: "EXTERNAL_MANAGED",
      target: `${COMPUTE}/regions/europe-west1/targetHttpsProxies/regional-web`,
      networkTier: "STANDARD",
    },
    "europe-west1",
  ),
  regionalInternalApplication: asset(
    GCP_REGIONAL_FORWARDING_RULE_ASSET,
    "regions/europe-west1/forwardingRules/orders",
    {
      region: `${COMPUTE}/regions/europe-west1`,
      IPAddress: "10.132.0.60",
      IPProtocol: "TCP",
      portRange: "80-80",
      loadBalancingScheme: "INTERNAL_MANAGED",
      target: `${COMPUTE}/regions/europe-west1/targetHttpProxies/orders`,
    },
    "europe-west1",
  ),
  crossRegionInternalApplication: asset(
    GCP_GLOBAL_FORWARDING_RULE_TYPE,
    "global/forwardingRules/cross-region",
    {
      IPAddress: "10.132.0.61",
      IPProtocol: "TCP",
      portRange: "80-80",
      loadBalancingScheme: "INTERNAL_MANAGED",
      target: `${COMPUTE}/global/targetHttpProxies/cross-region`,
    },
  ),
  globalTcpProxy: asset(
    GCP_GLOBAL_FORWARDING_RULE_TYPE,
    "global/forwardingRules/db",
    {
      IPAddress: "34.120.9.9",
      IPProtocol: "TCP",
      portRange: "5432-5432",
      loadBalancingScheme: "EXTERNAL_MANAGED",
      target: `${COMPUTE}/global/targetTcpProxies/db`,
    },
  ),
  classicSslProxy: asset(
    GCP_GLOBAL_FORWARDING_RULE_TYPE,
    "global/forwardingRules/mail",
    {
      IPAddress: "34.120.9.10",
      IPProtocol: "TCP",
      portRange: "993-993",
      loadBalancingScheme: "EXTERNAL",
      target: `${COMPUTE}/global/targetSslProxies/mail`,
    },
  ),
  regionalPassthrough: asset(
    GCP_REGIONAL_FORWARDING_RULE_ASSET,
    "regions/europe-west1/forwardingRules/game",
    {
      region: `${COMPUTE}/regions/europe-west1`,
      IPAddress: "34.77.1.1",
      IPProtocol: "UDP",
      ports: ["27015"],
      loadBalancingScheme: "EXTERNAL",
      backendService: `${COMPUTE}/regions/europe-west1/backendServices/game`,
    },
    "europe-west1",
  ),
  targetPool: asset(
    GCP_REGIONAL_FORWARDING_RULE_ASSET,
    "regions/us-east1/forwardingRules/legacy",
    {
      region: `${COMPUTE}/regions/us-east1`,
      IPAddress: "35.1.1.1",
      IPProtocol: "TCP",
      portRange: "80-80",
      loadBalancingScheme: "EXTERNAL",
      target: `${COMPUTE}/regions/us-east1/targetPools/legacy-pool`,
    },
    "us-east1",
  ),
  internalPassthrough: asset(
    GCP_REGIONAL_FORWARDING_RULE_ASSET,
    "regions/europe-west1/forwardingRules/orders-ilb",
    {
      region: `${COMPUTE}/regions/europe-west1`,
      IPAddress: "10.132.0.50",
      IPProtocol: "TCP",
      ports: ["8080"],
      loadBalancingScheme: "INTERNAL",
      backendService: `${COMPUTE}/regions/europe-west1/backendServices/orders`,
    },
    "europe-west1",
  ),
  globalPassthrough: asset(
    GCP_GLOBAL_FORWARDING_RULE_TYPE,
    "global/forwardingRules/anycast-udp",
    {
      IPAddress: "34.149.1.1",
      IPProtocol: "UDP",
      loadBalancingScheme: "EXTERNAL_PASSTHROUGH",
      backendService: `${COMPUTE}/global/backendServices/anycast`,
    },
  ),
  serviceMesh: asset(
    GCP_GLOBAL_FORWARDING_RULE_TYPE,
    "global/forwardingRules/mesh",
    {
      IPAddress: "0.0.0.0",
      loadBalancingScheme: "INTERNAL_SELF_MANAGED",
      target: `${COMPUTE}/global/targetGrpcProxies/mesh`,
    },
  ),
  // A rule whose target proxy the listing did not return: only its collection says what it is.
  applicationProxyUnlisted: asset(
    GCP_GLOBAL_FORWARDING_RULE_TYPE,
    "global/forwardingRules/blog-https",
    {
      IPAddress: "34.117.1.1",
      loadBalancingScheme: "EXTERNAL_MANAGED",
      target: `${COMPUTE}/global/targetHttpsProxies/blog-https`,
    },
  ),
  tcpProxyUnlisted: asset(
    GCP_GLOBAL_FORWARDING_RULE_TYPE,
    "global/forwardingRules/cache",
    {
      IPAddress: "34.117.1.2",
      loadBalancingScheme: "EXTERNAL",
      target: `${COMPUTE}/global/targetTcpProxies/cache`,
    },
  ),
  // A global external rule whose target nothing names: no Application Load Balancer OneUptime can tell.
  globalExternalUnknownTarget: asset(
    GCP_GLOBAL_FORWARDING_RULE_TYPE,
    "global/forwardingRules/mystery",
    {
      IPAddress: "34.117.1.3",
      loadBalancingScheme: "EXTERNAL_MANAGED",
      target: `${COMPUTE}/global/targetFooProxies/mystery`,
    },
  ),
};

// The project's Google Cloud project as the connector reads it, and as the sync keeps each rule.
function readAsSynced(rules: Array<GcpAsset>): Array<CloudResource> {
  const listed: Array<GcpAsset> = [...BACKENDS, ...PROXIES, ...rules];
  const context: GcpInventoryContext = buildGcpInventoryContext({
    projectId: GCP_PROJECT,
    assets: listed,
  });
  const items: Array<CloudInventoryItem> = [];
  const byItem: Map<CloudInventoryItem, GcpAsset> = new Map();

  for (const entry of listed) {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      entry,
      context,
    );

    if (item) {
      items.push(item);
      byItem.set(item, entry);
    }
  }

  addGcpInventoryEdges({ items, assets: byItem, listed });

  return items
    .filter((item: CloudInventoryItem): boolean => {
      return item.resource.resourceType === GCP_FORWARDING_RULE_TYPE;
    })
    .map((item: CloudInventoryItem): CloudResource => {
      const row: CloudResource = new CloudResource();

      Object.assign(row, {
        _id: ObjectID.generate().toString(),
        name: item.displayName || item.resource.name,
        cloudResourceType: item.resource.resourceType,
        providerResourceId: item.resource.providerResourceId,
        cloudConnection: { name: "Google Cloud shop" },
        ...CloudConnectionResourceSync.inventoryColumnsOf(item),
      });

      return row;
    });
}

function synced(rule: GcpAsset): CloudResource {
  const rows: Array<CloudResource> = readAsSynced([rule]);

  expect(rows).toHaveLength(1);

  return rows[0]!;
}

function blocks(...ranges: Array<string>): Array<NetworkAddressBlock> {
  return ranges.map((range: string): NetworkAddressBlock => {
    return NetworkAddressBlockUtil.parse(range)!;
  });
}

function useProject(columns: Partial<Project>): void {
  const project: Project = new Project();
  Object.assign(project, columns);

  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
    project as never,
  );
}

function useInventory(rows: Array<CloudResource>): void {
  getJestSpyOn(CloudResourceService, "findBy").mockResolvedValue(rows as never);
}

async function readOwn(): Promise<SecurityOwnLoadBalancersRead> {
  return await SecurityOwnLoadBalancers.read({
    projectId: PROJECT_ID,
    props: { isRoot: true },
  });
}

// What the scans trust, read now.
async function scansTrust(): Promise<TrustedProxies> {
  SecurityTrustedProxies.clearCache();
  return await SecurityTrustedProxies.getForProject(PROJECT_ID);
}

// A request with an attack in it, through `peer`, carrying `forwardedFor`.
function span(peer: string, forwardedFor: string): TraceScanSpan {
  return {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    parentSpanId: "",
    sessionId: "",
    name: "GET /download",
    kind: "SPAN_KIND_SERVER",
    durationMs: 12,
    startTime: new Date("2026-11-27T10:00:00.000Z"),
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
      "network.peer.address": peer,
      "http.request.header.x-forwarded-for": forwardedFor,
    },
  };
}

function readSpan(
  proxies: TrustedProxies,
  peer: string,
  forwardedFor: string,
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = buildTraceSecurityEvents(
    span(peer, forwardedFor),
    { trustedProxies: proxies },
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

// An nginx main-format line written behind `peer`, ending with `forwardedFor`.
function readLine(
  proxies: TrustedProxies,
  peer: string,
  forwardedFor: string,
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
    body: `${peer} - - [27/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.4.0" "${forwardedFor}"`,
    attributes: {},
    time: new Date("2026-11-27T10:00:05.000Z"),
    trustedProxies: { ...proxies, readsAccessLogForwardedFor: true },
  });

  expect(events).toHaveLength(1);

  return events[0]!;
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  useProject({});
  useInventory([]);
  getJestSpyOn(SecurityEdgeRanges, "findConnectedEdges").mockResolvedValue(
    [] as never,
  );
  SecurityTrustedProxies.clearCache();
});

afterEach(() => {
  SecurityTrustedProxies.clearCache();
  jest.restoreAllMocks();
});

describe("Google's front ends: the ranges", () => {
  test("are the ones Google's load balancing firewall rules page publishes, and say when they were checked there", () => {
    expect(GOOGLE_FRONT_END_RANGES).toEqual([
      "35.191.0.0/16",
      "130.211.0.0/22",
      "2600:2d00:1:1::/64",
    ]);
    expect(GOOGLE_FRONT_END_RANGES_SOURCE).toBe(
      "https://cloud.google.com/load-balancing/docs/firewall-rules",
    );
    expect(GOOGLE_FRONT_END_RANGES_CHECKED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("each is a range, written one way, and on the internet: no private range they would duplicate", () => {
    for (const range of GOOGLE_FRONT_END_RANGES) {
      const block: NetworkAddressBlock | null =
        NetworkAddressBlockUtil.parse(range);

      expect(block?.text).toBe(range);

      const first: string =
        block!.family === 4 ? range.split("/")[0]! : range.split("/")[0]!;

      expect(getSecurityAddressScope(first)).toBe(SecurityAddressScope.Public);
    }
  });

  test("are no range a Trusted Proxies list would refuse as too broad", () => {
    for (const block of blocks(...GOOGLE_FRONT_END_RANGES)) {
      expect(block.prefixLength).toBeGreaterThanOrEqual(
        block.family === 4 ? 8 : 16,
      );
    }
  });
});

describe("which recorded forwarding rules bring Google's front ends", () => {
  test.each([
    [
      "a global external Application Load Balancer",
      "globalExternalApplication",
    ],
    ["a classic Application Load Balancer", "classicApplication"],
    [
      "a classic Application Load Balancer in the Standard Tier, with a regional rule",
      "classicApplicationStandardTier",
    ],
    [
      "an Application Load Balancer whose proxy the listing did not return",
      "applicationProxyUnlisted",
    ],
  ])("%s forwards through them", (_what: string, rule: string) => {
    expect(readGoogleFrontEndUse(synced(RULES[rule]!))).toBe(
      GoogleFrontEndUse.Forwards,
    );
  });

  test.each([
    ["a global external proxy Network Load Balancer (TCP)", "globalTcpProxy"],
    ["a classic proxy Network Load Balancer (SSL)", "classicSslProxy"],
    ["a TCP proxy the listing did not return", "tcpProxyUnlisted"],
    [
      "a global external rule whose target OneUptime cannot tell",
      "globalExternalUnknownTarget",
    ],
  ])(
    "%s passes on, from the same front ends, what a client wrote",
    (_what: string, rule: string) => {
      expect(readGoogleFrontEndUse(synced(RULES[rule]!))).toBe(
        GoogleFrontEndUse.PassesOn,
      );
    },
  );

  test.each([
    [
      "a regional external Application Load Balancer, from its proxy-only subnet",
      "regionalExternalApplication",
    ],
    [
      "a regional internal Application Load Balancer",
      "regionalInternalApplication",
    ],
    [
      "a cross-region internal Application Load Balancer",
      "crossRegionInternalApplication",
    ],
    [
      "a regional external passthrough Network Load Balancer",
      "regionalPassthrough",
    ],
    ["a target pool's", "targetPool"],
    ["an internal passthrough Network Load Balancer", "internalPassthrough"],
    [
      "a global external passthrough Network Load Balancer",
      "globalPassthrough",
    ],
    ["Cloud Service Mesh", "serviceMesh"],
  ])("%s uses none", (_what: string, rule: string) => {
    expect(readGoogleFrontEndUse(synced(RULES[rule]!))).toBeNull();
  });

  test("a rule with no scheme recorded, or anything that is no forwarding rule, uses none", () => {
    const row: CloudResource = synced(RULES["globalExternalApplication"]!);
    const noScheme: OwnLoadBalancerRecord = {
      ...row,
      cloudProperties: { IPAddress: OWN_LOAD_BALANCER },
    };

    expect(readGoogleFrontEndUse(noScheme)).toBeNull();
    expect(
      readGoogleFrontEndUse({
        ...row,
        cloudResourceType: "compute.googleapis.com/Instance",
      }),
    ).toBeNull();
  });
});

describe("what the project's load balancers say of Google's front ends", () => {
  test("a global external Application Load Balancer brings them, trusted, named", async () => {
    useInventory(readAsSynced([RULES["globalExternalApplication"]!]));

    const read: SecurityOwnLoadBalancersRead = await readOwn();

    expect(read.googleFrontEnds).toEqual({
      ranges: [...GOOGLE_FRONT_END_RANGES],
      broughtBy: [{ name: "shop-https", where: "Google Cloud shop" }],
      withheldBy: [],
      isWithheldForIncompleteRead: false,
      isTrusted: true,
    });
    // The load balancer's own address is trusted beside them, as before.
    expect(
      read.loadBalancers.map((lb: { addresses: Array<string> }) => {
        return lb.addresses;
      }),
    ).toEqual([[OWN_LOAD_BALANCER]]);
  });

  test("a TCP or SSL proxy load balancer of the project's keeps them untrusted, named", async () => {
    useInventory(
      readAsSynced([
        RULES["globalExternalApplication"]!,
        RULES["globalTcpProxy"]!,
        RULES["classicSslProxy"]!,
      ]),
    );

    const googleFrontEnds: SecurityGoogleFrontEnds | null = (await readOwn())
      .googleFrontEnds;

    expect(googleFrontEnds?.isTrusted).toBe(false);
    expect(googleFrontEnds?.withheldBy).toEqual([
      { name: "db", where: "Google Cloud shop" },
      { name: "mail", where: "Google Cloud shop" },
    ]);
  });

  test("a passthrough or internal load balancer beside it keeps nothing untrusted", async () => {
    useInventory(
      readAsSynced([
        RULES["globalExternalApplication"]!,
        RULES["regionalPassthrough"]!,
        RULES["internalPassthrough"]!,
        RULES["regionalInternalApplication"]!,
        RULES["globalPassthrough"]!,
      ]),
    );

    expect((await readOwn()).googleFrontEnds?.isTrusted).toBe(true);
  });

  test("a project with only regional or internal Application Load Balancers uses none", async () => {
    useInventory(
      readAsSynced([
        RULES["regionalExternalApplication"]!,
        RULES["regionalInternalApplication"]!,
        RULES["crossRegionInternalApplication"]!,
      ]),
    );

    expect((await readOwn()).googleFrontEnds).toBeNull();
  });

  test("a project with only a TCP proxy says nothing of them: nothing brings them", async () => {
    useInventory(readAsSynced([RULES["globalTcpProxy"]!]));

    expect((await readOwn()).googleFrontEnds).toBeNull();
  });

  test("a read cut short keeps them untrusted: a TCP proxy may be among what was left out", () => {
    const rows: Array<CloudResource> = readAsSynced([
      RULES["globalExternalApplication"]!,
    ]);

    expect(readGoogleFrontEnds({ rows, isCut: true })).toEqual({
      ranges: [...GOOGLE_FRONT_END_RANGES],
      broughtBy: [{ name: "shop-https", where: "Google Cloud shop" }],
      withheldBy: [],
      isWithheldForIncompleteRead: true,
      isTrusted: false,
    });
  });

  test("more rows than one read takes is a read cut short", async () => {
    const application: CloudResource = synced(
      RULES["globalExternalApplication"]!,
    );
    const many: Array<CloudResource> = Array.from(
      { length: OWN_LOAD_BALANCER_ROWS_READ + 1 },
      (): CloudResource => {
        return application;
      },
    );

    useInventory(many);

    const googleFrontEnds: SecurityGoogleFrontEnds | null = (await readOwn())
      .googleFrontEnds;

    expect(googleFrontEnds?.isWithheldForIncompleteRead).toBe(true);
    expect(googleFrontEnds?.isTrusted).toBe(false);
  });
});

describe("what the scans trust", () => {
  test("Google's front ends, beside the load balancer, while it brings them", async () => {
    useInventory(readAsSynced([RULES["globalExternalApplication"]!]));

    const trusted: SecurityOwnLoadBalancerBlocks =
      await SecurityOwnLoadBalancers.getTrusted(PROJECT_ID);

    expect(
      trusted.loadBalancers.map((block: NetworkAddressBlock) => {
        return block.text;
      }),
    ).toEqual([OWN_LOAD_BALANCER]);
    expect(
      trusted.googleFrontEnds.map((block: NetworkAddressBlock) => {
        return block.text;
      }),
    ).toEqual([...GOOGLE_FRONT_END_RANGES]);

    const read: TrustedProxySourcesRead | null =
      await SecurityTrustedProxies.readSources(PROJECT_ID);

    expect(read?.sources.googleFrontEnds).toHaveLength(3);
    expect(read?.sources.ownLoadBalancers).toHaveLength(1);
  });

  test("none of them while a TCP proxy keeps them untrusted", async () => {
    useInventory(
      readAsSynced([
        RULES["globalExternalApplication"]!,
        RULES["globalTcpProxy"]!,
      ]),
    );

    expect(
      (await SecurityOwnLoadBalancers.getTrusted(PROJECT_ID)).googleFrontEnds,
    ).toEqual([]);
  });

  test("none of them with Your Load Balancers off: the switch turns them off too", async () => {
    useProject({ securityTrustOwnLoadBalancers: false });
    useInventory(readAsSynced([RULES["globalExternalApplication"]!]));

    const read: TrustedProxySourcesRead | null =
      await SecurityTrustedProxies.readSources(PROJECT_ID);

    expect(read?.sources.googleFrontEnds).toEqual([]);
    expect(read?.sources.ownLoadBalancers).toEqual([]);
    expect(
      (await scansTrust()).blocks.map((block: NetworkAddressBlock) => {
        return block.text;
      }),
    ).toEqual([]);
  });
});

/*
 * The issue's own test, and the others it implies: trusting the front ends
 * never lets anyone outside Google choose the address an attack is blamed
 * on - through the project's own load balancer, through someone else's, or
 * through a TCP proxy that passes a request on as sent.
 */
describe("a forged X-Forwarded-For through Google's front ends", () => {
  async function trustingGoogle(
    rules: Array<GcpAsset>,
  ): Promise<TrustedProxies> {
    useInventory(readAsSynced(rules));
    return await scansTrust();
  }

  test("through the project's own load balancer: the client is named, the forgery only claimed", async () => {
    const proxies: TrustedProxies = await trustingGoogle([
      RULES["globalExternalApplication"]!,
    ]);

    for (const read of [readSpan, readLine]) {
      const event: NormalizedSecurityEvent = read(
        proxies,
        FRONT_END,
        `${SENDERS_CLAIM}, ${CLIENT}, ${OWN_LOAD_BALANCER}`,
      );

      expect(event.principalIp).toBe(CLIENT);
      expect(readClientAddressTrust(event)).toBe(
        ClientAddressTrust.TrustedProxy,
      );
      expect(readClaimedClientAddress(event)?.address).toBe(SENDERS_CLAIM);
      expect(readForwardedBy(event)).toEqual([OWN_LOAD_BALANCER, FRONT_END]);
      expect(event.observables).not.toContain(SENDERS_CLAIM);
    }
  });

  test("from each of the front ends' ranges, IPv6 too", async () => {
    const proxies: TrustedProxies = await trustingGoogle([
      RULES["globalExternalApplication"]!,
    ]);

    for (const frontEnd of [FRONT_END, FRONT_END_OLD_RANGE, FRONT_END_IPV6]) {
      expect(
        readSpan(proxies, frontEnd, `${CLIENT}, ${OWN_LOAD_BALANCER}`)
          .principalIp,
      ).toBe(CLIENT);
    }
  });

  test("through another customer's load balancer from 35.191.0.0/16: the event names that load balancer", async () => {
    const proxies: TrustedProxies = await trustingGoogle([
      RULES["globalExternalApplication"]!,
    ]);

    for (const read of [readSpan, readLine]) {
      const event: NormalizedSecurityEvent = read(
        proxies,
        FRONT_END,
        `${SENDERS_CLAIM}, ${CLIENT}, ${SOMEONE_ELSES_LOAD_BALANCER}`,
      );

      expect(event.principalIp).toBe(SOMEONE_ELSES_LOAD_BALANCER);
      expect(event.observables).not.toContain(SENDERS_CLAIM);
      expect(event.observables).not.toContain(CLIENT);
    }
  });

  test("with a TCP proxy load balancer in the project, the front end is named: nothing the client wrote is read", async () => {
    const proxies: TrustedProxies = await trustingGoogle([
      RULES["globalExternalApplication"]!,
      RULES["globalTcpProxy"]!,
    ]);

    // Through the TCP proxy the header is all the client's own.
    const event: NormalizedSecurityEvent = readSpan(
      proxies,
      FRONT_END,
      SENDERS_CLAIM,
    );

    expect(event.principalIp).toBe(FRONT_END);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    expect(event.observables).not.toContain(SENDERS_CLAIM);
  });

  test("which is why: trusted beside a TCP proxy, the front ends would believe the client's own header", () => {
    const blindlyTrusting: TrustedProxies = trustedProxiesOf({
      listed: [],
      edges: [],
      ownLoadBalancers: blocks(OWN_LOAD_BALANCER),
      googleFrontEnds: blocks(...GOOGLE_FRONT_END_RANGES),
      readsAccessLogForwardedFor: false,
      accessLogFormat: null,
    });

    // The forgery a TCP proxy passes on would be named: what readGoogleFrontEnds keeps from happening.
    expect(
      readSpan(blindlyTrusting, FRONT_END, SENDERS_CLAIM).principalIp,
    ).toBe(SENDERS_CLAIM);
  });

  test("with Your Load Balancers off, the front end is named, as before #11047", async () => {
    useProject({ securityTrustOwnLoadBalancers: false });

    const proxies: TrustedProxies = await trustingGoogle([
      RULES["globalExternalApplication"]!,
    ]);

    expect(
      readSpan(proxies, FRONT_END, `${CLIENT}, ${OWN_LOAD_BALANCER}`)
        .principalIp,
    ).toBe(FRONT_END);
  });
});
