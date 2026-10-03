/**
 * A status page custom domain's certificate, end to end: Check now, the four
 * StatusPageCerts sweeps, and the order itself, run together the way the
 * worker and the API run them.
 *
 * Check now (the verify-cname route) now orders the free certificate the
 * moment it finds the domain's record, while the 15-minute sweeps keep
 * ordering for every verified domain without one. #4309's reviews found two
 * ways this kind of change goes wrong, and these are the regression tests
 * for both:
 *
 *   - duplicate orders: two orders for one name - Check now and the order
 *     sweep at the same tick, a sweep that read the domain before Check now
 *     ordered it, or a domain whose isSslOrdered a CNAME blip reset while
 *     its certificate was fine;
 *   - a CNAME blip deleting a working certificate: an order checks the
 *     CNAME once more and GreenlockUtil.orderCert removes the name's
 *     certificate when that check fails, so any order placed for a domain
 *     that has a certificate, during a moment of DNS trouble, took the
 *     domain off HTTPS.
 *
 * The hardening that followed (custom-domain-ssl-hardening) adds the rest
 * of what its review found, end to end:
 *
 *   - Reissue SSL takes the same lock as every other order;
 *   - Check now and the CNAME sweep check the record once, not again inside
 *     the order, and a sweep's DNS blip during a Check now order cannot
 *     leave the domain ordered but "waiting for DNS";
 *   - Check now says Issued only for a certificate that exists and has not
 *     expired, and renews an expired one;
 *   - a domain whose order failed waits longer before the sweeps order it
 *     again, and its failure is what the Status column reads;
 *   - Check now, the sweeps and the renewal run together stay within the
 *     installation's Let's Encrypt budget.
 *
 * Real: StatusPageDomainService (the sweeps, isCnameValid, orderCert,
 * orderCertIfMissing, orderCertOnceCnameIsVerified, reissueCert, the
 * renewal run), CertificateOrder, CertificateOrderBudget,
 * CertificateOrderFailures and GreenlockUtil.orderCert. Replaced: the two
 * tables (in memory), the Let's Encrypt client, the DNS and HTTP checks of
 * the customer's domain, and Redis (InMemoryRedis: a held lock refuses at
 * once, as Redis does).
 */

import StatusPageDomainService, {
  Service as StatusPageDomainServiceClass,
} from "../../../Server/Services/StatusPageDomainService";
import AcmeCertificateService from "../../../Server/Services/AcmeCertificateService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import Domain from "../../../Server/Types/Domain";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import CertificateOrderBudget from "../../../Server/Utils/Greenlock/CertificateOrderBudget";
import CertificateOrderFailures from "../../../Server/Utils/Greenlock/CertificateOrderFailures";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import {
  CustomDomainCertificateStatus,
  CustomDomainVerificationResult,
} from "../../../Types/StatusPage/CustomDomainVerification";
import { CustomDomainCertificate } from "../../../Types/StatusPage/CustomDomainCertificates";
import {
  InMemoryRedis,
  useInMemoryRedis,
} from "../Utils/Greenlock/InMemoryRedis";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

const mockCnameRecord: string = "statuspage.example.com";

// What the CA does with the next order; the default issues at once.
let mockAuto: () => Promise<string> = async (): Promise<string> => {
  return "-----BEGIN CERTIFICATE-----\nissued\n-----END CERTIFICATE-----";
};

// Names the CA was asked for, in order.
const mockCaOrders: Array<string> = [];

jest.mock("acme-client", () => {
  return {
    __esModule: true,
    default: {
      Client: class {
        public async auto(): Promise<string> {
          return mockAuto();
        }
      },
      directory: {
        letsencrypt: {
          production: "https://acme.example.com/directory",
        },
      },
      crypto: {
        createCsr: async (data: {
          commonName: string;
        }): Promise<Array<string>> => {
          mockCaOrders.push(data.commonName);
          return ["-----BEGIN PRIVATE KEY-----", "csr"];
        },
        readCertificateInfo: (): { notBefore: Date; notAfter: Date } => {
          return {
            notBefore: new Date(),
            notAfter: new Date(Date.now() + 90 * 24 * 3600 * 1000),
          };
        },
      },
    },
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    __esModule: true,
    LetsEncryptAccountKey: Buffer.from("account key").toString("base64"),
    LetsEncryptNotificationEmail: "certificates@example.com",
    // The same as mockCnameRecord: the factory runs before that is set.
    StatusPageCNameRecord: "statuspage.example.com",
  };
});

type DomainRow = {
  _id: string;
  id: ObjectID;
  fullDomain: string;
  subdomain: string;
  cnameVerificationToken: string;
  isCnameVerified: boolean;
  isSslOrdered: boolean;
  isSslProvisioned: boolean;
  isCustomCertificate: boolean;
  certificateReissueRequestedAt?: Date | undefined;
};

type CertificateRow = {
  _id: string;
  domain: string;
  certificate: string;
  expiresAt: Date;
};

type World = {
  domains: Array<DomainRow>;
  certificates: Map<string, CertificateRow>;
  // Names whose record points here: the HTTP and DNS checks pass.
  dnsLive: Set<string>;
  // Names nginx serves a certificate for: the HTTPS probe passes.
  served: Set<string>;
  deletedCertificates: Array<string>;
  heldLocks: Set<string>;
  // Redis keys with their values: Check now's window, the budgets, failures.
  cache: Map<string, string>;
  redis: InMemoryRedis;
};

let world: World;

function makeDomain(
  fullDomain: string,
  state: Partial<
    Pick<DomainRow, "isCnameVerified" | "isSslOrdered" | "isSslProvisioned">
  > = {},
): DomainRow {
  const id: ObjectID = ObjectID.generate();

  return {
    _id: id.toString(),
    id: id,
    fullDomain: fullDomain,
    subdomain: fullDomain.split(".")[0] || "",
    cnameVerificationToken: `token-${fullDomain}`,
    isCnameVerified: false,
    isSslOrdered: false,
    isSslProvisioned: false,
    isCustomCertificate: false,
    ...state,
  };
}

function matches(row: DomainRow, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, value]: [string, unknown]) => {
    // "IN (...)": QueryHelper.any, as the spy below builds it.
    const inList: Array<string> | undefined = (
      value as { inList?: Array<string> } | null
    )?.inList;

    if (inList) {
      return inList.includes(
        String((row as unknown as Record<string, unknown>)[key]),
      );
    }

    if (value instanceof Date) {
      const current: unknown = (row as unknown as Record<string, unknown>)[key];

      return current instanceof Date && current.getTime() === value.getTime();
    }

    /*
     * Another query operator (the reissue cooldown's "older than or null")
     * is not modelled: the domains here are reissued at most once.
     */
    if (value !== null && typeof value === "object") {
      return true;
    }

    return (
      String((row as unknown as Record<string, unknown>)[key]) === String(value)
    );
  });
}

function copyOf(row: DomainRow): DomainRow {
  return { ...row };
}

function rowById(id: ObjectID | string): DomainRow | undefined {
  return world.domains.find((row: DomainRow) => {
    return row._id === id.toString();
  });
}

function hostOf(url: string): string {
  return url.split("://")[1]!.split("/")[0]!;
}

function addCertificate(domain: string, expiresInDays: number): void {
  world.certificates.set(domain, {
    _id: ObjectID.generate().toString(),
    domain: domain,
    certificate: `existing certificate of ${domain}`,
    expiresAt: new Date(Date.now() + expiresInDays * 24 * 3600 * 1000),
  });
}

/*
 * The sweeps' read of the order sweep's domains can be held open, to stand
 * for a sweep that read its domains before Check now ordered one of them.
 */
let holdOrderSweepRead: Promise<void> | null = null;

function setUpWorld(): void {
  const redis: InMemoryRedis = useInMemoryRedis();

  world = {
    domains: [],
    certificates: new Map(),
    dnsLive: new Set(),
    served: new Set(),
    deletedCertificates: [],
    heldLocks: redis.heldLocks,
    cache: redis.cache,
    redis: redis,
  };
  mockCaOrders.length = 0;
  holdOrderSweepRead = null;

  jest.spyOn(QueryHelper, "any").mockImplementation(((
    values: Array<string>,
  ) => {
    return { inList: values.map(String) };
  }) as never);

  // The status page domain table.
  jest
    .spyOn(StatusPageDomainService, "findBy")
    .mockImplementation((async (call: {
      query: Record<string, unknown>;
      skip?: number;
      limit: number;
    }) => {
      const snapshot: Array<DomainRow> = world.domains
        .filter((row: DomainRow) => {
          return matches(row, call.query);
        })
        .map(copyOf)
        .slice(call.skip || 0, (call.skip || 0) + call.limit);

      const isOrderSweepRead: boolean =
        call.query["isCnameVerified"] === true &&
        call.query["isSslOrdered"] === false;

      if (isOrderSweepRead && holdOrderSweepRead) {
        await holdOrderSweepRead;
      }

      return snapshot;
    }) as never);

  jest
    .spyOn(StatusPageDomainService, "findOneBy")
    .mockImplementation((async (call: { query: Record<string, unknown> }) => {
      const row: DomainRow | undefined = world.domains.find(
        (row: DomainRow) => {
          return matches(row, call.query);
        },
      );

      return row ? copyOf(row) : null;
    }) as never);

  jest
    .spyOn(StatusPageDomainService, "updateOneById")
    .mockImplementation((async (update: {
      id: ObjectID;
      data: Partial<DomainRow>;
    }) => {
      const row: DomainRow | undefined = rowById(update.id);

      if (row) {
        Object.assign(row, update.data);
      }
    }) as never);

  jest
    .spyOn(StatusPageDomainService, "updateOneBy")
    .mockImplementation((async (update: {
      query: Record<string, unknown>;
      data: Partial<DomainRow>;
    }) => {
      const row: DomainRow | undefined = world.domains.find(
        (candidate: DomainRow) => {
          return matches(candidate, update.query);
        },
      );

      if (!row) {
        return 0;
      }

      Object.assign(row, update.data);
      return 1;
    }) as never);

  // Every row the query matches: the one write that records many domains.
  jest
    .spyOn(StatusPageDomainService, "updateBy")
    .mockImplementation((async (update: {
      query: Record<string, unknown>;
      data: Partial<DomainRow>;
    }) => {
      const rows: Array<DomainRow> = world.domains.filter(
        (candidate: DomainRow) => {
          return matches(candidate, update.query);
        },
      );

      for (const row of rows) {
        Object.assign(row, update.data);
      }

      return rows.length;
    }) as never);

  /*
   * The certificate table: a lookup by name, or - for the renewal run - the
   * rows due, by expiry.
   */
  jest
    .spyOn(AcmeCertificateService, "findBy")
    .mockImplementation((async (call: {
      query: { domain?: { inList: Array<string> } };
      skip?: number;
    }) => {
      if (!call.query.domain) {
        if (call.skip) {
          return [];
        }

        return [...world.certificates.values()]
          .sort((a: CertificateRow, b: CertificateRow) => {
            return a.expiresAt.getTime() - b.expiresAt.getTime();
          })
          .map((row: CertificateRow) => {
            return { ...row };
          });
      }

      return call.query.domain.inList
        .filter((domain: string) => {
          return world.certificates.has(domain);
        })
        .map((domain: string) => {
          return { ...world.certificates.get(domain)! };
        });
    }) as never);

  jest
    .spyOn(AcmeCertificateService, "findOneBy")
    .mockImplementation((async (call: { query: { domain: string } }) => {
      const row: CertificateRow | undefined = world.certificates.get(
        call.query.domain,
      );
      return row ? { ...row } : null;
    }) as never);

  jest
    .spyOn(AcmeCertificateService, "updateBy")
    .mockImplementation((async (call: {
      query: { domain: string };
      data: Partial<CertificateRow>;
    }) => {
      const row: CertificateRow | undefined = world.certificates.get(
        call.query.domain,
      );

      if (!row) {
        return 0;
      }

      Object.assign(row, call.data);
      return 1;
    }) as never);

  jest
    .spyOn(AcmeCertificateService, "create")
    .mockImplementation((async (call: { data: Partial<CertificateRow> }) => {
      world.certificates.set(call.data.domain as string, {
        _id: ObjectID.generate().toString(),
        domain: call.data.domain as string,
        certificate: call.data.certificate as string,
        expiresAt: call.data.expiresAt as Date,
      });
      return call.data;
    }) as never);

  jest
    .spyOn(AcmeCertificateService, "deleteBy")
    .mockImplementation((async (call: { query: { domain: string } }) => {
      if (world.certificates.delete(call.query.domain)) {
        world.deletedCertificates.push(call.query.domain);
        return 1;
      }

      return 0;
    }) as never);

  // The customer's domain: its HTTP token check, its HTTPS probe, its DNS.
  jest
    .spyOn(Domain, "getForDomainVerification")
    .mockImplementation((async (request: { url: string }) => {
      const host: string = hostOf(request.url);
      const isHttps: boolean = request.url.startsWith("https://");
      const answers: boolean =
        world.dnsLive.has(host) && (!isHttps || world.served.has(host));

      return {
        isSuccess: (): boolean => {
          return answers;
        },
        isFailure: (): boolean => {
          return !answers;
        },
      };
    }) as never);

  jest.spyOn(Domain, "getCnameRecords").mockImplementation((async (data: {
    domain: string;
  }) => {
    return world.dnsLive.has(data.domain) ? [mockCnameRecord] : [];
  }) as never);

  /*
   * The lock (a held key refuses at once, like Redis with one attempt) and
   * the cache - Check now's window, the order budgets and the failed-order
   * records - are InMemoryRedis, set up above.
   */
}

// A new on-demand order window: what 15 minutes later looks like.
function nextOnDemandWindow(): void {
  world.cache.clear();
}

// The clock, moved on by this many minutes from now.
function minutesLater(minutes: number): void {
  const later: Date = OneUptimeDate.addRemoveMinutes(new Date(), minutes);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(later);
}

/*
 * What the verify-cname route does: read the domain, check its record, and
 * once it is found order its certificate.
 */
async function clickCheckNow(
  domain: DomainRow,
  options?: {
    waitInMs?: number;
    // DNS stops answering the moment after the route found the record.
    dnsGoesAwayAfterTheCheck?: boolean;
  },
): Promise<CustomDomainVerificationResult | null> {
  const asRead: DomainRow = copyOf(rowById(domain.id)!);

  const isValid: boolean = await StatusPageDomainService.isCnameValid(
    asRead.fullDomain,
  );

  if (!isValid) {
    return null;
  }

  if (options?.dnsGoesAwayAfterTheCheck) {
    world.dnsLive.delete(asRead.fullDomain);
  }

  return await StatusPageDomainService.orderCertOnceCnameIsVerified(
    asRead as never,
    options,
  );
}

// Every sweep of the StatusPageCerts worker but renewal, as one tick.
async function runSweeps(): Promise<void> {
  await Promise.all([
    StatusPageDomainService.verifyCnameWhoseCnameisNotVerified(),
    StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet(),
    StatusPageDomainService.checkOrderStatus(),
    StatusPageDomainService.updateSslProvisioningStatusForAllDomains(),
  ]);
}

// A CA that holds the next order until released.
function holdTheNextOrder(): {
  release: () => void;
  started: Promise<void>;
} {
  let release: () => void = (): void => {};
  let markStarted: () => void = (): void => {};

  const started: Promise<void> = new Promise<void>((resolve: () => void) => {
    markStarted = resolve;
  });

  const original: () => Promise<string> = mockAuto;

  mockAuto = (): Promise<string> => {
    mockAuto = original;
    markStarted();

    return new Promise<string>((resolve: (cert: string) => void) => {
      release = (): void => {
        resolve("-----BEGIN CERTIFICATE-----\nheld\n-----END CERTIFICATE-----");
      };
    });
  };

  return {
    release: (): void => {
      release();
    },
    started: started,
  };
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

const DEFAULT_AUTO: () => Promise<string> = mockAuto;

describe("a status page custom domain's certificate, Check now and the sweeps together", () => {
  beforeEach(() => {
    mockAuto = DEFAULT_AUTO;
    setUpWorld();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Check now orders the certificate the moment the record is found, and the sweeps order nothing more", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    const result: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(result?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(mockCaOrders).toEqual(["status.acme.com"]);
    expect(world.certificates.has("status.acme.com")).toBe(true);
    expect(domain.isCnameVerified).toBe(true);
    expect(domain.isSslOrdered).toBe(true);

    // nginx writes it out; the sweeps see it served and order nothing.
    world.served.add("status.acme.com");
    await runSweeps();
    await runSweeps();

    expect(mockCaOrders).toEqual(["status.acme.com"]);
    expect(domain.isSslProvisioned).toBe(true);
  });

  /*
   * Regression: duplicate orders. Check now's order is still with the CA
   * when the 15-minute tick starts; the order sweep finds the domain
   * verified and unordered, and places nothing.
   */
  test("Check now and the order sweep at the same moment: one order", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    const ca: { release: () => void; started: Promise<void> } =
      holdTheNextOrder();

    const checkNow: Promise<CustomDomainVerificationResult | null> =
      clickCheckNow(domain);

    await ca.started;

    // The tick, while Check now's order is with the CA.
    await runSweeps();

    expect(domain.isCnameVerified).toBe(true);
    expect(domain.isSslOrdered).toBe(false);

    ca.release();
    await checkNow;

    expect(mockCaOrders).toEqual(["status.acme.com"]);
    expect(domain.isSslOrdered).toBe(true);

    await runSweeps();

    expect(mockCaOrders).toEqual(["status.acme.com"]);
  });

  /*
   * Regression: duplicate orders. The sweep read its domains a moment
   * before Check now ordered this one, and gets to it after that order has
   * finished and let go of the lock.
   */
  test("a sweep that read the domain before Check now ordered it does not order it again", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
    });
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    let letTheSweepGoOn: () => void = (): void => {};
    holdOrderSweepRead = new Promise<void>((resolve: () => void) => {
      letTheSweepGoOn = resolve;
    });

    const sweep: Promise<void> =
      StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    await settle();

    // Check now, start to finish, while the sweep holds its stale list.
    holdOrderSweepRead = null;
    await clickCheckNow(domain);

    expect(mockCaOrders).toEqual(["status.acme.com"]);

    letTheSweepGoOn();
    await sweep;

    expect(mockCaOrders).toEqual(["status.acme.com"]);
    expect(world.certificates.size).toBe(1);
  });

  test("two clicks on Check now at once: one order", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    const ca: { release: () => void; started: Promise<void> } =
      holdTheNextOrder();

    const first: Promise<CustomDomainVerificationResult | null> =
      clickCheckNow(domain);
    await ca.started;
    const second: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    ca.release();
    const firstResult: CustomDomainVerificationResult | null = await first;

    expect(mockCaOrders).toEqual(["status.acme.com"]);
    expect(firstResult?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(second?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
  });

  /*
   * Regression: a CNAME blip deleting a valid certificate, and the
   * duplicate order after the blip reset isSslOrdered. The record fails
   * for a few runs and comes back; the certificate that was fine throughout
   * is neither deleted nor ordered again.
   */
  test("a CNAME blip: the working certificate is never deleted, and never ordered again", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
      isSslOrdered: true,
      isSslProvisioned: true,
    });
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");
    world.served.add("status.acme.com");
    addCertificate("status.acme.com", 60);

    const certificateBefore: string =
      world.certificates.get("status.acme.com")!.certificate;

    // The blip.
    world.dnsLive.delete("status.acme.com");
    world.served.delete("status.acme.com");

    await runSweeps();

    // The failed checks reset the domain, as they always did...
    expect(domain.isCnameVerified).toBe(false);
    expect(domain.isSslOrdered).toBe(false);

    await runSweeps();
    await runSweeps();

    // ...but nothing deleted its certificate or ordered another.
    expect(world.deletedCertificates).toEqual([]);
    expect(world.certificates.get("status.acme.com")?.certificate).toBe(
      certificateBefore,
    );
    expect(mockCaOrders).toEqual([]);

    // The record is back.
    world.dnsLive.add("status.acme.com");
    world.served.add("status.acme.com");

    await runSweeps();
    await runSweeps();

    expect(domain.isCnameVerified).toBe(true);
    expect(domain.isSslOrdered).toBe(true);
    expect(domain.isSslProvisioned).toBe(true);
    expect(mockCaOrders).toEqual([]);
    expect(world.deletedCertificates).toEqual([]);
    expect(world.certificates.get("status.acme.com")?.certificate).toBe(
      certificateBefore,
    );
  });

  /*
   * Regression: Reissue SSL during a CNAME blip. The order checks the CNAME
   * once more, and GreenlockUtil.orderCert used to remove the name's
   * certificate when that check failed - the one being reissued, still
   * serving. The reissue is refused; the certificate stays.
   */
  test("Reissue SSL during a CNAME blip is refused, and the working certificate stays", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
      isSslOrdered: true,
      isSslProvisioned: true,
    });
    world.domains.push(domain);
    addCertificate("status.acme.com", 60);

    const certificateBefore: string =
      world.certificates.get("status.acme.com")!.certificate;

    // The blip, as the reissue's own CNAME check runs.
    world.dnsLive.delete("status.acme.com");

    await expect(
      StatusPageDomainService.reissueCert(domain.id),
    ).rejects.toThrow("Cname is not valid");

    expect(world.deletedCertificates).toEqual([]);
    expect(world.certificates.get("status.acme.com")?.certificate).toBe(
      certificateBefore,
    );
    expect(mockCaOrders).toEqual([]);
  });

  test("Check now on a domain verified again after a blip records its certificate and orders nothing", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");
    addCertificate("status.acme.com", 45);

    const result: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(result?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issued,
    );
    expect(mockCaOrders).toEqual([]);
    expect(domain.isSslOrdered).toBe(true);
  });

  /*
   * The provisioning sweep used to order again whenever its HTTPS probe
   * failed - which, right after an order, is until nginx next writes the
   * new certificate.
   */
  test("a certificate nginx has not written out yet is not ordered a second time", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    await clickCheckNow(domain);

    // Not served yet, for a few ticks.
    await runSweeps();
    await runSweeps();

    expect(mockCaOrders).toEqual(["status.acme.com"]);
    expect(domain.isSslProvisioned).toBe(false);

    world.served.add("status.acme.com");
    await runSweeps();

    expect(domain.isSslProvisioned).toBe(true);
    expect(mockCaOrders).toEqual(["status.acme.com"]);
  });

  test("without anyone clicking Check now, the sweep that verifies a domain orders its certificate in the same run", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);

    await runSweeps();

    expect(mockCaOrders).toEqual([]);
    expect(domain.isCnameVerified).toBe(false);

    world.dnsLive.add("status.acme.com");
    await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(domain.isCnameVerified).toBe(true);
    expect(domain.isSslOrdered).toBe(true);
    expect(mockCaOrders).toEqual(["status.acme.com"]);

    await runSweeps();

    expect(mockCaOrders).toEqual(["status.acme.com"]);
  });

  /*
   * The sweeps order a failed domain again - once its retry delay is up,
   * not on the very next tick: a domain whose order keeps failing used to
   * be ordered every run, each order against the account the whole
   * installation shares.
   */
  test("an order that fails is reported to Check now, and the sweeps order again once its delay is up", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    mockAuto = async (): Promise<string> => {
      mockAuto = DEFAULT_AUTO;
      throw new Error("urn:ietf:params:acme:error:caa");
    };

    const result: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(result?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Failed,
    );
    expect(result?.certificateError).toContain(
      "Unable to order certificate for status.acme.com",
    );
    expect(domain.isCnameVerified).toBe(true);
    expect(domain.isSslOrdered).toBe(false);

    // The next tick, a moment later: the domain waits.
    await runSweeps();

    expect(mockCaOrders).toEqual(["status.acme.com"]);

    // Its first retry delay, 15 minutes, is up.
    minutesLater(15);
    await runSweeps();

    expect(mockCaOrders).toEqual(["status.acme.com", "status.acme.com"]);
    expect(domain.isSslOrdered).toBe(true);
    expect(world.certificates.has("status.acme.com")).toBe(true);
  });

  /*
   * Regression (review): an order that fails leaves the domain unordered,
   * so every click on Check now - or a script calling verify-cname - used
   * to place another order against the shared Let's Encrypt account.
   */
  test("after a failed order, more clicks in the same window order nothing and keep showing why", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    mockAuto = async (): Promise<string> => {
      throw new Error("urn:ietf:params:acme:error:caa");
    };

    const first: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(first?.certificateStatus).toBe(CustomDomainCertificateStatus.Failed);
    expect(mockCaOrders).toEqual(["status.acme.com"]);

    for (let click: number = 0; click < 5; click++) {
      const again: CustomDomainVerificationResult | null =
        await clickCheckNow(domain);

      expect(again?.certificateStatus).toBe(
        CustomDomainCertificateStatus.Failed,
      );
      expect(again?.certificateError).toBe(first?.certificateError);
    }

    expect(mockCaOrders).toEqual(["status.acme.com"]);

    // The next window: Check now may order again, and this time it works.
    mockAuto = DEFAULT_AUTO;
    nextOnDemandWindow();

    const later: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(later?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(mockCaOrders).toEqual(["status.acme.com", "status.acme.com"]);
    expect(domain.isSslOrdered).toBe(true);
  });

  test("without the cache, Check now orders nothing and leaves the domain to the sweeps", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("Cache is not connected") as never);

    const result: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(result?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(mockCaOrders).toEqual([]);

    await runSweeps();

    expect(mockCaOrders).toEqual(["status.acme.com"]);
  });

  /*
   * The three sweeps that order - the CNAME sweep for what it has just
   * verified, the order sweep, the re-order of a missing certificate - run
   * on the same tick, each capping its own batch. Between them they order
   * no more than ORDER_MAX_PER_RUN in a window: one budget.
   */
  test("the ordering sweeps together order at most ORDER_MAX_PER_RUN in a window", async () => {
    const max: number = StatusPageDomainServiceClass.ORDER_MAX_PER_RUN;

    // Verified and waiting for the order sweep.
    for (let i: number = 0; i < max; i++) {
      world.domains.push(
        makeDomain(`waiting${i}.acme.com`, { isCnameVerified: true }),
      );
      world.dnsLive.add(`waiting${i}.acme.com`);
    }

    // Live but not verified yet: the CNAME sweep verifies and orders them.
    for (let i: number = 0; i < max; i++) {
      world.domains.push(makeDomain(`new${i}.acme.com`));
      world.dnsLive.add(`new${i}.acme.com`);
    }

    // Marked ordered, certificate gone: the re-order sweep's.
    for (let i: number = 0; i < max; i++) {
      world.domains.push(
        makeDomain(`lost${i}.acme.com`, {
          isCnameVerified: true,
          isSslOrdered: true,
        }),
      );
      world.dnsLive.add(`lost${i}.acme.com`);
    }

    await runSweeps();

    expect(mockCaOrders).toHaveLength(max);

    // The same window: nothing more.
    await runSweeps();

    expect(mockCaOrders).toHaveLength(max);

    // The next window orders the next batch.
    nextOnDemandWindow();
    await runSweeps();

    expect(mockCaOrders).toHaveLength(max * 2);
    expect(new Set(mockCaOrders).size).toBe(max * 2);
  });

  test("an order that outlives Check now's wait is answered as issuing, and finishes on its own", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    const ca: { release: () => void; started: Promise<void> } =
      holdTheNextOrder();

    const result: CustomDomainVerificationResult | null = await clickCheckNow(
      domain,
      { waitInMs: 10 },
    );

    expect(result?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(domain.isSslOrdered).toBe(false);

    ca.release();
    await settle();

    expect(domain.isSslOrdered).toBe(true);
    expect(world.certificates.has("status.acme.com")).toBe(true);
    expect(world.heldLocks.size).toBe(0);
  });
});

describe("custom domain certificates, hardened: the review's findings end to end", () => {
  beforeEach(() => {
    mockAuto = DEFAULT_AUTO;
    setUpWorld();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Review finding 2 (lock part): Reissue SSL ordered without the name's
   * lock, beside a Check now or a re-order of the same name - two orders,
   * and two http-01 challenges that remove each other's challenge rows.
   */
  test("Reissue SSL while another order of the name runs is refused, orders nothing, and keeps the day's reissue", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
      isSslOrdered: true,
    });
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    // The certificate went missing; the re-order sweep is ordering it.
    const ca: { release: () => void; started: Promise<void> } =
      holdTheNextOrder();
    const reorder: Promise<void> = StatusPageDomainService.checkOrderStatus();
    await ca.started;

    await expect(
      StatusPageDomainService.reissueCert(domain.id),
    ).rejects.toThrow(TooManyRequestsException);

    expect(mockCaOrders).toEqual(["status.acme.com"]);
    expect(domain.certificateReissueRequestedAt).toBeUndefined();

    ca.release();
    await reorder;

    // Nothing runs now: the reissue goes ahead, once.
    await StatusPageDomainService.reissueCert(domain.id);

    expect(mockCaOrders).toEqual(["status.acme.com", "status.acme.com"]);
    expect(domain.certificateReissueRequestedAt).toBeInstanceOf(Date);
    expect(world.heldLocks.size).toBe(0);
  });

  test("Check now while a reissue of the name runs orders nothing more", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
      isSslOrdered: true,
    });
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");
    addCertificate("status.acme.com", -1);

    const ca: { release: () => void; started: Promise<void> } =
      holdTheNextOrder();
    const reissue: Promise<void> = StatusPageDomainService.reissueCert(
      domain.id,
    );
    await ca.started;

    const result: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(result?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(mockCaOrders).toEqual(["status.acme.com"]);

    ca.release();
    await reissue;

    expect(mockCaOrders).toEqual(["status.acme.com"]);
  });

  /*
   * Review finding 3: the route found the record, then the order checked it
   * once more. A DNS blip between the two marked the domain unverified and
   * failed the order, while the dialog said "Your CNAME record is verified."
   */
  test("Check now does not check the record twice: a DNS blip right after the route found it does not fail the order", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    const result: CustomDomainVerificationResult | null = await clickCheckNow(
      domain,
      { dnsGoesAwayAfterTheCheck: true },
    );

    expect(result?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(mockCaOrders).toEqual(["status.acme.com"]);
    expect(domain.isCnameVerified).toBe(true);
    expect(domain.isSslOrdered).toBe(true);
  });

  test("the CNAME sweep does not check the record twice either", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    const isCnameValid: SpyInstance<
      typeof StatusPageDomainService.isCnameValid
    > = jest.spyOn(StatusPageDomainService, "isCnameValid");

    await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(mockCaOrders).toEqual(["status.acme.com"]);
    expect(isCnameValid).toHaveBeenCalledTimes(1);
  });

  /*
   * Review finding 8: the CNAME sweep read the domain as unverified before
   * Check now verified it, then hit a DNS blip on it while Check now's order
   * ran - marking it unverified and unordered - and the order then marked
   * it ordered: "ordered", but "waiting for DNS".
   */
  test("a sweep's DNS blip while Check now orders never leaves the domain ordered but unverified", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    const ca: { release: () => void; started: Promise<void> } =
      holdTheNextOrder();
    const checkNow: Promise<CustomDomainVerificationResult | null> =
      clickCheckNow(domain);
    await ca.started;

    // The sweep's own check of the domain, during a blip.
    world.dnsLive.delete("status.acme.com");
    await StatusPageDomainService.isCnameValid("status.acme.com");

    expect(domain.isCnameVerified).toBe(false);

    world.dnsLive.add("status.acme.com");
    ca.release();
    await checkNow;

    // Let's Encrypt fetched its challenge from the domain: it reaches us.
    expect(domain.isSslOrdered).toBe(true);
    expect(domain.isCnameVerified).toBe(true);
  });

  test("a domain that has a certificate is recorded as ordered only while it is verified", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
    });
    world.domains.push(domain);
    addCertificate("status.acme.com", 40);

    // Read as verified by the order sweep, then a blip marks it unverified.
    let letTheSweepGoOn: () => void = (): void => {};
    holdOrderSweepRead = new Promise<void>((resolve: () => void) => {
      letTheSweepGoOn = resolve;
    });

    const sweep: Promise<void> =
      StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();
    await settle();

    holdOrderSweepRead = null;
    await StatusPageDomainService.isCnameValid("status.acme.com");

    letTheSweepGoOn();
    await sweep;

    expect(domain.isCnameVerified).toBe(false);
    expect(domain.isSslOrdered).toBe(false);
    expect(mockCaOrders).toEqual([]);
  });

  /*
   * Review finding 6: Check now said Issued - "already has its free SSL
   * certificate, and we renew it automatically" - for an expired
   * certificate, and for a domain marked ordered whose certificate was gone.
   */
  test("Check now renews an expired certificate, and does not call it issued", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
      isSslOrdered: true,
    });
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");
    addCertificate("status.acme.com", -2);

    const result: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(result?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(mockCaOrders).toEqual(["status.acme.com"]);
    expect(
      world.certificates.get("status.acme.com")!.expiresAt.getTime(),
    ).toBeGreaterThan(Date.now());
    expect(world.deletedCertificates).toEqual([]);
  });

  test("Check now on a domain marked ordered whose certificate is gone orders it, and does not call it issued", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
      isSslOrdered: true,
    });
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    const result: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(result?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(mockCaOrders).toEqual(["status.acme.com"]);
  });

  test("Check now calls a certificate issued only when it is there and valid", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
      isSslOrdered: true,
    });
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");
    addCertificate("status.acme.com", 30);

    const result: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(result?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issued,
    );
    expect(mockCaOrders).toEqual([]);
  });

  /*
   * Review finding 4 / honest status: a domain whose order kept failing
   * said "Issuing a free certificate" for days, with the reason only in the
   * worker's log. The Status column reads this.
   */
  test("a failed order is what the Status column reads, until an order succeeds", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
    });
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    mockAuto = async (): Promise<string> => {
      throw new Error("urn:ietf:params:acme:error:caa");
    };

    await runSweeps();

    const failed: Array<CustomDomainCertificate> =
      await StatusPageDomainService.getCertificates([domain as never]);

    expect(failed).toEqual([
      {
        domainId: domain._id,
        expiresAt: undefined,
        lastOrderError: expect.stringContaining(
          "Unable to order certificate for status.acme.com",
        ),
        lastOrderFailedAt: expect.any(Date),
      },
    ]);

    mockAuto = DEFAULT_AUTO;
    minutesLater(15);
    await runSweeps();

    const issued: Array<CustomDomainCertificate> =
      await StatusPageDomainService.getCertificates([domain as never]);

    expect(issued[0]!.lastOrderError).toBeUndefined();
    expect(issued[0]!.expiresAt).toBeInstanceOf(Date);
  });

  test("a domain whose orders keep failing is ordered less and less often by the sweeps", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
    });
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    mockAuto = async (): Promise<string> => {
      throw new Error("urn:ietf:params:acme:error:caa");
    };

    // Two hours of ticks, every 15 minutes.
    for (let tick: number = 0; tick < 8; tick++) {
      minutesLater(tick * 15);
      await runSweeps();
    }

    /*
     * At 0, 15 and 45 minutes, then at 1 hour 45: four orders in eight
     * ticks, where every tick used to order one.
     */
    expect(mockCaOrders).toHaveLength(4);

    const failure: Map<string, unknown> = await CertificateOrderFailures.get([
      "status.acme.com",
    ]);

    expect(failure.size).toBe(1);
  });

  /*
   * Review finding 5: each sweep and run capped only itself, and the caps
   * added up past the 300 new orders per three hours of the account the
   * whole installation shares. Check now, the sweeps and the renewal run
   * now draw from one budget per window.
   */
  test("Check now, the sweeps and the renewal run together stay within the installation's budget, renewals first", async () => {
    // Due for renewal: a full renewal run.
    for (let i: number = 0; i < 10; i++) {
      const renewing: DomainRow = makeDomain(`renew${i}.acme.com`, {
        isCnameVerified: true,
        isSslOrdered: true,
        isSslProvisioned: true,
      });
      world.domains.push(renewing);
      world.dnsLive.add(renewing.fullDomain);
      world.served.add(renewing.fullDomain);
      addCertificate(renewing.fullDomain, 2);
    }

    // Verified, waiting for the order sweep.
    for (let i: number = 0; i < 10; i++) {
      world.domains.push(
        makeDomain(`waiting${i}.acme.com`, { isCnameVerified: true }),
      );
      world.dnsLive.add(`waiting${i}.acme.com`);
    }

    // Clicks on Check now, on domains whose record just went live.
    const clicked: Array<DomainRow> = [];

    for (let i: number = 0; i < 10; i++) {
      const domain: DomainRow = makeDomain(`clicked${i}.acme.com`);
      world.domains.push(domain);
      world.dnsLive.add(domain.fullDomain);
      clicked.push(domain);
    }

    // The new certificates come first in this window...
    for (const domain of clicked) {
      await clickCheckNow(domain);
    }

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    const newCertificates: number = mockCaOrders.length;

    expect(newCertificates).toBeLessThanOrEqual(
      CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW,
    );

    // ...and the renewals still have their share.
    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();

    expect(mockCaOrders.length).toBeLessThanOrEqual(
      CertificateOrderBudget.ORDERS_PER_WINDOW,
    );
    expect(mockCaOrders.length - newCertificates).toBeGreaterThanOrEqual(
      CertificateOrderBudget.ORDERS_PER_WINDOW -
        CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW,
    );
    expect(world.deletedCertificates).toEqual([]);
  });

  /*
   * Finding (h): renewal still deleted a certificate whose CNAME check
   * failed, weeks before it expired. And (review of this change) its CNAME
   * check still marked the domain unverified, unordered and unprovisioned -
   * "Waiting for DNS", Reissue SSL refused - while the certificate kept
   * serving.
   */
  test("a DNS blip during a renewal keeps the certificate and the domain as they are, says why, and a later run renews it", async () => {
    const domain: DomainRow = makeDomain("status.acme.com", {
      isCnameVerified: true,
      isSslOrdered: true,
      isSslProvisioned: true,
    });
    world.domains.push(domain);
    world.served.add("status.acme.com");
    addCertificate("status.acme.com", 10);

    const before: string =
      world.certificates.get("status.acme.com")!.certificate;

    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();

    expect(world.deletedCertificates).toEqual([]);
    expect(world.certificates.get("status.acme.com")?.certificate).toBe(before);
    expect(mockCaOrders).toEqual([]);

    // The row is untouched...
    expect(domain.isCnameVerified).toBe(true);
    expect(domain.isSslOrdered).toBe(true);
    expect(domain.isSslProvisioned).toBe(true);

    // ...and the Status column learns why the renewal did not happen.
    const certificates: Array<CustomDomainCertificate> =
      await StatusPageDomainService.getCertificates([domain as never]);

    expect(certificates[0]!.lastOrderError).toContain(
      "CNAME record could not be verified",
    );

    world.dnsLive.add("status.acme.com");

    // The name waits a little before the next try...
    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();

    expect(mockCaOrders).toEqual([]);

    // ...and is renewed once its delay is up.
    minutesLater(15);
    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();

    expect(mockCaOrders).toEqual(["status.acme.com"]);
    expect(world.deletedCertificates).toEqual([]);
    expect(
      (await StatusPageDomainService.getCertificates([domain as never]))[0]!
        .lastOrderError,
    ).toBeUndefined();
  });

  /*
   * Review of this change: a Check now refused for the window's orders being
   * used up kept the domain's window, so the next click within 15 minutes
   * only said "Issuing" again although nothing had been ordered.
   */
  test("Check now that ordered nothing - the orders used up - leaves the window to the next click", async () => {
    const domain: DomainRow = makeDomain("status.acme.com");
    world.domains.push(domain);
    world.dnsLive.add("status.acme.com");

    // This window's new certificates are all spent.
    world.cache.set(
      `${CertificateOrderBudget.NAMESPACE}-window-${CertificateOrderBudget.getWindowIndex(new Date())}`,
      String(CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW),
    );

    const refused: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(refused?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(mockCaOrders).toEqual([]);

    // The next window: the next click orders straight away.
    minutesLater(15);

    const ordered: CustomDomainVerificationResult | null =
      await clickCheckNow(domain);

    expect(ordered?.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
    expect(mockCaOrders).toEqual(["status.acme.com"]);
  });
});
