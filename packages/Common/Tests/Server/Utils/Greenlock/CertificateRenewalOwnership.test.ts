/**
 * Regression tests: a certificate renewal run only ever renews - or removes -
 * the certificates of its own caller.
 *
 * AcmeCertificate is one table shared by every owner of a certificate: status
 * page domains, dashboard domains and the installation's primary host. The
 * status page renewal job used to walk every certificate in it that was due
 * and validate each one with StatusPageDomainService.isCnameValid, which
 * answers false for any domain that is not a status page domain. So every
 * dashboard certificate that came due for renewal was deleted - while the
 * dashboard domain went on saying its certificate was ordered and nginx served
 * the stale file until it expired. Wiring the dashboard renewal as it stood
 * would have done the same to every status page certificate.
 *
 * No database and no ACME client: the shared table, both domain tables and
 * the CNAME checks are in memory below, and orderCert only records what it
 * was asked to order. GreenlockUtil's own selection, ownership filter, cap
 * and removal path run for real, as do the services' renewal wiring and
 * ownership lookups.
 */

import GreenlockUtil from "../../../../Server/Utils/Greenlock/Greenlock";
import AcmeCertificateService from "../../../../Server/Services/AcmeCertificateService";
import StatusPageDomainService from "../../../../Server/Services/StatusPageDomainService";
import DashboardDomainService, {
  Service as DashboardDomainServiceClass,
} from "../../../../Server/Services/DashboardDomainService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import AcmeCertificate from "../../../../Models/DatabaseModels/AcmeCertificate";
import OneUptimeDate from "../../../../Types/Date";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const STATUS_PAGE_DOMAINS: Array<string> = [
  "status.acme.com",
  "status.globex.com",
];
const DASHBOARD_DOMAINS: Array<string> = ["dash.acme.com", "dash.globex.com"];
// The installation's own HOST, renewed by the CoreSSL job.
const PRIMARY_HOST: string = "oneuptime.example.com";
// Left behind by a project deleted without the domain's own delete hook.
const UNOWNED_DOMAIN: string = "status.deleted-project.com";

type Certificate = {
  domain: string;
  expiresAt: Date;
};

type UploadedCertificateState = {
  isCustomCertificate: boolean;
  customCertificate?: string;
  customCertificateKey?: string;
};

type World = {
  // The shared AcmeCertificate table.
  certificates: Array<Certificate>;
  statusPageDomains: Array<string>;
  dashboardDomains: Array<string>;
  // Domain rows (in either table) whose upload switch is on.
  uploads: Map<string, UploadedCertificateState>;
  // Domains whose CNAME no longer validates. Every other owned domain does.
  brokenCnames: Set<string>;
  ordered: Array<string>;
  deleted: Array<string>;
  cnameChecks: { statusPage: Array<string>; dashboard: Array<string> };
  // Domains each service was told it lost (notifyDomainRemoved).
  notified: { statusPage: Array<string>; dashboard: Array<string> };
};

type ServiceUnderTest = {
  renewCertsWhichAreExpiringSoon: () => Promise<void>;
  getOwnedDomains: (domains: Array<string>) => Promise<Array<string>>;
};

function expiringInDays(domain: string, days: number): Certificate {
  return {
    domain: domain,
    expiresAt: OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      days,
    ),
  };
}

function sorted(values: Array<string>): Array<string> {
  return [...values].sort();
}

/*
 * QueryHelper.any builds a raw SQL operator; here it returns the list itself,
 * so the in-memory tables can answer "fullDomain IN (...)" queries.
 */
function inList(operator: unknown): Array<string> {
  return (operator as { inList: Array<string> }).inList;
}

/*
 * Wire both services and GreenlockUtil to an in-memory world. Each domain
 * service answers its own table only, and its CNAME check answers false for
 * any domain it has no row for - exactly what the real isCnameValid does, and
 * exactly what made the old renewal run delete other owners' certificates.
 */
function setUpWorld(data: {
  certificates: Array<Certificate>;
  brokenCnames?: Array<string>;
  uploads?: Array<[string, UploadedCertificateState]>;
}): World {
  const world: World = {
    certificates: [...data.certificates],
    statusPageDomains: [...STATUS_PAGE_DOMAINS],
    dashboardDomains: [...DASHBOARD_DOMAINS],
    uploads: new Map<string, UploadedCertificateState>(data.uploads || []),
    brokenCnames: new Set<string>(data.brokenCnames || []),
    ordered: [],
    deleted: [],
    cnameChecks: { statusPage: [], dashboard: [] },
    notified: { statusPage: [], dashboard: [] },
  };

  jest.spyOn(QueryHelper, "any").mockImplementation(((
    values: Array<string>,
  ) => {
    return { inList: values.map(String) };
  }) as never);

  // Pages like the database: findAllBy walks it with skip and limit.
  jest
    .spyOn(AcmeCertificateService, "findBy")
    .mockImplementation((async (call: { skip?: number; limit?: number }) => {
      const skip: number = Number(call.skip || 0);
      const limit: number = Number(call.limit || world.certificates.length);

      return [...world.certificates]
        .sort((a: Certificate, b: Certificate) => {
          return a.expiresAt.getTime() - b.expiresAt.getTime();
        })
        .slice(skip, skip + limit)
        .map((certificate: Certificate) => {
          return { ...certificate } as unknown as AcmeCertificate;
        });
    }) as never);

  jest
    .spyOn(AcmeCertificateService, "deleteBy")
    .mockImplementation((async (deleteBy: {
      query: { domain: string };
    }): Promise<number> => {
      const index: number = world.certificates.findIndex(
        (certificate: Certificate) => {
          return certificate.domain === deleteBy.query.domain;
        },
      );

      if (index === -1) {
        return 0;
      }

      world.certificates.splice(index, 1);
      world.deleted.push(deleteBy.query.domain);
      return 1;
    }) as never);

  jest
    .spyOn(GreenlockUtil, "orderCert")
    .mockImplementation(async (order: { domain: string }): Promise<void> => {
      world.ordered.push(order.domain);
    });

  const wireDomainService: (
    service: unknown,
    rows: () => Array<string>,
    cnameChecks: Array<string>,
    notified: Array<string>,
  ) => void = (
    service: unknown,
    rows: () => Array<string>,
    cnameChecks: Array<string>,
    notified: Array<string>,
  ): void => {
    jest.spyOn(service as never, "findBy").mockImplementation((async (findBy: {
      query: { fullDomain: unknown };
    }) => {
      const asked: Array<string> = inList(findBy.query.fullDomain);

      return rows()
        .filter((fullDomain: string) => {
          return asked.includes(fullDomain);
        })
        .map((fullDomain: string) => {
          return {
            fullDomain: fullDomain,
            isCustomCertificate: false,
            ...(world.uploads.get(fullDomain) || {}),
          };
        });
    }) as never);

    jest.spyOn(service as never, "isCnameValid").mockImplementation((async (
      fullDomain: string,
    ): Promise<boolean> => {
      cnameChecks.push(fullDomain);

      if (!rows().includes(fullDomain)) {
        return false;
      }

      return !world.brokenCnames.has(fullDomain);
    }) as never);

    jest
      .spyOn(service as never, "updateOneBy")
      .mockImplementation((async (updateBy: {
        query: { fullDomain: string };
      }): Promise<number> => {
        notified.push(updateBy.query.fullDomain);
        return 1;
      }) as never);
  };

  wireDomainService(
    StatusPageDomainService,
    () => {
      return world.statusPageDomains;
    },
    world.cnameChecks.statusPage,
    world.notified.statusPage,
  );

  wireDomainService(
    DashboardDomainService,
    () => {
      return world.dashboardDomains;
    },
    world.cnameChecks.dashboard,
    world.notified.dashboard,
  );

  return world;
}

// Every kind of certificate in the shared table, all of them due today.
function mixedDueCertificates(): Array<Certificate> {
  return [
    expiringInDays(STATUS_PAGE_DOMAINS[0]!, 3),
    expiringInDays(DASHBOARD_DOMAINS[0]!, 1),
    expiringInDays(PRIMARY_HOST, 2),
    expiringInDays(STATUS_PAGE_DOMAINS[1]!, 5),
    expiringInDays(DASHBOARD_DOMAINS[1]!, 4),
    expiringInDays(UNOWNED_DOMAIN, -10),
  ];
}

function remainingDomains(world: World): Array<string> {
  return sorted(
    world.certificates.map((certificate: Certificate) => {
      return certificate.domain;
    }),
  );
}

const ALL_DOMAINS: Array<string> = sorted([
  ...STATUS_PAGE_DOMAINS,
  ...DASHBOARD_DOMAINS,
  PRIMARY_HOST,
  UNOWNED_DOMAIN,
]);

describe("a renewal run over the shared certificate table", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the status page run renews status page certificates and removes nobody's", async () => {
    const world: World = setUpWorld({ certificates: mixedDueCertificates() });

    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();

    expect(sorted(world.ordered)).toEqual(sorted(STATUS_PAGE_DOMAINS));
    expect(world.deleted).toEqual([]);
    expect(remainingDomains(world)).toEqual(ALL_DOMAINS);

    // It never even asked whether another owner's domain still points here.
    expect(sorted(world.cnameChecks.statusPage)).toEqual(
      sorted(STATUS_PAGE_DOMAINS),
    );
    expect(world.cnameChecks.dashboard).toEqual([]);
    expect(world.notified.statusPage).toEqual([]);
    expect(world.notified.dashboard).toEqual([]);
  });

  test("the dashboard run renews dashboard certificates and removes nobody's", async () => {
    const world: World = setUpWorld({ certificates: mixedDueCertificates() });

    await DashboardDomainService.renewCertsWhichAreExpiringSoon();

    expect(sorted(world.ordered)).toEqual(sorted(DASHBOARD_DOMAINS));
    expect(world.deleted).toEqual([]);
    expect(remainingDomains(world)).toEqual(ALL_DOMAINS);

    expect(sorted(world.cnameChecks.dashboard)).toEqual(
      sorted(DASHBOARD_DOMAINS),
    );
    expect(world.cnameChecks.statusPage).toEqual([]);
    expect(world.notified.statusPage).toEqual([]);
    expect(world.notified.dashboard).toEqual([]);
  });

  test("both runs over one table: every certificate survives, each is renewed once, by its owner", async () => {
    const world: World = setUpWorld({ certificates: mixedDueCertificates() });

    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();
    const orderedByStatusPageRun: Array<string> = [...world.ordered];

    await DashboardDomainService.renewCertsWhichAreExpiringSoon();
    const orderedByDashboardRun: Array<string> = world.ordered.slice(
      orderedByStatusPageRun.length,
    );

    expect(sorted(orderedByStatusPageRun)).toEqual(sorted(STATUS_PAGE_DOMAINS));
    expect(sorted(orderedByDashboardRun)).toEqual(sorted(DASHBOARD_DOMAINS));

    expect(world.ordered).not.toContain(PRIMARY_HOST);
    expect(world.ordered).not.toContain(UNOWNED_DOMAIN);
    expect(world.deleted).toEqual([]);
    expect(remainingDomains(world)).toEqual(ALL_DOMAINS);
  });

  test("the dashboard run goes first just as safely", async () => {
    const world: World = setUpWorld({ certificates: mixedDueCertificates() });

    await DashboardDomainService.renewCertsWhichAreExpiringSoon();
    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();

    expect(sorted(world.ordered)).toEqual(
      sorted([...STATUS_PAGE_DOMAINS, ...DASHBOARD_DOMAINS]),
    );
    expect(world.deleted).toEqual([]);
    expect(remainingDomains(world)).toEqual(ALL_DOMAINS);
  });

  /*
   * Removal itself is intended - a certificate for a domain that no longer
   * points here should go - it just has to be the owner's certificate.
   */
  test("an owned certificate whose CNAME stopped validating is still removed, and only its owner hears about it", async () => {
    const brokenStatusPage: string = STATUS_PAGE_DOMAINS[1]!;
    const brokenDashboard: string = DASHBOARD_DOMAINS[1]!;

    const world: World = setUpWorld({
      certificates: mixedDueCertificates(),
      brokenCnames: [brokenStatusPage, brokenDashboard],
    });

    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();

    expect(world.deleted).toEqual([brokenStatusPage]);
    expect(world.notified.statusPage).toEqual([brokenStatusPage]);
    expect(world.notified.dashboard).toEqual([]);
    expect(world.ordered).toEqual([STATUS_PAGE_DOMAINS[0]]);

    await DashboardDomainService.renewCertsWhichAreExpiringSoon();

    expect(world.deleted).toEqual([brokenStatusPage, brokenDashboard]);
    expect(world.notified.dashboard).toEqual([brokenDashboard]);
    expect(world.notified.statusPage).toEqual([brokenStatusPage]);
    expect(world.ordered).toEqual([
      STATUS_PAGE_DOMAINS[0],
      DASHBOARD_DOMAINS[0],
    ]);

    expect(remainingDomains(world)).toEqual(
      sorted([
        STATUS_PAGE_DOMAINS[0]!,
        DASHBOARD_DOMAINS[0]!,
        PRIMARY_HOST,
        UNOWNED_DOMAIN,
      ]),
    );
  });

  test("a certificate nobody owns is neither renewed nor removed", async () => {
    const world: World = setUpWorld({
      certificates: [
        expiringInDays(UNOWNED_DOMAIN, -30),
        expiringInDays(PRIMARY_HOST, 1),
      ],
    });

    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();
    await DashboardDomainService.renewCertsWhichAreExpiringSoon();

    expect(world.ordered).toEqual([]);
    expect(world.deleted).toEqual([]);
    expect(remainingDomains(world)).toEqual(
      sorted([UNOWNED_DOMAIN, PRIMARY_HOST]),
    );
    expect(world.cnameChecks.statusPage).toEqual([]);
    expect(world.cnameChecks.dashboard).toEqual([]);
  });

  test("a backlog of status page certificates cannot take the dashboard run's slots", async () => {
    // More status page certificates due than any run may take, all of them closer to expiry.
    const statusPageBacklog: Array<string> = Array.from(
      { length: GreenlockUtil.RENEW_MAX_PER_RUN * 3 },
      (_value: unknown, index: number) => {
        return `status${index}.example.com`;
      },
    );

    const world: World = setUpWorld({
      certificates: [
        ...statusPageBacklog.map((domain: string) => {
          return expiringInDays(domain, 1);
        }),
        ...DASHBOARD_DOMAINS.map((domain: string) => {
          return expiringInDays(domain, 6);
        }),
      ],
    });
    world.statusPageDomains.push(...statusPageBacklog);

    await DashboardDomainService.renewCertsWhichAreExpiringSoon();

    expect(sorted(world.ordered)).toEqual(sorted(DASHBOARD_DOMAINS));
    expect(world.deleted).toEqual([]);
  });

  /*
   * nginx serves the uploaded certificate for that name (AcmeWriteCertificates
   * leaves it alone), but the Let's Encrypt one stays its owner's and stays
   * renewed, so switching back is instant - on every nginx replica, including
   * a new one that starts with an empty certificate directory.
   */
  test("a domain serving its own uploaded certificate still claims, and renews, its Let's Encrypt certificate", async () => {
    const world: World = setUpWorld({
      certificates: mixedDueCertificates(),
      uploads: [
        [
          STATUS_PAGE_DOMAINS[1]!,
          {
            isCustomCertificate: true,
            customCertificate: "-----BEGIN CERTIFICATE-----",
            customCertificateKey: "-----BEGIN PRIVATE KEY-----",
          },
        ],
        [DASHBOARD_DOMAINS[1]!, { isCustomCertificate: true }],
      ],
    });

    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();
    await DashboardDomainService.renewCertsWhichAreExpiringSoon();

    expect(sorted(world.ordered)).toEqual(
      sorted([...STATUS_PAGE_DOMAINS, ...DASHBOARD_DOMAINS]),
    );
    expect(world.deleted).toEqual([]);
    expect(remainingDomains(world)).toEqual(ALL_DOMAINS);
  });

  /*
   * The certificate table is read page by page, not a first page of it: a
   * pile of dead certificates nobody owns - which sort first, being the
   * oldest - must not push the caller's own out of the run.
   */
  test("thousands of expired certificates nobody owns cannot push the caller's due certificates out of the run", async () => {
    const abandoned: Array<Certificate> = Array.from(
      { length: 10050 },
      (_value: unknown, index: number) => {
        return expiringInDays(`gone${index}.example.com`, -60 - (index % 30));
      },
    );

    const world: World = setUpWorld({
      certificates: [
        ...abandoned,
        ...DASHBOARD_DOMAINS.map((domain: string) => {
          return expiringInDays(domain, 3);
        }),
      ],
    });

    await DashboardDomainService.renewCertsWhichAreExpiringSoon();

    expect(sorted(world.ordered)).toEqual(sorted(DASHBOARD_DOMAINS));
    expect(world.deleted).toEqual([]);
    expect(world.certificates).toHaveLength(abandoned.length + 2);
  });
});

/*
 * The same two regressions with the services' REAL isCnameValid: its first
 * step is the lookup of the caller's own row, and with no row it answers
 * false without touching the network. These fail if the ownership filter is
 * removed, because that false is exactly what used to delete the certificate.
 */
describe("the regression, with each service's real CNAME check", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  type RegressionCase = [string, ServiceUnderTest, string];

  const cases: Array<RegressionCase> = [
    [
      "the status page run keeps a dashboard certificate that came due",
      StatusPageDomainService as unknown as ServiceUnderTest,
      DASHBOARD_DOMAINS[0]!,
    ],
    [
      "the status page run keeps the primary host's certificate that came due",
      StatusPageDomainService as unknown as ServiceUnderTest,
      PRIMARY_HOST,
    ],
    [
      "the dashboard run keeps a status page certificate that came due",
      DashboardDomainService as unknown as ServiceUnderTest,
      STATUS_PAGE_DOMAINS[0]!,
    ],
    [
      "the dashboard run keeps the primary host's certificate that came due",
      DashboardDomainService as unknown as ServiceUnderTest,
      PRIMARY_HOST,
    ],
  ];

  test.each(cases)(
    "%s",
    async (_name: string, service: ServiceUnderTest, foreignDomain: string) => {
      const deleted: Array<string> = [];
      const ordered: Array<string> = [];

      jest.spyOn(QueryHelper, "any").mockImplementation(((
        values: Array<string>,
      ) => {
        return { inList: values.map(String) };
      }) as never);

      jest
        .spyOn(AcmeCertificateService, "findBy")
        .mockResolvedValue([
          expiringInDays(foreignDomain, 1) as unknown as AcmeCertificate,
        ] as never);

      jest
        .spyOn(AcmeCertificateService, "deleteBy")
        .mockImplementation((async (deleteBy: {
          query: { domain: string };
        }): Promise<number> => {
          deleted.push(deleteBy.query.domain);
          return 1;
        }) as never);

      jest
        .spyOn(GreenlockUtil, "orderCert")
        .mockImplementation(async (order: { domain: string }) => {
          ordered.push(order.domain);
        });

      // The caller has no row for the foreign domain, in either lookup.
      jest.spyOn(service as never, "findBy").mockResolvedValue([] as never);
      jest
        .spyOn(service as never, "findOneBy")
        .mockResolvedValue(null as never);
      jest.spyOn(service as never, "updateOneBy").mockResolvedValue(0 as never);

      // This false is what the old run acted on: it removed the certificate.
      await expect(
        (
          service as unknown as {
            isCnameValid: (fullDomain: string) => Promise<boolean>;
          }
        ).isCnameValid(foreignDomain),
      ).resolves.toBe(false);

      await service.renewCertsWhichAreExpiringSoon();

      expect(deleted).toEqual([]);
      expect(ordered).toEqual([]);
    },
  );
});

describe("GreenlockUtil.renewAllCertsWhichAreExpiringSoon ownership mechanics", () => {
  type Run = {
    ordered: Array<string>;
    deleted: Array<string>;
    notified: Array<string>;
    cnameChecks: Array<string>;
    ownershipQueries: Array<Array<string>>;
  };

  function setUpRun(certificates: Array<Certificate>): Run {
    const run: Run = {
      ordered: [],
      deleted: [],
      notified: [],
      cnameChecks: [],
      ownershipQueries: [],
    };

    jest.spyOn(AcmeCertificateService, "findBy").mockResolvedValue(
      [...certificates].map((certificate: Certificate) => {
        return { ...certificate } as unknown as AcmeCertificate;
      }) as never,
    );

    jest
      .spyOn(AcmeCertificateService, "deleteBy")
      .mockImplementation((async (deleteBy: {
        query: { domain: string };
      }): Promise<number> => {
        run.deleted.push(deleteBy.query.domain);
        return 1;
      }) as never);

    jest
      .spyOn(GreenlockUtil, "orderCert")
      .mockImplementation(async (order: { domain: string }) => {
        run.ordered.push(order.domain);
      });

    return run;
  }

  function renew(
    run: Run,
    getOwnedDomains: (domains: Array<string>) => Promise<Array<string>>,
    maxPerRun?: number,
  ): Promise<void> {
    return GreenlockUtil.renewAllCertsWhichAreExpiringSoon({
      maxPerRun: maxPerRun,
      getOwnedDomains: async (domains: Array<string>) => {
        run.ownershipQueries.push([...domains]);
        return await getOwnedDomains(domains);
      },
      validateCname: async (domain: string): Promise<boolean> => {
        run.cnameChecks.push(domain);
        return true;
      },
      notifyDomainRemoved: async (domain: string): Promise<void> => {
        run.notified.push(domain);
      },
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("ownership is asked once, about the certificates that are due and nothing else", async () => {
    const run: Run = setUpRun([
      expiringInDays("due-a.example.com", 1),
      expiringInDays("due-b.example.com", 10),
      expiringInDays("fresh.example.com", 89),
    ]);

    await renew(run, async (domains: Array<string>) => {
      return domains;
    });

    expect(run.ownershipQueries).toEqual([
      ["due-a.example.com", "due-b.example.com"],
    ]);
    expect(sorted(run.ordered)).toEqual([
      "due-a.example.com",
      "due-b.example.com",
    ]);
  });

  test("asks an owner about at most DOMAIN_LOOKUP_CHUNK_SIZE domains at a time", async () => {
    const chunk: number = GreenlockUtil.DOMAIN_LOOKUP_CHUNK_SIZE;

    const run: Run = setUpRun(
      Array.from(
        { length: chunk * 2 + 7 },
        (_value: unknown, index: number) => {
          return expiringInDays(`d${index}.example.com`, 1);
        },
      ),
    );

    await renew(run, async () => {
      return [];
    });

    expect(
      run.ownershipQueries.map((query: Array<string>) => {
        return query.length;
      }),
    ).toEqual([chunk, chunk, 7]);
    expect(new Set(run.ownershipQueries.flat()).size).toBe(chunk * 2 + 7);
  });

  /*
   * A certificate that expired without being renewed has been failing since
   * its lead time began; sorting first by expiry, it would take a slot in
   * every run. The ones that can still be saved go first.
   */
  test("certificates that already expired go after every one that can still be saved", async () => {
    const expired: Array<Certificate> = Array.from(
      { length: GreenlockUtil.RENEW_MAX_PER_RUN },
      (_value: unknown, index: number) => {
        return expiringInDays(`expired${index}.example.com`, -1 - index);
      },
    );

    const run: Run = setUpRun([
      ...expired,
      expiringInDays("soon.example.com", 2),
      expiringInDays("later.example.com", 20),
    ]);

    await renew(
      run,
      async (domains: Array<string>) => {
        return domains;
      },
      3,
    );

    // Both savable ones, then one expired one in the slot left over.
    expect(run.ordered).toHaveLength(3);
    expect(run.ordered).toContain("soon.example.com");
    expect(run.ordered).toContain("later.example.com");
    expect(
      run.ordered.filter((domain: string) => {
        return domain.startsWith("expired");
      }),
    ).toHaveLength(1);
  });

  test("expired certificates still renew in runs with slots to spare", async () => {
    const run: Run = setUpRun([
      expiringInDays("expired.example.com", -3),
      expiringInDays("soon.example.com", 2),
    ]);

    await renew(run, async (domains: Array<string>) => {
      return domains;
    });

    expect(sorted(run.ordered)).toEqual([
      "expired.example.com",
      "soon.example.com",
    ]);
  });

  test("a run full of savable certificates leaves the expired ones for later", async () => {
    const savable: Array<Certificate> = Array.from(
      { length: GreenlockUtil.RENEW_MAX_PER_RUN + 2 },
      (_value: unknown, index: number) => {
        return expiringInDays(`savable${index}.example.com`, 1 + index);
      },
    );

    const run: Run = setUpRun([
      expiringInDays("expired.example.com", -30),
      ...savable,
    ]);

    await renew(run, async (domains: Array<string>) => {
      return domains;
    });

    expect(run.ordered).toHaveLength(GreenlockUtil.RENEW_MAX_PER_RUN);
    expect(run.ordered).not.toContain("expired.example.com");
  });

  test("a name with more than one due row is renewed once", async () => {
    const run: Run = setUpRun([
      expiringInDays("twice.example.com", 1),
      expiringInDays("twice.example.com", 2),
      expiringInDays("once.example.com", 3),
    ]);

    await renew(run, async (domains: Array<string>) => {
      return domains;
    });

    expect(sorted(run.ordered)).toEqual([
      "once.example.com",
      "twice.example.com",
    ]);
    expect(run.ownershipQueries).toEqual([
      ["twice.example.com", "once.example.com"],
    ]);
  });

  test("with nothing due, ownership is not looked up and nothing happens", async () => {
    const run: Run = setUpRun([expiringInDays("fresh.example.com", 89)]);

    await renew(run, async (domains: Array<string>) => {
      return domains;
    });

    expect(run.ownershipQueries).toEqual([]);
    expect(run.ordered).toEqual([]);
    expect(run.deleted).toEqual([]);
  });

  test("ownership is settled before the cap, so someone else's backlog cannot starve this caller", async () => {
    const foreign: Array<Certificate> = Array.from(
      { length: GreenlockUtil.RENEW_MAX_PER_RUN * 2 },
      (_value: unknown, index: number) => {
        return expiringInDays(`foreign${index}.example.com`, 1);
      },
    );

    const mine: Array<string> = [
      "mine-a.example.com",
      "mine-b.example.com",
      "mine-c.example.com",
    ];

    const run: Run = setUpRun([
      ...foreign,
      ...mine.map((domain: string) => {
        return expiringInDays(domain, 3);
      }),
    ]);

    await renew(run, async (domains: Array<string>) => {
      return domains.filter((domain: string) => {
        return mine.includes(domain);
      });
    });

    expect(sorted(run.ordered)).toEqual(sorted(mine));
    expect(sorted(run.cnameChecks)).toEqual(sorted(mine));
    expect(run.deleted).toEqual([]);
  });

  test("a certificate the caller does not own is skipped even when its CNAME check would fail", async () => {
    const run: Run = setUpRun([expiringInDays("someone-else.example.com", 1)]);

    await GreenlockUtil.renewAllCertsWhichAreExpiringSoon({
      getOwnedDomains: async () => {
        return [];
      },
      validateCname: async (domain: string): Promise<boolean> => {
        run.cnameChecks.push(domain);
        return false;
      },
      notifyDomainRemoved: async (domain: string): Promise<void> => {
        run.notified.push(domain);
      },
    });

    expect(run.cnameChecks).toEqual([]);
    expect(run.deleted).toEqual([]);
    expect(run.notified).toEqual([]);
  });

  test("a failed ownership lookup renews nothing and removes nothing", async () => {
    const run: Run = setUpRun([
      expiringInDays("a.example.com", 1),
      expiringInDays("b.example.com", 1),
    ]);

    await expect(
      renew(run, async (): Promise<Array<string>> => {
        throw new Error("database unavailable");
      }),
    ).rejects.toThrow("database unavailable");

    expect(run.cnameChecks).toEqual([]);
    expect(run.ordered).toEqual([]);
    expect(run.deleted).toEqual([]);
    expect(run.notified).toEqual([]);
  });

  test("an ownership answer naming domains that are not due cannot widen the run", async () => {
    const run: Run = setUpRun([
      expiringInDays("due.example.com", 1),
      expiringInDays("fresh.example.com", 89),
    ]);

    await renew(run, async () => {
      return ["due.example.com", "fresh.example.com", "unknown.example.com"];
    });

    expect(run.ordered).toEqual(["due.example.com"]);
    expect(run.deleted).toEqual([]);
  });

  test("a caller can lower its cap, but not raise it past RENEW_MAX_PER_RUN", async () => {
    const certificates: Array<Certificate> = Array.from(
      { length: GreenlockUtil.RENEW_MAX_PER_RUN * 3 },
      (_value: unknown, index: number) => {
        return expiringInDays(`d${index}.example.com`, 1);
      },
    );

    const ownsAll: (domains: Array<string>) => Promise<Array<string>> = async (
      domains: Array<string>,
    ) => {
      return domains;
    };

    let run: Run = setUpRun(certificates);
    await renew(run, ownsAll, 3);
    expect(run.ordered).toHaveLength(3);
    jest.restoreAllMocks();

    run = setUpRun(certificates);
    await renew(run, ownsAll, GreenlockUtil.RENEW_MAX_PER_RUN * 100);
    expect(run.ordered).toHaveLength(GreenlockUtil.RENEW_MAX_PER_RUN);
    jest.restoreAllMocks();

    run = setUpRun(certificates);
    await renew(run, ownsAll);
    expect(run.ordered).toHaveLength(GreenlockUtil.RENEW_MAX_PER_RUN);
  });
});

describe("each run's cap", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function manyDue(prefix: string): Array<Certificate> {
    return Array.from(
      { length: GreenlockUtil.RENEW_MAX_PER_RUN * 3 },
      (_value: unknown, index: number) => {
        return expiringInDays(`${prefix}${index}.example.com`, 1);
      },
    );
  }

  test("the status page run renews up to RENEW_MAX_PER_RUN", async () => {
    const certificates: Array<Certificate> = manyDue("status");
    const world: World = setUpWorld({ certificates });
    world.statusPageDomains.push(
      ...certificates.map((certificate: Certificate) => {
        return certificate.domain;
      }),
    );

    await StatusPageDomainService.renewCertsWhichAreExpiringSoon();

    expect(world.ordered).toHaveLength(GreenlockUtil.RENEW_MAX_PER_RUN);
  });

  /*
   * Dashboards are the smaller fleet and spend from the same Let's Encrypt
   * account, so their renewal shares their ordering sweeps' smaller budget.
   */
  test("the dashboard run renews up to DashboardDomainService.ORDER_MAX_PER_RUN", async () => {
    const certificates: Array<Certificate> = manyDue("dash");
    const world: World = setUpWorld({ certificates });
    world.dashboardDomains.push(
      ...certificates.map((certificate: Certificate) => {
        return certificate.domain;
      }),
    );

    await DashboardDomainService.renewCertsWhichAreExpiringSoon();

    expect(world.ordered).toHaveLength(
      DashboardDomainServiceClass.ORDER_MAX_PER_RUN,
    );
    expect(DashboardDomainServiceClass.ORDER_MAX_PER_RUN).toBeLessThan(
      GreenlockUtil.RENEW_MAX_PER_RUN,
    );
  });
});

describe.each([
  ["StatusPageDomainService", StatusPageDomainService as unknown],
  ["DashboardDomainService", DashboardDomainService as unknown],
])("%s.getOwnedDomains", (_name: string, service: unknown) => {
  let findByCalls: Array<{
    query: { fullDomain: unknown };
    select: Record<string, unknown>;
    props: Record<string, unknown>;
  }>;

  beforeEach(() => {
    findByCalls = [];

    jest.spyOn(QueryHelper, "any").mockImplementation(((
      values: Array<string>,
    ) => {
      return { inList: values.map(String) };
    }) as never);

    jest.spyOn(service as never, "findBy").mockImplementation((async (call: {
      query: { fullDomain: unknown };
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    }) => {
      findByCalls.push(call);
      return [
        { fullDomain: "owned.example.com", isCustomCertificate: false },
        { fullDomain: "" },
        {},
        {
          fullDomain: "uploaded.example.com",
          isCustomCertificate: true,
          customCertificate: "-----BEGIN CERTIFICATE-----",
          customCertificateKey: "-----BEGIN PRIVATE KEY-----",
        },
        {
          fullDomain: "switch-only.example.com",
          isCustomCertificate: true,
        },
      ];
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("looks up exactly the domains it was asked about, in its own table, as root", async () => {
    const owned: Array<string> = await (
      service as ServiceUnderTest
    ).getOwnedDomains(["owned.example.com", "foreign.example.com"]);

    expect(findByCalls).toHaveLength(1);
    expect(inList(findByCalls[0]!.query.fullDomain)).toEqual([
      "owned.example.com",
      "foreign.example.com",
    ]);
    expect(findByCalls[0]!.select).toEqual({ fullDomain: true });
    expect(findByCalls[0]!.props).toEqual({ isRoot: true });

    /*
     * Rows without a domain are not ownership of anything. A domain on an
     * uploaded certificate still owns its Let's Encrypt one.
     */
    expect(owned).toEqual([
      "owned.example.com",
      "uploaded.example.com",
      "switch-only.example.com",
    ]);
  });

  test("asked about nothing, it owns nothing and does not query", async () => {
    await expect(
      (service as ServiceUnderTest).getOwnedDomains([]),
    ).resolves.toEqual([]);

    expect(findByCalls).toEqual([]);
  });

  test("its renewal run hands GreenlockUtil this lookup", async () => {
    const handedOver: {
      getOwnedDomains?: (domains: Array<string>) => Promise<Array<string>>;
    } = {};

    jest
      .spyOn(GreenlockUtil, "renewAllCertsWhichAreExpiringSoon")
      .mockImplementation(
        async (data: {
          getOwnedDomains: (domains: Array<string>) => Promise<Array<string>>;
        }) => {
          handedOver.getOwnedDomains = data.getOwnedDomains;
        },
      );

    await (service as ServiceUnderTest).renewCertsWhichAreExpiringSoon();

    expect(handedOver.getOwnedDomains).toBeDefined();
    await expect(
      handedOver.getOwnedDomains!(["owned.example.com", "foreign.example.com"]),
    ).resolves.toEqual([
      "owned.example.com",
      "uploaded.example.com",
      "switch-only.example.com",
    ]);
    expect(inList(findByCalls[0]!.query.fullDomain)).toEqual([
      "owned.example.com",
      "foreign.example.com",
    ]);
  });
});
