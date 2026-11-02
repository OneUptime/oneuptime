import {
  EXACT_SECURITY_CONNECTION_REASONS,
  POSSIBLE_SECURITY_CONNECTION_REASONS,
  SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES,
  SECURITY_CONNECTION_KINDS,
  SECURITY_CONNECTION_MAX_ADDRESSES,
  SECURITY_CONNECTION_MAX_ENTITIES,
  SECURITY_CONNECTION_MAX_WINDOW_IN_HOURS,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
} from "../../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  MAX_HOST_NAME_LENGTH,
  MAX_RESOURCE_ID_LENGTH,
  MAX_URL_LENGTH,
  MONITOR_TARGET_MAX_HOSTS,
  SECURITY_CONNECTION_LOOKUP_KINDS,
  SECURITY_CONNECTION_MAX_MONITOR_MENTIONS,
  SecurityAddressScope,
  SecurityConnectionLookups,
  SecurityConnectionVerdict,
  SecurityConnectionWindow,
  canonicalAddress,
  compareConnectedResources,
  foldConnectionValue,
  getBestCertainty,
  getCaseConnectionWindow,
  getEventConnectionWindow,
  getLookupKindsOf,
  getMonitorMentionTexts,
  getMonitorTargetHosts,
  getObservableSearchValues,
  getRecordSecurityValues,
  getSecurityAddressScope,
  getSecurityConnectionLookups,
  getShortHostName,
  getUrlHost,
  isCloudResourceIdLike,
  isEmailLike,
  isHostNameLike,
  matchAddress,
  matchEmail,
  matchHostName,
  matchMonitorTarget,
  matchResourceId,
  readCloudEndpointHosts,
  readRecordAddresses,
  readSecurityLogResource,
  recordReportsAddress,
  wasLookedUpEverywhere,
} from "../../../Utils/SecurityCase/SecurityConnectionMatch";
import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import {
  getEntityCaseGroupingKey,
  getEntityRiskKey,
} from "../../../Utils/SecurityCase/SecurityEntityRiskScore";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * Whether a value Security Events names is one of the project's own records,
 * and how sure that is (Types/SecurityCase/SecurityConnection): exact,
 * possible - shown, said to be possible, counted nowhere - or not at all.
 * Every value here is outside text, so each rule is held to its shape too:
 * what it must never be handed, and how long it may take.
 */

const NOW: Date = new Date("2026-10-25T12:00:00.000Z");

function minutes(date: Date, offset: number): Date {
  return new Date(date.getTime() + offset * 60 * 1000);
}

describe("one identity: the way an entity's risk and a case's grouping key fold a value", () => {
  test("trimmed and case folded, as getEntityRiskKey folds it", () => {
    expect(foldConnectionValue("  WEB-1 ")).toBe("web-1");
    expect(foldConnectionValue("Web-1")).toBe(getEntityRiskKey("web-1"));
    expect(getEntityCaseGroupingKey("WEB-1")).toBe(
      `entity:${foldConnectionValue("web-1")}`,
    );
  });

  test("a value too long to index whole is hashed on both sides, so it still meets itself", () => {
    const long: string = `${"a".repeat(240)}.example`;

    expect(foldConnectionValue(long)).toBe(getEntityRiskKey(long));
    expect(foldConnectionValue(long.toUpperCase())).toBe(
      foldConnectionValue(long),
    );
    expect(foldConnectionValue(long).startsWith("sha256:")).toBe(true);
  });

  test("nothing folds to nothing", () => {
    expect(foldConnectionValue(undefined)).toBe("");
    expect(foldConnectionValue(null)).toBe("");
    expect(foldConnectionValue("   ")).toBe("");
  });
});

describe("the kinds and reasons", () => {
  test("every kind is listed once, machines first and inventory items last", () => {
    expect(new Set(SECURITY_CONNECTION_KINDS).size).toBe(
      Object.values(SecurityConnectionKind).length,
    );
    expect(SECURITY_CONNECTION_KINDS[0]).toBe(SecurityConnectionKind.Host);
    expect(
      SECURITY_CONNECTION_KINDS[SECURITY_CONNECTION_KINDS.length - 1],
    ).toBe(SecurityConnectionKind.InventoryItem);
  });

  test("machines, clusters, devices, the cloud's, services, the monitors that check them, then people", () => {
    expect(SECURITY_CONNECTION_KINDS).toEqual([
      SecurityConnectionKind.Host,
      SecurityConnectionKind.DockerHost,
      SecurityConnectionKind.PodmanHost,
      SecurityConnectionKind.KubernetesCluster,
      SecurityConnectionKind.NetworkDevice,
      SecurityConnectionKind.CloudResource,
      SecurityConnectionKind.ServerlessFunction,
      SecurityConnectionKind.Service,
      SecurityConnectionKind.Monitor,
      SecurityConnectionKind.User,
      SecurityConnectionKind.InventoryItem,
    ]);
  });

  test("a cloud resource's ID, the names it answers on and a monitor's target are exact reasons", () => {
    for (const reason of [
      SecurityConnectionReason.ResourceId,
      SecurityConnectionReason.CloudEndpoint,
      SecurityConnectionReason.MonitorTarget,
    ]) {
      expect(EXACT_SECURITY_CONNECTION_REASONS).toContain(reason);
      expect(POSSIBLE_SECURITY_CONNECTION_REASONS).not.toContain(reason);
    }
  });

  test("every reason is either exact or possible, never both", () => {
    const all: Array<SecurityConnectionReason> = [
      ...EXACT_SECURITY_CONNECTION_REASONS,
      ...POSSIBLE_SECURITY_CONNECTION_REASONS,
    ];

    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(
      new Set(Object.values(SecurityConnectionReason)),
    );
  });
});

describe("isHostNameLike", () => {
  test.each([
    "web-1",
    "WEB-1",
    "web_1",
    "web-1.acme.internal",
    "ip-10-0-1-5.ec2.internal",
    "a",
    "1234",
    `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
  ])("%s can be a machine's name", (value: string) => {
    expect(isHostNameLike(value)).toBe(true);
  });

  test.each([
    "",
    "   ",
    "web 1",
    "web-1.",
    ".web-1",
    "-web",
    "web-",
    "a..b",
    "%",
    "web*",
    "web'1",
    "web/1",
    "https://web-1.example",
    "k.morgan@acme.example",
    "10.0.0.5",
    "2001:db8::7",
    "a".repeat(MAX_HOST_NAME_LENGTH + 1),
  ])(
    "%s is no machine's name, and is never looked up as one",
    (value: string) => {
      expect(isHostNameLike(value)).toBe(false);
    },
  );
});

describe("getShortHostName", () => {
  test("a full name's first label", () => {
    expect(getShortHostName("web-1.acme.internal")).toBe("web-1");
    expect(getShortHostName("WEB-1.ACME.INTERNAL")).toBe("web-1");
  });

  test("a bare name, an address or anything else has none", () => {
    expect(getShortHostName("web-1")).toBeNull();
    expect(getShortHostName("10.0.0.5")).toBeNull();
    expect(getShortHostName("web 1.acme")).toBeNull();
    expect(getShortHostName(undefined)).toBeNull();
  });
});

describe("matchHostName", () => {
  test("the same name, whatever its case or spaces: exact", () => {
    expect(
      matchHostName({ entityValue: " WEB-1 ", resourceName: "web-1" }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.HostName,
    });
  });

  test("an exact match is named as the record's kind names it", () => {
    expect(
      matchHostName({
        entityValue: "prod-eu",
        resourceName: "prod-eu",
        exactReason: SecurityConnectionReason.ClusterName,
      })?.reason,
    ).toBe(SecurityConnectionReason.ClusterName);
  });

  test("a host or domain entity can be exact; an untyped value only possible", () => {
    expect(
      matchHostName({
        entityValue: "web-1.acme.internal",
        entityType: SecurityEntityType.Domain,
        resourceName: "web-1.acme.internal",
      })?.certainty,
    ).toBe(SecurityConnectionCertainty.Exact);

    expect(
      matchHostName({
        entityValue: "production",
        entityType: SecurityEntityType.Other,
        resourceName: "production",
      }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.UntypedValue,
    });
  });

  test("a bare name and the full name starting with it: possible, either way round", () => {
    const possible: SecurityConnectionVerdict = {
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.ShortHostName,
    };

    expect(
      matchHostName({
        entityValue: "web-1",
        resourceName: "web-1.acme.internal",
      }),
    ).toEqual(possible);
    expect(
      matchHostName({
        entityValue: "WEB-1.acme.internal",
        resourceName: "web-1",
      }),
    ).toEqual(possible);
  });

  test("two full names sharing a first label are two machines", () => {
    expect(
      matchHostName({
        entityValue: "web-1.prod.acme",
        resourceName: "web-1.staging.acme",
      }),
    ).toBeNull();
  });

  test("a different name, an address or nothing matches nothing", () => {
    expect(
      matchHostName({ entityValue: "web-2", resourceName: "web-1" }),
    ).toBeNull();
    expect(
      matchHostName({ entityValue: "10.0.0", resourceName: "10.0.0.5" }),
    ).toBeNull();
    expect(
      matchHostName({ entityValue: "web-1", resourceName: undefined }),
    ).toBeNull();
    expect(matchHostName({ entityValue: "", resourceName: "" })).toBeNull();
  });
});

describe("emails", () => {
  test("isEmailLike: one @, a domain with a dot, no white space", () => {
    expect(isEmailLike("k.morgan@acme.example")).toBe(true);
    expect(isEmailLike("root")).toBe(false);
    expect(isEmailLike("a@b")).toBe(false);
    expect(isEmailLike("a@@b.example")).toBe(false);
    expect(isEmailLike("@acme.example")).toBe(false);
    expect(isEmailLike("a b@acme.example")).toBe(false);
    expect(isEmailLike(`${"a".repeat(250)}@b.example`)).toBe(false);
  });

  test("the member with this email, folded: exact", () => {
    expect(
      matchEmail({
        entityValue: "K.Morgan@ACME.example",
        email: "k.morgan@acme.example",
      }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.Email,
    });
  });

  test("a bare user name names nobody in particular; another email is another person", () => {
    expect(matchEmail({ entityValue: "kmorgan", email: "kmorgan" })).toBeNull();
    expect(
      matchEmail({
        entityValue: "k.morgan@acme.example",
        email: "kim@acme.example",
      }),
    ).toBeNull();
  });
});

describe("addresses", () => {
  test("canonicalAddress: one spelling for each address", () => {
    expect(canonicalAddress("10.0.0.5")).toBe("10.0.0.5");
    expect(canonicalAddress(" 10.0.0.5 ")).toBe("10.0.0.5");
    expect(canonicalAddress("2001:db8::7")).toBe("2001:db8:0:0:0:0:0:7");
    expect(canonicalAddress("2001:0DB8:0:0:0:0:0:7")).toBe(
      "2001:db8:0:0:0:0:0:7",
    );
    expect(canonicalAddress("fe80::1%eth0")).toBe("fe80:0:0:0:0:0:0:1");
    expect(canonicalAddress("::ffff:10.0.0.5")).toBe("10.0.0.5");
    expect(canonicalAddress("::1")).toBe("0:0:0:0:0:0:0:1");
  });

  test.each([
    "",
    "10.0.0",
    "10.0.0.256",
    "10.0.0.5.1",
    "1.2.3.-4",
    "2001:db8::7::1",
    "2001:db8:zz::1",
    "12345::1",
    "web-1",
    "1:2:3:4:5:6:7:8:9",
  ])("%s is no address", (value: string) => {
    expect(canonicalAddress(value)).toBeNull();
    expect(getSecurityAddressScope(value)).toBeNull();
  });

  test.each([
    ["203.0.113.7", SecurityAddressScope.Public],
    ["8.8.8.8", SecurityAddressScope.Public],
    ["2001:db8::7", SecurityAddressScope.Public],
    ["10.0.3.17", SecurityAddressScope.Private],
    ["172.16.0.1", SecurityAddressScope.Private],
    ["172.31.255.255", SecurityAddressScope.Private],
    ["192.168.1.2", SecurityAddressScope.Private],
    ["100.64.0.1", SecurityAddressScope.Private],
    ["fd12:3456::1", SecurityAddressScope.Private],
    ["fec0::1", SecurityAddressScope.Private],
    ["::ffff:192.168.1.2", SecurityAddressScope.Private],
    ["172.32.0.1", SecurityAddressScope.Public],
    ["127.0.0.1", SecurityAddressScope.Local],
    ["0.0.0.0", SecurityAddressScope.Local],
    ["169.254.10.10", SecurityAddressScope.Local],
    ["224.0.0.1", SecurityAddressScope.Local],
    ["255.255.255.255", SecurityAddressScope.Local],
    ["::1", SecurityAddressScope.Local],
    ["::", SecurityAddressScope.Local],
    ["fe80::1", SecurityAddressScope.Local],
    ["ff02::1", SecurityAddressScope.Local],
  ])("%s is %s", (address: string, scope: SecurityAddressScope) => {
    expect(getSecurityAddressScope(address)).toBe(scope);
  });

  test("a public address only one record holds: exact", () => {
    expect(matchAddress({ address: "203.0.113.7", holderCount: 1 })).toEqual({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.Address,
    });
  });

  test("a private address: possible, however few hold it", () => {
    expect(matchAddress({ address: "10.0.3.17", holderCount: 1 })).toEqual({
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.PrivateAddress,
    });
  });

  test("an address several records hold: possible, public or not", () => {
    for (const address of ["203.0.113.7", "10.0.3.17"]) {
      expect(matchAddress({ address, holderCount: 2 })).toEqual({
        certainty: SecurityConnectionCertainty.Possible,
        reason: SecurityConnectionReason.SharedAddress,
      });
    }
  });

  test("a local address, an address nobody holds or no address: nothing", () => {
    expect(matchAddress({ address: "127.0.0.1", holderCount: 1 })).toBeNull();
    expect(matchAddress({ address: "fe80::1", holderCount: 1 })).toBeNull();
    expect(matchAddress({ address: "203.0.113.7", holderCount: 0 })).toBeNull();
    expect(matchAddress({ address: "web-1", holderCount: 1 })).toBeNull();
  });

  test("a record's addresses: commas or spaces, each once in its one spelling, the local ones left out", () => {
    expect(
      readRecordAddresses(
        "10.0.0.5, 127.0.0.1 fe80::1,2001:DB8::7, 2001:db8:0:0:0:0:0:7,,  10.0.0.5",
      ),
    ).toEqual(["10.0.0.5", "2001:db8:0:0:0:0:0:7"]);
    expect(readRecordAddresses(["203.0.113.9", "not-an-address"])).toEqual([
      "203.0.113.9",
    ]);
    expect(readRecordAddresses(undefined)).toEqual([]);
  });

  test("recordReportsAddress: exact addresses only, whatever their spelling", () => {
    expect(recordReportsAddress("10.0.0.10", "10.0.0.1")).toBe(false);
    expect(recordReportsAddress("10.0.0.1, 10.0.0.10", "10.0.0.1")).toBe(true);
    expect(recordReportsAddress("2001:0db8::7", "2001:DB8:0:0:0:0:0:7")).toBe(
      true,
    );
    expect(recordReportsAddress("10.0.0.1", "nonsense")).toBe(false);
  });
});

describe("getSecurityConnectionLookups: what each entity is looked up as", () => {
  const entities: Array<SecurityEntity> = [
    { type: SecurityEntityType.Host, value: "WEB-1" },
    { type: SecurityEntityType.Domain, value: "db-1.acme.internal" },
    { type: SecurityEntityType.Other, value: "prod-eu" },
    { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    { type: SecurityEntityType.IpAddress, value: "127.0.0.1" },
    { type: SecurityEntityType.User, value: "K.Morgan@acme.example" },
    { type: SecurityEntityType.User, value: "root" },
    {
      type: SecurityEntityType.FileHash,
      value: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    { type: SecurityEntityType.Url, value: "https://evil.example/x" },
    { type: SecurityEntityType.Process, value: "powershell.exe -enc" },
    // The same host again, in another case: looked up once.
    { type: SecurityEntityType.Host, value: "web-1" },
    // A URL an attribute named without saying it is one, and a local one.
    {
      type: SecurityEntityType.Other,
      value: "https://Shop.Acme.example:8443/login?next=/",
    },
    { type: SecurityEntityType.Url, value: "http://127.0.0.1:8080/admin" },
    // A cloud resource's own ID.
    {
      type: SecurityEntityType.Other,
      value: "arn:aws:s3:::acme-prod-data",
    },
    // An IAM user's ARN names a user, not a resource.
    {
      type: SecurityEntityType.User,
      value: "arn:aws:iam::123456789012:user/kim",
    },
  ];
  const lookups: SecurityConnectionLookups =
    getSecurityConnectionLookups(entities);

  test("names: hosts, domains and untyped values shaped like a name, folded, each once", () => {
    expect(lookups.hostNames).toEqual([
      "web-1",
      "db-1.acme.internal",
      "prod-eu",
    ]);
    expect(lookups.hostNameEntities.get("web-1")).toEqual({
      type: SecurityEntityType.Host,
      value: "WEB-1",
    });
    expect(lookups.hostNameEntities.get("prod-eu")?.type).toBe(
      SecurityEntityType.Other,
    );
  });

  test("a full name is looked up as itself and its short form; a bare one as the full names it starts", () => {
    expect(lookups.hostNameQueryValues).toEqual([
      "web-1",
      "db-1.acme.internal",
      "db-1",
      "prod-eu",
    ]);
    expect(lookups.hostNamePrefixes).toEqual(["web-1", "prod-eu"]);
  });

  test("addresses in their one spelling, the local ones left out", () => {
    expect(lookups.addresses).toEqual(["203.0.113.7"]);
  });

  test("emails folded; a bare user name, a hash and a process are never looked up", () => {
    expect(lookups.emails).toEqual(["k.morgan@acme.example"]);
    expect(
      lookups.lookedUp.map((entity: SecurityEntity): string => {
        return entity.value;
      }),
    ).toEqual([
      "WEB-1",
      "db-1.acme.internal",
      "prod-eu",
      "203.0.113.7",
      "K.Morgan@acme.example",
      "https://evil.example/x",
      "https://Shop.Acme.example:8443/login?next=/",
      "arn:aws:s3:::acme-prod-data",
    ]);
  });

  test("a URL by its host - typed one, or written with a scheme - and never a local one", () => {
    expect(lookups.urlHosts).toEqual(["evil.example", "shop.acme.example"]);
    expect(lookups.urlHostEntities.get("shop.acme.example")).toEqual({
      type: SecurityEntityType.Other,
      value: "https://Shop.Acme.example:8443/login?next=/",
    });
    // A URL's host is never a name looked up among the machines.
    expect(lookups.hostNames).not.toContain("evil.example");
  });

  test("a cloud resource's own ID, folded; a user's ARN is a user's", () => {
    expect(lookups.resourceIds).toEqual(["arn:aws:s3:::acme-prod-data"]);
  });

  test("at most a case's worth of entities, and a few addresses", () => {
    const many: Array<SecurityEntity> = [];

    for (let index: number = 0; index < 80; index++) {
      many.push({
        type: SecurityEntityType.IpAddress,
        value: `203.0.113.${index}`,
      });
      many.push({ type: SecurityEntityType.Host, value: `host-${index}` });
    }

    const bounded: SecurityConnectionLookups =
      getSecurityConnectionLookups(many);

    expect(bounded.addresses.length).toBe(SECURITY_CONNECTION_MAX_ADDRESSES);
    expect(
      bounded.hostNames.length + bounded.addresses.length,
    ).toBeLessThanOrEqual(SECURITY_CONNECTION_MAX_ENTITIES);
  });

  test("an entity that is not one (no value, no object) is skipped", () => {
    expect(
      getSecurityConnectionLookups([
        null as unknown as SecurityEntity,
        { type: SecurityEntityType.Host, value: 5 as unknown as string },
        { type: SecurityEntityType.Host, value: "  " },
      ]).lookedUp,
    ).toEqual([]);
  });
});

describe("URLs: a URL by its host", () => {
  test("the host of a URL with a scheme, folded, without its user, port, path or query", () => {
    expect(getUrlHost("https://Shop.Acme.example:8443/admin?x=1#y")).toBe(
      "shop.acme.example",
    );
    expect(getUrlHost("ftp://kim:secret@files.acme.example/a")).toBe(
      "files.acme.example",
    );
    expect(getUrlHost("  wss://live.acme.example/socket  ")).toBe(
      "live.acme.example",
    );
  });

  test("an address host in its one spelling", () => {
    expect(getUrlHost("http://203.0.113.7/login")).toBe("203.0.113.7");
    expect(getUrlHost("http://[2001:db8::7]:8080/")).toBe(
      "2001:db8:0:0:0:0:0:7",
    );
  });

  test("no scheme, no host a monitor could check, or too long: nothing", () => {
    expect(getUrlHost("shop.acme.example/admin")).toBeNull();
    expect(getUrlHost("/admin/login")).toBeNull();
    expect(getUrlHost("https://")).toBeNull();
    expect(getUrlHost("https://bad host/x")).toBeNull();
    expect(getUrlHost("1http://shop.acme.example")).toBeNull();
    expect(getUrlHost("ht%p://shop.acme.example")).toBeNull();
    expect(
      getUrlHost(`https://shop.acme.example/${"a".repeat(MAX_URL_LENGTH)}`),
    ).toBeNull();
    expect(getUrlHost(undefined)).toBeNull();
    expect(getUrlHost(null)).toBeNull();
  });
});

describe("cloud resources: their own IDs, and the names and addresses they answer on", () => {
  test.each([
    "arn:aws:s3:::acme-prod-data",
    "arn:aws:lambda:us-east-1:123456789012:function:checkout",
    "ARN:AWS:EC2:US-EAST-1:123456789012:INSTANCE/I-0ABC",
    "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1",
    "//compute.googleapis.com/projects/acme/zones/us-central1-a/instances/web-1",
  ])("%s is a cloud resource's ID", (value: string) => {
    expect(isCloudResourceIdLike(value)).toBe(true);
  });

  test.each([
    "arn:aws:s3",
    "arn:aws:s3:::",
    "/subscriptions/",
    "//googleapis.com/x",
    "//compute.googleapis.com/",
    "web-1.acme.example",
    "https://compute.googleapis.com/projects/acme",
    "arn:aws:s3:::acme prod",
    "",
  ])("%p is not", (value: string) => {
    expect(isCloudResourceIdLike(value)).toBe(false);
  });

  test("an ID longer than any provider writes is not one", () => {
    expect(
      isCloudResourceIdLike(
        `arn:aws:s3:::${"a".repeat(MAX_RESOURCE_ID_LENGTH)}`,
      ),
    ).toBe(false);
  });

  test("a resource's own ID, folded, is that resource whatever the value was typed as", () => {
    const verdict: SecurityConnectionVerdict | null = matchResourceId({
      entityValue: " ARN:aws:s3:::Acme-Prod-Data ",
      providerResourceId: "arn:aws:s3:::acme-prod-data",
    });

    expect(verdict).toEqual({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.ResourceId,
    });
  });

  test("another ID, a name or nothing is no resource's ID", () => {
    expect(
      matchResourceId({
        entityValue: "arn:aws:s3:::acme-prod-data",
        providerResourceId: "arn:aws:s3:::acme-prod-data-2",
      }),
    ).toBeNull();
    // Equal, but not an ID at all: a name is never matched as one.
    expect(
      matchResourceId({
        entityValue: "checkout",
        providerResourceId: "checkout",
      }),
    ).toBeNull();
    expect(
      matchResourceId({
        entityValue: "arn:aws:s3:::acme-prod-data",
        providerResourceId: undefined,
      }),
    ).toBeNull();
  });

  test("the names it answers on apart from its addresses; local ones and repeats left out", () => {
    expect(
      readCloudEndpointHosts([
        "Checkout-1234.us-east-1.elb.amazonaws.com",
        "checkout-1234.us-east-1.elb.amazonaws.com",
        "203.0.113.50",
        "10.0.4.12",
        "127.0.0.1",
        "2001:db8::50",
        "",
        null,
        { host: "shop.example.com" },
      ]),
    ).toEqual({
      names: ["checkout-1234.us-east-1.elb.amazonaws.com"],
      addresses: ["203.0.113.50", "10.0.4.12", "2001:db8:0:0:0:0:0:50"],
    });
    expect(readCloudEndpointHosts(undefined)).toEqual({
      names: [],
      addresses: [],
    });
    expect(readCloudEndpointHosts("shop.example.com")).toEqual({
      names: [],
      addresses: [],
    });
  });

  test("a name it answers on, by the host rules: exact when typed, never by a short form", () => {
    expect(
      matchHostName({
        entityValue: "checkout-1234.us-east-1.elb.amazonaws.com",
        entityType: SecurityEntityType.Domain,
        resourceName: "checkout-1234.us-east-1.elb.amazonaws.com",
        exactReason: SecurityConnectionReason.CloudEndpoint,
      }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.CloudEndpoint,
    });
  });
});

function stepsWith(
  steps: Array<(step: MonitorStep) => MonitorStep>,
): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();

  monitorSteps.setMonitorStepsInstanceArray(
    steps.map((build: (step: MonitorStep) => MonitorStep): MonitorStep => {
      return build(new MonitorStep());
    }),
  );

  return monitorSteps;
}

describe("monitors: the hosts a monitor checks", () => {
  test("a URL's host, a host name, an address, a DNS lookup's name, a domain and an SNMP host", () => {
    const steps: MonitorSteps = stepsWith([
      (step: MonitorStep): MonitorStep => {
        return step.setMonitorDestination(
          URL.fromString("https://kim:pw@Shop.Acme.example:8443/checkout?a=1"),
        );
      },
      (step: MonitorStep): MonitorStep => {
        return step.setMonitorDestination(new Hostname("db-1.acme.internal"));
      },
      (step: MonitorStep): MonitorStep => {
        return step.setMonitorDestination(new IP("203.0.113.7"));
      },
      (step: MonitorStep): MonitorStep => {
        return step.setDnsMonitor({
          queryName: "API.acme.example",
          // The DNS server asked: not what the monitor checks.
          hostname: "8.8.8.8",
        } as never);
      },
      (step: MonitorStep): MonitorStep => {
        return step.setDomainMonitor({
          domainName: "acme.example",
        } as never);
      },
      (step: MonitorStep): MonitorStep => {
        return step.setSnmpMonitor({ hostname: "core-sw-1" } as never);
      },
    ]);

    expect(getMonitorTargetHosts(steps)).toEqual([
      "shop.acme.example",
      "db-1.acme.internal",
      "203.0.113.7",
      "api.acme.example",
      "acme.example",
      "core-sw-1",
    ]);
  });

  test("read from the JSON a monitor is stored as, too", () => {
    const json: unknown = JSON.parse(
      JSON.stringify(
        stepsWith([
          (step: MonitorStep): MonitorStep => {
            return step.setMonitorDestination(
              URL.fromString("https://shop.acme.example/"),
            );
          },
          (step: MonitorStep): MonitorStep => {
            return step.setDnsMonitor({
              queryName: "api.acme.example",
            } as never);
          },
        ]).toJSON(),
      ),
    );

    expect(getMonitorTargetHosts(json)).toEqual([
      "shop.acme.example",
      "api.acme.example",
    ]);
  });

  test("an address in its one spelling; a local one, a repeat or no host adds nothing", () => {
    expect(
      getMonitorTargetHosts(
        stepsWith([
          (step: MonitorStep): MonitorStep => {
            return step.setMonitorDestination(new IP("2001:0DB8::7"));
          },
          (step: MonitorStep): MonitorStep => {
            return step.setMonitorDestination(new IP("127.0.0.1"));
          },
          (step: MonitorStep): MonitorStep => {
            return step.setMonitorDestination(
              URL.fromString("https://SHOP.acme.example/a"),
            );
          },
          (step: MonitorStep): MonitorStep => {
            return step.setMonitorDestination(
              URL.fromString("https://shop.acme.example/b"),
            );
          },
          (step: MonitorStep): MonitorStep => {
            return step;
          },
        ]),
      ),
    ).toEqual(["2001:db8:0:0:0:0:0:7", "shop.acme.example"]);
  });

  test(`at most ${MONITOR_TARGET_MAX_HOSTS} hosts`, () => {
    const many: MonitorSteps = stepsWith(
      Array.from(
        { length: MONITOR_TARGET_MAX_HOSTS + 5 },
        (_value: unknown, index: number) => {
          return (step: MonitorStep): MonitorStep => {
            return step.setMonitorDestination(
              new Hostname(`host-${index}.acme.example`),
            );
          };
        },
      ),
    );

    expect(getMonitorTargetHosts(many)).toHaveLength(MONITOR_TARGET_MAX_HOSTS);
  });

  test("nothing that is not a monitor's steps checks a host", () => {
    expect(getMonitorTargetHosts(undefined)).toEqual([]);
    expect(getMonitorTargetHosts("https://shop.acme.example")).toEqual([]);
    expect(getMonitorTargetHosts({ data: {} })).toEqual([]);
    expect(
      getMonitorTargetHosts({
        data: { monitorStepsInstanceArray: [null, 3, { data: null }] },
      }),
    ).toEqual([]);
    expect(
      getMonitorTargetHosts({
        value: {
          monitorStepsInstanceArray: [
            { value: { dnsMonitor: ["api.acme.example"] } },
          ],
        },
      }),
    ).toEqual([]);
  });
});

describe("monitors: whether a value is what a monitor checks", () => {
  test("a host or a domain it checks: exact", () => {
    for (const type of [SecurityEntityType.Host, SecurityEntityType.Domain]) {
      expect(
        matchMonitorTarget({
          entityValue: "SHOP.acme.example",
          entityType: type,
          target: "shop.acme.example",
        }),
      ).toEqual({
        certainty: SecurityConnectionCertainty.Exact,
        reason: SecurityConnectionReason.MonitorTarget,
      });
    }
  });

  test("an untyped value or a short form: possible", () => {
    expect(
      matchMonitorTarget({
        entityValue: "shop.acme.example",
        entityType: SecurityEntityType.Other,
        target: "shop.acme.example",
      }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.UntypedValue,
    });
    expect(
      matchMonitorTarget({
        entityValue: "web-1",
        entityType: SecurityEntityType.Host,
        target: "web-1.acme.internal",
      }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.ShortHostName,
    });
  });

  test("a URL on the host it checks: exact, by the URL's host alone", () => {
    expect(
      matchMonitorTarget({
        entityValue: "https://shop.acme.example/admin/login",
        entityType: SecurityEntityType.Url,
        target: "shop.acme.example",
      }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.MonitorTarget,
    });
    // Written with a scheme, whatever it was typed as.
    expect(
      matchMonitorTarget({
        entityValue: "https://shop.acme.example/admin",
        entityType: SecurityEntityType.Other,
        target: "shop.acme.example",
      })?.certainty,
    ).toBe(SecurityConnectionCertainty.Exact);
    // A URL's host is never another host's short form.
    expect(
      matchMonitorTarget({
        entityValue: "https://shop/admin",
        entityType: SecurityEntityType.Url,
        target: "shop.acme.example",
      }),
    ).toBeNull();
  });

  test("a public address it checks: exact, however many monitors check it", () => {
    expect(
      matchMonitorTarget({
        entityValue: "203.0.113.7",
        entityType: SecurityEntityType.IpAddress,
        target: "203.0.113.7",
      }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.MonitorTarget,
    });
    expect(
      matchMonitorTarget({
        entityValue: "2001:DB8::7",
        entityType: SecurityEntityType.IpAddress,
        target: "2001:db8:0:0:0:0:0:7",
      })?.certainty,
    ).toBe(SecurityConnectionCertainty.Exact);
    expect(
      matchMonitorTarget({
        entityValue: "http://203.0.113.7/admin",
        entityType: SecurityEntityType.Url,
        target: "203.0.113.7",
      })?.certainty,
    ).toBe(SecurityConnectionCertainty.Exact);
  });

  test("a private address it checks: possible; a local one names nothing", () => {
    expect(
      matchMonitorTarget({
        entityValue: "10.0.3.17",
        entityType: SecurityEntityType.IpAddress,
        target: "10.0.3.17",
      }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.PrivateAddress,
    });
    expect(
      matchMonitorTarget({
        entityValue: "127.0.0.1",
        entityType: SecurityEntityType.IpAddress,
        target: "127.0.0.1",
      }),
    ).toBeNull();
  });

  test("another host, an address against a name, or nothing: no match", () => {
    expect(
      matchMonitorTarget({
        entityValue: "203.0.113.70",
        entityType: SecurityEntityType.IpAddress,
        target: "203.0.113.7",
      }),
    ).toBeNull();
    expect(
      matchMonitorTarget({
        entityValue: "203.0.113.7",
        entityType: SecurityEntityType.IpAddress,
        target: "shop.acme.example",
      }),
    ).toBeNull();
    expect(
      matchMonitorTarget({
        entityValue: "shop.acme.example",
        entityType: SecurityEntityType.Host,
        target: "203.0.113.7",
      }),
    ).toBeNull();
    expect(
      matchMonitorTarget({
        entityValue: "web-10.acme.example",
        entityType: SecurityEntityType.Host,
        target: "web-1.acme.example",
      }),
    ).toBeNull();
    expect(
      matchMonitorTarget({
        entityValue: "",
        entityType: SecurityEntityType.Host,
        target: "web-1.acme.example",
      }),
    ).toBeNull();
    expect(
      matchMonitorTarget({
        entityValue: "web-1.acme.example",
        entityType: SecurityEntityType.Host,
        target: "",
      }),
    ).toBeNull();
  });

  test("what the project's monitors are searched for: where a stored step holds a host, never a bare word", () => {
    const lookups: SecurityConnectionLookups = getSecurityConnectionLookups([
      { type: SecurityEntityType.Host, value: "web-1.acme.internal" },
      { type: SecurityEntityType.Host, value: "db" },
      { type: SecurityEntityType.Url, value: "https://shop.acme.example/x" },
      { type: SecurityEntityType.IpAddress, value: "2001:DB8::7" },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    ]);

    expect(getMonitorMentionTexts(lookups)).toEqual([
      // A full name: a whole string, a URL's host, a user's host.
      '"web-1.acme.internal"',
      "//web-1.acme.internal",
      "@web-1.acme.internal",
      // A bare name: itself, and itself with a domain after it.
      '"db"',
      "//db",
      "@db",
      '"db.',
      "//db.",
      "@db.",
      // A URL's host, as a full name is searched for.
      '"shop.acme.example"',
      "//shop.acme.example",
      "@shop.acme.example",
      // An IPv6 address in its one spelling and as written, whole or in brackets.
      '"2001:db8:0:0:0:0:0:7"',
      "[2001:db8:0:0:0:0:0:7]",
      '"2001:db8::7"',
      "[2001:db8::7]",
      '"203.0.113.7"',
      "//203.0.113.7",
      "@203.0.113.7",
      // A full name's short form, only as the whole host a step checks.
      '"web-1"',
      "//web-1/",
      "//web-1:",
      '//web-1"',
    ]);
  });

  test("a common short word is never searched for on its own", () => {
    const texts: Array<string> = getMonitorMentionTexts(
      getSecurityConnectionLookups([
        { type: SecurityEntityType.Host, value: "www.acme.example" },
      ]),
    );

    expect(texts).not.toContain("www");
    expect(texts).not.toContain("//www");
    expect(texts).toContain('"www"');
    expect(texts).toContain("//www/");
  });

  test(`at most ${SECURITY_CONNECTION_MAX_MONITOR_MENTIONS} texts, the case's own names first`, () => {
    const many: Array<SecurityEntity> = Array.from(
      { length: 50 },
      (_value: unknown, index: number): SecurityEntity => {
        return {
          type: SecurityEntityType.Host,
          value: `host-${index}.acme.example`,
        };
      },
    );
    const texts: Array<string> = getMonitorMentionTexts(
      getSecurityConnectionLookups(many),
    );

    expect(texts).toHaveLength(SECURITY_CONNECTION_MAX_MONITOR_MENTIONS);
    expect(texts[0]).toBe('"host-0.acme.example"');
    // Every full name made it in before any short form.
    expect(texts).toContain('"host-49.acme.example"');
    expect(getMonitorMentionTexts(getSecurityConnectionLookups([]))).toEqual(
      [],
    );
  });
});

describe("the kinds each value is looked up among", () => {
  test("a name among the machines, devices, the names cloud resources answer on and the hosts monitors check", () => {
    expect(
      getLookupKindsOf({ type: SecurityEntityType.Host, value: "web-1" }),
    ).toEqual(SECURITY_CONNECTION_LOOKUP_KINDS.name);
    expect(SECURITY_CONNECTION_LOOKUP_KINDS.name).toEqual([
      SecurityConnectionKind.Host,
      SecurityConnectionKind.DockerHost,
      SecurityConnectionKind.PodmanHost,
      SecurityConnectionKind.KubernetesCluster,
      SecurityConnectionKind.NetworkDevice,
      SecurityConnectionKind.CloudResource,
      SecurityConnectionKind.Monitor,
    ]);
  });

  test("an address among the hosts, devices and cloud resources holding it and the monitors checking it", () => {
    expect(
      getLookupKindsOf({
        type: SecurityEntityType.IpAddress,
        value: "203.0.113.7",
      }),
    ).toEqual([
      SecurityConnectionKind.Host,
      SecurityConnectionKind.NetworkDevice,
      SecurityConnectionKind.CloudResource,
      SecurityConnectionKind.Monitor,
    ]);
  });

  test("an email among the members, a URL among the monitors, an ID among the cloud resources", () => {
    expect(
      getLookupKindsOf({
        type: SecurityEntityType.User,
        value: "kim@acme.example",
      }),
    ).toEqual([SecurityConnectionKind.User]);
    expect(
      getLookupKindsOf({
        type: SecurityEntityType.Url,
        value: "https://shop.acme.example",
      }),
    ).toEqual([SecurityConnectionKind.Monitor]);
    expect(
      getLookupKindsOf({
        type: SecurityEntityType.Other,
        value: "arn:aws:s3:::acme-prod-data",
      }),
    ).toEqual([SecurityConnectionKind.CloudResource]);
  });

  test("a value is not in OneUptime only when every kind it could be was read", () => {
    const url: SecurityEntity = {
      type: SecurityEntityType.Url,
      value: "https://shop.acme.example",
    };
    const name: SecurityEntity = {
      type: SecurityEntityType.Host,
      value: "web-1",
    };

    expect(wasLookedUpEverywhere(url, new Set())).toBe(true);
    // Monitors could not be read: the URL may well be a monitor's.
    expect(
      wasLookedUpEverywhere(url, new Set([SecurityConnectionKind.Monitor])),
    ).toBe(false);
    expect(
      wasLookedUpEverywhere(url, new Set([SecurityConnectionKind.Host])),
    ).toBe(true);
    expect(
      wasLookedUpEverywhere(
        name,
        new Set([SecurityConnectionKind.CloudResource]),
      ),
    ).toBe(false);
    expect(
      wasLookedUpEverywhere(
        {
          type: SecurityEntityType.Other,
          value: "arn:aws:s3:::acme-prod-data",
        },
        new Set([SecurityConnectionKind.Monitor]),
      ),
    ).toBe(true);
  });
});

describe("ordering", () => {
  test("the best certainty: exact when any match is", () => {
    expect(
      getBestCertainty([
        SecurityConnectionCertainty.Possible,
        SecurityConnectionCertainty.Exact,
      ]),
    ).toBe(SecurityConnectionCertainty.Exact);
    expect(getBestCertainty([SecurityConnectionCertainty.Possible])).toBe(
      SecurityConnectionCertainty.Possible,
    );
    expect(getBestCertainty([])).toBe(SecurityConnectionCertainty.Possible);
  });

  test("exact first, then by kind, then by name", () => {
    const rows: Array<{
      certainty: SecurityConnectionCertainty;
      kind: SecurityConnectionKind;
      name: string;
    }> = [
      {
        certainty: SecurityConnectionCertainty.Possible,
        kind: SecurityConnectionKind.Host,
        name: "a",
      },
      {
        certainty: SecurityConnectionCertainty.Exact,
        kind: SecurityConnectionKind.User,
        name: "kim",
      },
      {
        certainty: SecurityConnectionCertainty.Exact,
        kind: SecurityConnectionKind.Host,
        name: "web-2",
      },
      {
        certainty: SecurityConnectionCertainty.Exact,
        kind: SecurityConnectionKind.Host,
        name: "web-1",
      },
    ];

    expect(
      [...rows].sort(compareConnectedResources).map((row: { name: string }) => {
        return row.name;
      }),
    ).toEqual(["web-1", "web-2", "kim", "a"]);
  });
});

describe("windows", () => {
  test("an event: half an hour either side", () => {
    const time: Date = minutes(NOW, -120);
    const window: SecurityConnectionWindow = getEventConnectionWindow(
      time,
      NOW,
    );

    expect(window.start).toEqual(
      minutes(time, -SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES),
    );
    expect(window.end).toEqual(
      minutes(time, SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES),
    );
  });

  test("an event of the last half hour ends now, never in the future", () => {
    const time: Date = minutes(NOW, -10);

    expect(getEventConnectionWindow(time, NOW).end).toEqual(NOW);
  });

  test("an event the clock calls future still ends no earlier than the event", () => {
    const time: Date = minutes(NOW, 5);

    expect(getEventConnectionWindow(time, NOW).end).toEqual(time);
  });

  test("a case: from before its first detection to after its last", () => {
    const window: SecurityConnectionWindow = getCaseConnectionWindow({
      firstDetectedAt: minutes(NOW, -300),
      lastDetectedAt: minutes(NOW, -120),
      now: NOW,
    });

    expect(window.start).toEqual(minutes(NOW, -330));
    expect(window.end).toEqual(minutes(NOW, -90));
  });

  test("a long case: its last day", () => {
    const last: Date = minutes(NOW, -60);
    const window: SecurityConnectionWindow = getCaseConnectionWindow({
      firstDetectedAt: "2026-09-01T00:00:00.000Z",
      lastDetectedAt: last.toISOString(),
      now: NOW,
    });

    expect(window.end).toEqual(minutes(last, 30));
    expect(window.end.getTime() - window.start.getTime()).toBe(
      SECURITY_CONNECTION_MAX_WINDOW_IN_HOURS * 60 * 60 * 1000,
    );
  });

  test("a case nothing has joined is read around its opening, and one with no time around now", () => {
    const opened: Date = minutes(NOW, -600);

    expect(getCaseConnectionWindow({ createdAt: opened, now: NOW })).toEqual({
      start: minutes(opened, -30),
      end: minutes(opened, 30),
    });
    expect(getCaseConnectionWindow({ now: NOW })).toEqual({
      start: minutes(NOW, -30),
      end: NOW,
    });
    expect(
      getCaseConnectionWindow({
        firstDetectedAt: "not a date",
        lastDetectedAt: "",
        now: NOW,
      }).end,
    ).toEqual(NOW);
  });
});

describe("readSecurityLogResource", () => {
  test("the record a log line was sent under, when the event names a real one", () => {
    expect(
      readSecurityLogResource({
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]:
          " 33333333-3333-4333-8333-333333333333 ",
        [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: "Host",
      }),
    ).toEqual({ type: "Host", id: "33333333-3333-4333-8333-333333333333" });
  });

  test("an event of another source, or one naming no real id, has none", () => {
    expect(readSecurityLogResource({})).toBeNull();
    expect(readSecurityLogResource(undefined)).toBeNull();
    expect(
      readSecurityLogResource({
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: "project-1",
        [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: "Host",
      }),
    ).toBeNull();
    expect(
      readSecurityLogResource({
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]:
          "33333333-3333-4333-8333-333333333333",
      }),
    ).toBeNull();
  });
});

describe("the way back: what a record is searched for by", () => {
  test("its names folded, each once, and its public addresses - never a private or local one", () => {
    expect(
      getRecordSecurityValues({
        names: ["WEB-1", "web-1", undefined, "  ", "Web 1"],
        addresses: "10.0.0.5, 127.0.0.1, 203.0.113.9, fe80::1, 2001:db8::9",
      }),
    ).toEqual(["web-1", "web 1", "203.0.113.9", "2001:db8:0:0:0:0:0:9"]);
  });

  test("a name too long to be anyone's is left out", () => {
    expect(getRecordSecurityValues({ names: ["a".repeat(300)] })).toEqual([]);
  });

  test("a cloud resource's own ID is kept, however long an Azure ID runs", () => {
    const azure: string = `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/${"rg".repeat(150)}/providers/Microsoft.Compute/virtualMachines/vm-1`;

    expect(azure.length).toBeGreaterThan(254);
    expect(getRecordSecurityValues({ names: [azure] })).toEqual([
      azure.toLowerCase(),
    ]);
    expect(
      getRecordSecurityValues({
        names: [`/subscriptions/${"x".repeat(2100)}`],
      }),
    ).toEqual([]);
  });

  test("observables are searched in the usual spellings, each once, within a limit", () => {
    expect(getObservableSearchValues(["Web-1", "web-1", " "])).toEqual([
      "Web-1",
      "web-1",
      "WEB-1",
    ]);
    expect(getObservableSearchValues(["a", "b", "c"], 4)).toEqual([
      "a",
      "A",
      "b",
      "B",
    ]);
  });
});

/*
 * Outside text is read in time in line with its length: a value an attacker
 * writes (400,000 characters of the worst case each reading meets) is
 * answered in well under two seconds.
 */
describe("every rule reads outside text in linear time", () => {
  const worstCases: Array<string> = [
    "a.".repeat(200000),
    "a-".repeat(200000),
    "1.".repeat(200000),
    ":".repeat(400000),
    "f:".repeat(200000),
    "@a".repeat(200000),
    `${"a".repeat(399999)}@`,
    "%".repeat(400000),
    // A URL's scheme, an ARN's colons, a Google Cloud name's slashes.
    "a://".repeat(100000),
    `https://${"a.".repeat(199990)}`,
    `arn:${":".repeat(399996)}`,
    `//${"x.googleapis.com/".repeat(23000)}`,
    `/subscriptions/${"/".repeat(399985)}`,
  ];

  test.each(
    worstCases.map((value: string, index: number): [number, string] => {
      return [index, value];
    }),
  )("worst case %i", (_index: number, value: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        isHostNameLike(value);
        getShortHostName(value);
        canonicalAddress(value);
        getSecurityAddressScope(value);
        isEmailLike(value);
        matchHostName({ entityValue: value, resourceName: value });
        readRecordAddresses(value);
        getSecurityConnectionLookups([
          { type: SecurityEntityType.Host, value },
          { type: SecurityEntityType.User, value },
        ]);
        getUrlHost(value);
        isCloudResourceIdLike(value);
        matchResourceId({ entityValue: value, providerResourceId: value });
        readCloudEndpointHosts([value]);
        matchMonitorTarget({
          entityValue: value,
          entityType: SecurityEntityType.Url,
          target: value,
        });
        getLookupKindsOf({ type: SecurityEntityType.Other, value });
        getMonitorMentionTexts(
          getSecurityConnectionLookups([
            { type: SecurityEntityType.Url, value },
            { type: SecurityEntityType.Other, value },
          ]),
        );
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
