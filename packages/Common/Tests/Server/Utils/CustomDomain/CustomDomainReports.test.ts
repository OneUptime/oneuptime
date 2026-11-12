import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE FOUR OPEN REPORTS ABOUT STATUS PAGE CUSTOM DOMAINS, RE-TESTED.
 *
 * #1521, #1664, #1692 and #1774 (all from 2024) each describe a status page
 * custom domain that could not be verified. Each is reproduced here as its
 * reporter described it, against today's code, on the installation they
 * ran - OneUptime Cloud or self-hosted, whose set-ups differ (the CNAME
 * target, how certificates are issued, what the admin must configure). DNS,
 * the request to the domain and the certificate issuer are stubbed: nothing
 * here touches the network.
 *
 *   #1521 (self-hosted, Docker Compose and Helm): the CNAME was right, the
 *     request to the domain got a 404 from the proxy in front of
 *     OneUptime, and the dialog said only "CNAME is not verified". Today
 *     the CNAME record alone verifies the domain, and DNS Setup warns that
 *     requests do not reach OneUptime (the certificate cannot be issued
 *     until they do). The Helm chart no longer has a Kubernetes Ingress
 *     whose host list had to name every status page domain: OneUptime's own
 *     ingress serves every hostname.
 *   #1664 (self-hosted, behind a Cloudflare tunnel): "I don't understand
 *     how OneUptime reads CNAME records". Cloudflare's proxy hides the
 *     CNAME (the name answers with Cloudflare's addresses), and the tunnel
 *     did not route the name to OneUptime. Today the check says exactly
 *     that, and a chain through a name of the customer's own counts.
 *   #1692 (self-hosted): "Error connecting to server" when verifying. The
 *     request to the domain was unbounded, and outlived the proxy's 60
 *     second timeout. Today every request and lookup is bounded well inside
 *     the /api location's timeout, and a failed check is a 400 that says
 *     what was looked up.
 *   #1774 (Kubernetes): "Custom Domains not enabled" with
 *     statusPage.cnameRecord set (fixed by a reinstall: the pods had not
 *     restarted), then the CNAME not verifying until the status page host
 *     was added to the Ingress's hosts. Today the chart passes the value
 *     through, the readiness check names the setting and says to restart,
 *     and no host list exists to forget.
 */

let mockCnameRecord: string = "statuspage.oneuptime.com";
let mockIsBillingEnabled: boolean = true;

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "StatusPageCNameRecord", {
    get: (): string => {
      return mockCnameRecord;
    },
  });

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mocked;
});

import StatusPageDomainService from "../../../../Server/Services/StatusPageDomainService";
import DnsLookup, {
  DnsLookupAnswer,
  DnsLookupFailure,
} from "../../../../Server/Utils/CustomDomain/DnsLookup";
import CustomDomainDnsCheck from "../../../../Server/Utils/CustomDomain/CustomDomainDnsCheck";
import CustomDomainServerReadiness from "../../../../Server/Utils/CustomDomain/CustomDomainServerReadiness";
import Domain, {
  DOMAIN_VERIFICATION_TIMEOUT_IN_MS,
} from "../../../../Server/Types/Domain";
import CustomDomainRoutes from "../../../../Server/API/CustomDomainRoutes";
import CustomDomainVerification from "../../../../Types/CustomDomain/CustomDomainVerification";
import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
} from "../../../../Types/CustomDomain/DnsRecordCheck";
import {
  DnsRecordCheckDescription,
  describeDnsRecordCheck,
  describeDnsRecordCheckInEnglish,
} from "../../../../Types/CustomDomain/DnsRecordCheckWords";
import {
  CustomDomainReadinessCheck,
  CustomDomainReadinessCheckId,
  CustomDomainReadinessOutcome,
  CustomDomainServerReadinessResult,
  describeReadinessCheckInEnglish,
} from "../../../../Types/CustomDomain/CustomDomainServerReadiness";
import { fillTemplate } from "../../../../Types/Translator";

type MockedFn = ReturnType<typeof jest.fn>;

const REPOSITORY: string = path.resolve(__dirname, "../../../../../..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY, relativePath), "utf8");
}

// The world a domain's check sees.
interface World {
  cname: Map<string, DnsLookupAnswer>;
  addresses: Map<string, DnsLookupAnswer>;
  // What a request to the domain's verification address answers.
  http: number | "no answer";
}

let world: World;
let recorded: Array<{ domain: string; verified: boolean }>;

const noRecords: DnsLookupAnswer = {
  values: [],
  failure: DnsLookupFailure.NoRecords,
  errorCode: "ENODATA",
};

beforeEach(() => {
  world = { cname: new Map(), addresses: new Map(), http: "no answer" };
  recorded = [];
  CustomDomainServerReadiness.clearCache();

  jest.spyOn(StatusPageDomainService, "findOneBy").mockResolvedValue({
    _id: "d0d0d0d0-0000-4000-8000-000000000001",
    cnameVerificationToken: "token-1",
  } as never);

  jest
    .spyOn(StatusPageDomainService, "updateCnameStatusForStatusPageDomain")
    .mockImplementation((async (data: {
      domain: string;
      cnameStatus: boolean;
    }): Promise<void> => {
      recorded.push({ domain: data.domain, verified: data.cnameStatus });
    }) as never);

  jest.spyOn(DnsLookup, "resolveCname").mockImplementation((async (
    name: string,
  ): Promise<DnsLookupAnswer> => {
    return world.cname.get(name) || noRecords;
  }) as never);

  jest.spyOn(DnsLookup, "resolveAddresses").mockImplementation((async (
    name: string,
  ): Promise<DnsLookupAnswer> => {
    return world.addresses.get(name) || noRecords;
  }) as never);

  jest
    .spyOn(Domain, "getForDomainVerification")
    .mockImplementation((async () => {
      if (world.http === "no answer") {
        throw new Error("connect ETIMEDOUT");
      }

      const status: number = world.http;

      return {
        statusCode: status,
        isSuccess: (): boolean => {
          return status === 200;
        },
        isFailure: (): boolean => {
          return status !== 200;
        },
      };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function checkNow(fullDomain: string): Promise<DnsRecordCheck> {
  return await StatusPageDomainService.checkCname(fullDomain, {
    lookUpDnsEvenWhenReached: true,
  });
}

describe("#1521: a right CNAME behind a proxy that answers 404 (self-hosted)", () => {
  beforeEach(() => {
    mockIsBillingEnabled = false;
    // config.env: STATUS_PAGE_CNAME_RECORD=oneuptimestatuspage.mydomain.com
    mockCnameRecord = "oneuptimestatuspage.mydomain.com";
    world.cname.set("status.mydomain.com", {
      values: ["oneuptimestatuspage.mydomain.com"],
    });
    // "DNS is resolving and when being accessed it returns 404."
    world.http = 404;
  });

  test("the CNAME record verifies the domain: no more 'CNAME is not verified'", async () => {
    const check: DnsRecordCheck = await checkNow("status.mydomain.com");

    expect(check.outcome).toBe(DnsRecordCheckOutcome.Found);
    expect(recorded).toEqual([
      { domain: "status.mydomain.com", verified: true },
    ]);
    expect(
      await StatusPageDomainService.isCnameValid("status.mydomain.com"),
    ).toBe(true);
  });

  test("and DNS Setup says requests do not reach OneUptime yet, and what to change", async () => {
    const description: DnsRecordCheckDescription = describeDnsRecordCheck(
      await checkNow("status.mydomain.com"),
    );

    expect(
      fillTemplate(description.warning!.template, description.warning!.values),
    ).toBe(
      "But a request to status.mydomain.com did not reach OneUptime: it answered with HTTP 404. If a proxy or load balancer is in front of OneUptime, it must pass requests for status.mydomain.com on to OneUptime.",
    );
  });

  test("the Helm chart has no Kubernetes Ingress whose hosts had to list each status page domain", () => {
    const ingress: string = read(
      "HelmChart/Public/oneuptime/templates/ingress.yaml",
    );

    expect(ingress).not.toMatch(/kind:\s*Ingress/);
    expect(ingress).not.toContain("hosts");
  });

  test("OneUptime's own ingress answers every hostname, and passes the verification path on", () => {
    const nginx: string = read("packages/Nginx/default.conf.template");

    expect(nginx).toMatch(
      /listen \$\{NGINX_LISTEN_ADDRESS\}7849 default_server/,
    );
    expect(nginx).toMatch(/server_name\s+_;/);
    expect(nginx).toContain("location /status-page-api/ {");
    expect(nginx).toContain(
      "rewrite ^/status-page-api/(.*)$ /api/status-page/$1 break;",
    );
  });
});

describe("#1664: a name Cloudflare proxies, behind a tunnel (self-hosted)", () => {
  beforeEach(() => {
    mockIsBillingEnabled = false;
    // STATUS_PAGE_CNAME_RECORD=oneuptime.mydomain.com
    mockCnameRecord = "oneuptime.mydomain.com";
  });

  test("the proxied CNAME is hidden: the check says the name answers with Cloudflare's addresses", async () => {
    world.addresses.set("status.mydomain.com", {
      values: ["104.21.32.1", "172.67.150.2"],
    });

    const check: DnsRecordCheck = await checkNow("status.mydomain.com");

    expect(check.outcome).toBe(DnsRecordCheckOutcome.NotFound);
    expect(check.addresses).toEqual(["104.21.32.1", "172.67.150.2"]);

    const english: string = describeDnsRecordCheckInEnglish(check);

    expect(english).toContain(
      "We looked up the CNAME record of status.mydomain.com and got nothing, but the name answers with the address 104.21.32.1, 172.67.150.2.",
    );
    expect(english).toContain("Cloudflare's orange cloud");
    expect(english).toContain("set the name to DNS only");
  });

  test("set to DNS only, the record points at the target, whatever the target itself points at", async () => {
    world.cname.set("status.mydomain.com", {
      values: ["oneuptime.mydomain.com"],
    });
    world.cname.set("oneuptime.mydomain.com", {
      values: ["0a1b2c.cfargotunnel.com"],
    });

    const check: DnsRecordCheck = await checkNow("status.mydomain.com");

    expect(check.outcome).toBe(DnsRecordCheckOutcome.Found);
    expect(check.foundValues).toEqual(["oneuptime.mydomain.com"]);
  });

  test("a chain through a name of the customer's own counts", async () => {
    world.cname.set("status.mydomain.com", { values: ["pages.mydomain.com"] });
    world.cname.set("pages.mydomain.com", {
      values: ["oneuptime.mydomain.com."],
    });

    expect((await checkNow("status.mydomain.com")).outcome).toBe(
      DnsRecordCheckOutcome.Found,
    );
  });

  test("proxied, but the tunnel routes the name to OneUptime: verified", async () => {
    world.addresses.set("status.mydomain.com", { values: ["104.21.32.1"] });
    world.http = 200;

    const check: DnsRecordCheck = await checkNow("status.mydomain.com");

    expect(check.outcome).toBe(DnsRecordCheckOutcome.Found);
    expect(describeDnsRecordCheckInEnglish(check)).toBe(
      "Requests to status.mydomain.com reach OneUptime.",
    );
  });
});

describe("#1692: 'Error connecting to server' when verifying (self-hosted)", () => {
  beforeEach(() => {
    mockIsBillingEnabled = false;
    mockCnameRecord = "oneuptime.mydomain.com";
  });

  test("a domain that never answers is a check with an answer, not a request that outlives the proxy", async () => {
    world.http = "no answer";
    world.cname.set("status1.example.com", {
      values: [],
      failure: DnsLookupFailure.NoAnswer,
      errorCode: "ETIMEOUT",
    });

    const check: DnsRecordCheck = await checkNow("status1.example.com");

    expect(check.outcome).toBe(DnsRecordCheckOutcome.LookupFailed);
    expect(CustomDomainRoutes.getNotVerifiedMessage(check)).toBe(
      "We could not look up the CNAME record of status1.example.com: the DNS server did not answer. Try again in a few minutes. We keep checking every 15 minutes.",
    );
  });

  test("the longest Check now can take stays well inside the /api location's proxy timeout", () => {
    const nginx: string = read("packages/Nginx/default.conf.template");

    // Every /api location, and the shortest read timeout among them.
    const apiLocations: Array<string> =
      nginx.match(/ {4}location \/api \{[\s\S]*?\n {4}\}/g) || [];
    const timeoutsInMs: Array<number> = apiLocations.map(
      (location: string): number => {
        const timeout: RegExpMatchArray | null = location.match(
          /proxy_read_timeout (\d+)s;/,
        );

        // Without one, nginx's default: 60 seconds.
        return (timeout ? parseInt(timeout[1]!, 10) : 60) * 1000;
      },
    );

    expect(timeoutsInMs.length).toBeGreaterThan(0);

    const proxyTimeoutInMs: number = Math.min(...timeoutsInMs);

    /*
     * The two verification requests (http, https), one CNAME lookup that
     * times out (a chain ends at the first that fails), the address lookup
     * (A and AAAA at once), and the wait for the certificate order.
     */
    const dnsLookupInMs: number = DnsLookup.TIMEOUT_IN_MS * DnsLookup.TRIES;
    const longestCheckNowInMs: number =
      2 * DOMAIN_VERIFICATION_TIMEOUT_IN_MS +
      CustomDomainDnsCheck.MAX_CNAME_HOPS * dnsLookupInMs +
      dnsLookupInMs +
      CustomDomainVerification.ORDER_WAIT_IN_MS;

    expect(longestCheckNowInMs).toBeLessThan(proxyTimeoutInMs / 2);
    // The default nginx timeout the report ran into is not what /api has now.
    expect(proxyTimeoutInMs).toBeGreaterThan(60000);
  });

  test("the request to the domain is bounded", () => {
    expect(DOMAIN_VERIFICATION_TIMEOUT_IN_MS).toBeLessThanOrEqual(10000);
    expect(read("packages/Common/Server/Types/Domain.ts")).toContain(
      "timeout: DOMAIN_VERIFICATION_TIMEOUT_IN_MS",
    );
  });
});

describe("#1774: 'Custom Domains not enabled', then a CNAME that would not verify (Kubernetes)", () => {
  test("the chart passes statusPage.cnameRecord through as STATUS_PAGE_CNAME_RECORD", () => {
    expect(read("HelmChart/Public/oneuptime/templates/_helpers.tpl")).toMatch(
      /- name: STATUS_PAGE_CNAME_RECORD\n\s+value: \{\{ include "oneuptime\.envValue" \$\.Values\.statusPage\.cnameRecord \}\}/,
    );
  });

  test("a server without it is told which setting, in Docker Compose and in Helm, and to restart", async () => {
    mockIsBillingEnabled = false;

    const readiness: CustomDomainServerReadinessResult =
      await CustomDomainServerReadiness.check({
        target: "",
        variable: "STATUS_PAGE_CNAME_RECORD",
        helmValue: "statusPage.cnameRecord",
      });

    const targetSet: CustomDomainReadinessCheck | undefined =
      readiness.checks.find((item: CustomDomainReadinessCheck) => {
        return item.id === CustomDomainReadinessCheckId.TargetSet;
      });

    expect(targetSet?.outcome).toBe(CustomDomainReadinessOutcome.Fail);
    expect(describeReadinessCheckInEnglish(targetSet!)).toContain(
      "statusPage.cnameRecord in the Helm chart's values), then restart OneUptime.",
    );
  });

  test("with it set, the status page host no longer has to be listed anywhere: its CNAME verifies it", async () => {
    mockIsBillingEnabled = false;
    mockCnameRecord = "oneuptime.mycompany.com";
    world.cname.set("status.mycompany.com", {
      values: ["oneuptime.mycompany.com"],
    });
    world.http = 200;

    expect((await checkNow("status.mycompany.com")).outcome).toBe(
      DnsRecordCheckOutcome.Found,
    );
  });
});

describe("on OneUptime Cloud", () => {
  beforeEach(() => {
    mockIsBillingEnabled = true;
    mockCnameRecord = "statuspage.oneuptime.com";
  });

  test("a domain pointed at the Cloud's record is verified", async () => {
    world.cname.set("status.acme.com", {
      values: ["statuspage.oneuptime.com"],
    });
    world.http = 200;

    const check: DnsRecordCheck = await checkNow("status.acme.com");

    expect(check.outcome).toBe(DnsRecordCheckOutcome.Found);
    expect(check.reachedOneUptime).toBe(true);
    expect(describeDnsRecordCheck(check).warning).toBeUndefined();
  });

  test("a domain pointed at a self-hosted record by mistake says what it got and what Cloud expects", async () => {
    world.cname.set("status.acme.com", { values: ["oneuptime.acme.com"] });

    const english: string = describeDnsRecordCheckInEnglish(
      await checkNow("status.acme.com"),
    );

    expect(english).toContain(
      "got oneuptime.acme.com, but expected statuspage.oneuptime.com.",
    );
  });

  test("a domain the check cannot even read is recorded unverified, and says so", async () => {
    (
      StatusPageDomainService.findOneBy as unknown as MockedFn
    ).mockRejectedValue(new Error("database is down") as never);

    const check: DnsRecordCheck = await checkNow("status.acme.com");

    expect(check.outcome).toBe(DnsRecordCheckOutcome.LookupFailed);
    expect(recorded).toEqual([{ domain: "status.acme.com", verified: false }]);
  });

  test("a name that is not one of ours is not looked up, and records nothing", async () => {
    (
      StatusPageDomainService.findOneBy as unknown as MockedFn
    ).mockResolvedValue(null as never);

    const check: DnsRecordCheck = await checkNow("status.acme.com");

    expect(check.outcome).toBe(DnsRecordCheckOutcome.NotFound);
    expect(recorded).toEqual([]);
    expect(Domain.getForDomainVerification).not.toHaveBeenCalled();
  });
});
