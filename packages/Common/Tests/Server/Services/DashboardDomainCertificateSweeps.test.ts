import DashboardDomainService, {
  Service as DashboardDomainServiceClass,
} from "../../../Server/Services/DashboardDomainService";
import AcmeCertificateService from "../../../Server/Services/AcmeCertificateService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import Domain from "../../../Server/Types/Domain";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The sweeps the DashboardCerts worker runs every 15 minutes, which before
 * that job existed nothing ran: verify CNAMEs, order first certificates,
 * re-order certificates that went missing, and record which certificates are
 * being served.
 *
 * Every order spends from the Let's Encrypt account the whole installation
 * shares, so what these pin hardest is WHICH domains each sweep may order for
 * and HOW MANY per run. No database, no network and no CA: the service's own
 * reads and writes, the certificate table, the HTTPS probe and orderCert are
 * all spied on.
 */

type DomainRow = {
  _id: string;
  id: ObjectID;
  fullDomain: string;
  cnameVerificationToken?: string;
};

function makeDomain(fullDomain: string): DomainRow {
  const id: ObjectID = ObjectID.generate();

  return {
    _id: id.toString(),
    id: id,
    fullDomain: fullDomain,
    cnameVerificationToken: `token-for-${fullDomain}`,
  };
}

type FindByCall = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit: number;
  props: Record<string, unknown>;
};

function inList(operator: unknown): Array<string> {
  return (operator as { inList: Array<string> }).inList;
}

function spyOnInLists(): void {
  jest.spyOn(QueryHelper, "any").mockImplementation(((
    values: Array<string>,
  ) => {
    return { inList: values.map(String) };
  }) as never);
}

/*
 * Domain rows the service reads, and the domains handed to orderCert. Any
 * failure is per domain.
 */
function setUpService(data: {
  rows: Array<DomainRow>;
  failOrdersFor?: Array<string>;
}): { findByCalls: Array<FindByCall>; ordered: Array<string> } {
  const findByCalls: Array<FindByCall> = [];
  const ordered: Array<string> = [];

  jest.spyOn(DashboardDomainService, "findBy").mockImplementation((async (
    call: FindByCall,
  ) => {
    findByCalls.push(call);
    return data.rows.slice(0, call.limit);
  }) as never);

  jest.spyOn(DashboardDomainService, "orderCert").mockImplementation((async (
    domain: DomainRow,
  ): Promise<void> => {
    ordered.push(domain.fullDomain);

    if ((data.failOrdersFor || []).includes(domain.fullDomain)) {
      throw new Error(`CA refused the order for ${domain.fullDomain}`);
    }
  }) as never);

  return { findByCalls, ordered };
}

describe("DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("asks only for verified, not yet ordered, Let's Encrypt domains: least recently updated first, a capped batch", async () => {
    const { findByCalls } = setUpService({ rows: [] });

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(findByCalls).toHaveLength(1);
    expect(findByCalls[0]!.query).toEqual({
      isCnameVerified: true,
      isSslOrdered: false,
      isCustomCertificate: false,
    });
    expect(findByCalls[0]!.sort).toEqual({ updatedAt: SortOrder.Ascending });
    expect(findByCalls[0]!.limit).toBe(
      DashboardDomainServiceClass.ORDER_MAX_PER_RUN,
    );
    expect(findByCalls[0]!.props).toEqual({ isRoot: true });
  });

  test("orders a certificate for each domain it is handed", async () => {
    const { ordered } = setUpService({
      rows: [makeDomain("a.example.com"), makeDomain("b.example.com")],
    });

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(ordered).toEqual(["a.example.com", "b.example.com"]);
  });

  test("never orders more than ORDER_MAX_PER_RUN in one run", async () => {
    const rows: Array<DomainRow> = Array.from(
      { length: DashboardDomainServiceClass.ORDER_MAX_PER_RUN * 4 },
      (_value: unknown, index: number) => {
        return makeDomain(`d${index}.example.com`);
      },
    );

    const { ordered } = setUpService({ rows });

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(ordered).toHaveLength(DashboardDomainServiceClass.ORDER_MAX_PER_RUN);
  });

  test("one domain whose order fails does not stop the rest", async () => {
    const { ordered } = setUpService({
      rows: [makeDomain("broken.example.com"), makeDomain("ok.example.com")],
      failOrdersFor: ["broken.example.com"],
    });

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(ordered).toEqual(["broken.example.com", "ok.example.com"]);
  });
});

describe("DashboardDomainService.checkOrderStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The self-heal: the status page renewal job used to delete dashboard
   * certificates when they came due, leaving domains that say "ordered" with
   * no certificate behind them.
   */
  function withCertificatesFor(
    domains: Array<string>,
  ): Array<{ query: Record<string, unknown> }> {
    const certificateQueries: Array<{ query: Record<string, unknown> }> = [];

    jest
      .spyOn(AcmeCertificateService, "findBy")
      .mockImplementation((async (call: { query: Record<string, unknown> }) => {
        certificateQueries.push(call);
        return inList(call.query["domain"])
          .filter((domain: string) => {
            return domains.includes(domain);
          })
          .map((domain: string) => {
            return { domain: domain };
          });
      }) as never);

    return certificateQueries;
  }

  test("re-orders an ordered domain whose certificate is gone, and leaves the ones that have one alone", async () => {
    spyOnInLists();

    const { ordered } = setUpService({
      rows: [
        makeDomain("healthy.example.com"),
        makeDomain("deleted-by-old-job.example.com"),
        makeDomain("also-healthy.example.com"),
      ],
    });

    withCertificatesFor(["healthy.example.com", "also-healthy.example.com"]);

    await DashboardDomainService.checkOrderStatus();

    expect(ordered).toEqual(["deleted-by-old-job.example.com"]);
  });

  test("reads ordered Let's Encrypt domains least recently updated first, and their certificates in one query", async () => {
    spyOnInLists();

    const { findByCalls } = setUpService({
      rows: [makeDomain("a.example.com"), makeDomain("b.example.com")],
    });

    const certificateQueries: Array<{ query: Record<string, unknown> }> =
      withCertificatesFor(["a.example.com", "b.example.com"]);

    await DashboardDomainService.checkOrderStatus();

    expect(findByCalls[0]!.query).toEqual({
      isSslOrdered: true,
      isCustomCertificate: false,
    });
    expect(findByCalls[0]!.sort).toEqual({ updatedAt: SortOrder.Ascending });
    expect(findByCalls[0]!.props).toEqual({ isRoot: true });

    expect(certificateQueries).toHaveLength(1);
    expect(inList(certificateQueries[0]!.query["domain"])).toEqual([
      "a.example.com",
      "b.example.com",
    ]);
  });

  test("re-orders at most ORDER_MAX_PER_RUN per run, the least recently updated first", async () => {
    spyOnInLists();

    const rows: Array<DomainRow> = Array.from(
      { length: DashboardDomainServiceClass.ORDER_MAX_PER_RUN * 3 },
      (_value: unknown, index: number) => {
        return makeDomain(`missing${index}.example.com`);
      },
    );

    const { ordered } = setUpService({ rows });
    withCertificatesFor([]);

    await DashboardDomainService.checkOrderStatus();

    expect(ordered).toEqual(
      rows
        .slice(0, DashboardDomainServiceClass.ORDER_MAX_PER_RUN)
        .map((row: DomainRow) => {
          return row.fullDomain;
        }),
    );
  });

  test("the cap counts only domains that need an order", async () => {
    spyOnInLists();

    const healthy: Array<DomainRow> = Array.from(
      { length: DashboardDomainServiceClass.ORDER_MAX_PER_RUN * 2 },
      (_value: unknown, index: number) => {
        return makeDomain(`healthy${index}.example.com`);
      },
    );

    const { ordered } = setUpService({
      rows: [...healthy, makeDomain("missing.example.com")],
    });

    withCertificatesFor(
      healthy.map((row: DomainRow) => {
        return row.fullDomain;
      }),
    );

    await DashboardDomainService.checkOrderStatus();

    expect(ordered).toEqual(["missing.example.com"]);
  });

  test("one domain whose re-order fails does not stop the rest", async () => {
    spyOnInLists();

    const { ordered } = setUpService({
      rows: [makeDomain("broken.example.com"), makeDomain("ok.example.com")],
      failOrdersFor: ["broken.example.com"],
    });

    withCertificatesFor([]);

    await DashboardDomainService.checkOrderStatus();

    expect(ordered).toEqual(["broken.example.com", "ok.example.com"]);
  });

  test("with no ordered domains it neither looks up certificates nor orders", async () => {
    spyOnInLists();

    const { ordered } = setUpService({ rows: [] });
    const certificateQueries: Array<{ query: Record<string, unknown> }> =
      withCertificatesFor([]);

    await DashboardDomainService.checkOrderStatus();

    expect(certificateQueries).toEqual([]);
    expect(ordered).toEqual([]);
  });
});

describe("DashboardDomainService.updateSslProvisioningStatusForAllDomains", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  type Sweep = {
    probed: Array<string>;
    cnameChecks: Array<string>;
    ordered: Array<string>;
    provisioned: Map<string, boolean>;
  };

  /*
   * served: the domains whose HTTPS probe succeeds. throwsFor: the domains
   * whose row cannot even be read.
   */
  function setUpSweep(data: {
    rows: Array<DomainRow>;
    served: Array<string>;
    throwsFor?: Array<string>;
  }): Sweep {
    const sweep: Sweep = {
      probed: [],
      cnameChecks: [],
      ordered: [],
      provisioned: new Map<string, boolean>(),
    };

    const byId: Map<string, DomainRow> = new Map<string, DomainRow>(
      data.rows.map((row: DomainRow) => {
        return [row._id, row];
      }),
    );

    jest
      .spyOn(DashboardDomainService, "findBy")
      .mockResolvedValue(data.rows as never);

    jest
      .spyOn(DashboardDomainService, "findOneBy")
      .mockImplementation((async (call: { query: { _id: string } }) => {
        const row: DomainRow | undefined = byId.get(call.query._id);

        if (row && (data.throwsFor || []).includes(row.fullDomain)) {
          throw new Error(`could not read ${row.fullDomain}`);
        }

        return row || null;
      }) as never);

    jest
      .spyOn(Domain, "getForDomainVerification")
      .mockImplementation((async (request: { url: string }) => {
        sweep.probed.push(request.url);

        const isServed: boolean = data.served.some((domain: string) => {
          return request.url.startsWith(`https://${domain}/`);
        });

        return {
          isFailure: (): boolean => {
            return !isServed;
          },
          isSuccess: (): boolean => {
            return isServed;
          },
        };
      }) as never);

    jest
      .spyOn(DashboardDomainService, "isCnameValid")
      .mockImplementation((async (fullDomain: string): Promise<boolean> => {
        sweep.cnameChecks.push(fullDomain);
        return true;
      }) as never);

    jest.spyOn(DashboardDomainService, "orderCert").mockImplementation((async (
      domain: DomainRow,
    ): Promise<void> => {
      sweep.ordered.push(domain.fullDomain);
    }) as never);

    jest
      .spyOn(DashboardDomainService, "updateOneById")
      .mockImplementation((async (update: {
        id: ObjectID;
        data: { isSslProvisioned: boolean };
      }): Promise<void> => {
        const row: DomainRow | undefined = byId.get(update.id.toString());
        sweep.provisioned.set(
          row?.fullDomain || "unknown",
          update.data.isSslProvisioned,
        );
      }) as never);

    return sweep;
  }

  test("marks a domain provisioned once it serves its certificate over HTTPS", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [makeDomain("served.example.com")],
      served: ["served.example.com"],
    });

    await DashboardDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.provisioned.get("served.example.com")).toBe(true);
    expect(sweep.probed).toHaveLength(1);
    expect(sweep.probed[0]!.startsWith("https://served.example.com/")).toBe(
      true,
    );
    expect(sweep.cnameChecks).toEqual([]);
  });

  /*
   * The status page sweep re-orders here. Right after an order this probe is
   * usually racing nginx's 15-minute write of the new certificate, so the
   * dashboard sweep leaves ordering to checkOrderStatus and the renewal run.
   */
  test("marks a domain that does not serve it yet as not provisioned, re-checks its CNAME, and never orders", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [makeDomain("not-yet.example.com")],
      served: [],
    });

    await DashboardDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.provisioned.get("not-yet.example.com")).toBe(false);
    expect(sweep.cnameChecks).toEqual(["not-yet.example.com"]);
    expect(sweep.ordered).toEqual([]);
  });

  test("one domain that cannot be checked does not end the sweep for the rest", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [
        makeDomain("broken.example.com"),
        makeDomain("served.example.com"),
        makeDomain("not-yet.example.com"),
      ],
      served: ["served.example.com"],
      throwsFor: ["broken.example.com"],
    });

    await DashboardDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.provisioned.get("served.example.com")).toBe(true);
    expect(sweep.provisioned.get("not-yet.example.com")).toBe(false);
    expect(sweep.provisioned.has("broken.example.com")).toBe(false);
    expect(sweep.ordered).toEqual([]);
  });

  test("reads only ordered Let's Encrypt domains", async () => {
    setUpSweep({ rows: [], served: [] });

    await DashboardDomainService.updateSslProvisioningStatusForAllDomains();

    const findBy: unknown = DashboardDomainService.findBy;
    const call: FindByCall = (
      findBy as { mock: { calls: Array<[FindByCall]> } }
    ).mock.calls[0]![0];

    expect(call.query).toEqual({
      isSslOrdered: true,
      isCustomCertificate: false,
    });
    expect(call.props).toEqual({ isRoot: true });
  });
});

describe("DashboardDomainService.verifyCnameWhoseCnameisNotVerified", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("checks every unverified domain and keeps going past one that throws", async () => {
    const checked: Array<string> = [];
    const findByCalls: Array<FindByCall> = [];

    jest.spyOn(DashboardDomainService, "findBy").mockImplementation((async (
      call: FindByCall,
    ) => {
      findByCalls.push(call);
      return [
        makeDomain("a.example.com"),
        makeDomain("broken.example.com"),
        makeDomain("b.example.com"),
      ];
    }) as never);

    jest
      .spyOn(DashboardDomainService, "isCnameValid")
      .mockImplementation((async (fullDomain: string): Promise<boolean> => {
        checked.push(fullDomain);

        if (fullDomain === "broken.example.com") {
          throw new Error("DNS lookup failed");
        }

        return true;
      }) as never);

    await DashboardDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(findByCalls[0]!.query).toEqual({ isCnameVerified: false });
    expect(checked.sort()).toEqual([
      "a.example.com",
      "b.example.com",
      "broken.example.com",
    ]);
  });

  test("checks at most DOMAIN_CHECK_CONCURRENCY domains at once", async () => {
    const total: number =
      DashboardDomainServiceClass.DOMAIN_CHECK_CONCURRENCY * 3;
    let inFlight: number = 0;
    let mostInFlight: number = 0;
    let checked: number = 0;

    jest.spyOn(DashboardDomainService, "findBy").mockResolvedValue(
      Array.from({ length: total }, (_value: unknown, index: number) => {
        return makeDomain(`d${index}.example.com`);
      }) as never,
    );

    jest
      .spyOn(DashboardDomainService, "isCnameValid")
      .mockImplementation((async (): Promise<boolean> => {
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
        inFlight--;
        checked++;
        return true;
      }) as never);

    await DashboardDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(checked).toBe(total);
    expect(mostInFlight).toBe(
      DashboardDomainServiceClass.DOMAIN_CHECK_CONCURRENCY,
    );
  });
});
