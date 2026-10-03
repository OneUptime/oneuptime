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
 * Real: StatusPageDomainService (the sweeps, isCnameValid, orderCert,
 * orderCertIfMissing, orderCertOnceCnameIsVerified), CertificateOrder and
 * GreenlockUtil.orderCert. Replaced: the two tables (in memory), the
 * Let's Encrypt client, the DNS and HTTP checks of the customer's domain,
 * and the Redis lock (in memory, refusing a held key at once as Redis does).
 */

import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import AcmeCertificateService from "../../../Server/Services/AcmeCertificateService";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import Domain from "../../../Server/Types/Domain";
import ObjectID from "../../../Types/ObjectID";
import {
  CustomDomainCertificateStatus,
  CustomDomainVerificationResult,
} from "../../../Types/StatusPage/CustomDomainVerification";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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
  world = {
    domains: [],
    certificates: new Map(),
    dnsLive: new Set(),
    served: new Set(),
    deletedCertificates: [],
    heldLocks: new Set(),
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

  // The certificate table.
  jest
    .spyOn(AcmeCertificateService, "findBy")
    .mockImplementation((async (call: {
      query: { domain: { inList: Array<string> } };
    }) => {
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

  // The lock: a held key refuses at once, like Redis with one attempt.
  jest.spyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
    namespace: string;
  }) => {
    const key: string = `${data.namespace}-${data.key}`;

    if (world.heldLocks.has(key)) {
      throw new SemaphoreLockTimeoutError(`Acquire mutex ${key} timeout`);
    }

    world.heldLocks.add(key);
    return { key: key } as unknown as SemaphoreMutex;
  }) as never);

  jest.spyOn(Semaphore, "release").mockImplementation((async (
    mutex: SemaphoreMutex,
  ) => {
    world.heldLocks.delete((mutex as unknown as { key: string }).key);
  }) as never);
}

/*
 * What the verify-cname route does: read the domain, check its record, and
 * once it is found order its certificate.
 */
async function clickCheckNow(
  domain: DomainRow,
  options?: { waitInMs?: number },
): Promise<CustomDomainVerificationResult | null> {
  const asRead: DomainRow = copyOf(rowById(domain.id)!);

  const isValid: boolean = await StatusPageDomainService.isCnameValid(
    asRead.fullDomain,
  );

  if (!isValid) {
    return null;
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

  test("an order that fails is reported to Check now, and the sweeps order again", async () => {
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

    await runSweeps();

    expect(mockCaOrders).toEqual(["status.acme.com", "status.acme.com"]);
    expect(domain.isSslOrdered).toBe(true);
    expect(world.certificates.has("status.acme.com")).toBe(true);
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
