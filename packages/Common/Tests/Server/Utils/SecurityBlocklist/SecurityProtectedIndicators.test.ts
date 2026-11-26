import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DomainService from "../../../../Server/Services/DomainService";
import MonitorService from "../../../../Server/Services/MonitorService";
import SecurityProtectedEntityService from "../../../../Server/Services/SecurityProtectedEntityService";
import StatusPageDomainService from "../../../../Server/Services/StatusPageDomainService";
import SecurityProtectedAddresses, {
  SecurityProtectionCheck,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import SecurityProtectedIndicators, {
  ENDPOINT_PRODUCT_DOMAINS,
  PROTECTED_INDICATOR_ROWS_PER_SOURCE,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityProtectedIndicators";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockIndicatorValue,
  readSecurityBlockIndicator,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityProtectedAddressSource } from "../../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * What protects a domain, a URL or a file from the blocklist (#10346): the
 * project's own list, OneUptime's host, the endpoint products' services,
 * the hosts its monitors check, its status pages' and verified domains, its
 * cloud DNS names and zones - each read as OneUptime, in one bounded query,
 * and a source that cannot be read leaving the answer open.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function indicator(value: string): SecurityBlockIndicatorValue {
  return readSecurityBlockIndicator(value)!;
}

// What each source's read answers, and what it was asked.
let entities: Array<JSONObject>;
let monitors: Array<JSONObject>;
let statusPages: Array<JSONObject>;
let domains: Array<JSONObject>;
let resources: Array<JSONObject>;
let asked: Array<{ service: string; query: JSONObject; limit: number }>;
let failing: Set<string>;
let addressSpy: SpyInstance<typeof SecurityProtectedAddresses.findProtection>;

function answer(
  service: string,
  rows: () => Array<JSONObject>,
): (args: unknown) => Promise<Array<JSONObject>> {
  return async (args: unknown): Promise<Array<JSONObject>> => {
    const read: { query: JSONObject; limit: number } = args as {
      query: JSONObject;
      limit: number;
    };

    asked.push({ service, query: read.query, limit: read.limit });

    if (failing.has(service)) {
      throw new Error(`${service} could not be read`);
    }

    // A row as a model reads it: its id beside its _id.
    return rows().map((row: JSONObject): JSONObject => {
      return typeof row["_id"] === "string"
        ? ({ ...row, id: new ObjectID(row["_id"]) } as unknown as JSONObject)
        : row;
    });
  };
}

// A monitor's steps, as the Monitor column holds them: a website's URL.
function websiteSteps(url: string): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: { monitorDestination: { _type: "URL", value: url } },
        },
      ],
    },
  };
}

beforeEach(() => {
  entities = [];
  monitors = [];
  statusPages = [];
  domains = [];
  resources = [];
  asked = [];
  failing = new Set();

  jest.spyOn(SecurityProtectedEntityService, "findBy").mockImplementation(
    answer("ProtectedEntity", () => {
      return entities;
    }) as never,
  );
  jest.spyOn(MonitorService, "findBy").mockImplementation(
    answer("Monitor", () => {
      return monitors;
    }) as never,
  );
  jest.spyOn(StatusPageDomainService, "findBy").mockImplementation(
    answer("StatusPage", () => {
      return statusPages;
    }) as never,
  );
  jest.spyOn(DomainService, "findBy").mockImplementation(
    answer("ProjectDomain", () => {
      return domains;
    }) as never,
  );
  jest.spyOn(CloudResourceService, "findBy").mockImplementation(((
    args: unknown,
  ): Promise<Array<JSONObject>> => {
    const query: JSONObject = (args as { query: JSONObject }).query;

    // The DNS zones are read by their type; the endpoints by their text.
    return answer("CloudResource", () => {
      return resources.filter((resource: JSONObject): boolean => {
        return query["cloudEndpoints"]
          ? resource["isZone"] !== true
          : resource["isZone"] === true;
      });
    })(args);
  }) as never);

  addressSpy = jest
    .spyOn(SecurityProtectedAddresses, "findProtection")
    .mockResolvedValue({ protection: null, unreadSources: [] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function protectionOf(value: string): Promise<SecurityProtectionCheck> {
  return await SecurityProtectedIndicators.findProtection({
    projectId: PROJECT_ID,
    indicator: indicator(value),
  });
}

describe("a domain on the Protected Entities list", () => {
  test("an exact entry protects its name and refuses its parents, by its description", async () => {
    entities = [
      {
        _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        value: "status.partner.example",
        description: "Our partner's status page",
        entityType: SecurityEntityType.Domain,
      },
    ];

    expect((await protectionOf("partner.example")).protection).toEqual({
      source: SecurityProtectedAddressSource.ProtectedEntity,
      protectedValue: "status.partner.example",
      name: "Our partner's status page",
      recordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect((await protectionOf("evil.partner.example")).protection).toBeNull();
    // Only its domain entries are read.
    expect(asked[0]!.query["entityType"]).toBe(SecurityEntityType.Domain);
  });

  test("a `*.` entry protects every name under it, and a URL on one", async () => {
    entities = [{ value: "*.acme.com" }];

    expect(
      (await protectionOf("evil.acme.com")).protection?.protectedValue,
    ).toBe("*.acme.com");
    expect(
      (await protectionOf("https://login.acme.com/reset")).protection
        ?.protectedValue,
    ).toBe("*.acme.com");
    expect((await protectionOf("acme.org")).protection).toBeNull();
  });
});

describe("OneUptime's own host and the endpoint products' services", () => {
  test("OneUptime's host and the status pages' DNS target, without a port", () => {
    expect(
      SecurityProtectedIndicators.getOneUptimeDomains({
        host: "oneuptime.example.com:3000",
        statusPageCName: "statuspage.oneuptime.example.com",
      }).map((domain: { protection: { protectedValue: string } }) => {
        return domain.protection.protectedValue;
      }),
    ).toEqual(["oneuptime.example.com", "statuspage.oneuptime.example.com"]);
    expect(
      SecurityProtectedIndicators.getOneUptimeDomains({
        host: "localhost",
        statusPageCName: "",
      }),
    ).toEqual([]);
  });

  test("the products' services refuse a block of the names above them, never of a name under them", async () => {
    expect(ENDPOINT_PRODUCT_DOMAINS.length).toBe(2);

    const windows: SecurityProtectionCheck = await protectionOf("windows.net");

    expect(windows.protection).toEqual({
      source: SecurityProtectedAddressSource.EndpointProduct,
      protectedValue: "blob.core.windows.net",
      name: "Microsoft Defender",
    });
    expect((await protectionOf("crowdstrike.com")).protection?.name).toBe(
      "CrowdStrike Falcon",
    );
    expect((await protectionOf("cloudsink.net")).protection?.name).toBe(
      "CrowdStrike Falcon",
    );
    // A storage account of someone's under Microsoft's domain is blocked on its own.
    expect(
      (await protectionOf("evil.blob.core.windows.net")).protection,
    ).toBeNull();
  });
});

describe("the project's own domains", () => {
  test("the host a monitor checks, read only from the monitors whose steps name the domain", async () => {
    monitors = [
      {
        _id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "API Health",
        monitorSteps: websiteSteps("https://api.acme.com/health"),
      },
    ];

    expect((await protectionOf("acme.com")).protection).toEqual({
      source: SecurityProtectedAddressSource.Monitor,
      protectedValue: "api.acme.com",
      name: "API Health",
      recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    const monitorRead: { query: JSONObject; limit: number } | undefined =
      asked.find((read: { service: string }) => {
        return read.service === "Monitor";
      });

    expect(monitorRead?.query["projectId"]).toBe(PROJECT_ID);
    expect(monitorRead?.query["monitorSteps"]).toBeDefined();
    expect(monitorRead?.limit).toBe(PROTECTED_INDICATOR_ROWS_PER_SOURCE + 1);
  });

  test("a status page's own domain, by the page's name", async () => {
    statusPages = [
      {
        _id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        fullDomain: "status.acme.com",
        statusPage: { name: "Acme Status" },
      },
    ];

    expect((await protectionOf("status.acme.com")).protection).toEqual({
      source: SecurityProtectedAddressSource.StatusPage,
      protectedValue: "status.acme.com",
      name: "Acme Status",
      recordId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
  });

  test("a verified domain protects every name under it, and only a verified one is read", async () => {
    domains = [
      { _id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", domain: "acme.com" },
    ];

    expect((await protectionOf("evil.acme.com")).protection).toEqual({
      source: SecurityProtectedAddressSource.ProjectDomain,
      protectedValue: "acme.com",
      name: "acme.com",
      recordId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    expect(
      asked.find((read: { service: string }) => {
        return read.service === "ProjectDomain";
      })?.query["isVerified"],
    ).toBe(true);
  });

  test("a cloud resource's DNS name, and a DNS zone with every name under it", async () => {
    resources = [
      {
        _id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        name: "prod-alb",
        cloudProvider: "AWS",
        cloudResourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        cloudEndpoints: ["prod-alb-123.us-east-1.elb.amazonaws.com"],
        cloudConnection: { name: "Production" },
      },
      {
        _id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        name: "acme.io",
        cloudProvider: "Azure",
        cloudResourceType: "Microsoft.Network/dnszones",
        cloudEndpoints: [],
        isZone: true,
      },
    ];

    const alb: SecurityProtectionCheck =
      await protectionOf("elb.amazonaws.com");

    expect(alb.protection?.source).toBe(
      SecurityProtectedAddressSource.CloudResource,
    );
    expect(alb.protection?.protectedValue).toBe(
      "prod-alb-123.us-east-1.elb.amazonaws.com",
    );
    expect(alb.protection?.name).toBe("prod-alb");
    expect(alb.protection?.where).toBe("Production");

    expect(
      (await protectionOf("shop.acme.io")).protection?.protectedValue,
    ).toBe("acme.io");
  });

  test("a domain nothing protects is not protected, every source read", async () => {
    const check: SecurityProtectionCheck = await protectionOf("evil.example");

    expect(check).toEqual({ protection: null, unreadSources: [] });
    expect(
      new Set(
        asked.map((read: { service: string }): string => {
          return read.service;
        }),
      ),
    ).toEqual(
      new Set([
        "ProtectedEntity",
        "Monitor",
        "StatusPage",
        "ProjectDomain",
        "CloudResource",
      ]),
    );
  });
});

describe("a source that cannot tell", () => {
  test("one that cannot be read is named, and the others are still asked", async () => {
    failing.add("Monitor");
    statusPages = [
      { fullDomain: "status.acme.com", statusPage: { name: "S" } },
    ];

    expect(await protectionOf("evil.example")).toEqual({
      protection: null,
      unreadSources: [SecurityProtectedAddressSource.Monitor],
    });

    // What a later source finds protects it all the same.
    expect((await protectionOf("status.acme.com")).protection?.source).toBe(
      SecurityProtectedAddressSource.StatusPage,
    );
  });

  test("one that holds more than one read takes leaves the answer open", async () => {
    statusPages = Array.from(
      { length: PROTECTED_INDICATOR_ROWS_PER_SOURCE + 1 },
      (_unused: unknown, index: number): JSONObject => {
        return { fullDomain: `s${index}.other.example` };
      },
    );

    expect((await protectionOf("evil.example")).unreadSources).toEqual([
      SecurityProtectedAddressSource.StatusPage,
    ]);
  });
});

describe("a URL whose host is an address", () => {
  test("is an address's block, held to the address's protections", async () => {
    addressSpy.mockResolvedValueOnce({
      protection: {
        source: SecurityProtectedAddressSource.Host,
        protectedValue: "198.51.100.7",
        name: "web-3",
      },
      unreadSources: [],
    });

    const check: SecurityProtectionCheck = await protectionOf(
      "http://198.51.100.7/payload.exe",
    );

    expect(check.protection?.name).toBe("web-3");
    expect(addressSpy.mock.calls[0]![0].block.text).toBe("198.51.100.7");
    expect(asked).toEqual([]);
  });
});

describe("a file", () => {
  test("an empty file's hash is protected without a read", async () => {
    expect(
      await protectionOf(
        "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
      ),
    ).toEqual({
      protection: {
        source: SecurityProtectedAddressSource.EmptyFile,
        protectedValue:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
      unreadSources: [],
    });
    expect(asked).toEqual([]);
  });

  test("a hash on the Protected Entities list, by its description", async () => {
    entities = [
      {
        _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        value: "44D88612FEA8A8F36DE82E1278ABB02F",
        description: "Our installer",
      },
    ];

    expect(
      (await protectionOf("44d88612fea8a8f36de82e1278abb02f")).protection,
    ).toEqual({
      source: SecurityProtectedAddressSource.ProtectedEntity,
      protectedValue: "44d88612fea8a8f36de82e1278abb02f",
      name: "Our installer",
      recordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(asked[0]!.query["entityType"]).toBe(SecurityEntityType.FileHash);
  });

  test("a list that cannot be read, or holds more than one read takes, leaves the answer open", async () => {
    failing.add("ProtectedEntity");

    expect(
      (await protectionOf("44d88612fea8a8f36de82e1278abb02f")).unreadSources,
    ).toEqual([SecurityProtectedAddressSource.ProtectedEntity]);

    failing.clear();
    entities = Array.from(
      { length: PROTECTED_INDICATOR_ROWS_PER_SOURCE + 1 },
      (_unused: unknown, index: number): JSONObject => {
        return { value: index.toString(16).padStart(32, "0") };
      },
    );

    expect(
      (await protectionOf("44d88612fea8a8f36de82e1278abb02f")).unreadSources,
    ).toEqual([SecurityProtectedAddressSource.ProtectedEntity]);
  });
});
