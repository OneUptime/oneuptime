import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import MonitorService from "../../../../Server/Services/MonitorService";
import CloudEndpointSuggestions, {
  CLOUD_ENDPOINT_CNAME_DEPTH,
  CLOUD_ENDPOINT_DNS_TIMEOUT_MS,
  CLOUD_ENDPOINT_SUGGESTION_LIMIT,
  CloudEndpointDns,
  CloudEndpointResolver,
  createCloudEndpointDns,
  getCloudEndpointNames,
} from "../../../../Server/Utils/CloudConnection/CloudEndpointSuggestions";
import fs from "fs";
import path from "path";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import {
  CloudEndpointName,
  CloudEndpointSuggestion,
} from "../../../../Types/Cloud/CloudEndpointMatch";
import IP from "../../../../Types/IP/IP";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../../Types/ObjectID";

/*
 * The cloud resources a monitor seems to check: its hosts followed through
 * DNS - the CNAME chain, then the addresses it ends on - and matched to the
 * endpoints the project's cloud connections listed. Read as the caller,
 * never offering a resource the monitor is linked to already, never
 * returning a DNS answer of its own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALB_ID: string = "33333333-3333-4333-8333-333333333333";
const CDN_ID: string = "44444444-4444-4444-8444-444444444444";

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

// A resolver that answers from a table: CNAMEs, then addresses.
function fakeDns(data: {
  cnames?: Record<string, string>;
  addresses?: Record<string, Array<string>>;
}): CloudEndpointDns & {
  cnameCalls: Array<string>;
  lookupCalls: Array<string>;
} {
  const cnameCalls: Array<string> = [];
  const lookupCalls: Array<string> = [];

  return {
    cnameCalls,
    lookupCalls,
    resolveCname: async (host: string): Promise<Array<string>> => {
      cnameCalls.push(host);
      const target: string | undefined = data.cnames?.[host];
      return target ? [target] : [];
    },
    resolveAddresses: async (host: string): Promise<Array<string>> => {
      lookupCalls.push(host);
      return data.addresses?.[host] || [];
    },
  };
}

function monitorChecking(
  destinations: Array<URL | IP>,
  linkedIds: Array<string> = [],
): Monitor {
  const steps: MonitorSteps = new MonitorSteps();
  steps.setMonitorStepsInstanceArray(
    destinations.map((destination: URL | IP): MonitorStep => {
      return new MonitorStep().setMonitorDestination(destination);
    }),
  );

  const monitor: Monitor = new Monitor();
  monitor.projectId = PROJECT_ID;
  monitor.monitorSteps = steps;
  monitor.cloudResources = linkedIds.map((id: string): CloudResource => {
    const resource: CloudResource = new CloudResource();
    resource._id = id;
    return resource;
  });
  return monitor;
}

function resource(data: {
  id: string;
  name: string;
  type: string;
  endpoints: Array<string>;
}): CloudResource {
  const row: CloudResource = new CloudResource();
  row._id = data.id;
  row.name = data.name;
  row.cloudResourceType = data.type;
  row.cloudProvider = "aws";
  row.cloudEndpoints = data.endpoints;
  return row;
}

const ALB: CloudResource = resource({
  id: ALB_ID,
  name: "web-alb",
  type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
  endpoints: ["web-alb-123.eu-west-1.elb.amazonaws.com"],
});

const CDN: CloudResource = resource({
  id: CDN_ID,
  name: "assets-cdn",
  type: "AWS::CloudFront::Distribution",
  endpoints: ["d111111abcdef8.cloudfront.net"],
});

describe("the names a host answers under", () => {
  test("the host, its CNAME chain, then the addresses the chain ends on", async () => {
    const dns: ReturnType<typeof fakeDns> = fakeDns({
      cnames: {
        "shop.example.com": "shop.example.com.cdn.cloudflare.net.",
        "shop.example.com.cdn.cloudflare.net":
          "dualstack.web-alb-123.eu-west-1.elb.amazonaws.com",
      },
      addresses: {
        "dualstack.web-alb-123.eu-west-1.elb.amazonaws.com": [
          "198.51.100.7",
          "198.51.100.8",
        ],
      },
    });

    const names: Array<CloudEndpointName> = await getCloudEndpointNames(
      "https://Shop.Example.com/checkout",
      dns,
    );

    expect(names).toEqual([
      { name: "shop.example.com", via: "shop.example.com" },
      {
        name: "shop.example.com.cdn.cloudflare.net",
        via: "shop.example.com",
      },
      {
        name: "dualstack.web-alb-123.eu-west-1.elb.amazonaws.com",
        via: "shop.example.com",
      },
      { name: "198.51.100.7", via: "shop.example.com" },
      { name: "198.51.100.8", via: "shop.example.com" },
    ]);
    // The addresses of the last name only.
    expect(dns.lookupCalls).toEqual([
      "dualstack.web-alb-123.eu-west-1.elb.amazonaws.com",
    ]);
  });

  test(`a chain is followed ${CLOUD_ENDPOINT_CNAME_DEPTH} names deep at most, and a loop once`, async () => {
    const long: Record<string, string> = {};

    for (let index: number = 0; index < 20; index++) {
      long[`n${index}.example.com`] = `n${index + 1}.example.com`;
    }

    expect(
      await getCloudEndpointNames("n0.example.com", fakeDns({ cnames: long })),
    ).toHaveLength(1 + CLOUD_ENDPOINT_CNAME_DEPTH);

    const loop: ReturnType<typeof fakeDns> = fakeDns({
      cnames: {
        "a.example.com": "b.example.com",
        "b.example.com": "a.example.com",
      },
    });

    expect(
      (await getCloudEndpointNames("a.example.com", loop)).map(
        (name: CloudEndpointName): string => {
          return name.name;
        },
      ),
    ).toEqual(["a.example.com", "b.example.com"]);
  });

  test("an address is its own only name: nothing is looked up", async () => {
    const dns: ReturnType<typeof fakeDns> = fakeDns({});

    expect(await getCloudEndpointNames("203.0.113.10", dns)).toEqual([
      { name: "203.0.113.10", via: "203.0.113.10" },
    ]);
    expect(dns.cnameCalls).toEqual([]);
    expect(dns.lookupCalls).toEqual([]);
  });

  test("what is not a host has no names", async () => {
    expect(await getCloudEndpointNames("not a host", fakeDns({}))).toEqual([]);
  });
});

describe("suggestions for a monitor", () => {
  let monitorSpy: SpyInstance;
  let idsSpy: SpyInstance;
  let findSpy: SpyInstance;

  beforeEach(() => {
    monitorSpy = jest.spyOn(MonitorService, "findOneById");
    idsSpy = jest
      .spyOn(CloudResourceService, "findIdsByEndpoints")
      .mockResolvedValue([new ObjectID(ALB_ID), new ObjectID(CDN_ID)]);
    findSpy = jest
      .spyOn(CloudResourceService, "findBy")
      .mockResolvedValue([ALB, CDN]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the resources its hosts lead to, read with the caller's own rights", async () => {
    monitorSpy.mockResolvedValue(
      monitorChecking([
        URL.fromString("https://shop.example.com"),
        URL.fromString("https://cdn.example.com/logo.png"),
      ]),
    );

    const suggestions: Array<CloudEndpointSuggestion> =
      await CloudEndpointSuggestions.forMonitor(
        { monitorId: MONITOR_ID, projectId: PROJECT_ID, props: CALLER },
        fakeDns({
          cnames: {
            "shop.example.com":
              "dualstack.web-alb-123.eu-west-1.elb.amazonaws.com",
            "cdn.example.com": "d111111abcdef8.cloudfront.net",
          },
        }),
      );

    expect(suggestions).toEqual([
      {
        cloudResourceId: CDN_ID,
        name: "assets-cdn",
        type: "AWS::CloudFront::Distribution",
        provider: "aws",
        endpoint: "d111111abcdef8.cloudfront.net",
        via: "cdn.example.com",
      },
      {
        cloudResourceId: ALB_ID,
        name: "web-alb",
        type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        provider: "aws",
        endpoint: "web-alb-123.eu-west-1.elb.amazonaws.com",
        via: "shop.example.com",
      },
    ]);

    // The monitor, as the caller.
    expect(monitorSpy).toHaveBeenCalledTimes(1);
    const monitorRead: { props: unknown; id: ObjectID } = monitorSpy.mock
      .calls[0]![0] as { props: unknown; id: ObjectID };
    expect(monitorRead.props).toBe(CALLER);
    expect(monitorRead.id.toString()).toBe(MONITOR_ID.toString());

    // The lookup, pinned to the project, with every spelling met.
    const lookup: {
      projectId: ObjectID;
      endpoints: Array<string>;
      limit: number;
    } = idsSpy.mock.calls[0]![0] as {
      projectId: ObjectID;
      endpoints: Array<string>;
      limit: number;
    };
    expect(lookup.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(lookup.endpoints).toEqual(
      expect.arrayContaining([
        "shop.example.com",
        "dualstack.web-alb-123.eu-west-1.elb.amazonaws.com",
        "web-alb-123.eu-west-1.elb.amazonaws.com",
        "cdn.example.com",
        "d111111abcdef8.cloudfront.net",
      ]),
    );

    // The rows, as the caller, in the project.
    const rowsRead: {
      query: { _id: Includes; projectId: ObjectID };
      props: unknown;
    } = findSpy.mock.calls[0]![0] as {
      query: { _id: Includes; projectId: ObjectID };
      props: unknown;
    };
    expect(rowsRead.props).toBe(CALLER);
    expect(rowsRead.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(
      rowsRead.query._id.values.map((id: unknown): string => {
        return String(id);
      }),
    ).toEqual([ALB_ID, CDN_ID]);
  });

  test("a resource the monitor is linked to already is not offered again", async () => {
    monitorSpy.mockResolvedValue(
      monitorChecking([URL.fromString("https://cdn.example.com")], [CDN_ID]),
    );

    const suggestions: Array<CloudEndpointSuggestion> =
      await CloudEndpointSuggestions.forMonitor(
        { monitorId: MONITOR_ID, projectId: PROJECT_ID, props: CALLER },
        fakeDns({
          cnames: { "cdn.example.com": "d111111abcdef8.cloudfront.net" },
        }),
      );

    expect(suggestions).toEqual([]);
  });

  test("a monitor the caller cannot read, or of another project, suggests nothing and reads nothing more", async () => {
    monitorSpy.mockResolvedValue(null);

    expect(
      await CloudEndpointSuggestions.forMonitor(
        { monitorId: MONITOR_ID, projectId: PROJECT_ID, props: CALLER },
        fakeDns({}),
      ),
    ).toEqual([]);

    const foreign: Monitor = monitorChecking([
      URL.fromString("https://shop.example.com"),
    ]);
    foreign.projectId = ObjectID.generate();
    monitorSpy.mockResolvedValue(foreign);

    expect(
      await CloudEndpointSuggestions.forMonitor(
        { monitorId: MONITOR_ID, projectId: PROJECT_ID, props: CALLER },
        fakeDns({}),
      ),
    ).toEqual([]);
    expect(idsSpy).not.toHaveBeenCalled();
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("a monitor that checks no host suggests nothing, and looks nothing up", async () => {
    monitorSpy.mockResolvedValue(monitorChecking([]));
    const dns: ReturnType<typeof fakeDns> = fakeDns({});

    expect(
      await CloudEndpointSuggestions.forMonitor(
        { monitorId: MONITOR_ID, projectId: PROJECT_ID, props: CALLER },
        dns,
      ),
    ).toEqual([]);
    expect(dns.cnameCalls).toEqual([]);
    expect(idsSpy).not.toHaveBeenCalled();
  });

  test("no endpoint matches: no rows read", async () => {
    monitorSpy.mockResolvedValue(
      monitorChecking([URL.fromString("https://shop.example.com")]),
    );
    idsSpy.mockResolvedValue([]);

    expect(
      await CloudEndpointSuggestions.forMonitor(
        { monitorId: MONITOR_ID, projectId: PROJECT_ID, props: CALLER },
        fakeDns({}),
      ),
    ).toEqual([]);
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("a resource the caller may not read is not offered, though its endpoint matched", async () => {
    monitorSpy.mockResolvedValue(
      monitorChecking([URL.fromString("https://cdn.example.com")]),
    );
    // The caller's own read leaves it out.
    findSpy.mockResolvedValue([]);

    expect(
      await CloudEndpointSuggestions.forMonitor(
        { monitorId: MONITOR_ID, projectId: PROJECT_ID, props: CALLER },
        fakeDns({
          cnames: { "cdn.example.com": "d111111abcdef8.cloudfront.net" },
        }),
      ),
    ).toEqual([]);
  });

  test(`at most ${CLOUD_ENDPOINT_SUGGESTION_LIMIT} suggestions`, async () => {
    monitorSpy.mockResolvedValue(
      monitorChecking([URL.fromString("https://shop.example.com")]),
    );
    const many: Array<CloudResource> = Array.from(
      { length: CLOUD_ENDPOINT_SUGGESTION_LIMIT + 5 },
      (_value: unknown, index: number): CloudResource => {
        return resource({
          id: `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`,
          name: `alb-${String(index).padStart(2, "0")}`,
          type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
          endpoints: ["shop.example.com"],
        });
      },
    );
    findSpy.mockResolvedValue(many);

    expect(
      await CloudEndpointSuggestions.forMonitor(
        { monitorId: MONITOR_ID, projectId: PROJECT_ID, props: CALLER },
        fakeDns({}),
      ),
    ).toHaveLength(CLOUD_ENDPOINT_SUGGESTION_LIMIT);
  });
});

/*
 * The lookups the server makes: asked of the DNS servers (c-ares), never
 * through the operating system's getaddrinfo - which holds one of libuv's
 * four threads for as long as a slow name takes, whatever timeout the
 * caller gave up at, and answers names /etc/hosts makes up.
 */
describe("the system's DNS lookups", () => {
  function fakeResolver(data: {
    cname?: (host: string) => Promise<Array<string>>;
    ipv4?: (host: string) => Promise<Array<string>>;
    ipv6?: (host: string) => Promise<Array<string>>;
  }): CloudEndpointResolver & { calls: Array<string> } {
    const calls: Array<string> = [];

    return {
      calls,
      resolveCname: (host: string): Promise<Array<string>> => {
        calls.push(`cname ${host}`);
        return data.cname ? data.cname(host) : Promise.resolve([]);
      },
      resolve4: (host: string): Promise<Array<string>> => {
        calls.push(`a ${host}`);
        return data.ipv4 ? data.ipv4(host) : Promise.resolve([]);
      },
      resolve6: (host: string): Promise<Array<string>> => {
        calls.push(`aaaa ${host}`);
        return data.ipv6 ? data.ipv6(host) : Promise.resolve([]);
      },
    };
  }

  test("a name's CNAME targets, as the resolver answers them", async () => {
    const lookups: CloudEndpointDns = createCloudEndpointDns(
      fakeResolver({
        cname: async (): Promise<Array<string>> => {
          return ["web-alb-123.eu-west-1.elb.amazonaws.com"];
        },
      }),
    );

    expect(await lookups.resolveCname("shop.example.com")).toEqual([
      "web-alb-123.eu-west-1.elb.amazonaws.com",
    ]);
  });

  test("a name's addresses: its IPv4 ones, then its IPv6 ones, asked together", async () => {
    const resolver: ReturnType<typeof fakeResolver> = fakeResolver({
      ipv4: async (): Promise<Array<string>> => {
        return ["198.51.100.7"];
      },
      ipv6: async (): Promise<Array<string>> => {
        return ["2001:db8::7"];
      },
    });

    expect(
      await createCloudEndpointDns(resolver).resolveAddresses(
        "web-alb-123.eu-west-1.elb.amazonaws.com",
      ),
    ).toEqual(["198.51.100.7", "2001:db8::7"]);
    expect(resolver.calls).toEqual([
      "a web-alb-123.eu-west-1.elb.amazonaws.com",
      "aaaa web-alb-123.eu-west-1.elb.amazonaws.com",
    ]);
  });

  test("a query that fails answers nothing - a name with only IPv4 addresses keeps them", async () => {
    const lookups: CloudEndpointDns = createCloudEndpointDns(
      fakeResolver({
        cname: async (): Promise<Array<string>> => {
          throw Object.assign(new Error("queryCname ENOTFOUND"), {
            code: "ENOTFOUND",
          });
        },
        ipv4: async (): Promise<Array<string>> => {
          return ["198.51.100.7"];
        },
        ipv6: async (): Promise<Array<string>> => {
          throw Object.assign(new Error("queryAaaa ENODATA"), {
            code: "ENODATA",
          });
        },
      }),
    );

    expect(await lookups.resolveCname("shop.example.com")).toEqual([]);
    expect(await lookups.resolveAddresses("shop.example.com")).toEqual([
      "198.51.100.7",
    ]);
  });

  test("a query slower than the timeout answers nothing, and the lookup goes on", async () => {
    const lookups: CloudEndpointDns = createCloudEndpointDns(
      fakeResolver({
        cname: (): Promise<Array<string>> => {
          // Never answers.
          return new Promise<Array<string>>(() => {});
        },
        ipv4: async (): Promise<Array<string>> => {
          return ["198.51.100.7"];
        },
      }),
      20,
    );

    expect(await lookups.resolveCname("slow.example.com")).toEqual([]);
    expect(await lookups.resolveAddresses("slow.example.com")).toEqual([
      "198.51.100.7",
    ]);
  });

  test("an answer that is not a list of names is no answer", async () => {
    const lookups: CloudEndpointDns = createCloudEndpointDns(
      fakeResolver({
        cname: async (): Promise<Array<string>> => {
          return [42, null, "next.example.com"] as unknown as Array<string>;
        },
        ipv4: async (): Promise<Array<string>> => {
          return "198.51.100.7" as unknown as Array<string>;
        },
      }),
    );

    expect(await lookups.resolveCname("odd.example.com")).toEqual([
      "next.example.com",
    ]);
    expect(await lookups.resolveAddresses("odd.example.com")).toEqual([]);
  });

  test("the server's own lookups use a resolver with one try and the timeout, never getaddrinfo", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../Server/Utils/CloudConnection/CloudEndpointSuggestions.ts",
      ),
      "utf8",
    );

    expect(source).toContain("new dns.promises.Resolver({");
    expect(source).toContain("timeout: CLOUD_ENDPOINT_DNS_TIMEOUT_MS,");
    expect(source).toContain("tries: 1,");
    expect(source).not.toContain("dns.promises.lookup(");
    expect(source).not.toContain("dns.lookup(");
    expect(CLOUD_ENDPOINT_DNS_TIMEOUT_MS).toBeLessThanOrEqual(2000);
  });
});
