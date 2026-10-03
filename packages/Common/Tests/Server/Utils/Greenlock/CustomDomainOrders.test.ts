/**
 * CustomDomainOrders: the steps a custom domain's free certificate goes
 * through that do not depend on which kind of custom domain it is - a status
 * page's or a dashboard's - written once, so the two kinds can no longer
 * drift apart (the dashboard one kept a Check now that only checked, and an
 * Order Free SSL button, after the status page one lost both).
 *
 *   - orderOnceCnameIsVerified: Check now, once the record is found;
 *   - orderForVerifiedDomainsWithoutOne: the sweeps' first orders;
 *   - getCertificates: what the Custom Domains page's Status column reads.
 *
 * The services hand in their own reads, writes and first-order door; here
 * those are plain functions, so what is pinned is the step itself. Redis -
 * Check now's window, the failed-order records - is InMemoryRedis; the
 * certificate table is a spy on its one lookup.
 */

import CustomDomainOrders, {
  CustomDomainToOrder,
} from "../../../../Server/Utils/Greenlock/CustomDomainOrders";
import CertificateOrder, {
  CertificateOrderOutcome,
  CustomDomainCertificateState,
} from "../../../../Server/Utils/Greenlock/CertificateOrder";
import CertificateOrderFailures from "../../../../Server/Utils/Greenlock/CertificateOrderFailures";
import GreenlockUtil from "../../../../Server/Utils/Greenlock/Greenlock";
import { InMemoryRedis, useInMemoryRedis } from "./InMemoryRedis";
import AcmeCertificate from "../../../../Models/DatabaseModels/AcmeCertificate";
import BadDataException from "../../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import {
  CustomDomainCertificateStatus,
  CustomDomainVerificationResult,
} from "../../../../Types/CustomDomain/CustomDomainVerification";
import { CustomDomainCertificate } from "../../../../Types/CustomDomain/CustomDomainCertificates";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

type Domain = CustomDomainToOrder & { id: ObjectID; fullDomain: string };

function domain(
  fullDomain: string,
  extra: Partial<CustomDomainToOrder> = {},
): Domain {
  return {
    id: ObjectID.generate(),
    fullDomain: fullDomain,
    isCustomCertificate: false,
    isSslOrdered: false,
    ...extra,
  } as Domain;
}

/*
 * The certificate table: the days left on each name's certificate,
 * negative once it has expired. Records every name looked up.
 */
function withCertificates(
  expiringInDays: Record<string, number>,
): Array<Array<string>> {
  const lookups: Array<Array<string>> = [];

  jest.spyOn(GreenlockUtil, "findCertificatesByDomain").mockImplementation(
    (async (names: Array<string>): Promise<Map<string, AcmeCertificate>> => {
      lookups.push([...names]);

      const found: Map<string, AcmeCertificate> = new Map();

      for (const name of names) {
        const days: number | undefined = expiringInDays[name];

        if (days !== undefined) {
          found.set(name, {
            domain: name,
            expiresAt: OneUptimeDate.addRemoveDays(
              OneUptimeDate.getCurrentDate(),
              days,
            ),
          } as AcmeCertificate);
        }
      }

      return found;
    }) as never,
  );

  return lookups;
}

let redis: InMemoryRedis;

beforeEach(() => {
  redis = useInMemoryRedis();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CustomDomainOrders.orderOnceCnameIsVerified (Check now)", () => {
  type CheckNow = {
    result: CustomDomainVerificationResult;
    orders: number;
    recordings: number;
  };

  async function checkNow(data: {
    domain: Domain;
    order?: () => Promise<CertificateOrderOutcome>;
    waitInMs?: number;
  }): Promise<CheckNow> {
    const calls: { orders: number; recordings: number } = {
      orders: 0,
      recordings: 0,
    };

    const result: CustomDomainVerificationResult =
      await CustomDomainOrders.orderOnceCnameIsVerified({
        domain: data.domain,
        waitInMs: data.waitInMs,
        recordAsOrdered: async (): Promise<void> => {
          calls.recordings++;
        },
        orderIfMissing: async (): Promise<CertificateOrderOutcome> => {
          calls.orders++;

          return data.order
            ? await data.order()
            : CertificateOrderOutcome.Ordered;
        },
      });

    return { result, ...calls };
  }

  test("a domain on an uploaded certificate orders nothing, looks nothing up, and answers Uploaded", async () => {
    const lookups: Array<Array<string>> = withCertificates({});

    const done: CheckNow = await checkNow({
      domain: domain("dash.acme.com", { isCustomCertificate: true }),
    });

    expect(done.result).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Uploaded,
    });
    expect(done.orders).toBe(0);
    expect(lookups).toEqual([]);
    // Its window is untouched.
    expect(redis.cache.size).toBe(0);
  });

  test("a domain without a certificate is ordered now, and answers Issuing", async () => {
    withCertificates({});

    const done: CheckNow = await checkNow({ domain: domain("dash.acme.com") });

    expect(done.orders).toBe(1);
    expect(done.result).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Issuing,
    });
  });

  test("the name is looked up and its window claimed as the lock and the table spell it", async () => {
    const lookups: Array<Array<string>> = withCertificates({});
    const claim: Mock<(domain: string) => Promise<unknown>> = jest.spyOn(
      CertificateOrder,
      "claimOnDemandOrder",
    ) as unknown as Mock<(domain: string) => Promise<unknown>>;

    await checkNow({ domain: domain("Dash.ACME.com") });

    expect(lookups).toEqual([["dash.acme.com"]]);
    expect(claim).toHaveBeenCalledWith("dash.acme.com");
  });

  test("a valid certificate is Issued: nothing ordered, no window used", async () => {
    withCertificates({ "dash.acme.com": 40 });

    const done: CheckNow = await checkNow({
      domain: domain("dash.acme.com", { isSslOrdered: true }),
    });

    expect(done.result).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Issued,
    });
    expect(done.orders).toBe(0);
    // Already recorded as ordered: nothing to write.
    expect(done.recordings).toBe(0);
    expect(redis.cache.size).toBe(0);
  });

  test("a domain verified again after a blip, its certificate still good, is recorded as ordered and not ordered again", async () => {
    withCertificates({ "dash.acme.com": 40 });

    const done: CheckNow = await checkNow({
      domain: domain("dash.acme.com", { isSslOrdered: false }),
    });

    expect(done.result.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issued,
    );
    expect(done.recordings).toBe(1);
    expect(done.orders).toBe(0);
  });

  test("an expired certificate is not Issued: it is ordered now", async () => {
    withCertificates({ "dash.acme.com": -2 });

    const done: CheckNow = await checkNow({
      domain: domain("dash.acme.com", { isSslOrdered: true }),
    });

    expect(done.orders).toBe(1);
    expect(done.result.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
  });

  test("the order found the certificate in place under its lock: Issued", async () => {
    withCertificates({});

    const done: CheckNow = await checkNow({
      domain: domain("dash.acme.com"),
      order: async (): Promise<CertificateOrderOutcome> => {
        return CertificateOrderOutcome.AlreadyIssued;
      },
    });

    expect(done.result.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issued,
    );
  });

  test("one on-demand order per domain per window: the second click orders nothing", async () => {
    withCertificates({});

    const first: CheckNow = await checkNow({ domain: domain("dash.acme.com") });
    const second: CheckNow = await checkNow({
      domain: domain("dash.acme.com"),
    });

    expect(first.orders).toBe(1);
    expect(second.orders).toBe(0);
    expect(second.result).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Issuing,
    });
  });

  test("a click within the window of a failed order shows why it failed, and orders nothing", async () => {
    withCertificates({});

    const failed: CheckNow = await checkNow({
      domain: domain("dash.acme.com"),
      order: async (): Promise<CertificateOrderOutcome> => {
        throw new BadDataException("CAA record forbids letsencrypt.org.");
      },
    });

    expect(failed.result).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Failed,
      certificateError: "CAA record forbids letsencrypt.org.",
    });

    // The failure is recorded for the window, not awaited by the answer.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    const again: CheckNow = await checkNow({ domain: domain("dash.acme.com") });

    expect(again.orders).toBe(0);
    expect(again.result).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Failed,
      certificateError: "CAA record forbids letsencrypt.org.",
    });
  });

  test.each([
    [CertificateOrderOutcome.NotOrderedNow],
    [CertificateOrderOutcome.LimitReached],
  ])(
    "nothing ordered (%s) answers Issuing, and gives the window back to the next click",
    async (outcome: CertificateOrderOutcome) => {
      withCertificates({});

      const refused: CheckNow = await checkNow({
        domain: domain("dash.acme.com"),
        order: async (): Promise<CertificateOrderOutcome> => {
          return outcome;
        },
      });

      expect(refused.result.certificateStatus).toBe(
        CustomDomainCertificateStatus.Issuing,
      );

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      const next: CheckNow = await checkNow({ domain: domain("dash.acme.com") });

      expect(next.orders).toBe(1);
    },
  );

  test("an order that was placed keeps the window", async () => {
    withCertificates({});

    await checkNow({ domain: domain("dash.acme.com") });

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    expect(
      [...redis.cache.entries()].filter(([key]: [string, string]) => {
        return key.startsWith(CertificateOrder.ON_DEMAND_ORDER_NAMESPACE);
      }),
    ).toEqual([
      [`${CertificateOrder.ON_DEMAND_ORDER_NAMESPACE}-dash.acme.com`, "ordering"],
    ]);
  });

  test("an unexpected error is reported in plain words, not as its internals", async () => {
    withCertificates({});

    const done: CheckNow = await checkNow({
      domain: domain("dash.acme.com"),
      order: async (): Promise<CertificateOrderOutcome> => {
        throw new TypeError("Cannot read properties of undefined");
      },
    });

    expect(done.result).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Failed,
      certificateError: "We could not order an SSL certificate for this domain.",
    });
  });

  test("an order door that throws before it returns a promise is reported, not thrown", async () => {
    withCertificates({});

    const result: CustomDomainVerificationResult =
      await CustomDomainOrders.orderOnceCnameIsVerified({
        domain: domain("dash.acme.com"),
        recordAsOrdered: async (): Promise<void> => {},
        orderIfMissing: (): Promise<CertificateOrderOutcome> => {
          throw new BadDataException("Domain ID is required");
        },
      });

    expect(result).toEqual({
      certificateStatus: CustomDomainCertificateStatus.Failed,
      certificateError: "Domain ID is required",
    });
  });

  test("an order that outlives the wait is answered as Issuing, finishes on its own, and its failure is never thrown at anyone", async () => {
    withCertificates({});

    let failOrder: (err: Error) => void = (): void => {};

    const unhandled: Array<unknown> = [];
    const onUnhandled: (reason: unknown) => void = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const startedAt: number = Date.now();

      const done: CheckNow = await checkNow({
        domain: domain("dash.acme.com"),
        waitInMs: 10,
        order: (): Promise<CertificateOrderOutcome> => {
          return new Promise<CertificateOrderOutcome>(
            (
              _resolve: (outcome: CertificateOrderOutcome) => void,
              reject: (err: Error) => void,
            ) => {
              failOrder = reject;
            },
          );
        },
      });

      expect(done.result.certificateStatus).toBe(
        CustomDomainCertificateStatus.Issuing,
      );
      expect(Date.now() - startedAt).toBeLessThan(5000);

      failOrder(new BadDataException("CA refused the order"));

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("an order that finishes within the wait answers at once", async () => {
    withCertificates({});

    const startedAt: number = Date.now();

    await checkNow({ domain: domain("dash.acme.com"), waitInMs: 60_000 });

    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  test("without Redis it orders nothing on demand, and leaves the domain to the sweeps", async () => {
    withCertificates({});
    redis.goDown();

    const done: CheckNow = await checkNow({ domain: domain("dash.acme.com") });

    expect(done.orders).toBe(0);
    expect(done.result.certificateStatus).toBe(
      CustomDomainCertificateStatus.Issuing,
    );
  });
});

describe("CustomDomainOrders.orderForVerifiedDomainsWithoutOne (the sweeps)", () => {
  type Sweep = {
    ordered: Array<string>;
    recorded: Array<Array<string>>;
  };

  async function sweep(data: {
    domains: Array<Domain>;
    maxPerRun?: number;
    failOrdersFor?: Array<string>;
    failRecording?: boolean;
  }): Promise<Sweep> {
    const done: Sweep = { ordered: [], recorded: [] };

    await CustomDomainOrders.orderForVerifiedDomainsWithoutOne<Domain>({
      domains: data.domains,
      maxPerRun: data.maxPerRun ?? 5,
      recordAsOrdered: async (domainIds: Array<ObjectID>): Promise<void> => {
        if (data.failRecording) {
          throw new Error("database is down");
        }

        done.recorded.push(
          domainIds.map((id: ObjectID) => {
            return (
              data.domains.find((candidate: Domain) => {
                return candidate.id.toString() === id.toString();
              })?.fullDomain || "unknown"
            );
          }),
        );
      },
      orderIfMissing: async (
        candidate: Domain,
      ): Promise<CertificateOrderOutcome> => {
        done.ordered.push(candidate.fullDomain);

        if ((data.failOrdersFor || []).includes(candidate.fullDomain)) {
          throw new Error(`CA refused ${candidate.fullDomain}`);
        }

        return CertificateOrderOutcome.Ordered;
      },
    });

    return done;
  }

  test("orders each domain without a certificate", async () => {
    withCertificates({});

    const done: Sweep = await sweep({
      domains: [domain("a.acme.com"), domain("b.acme.com")],
    });

    expect(done.ordered.sort()).toEqual(["a.acme.com", "b.acme.com"]);
  });

  test("never orders for an uploaded certificate, or a row without an id or a name", async () => {
    const lookups: Array<Array<string>> = withCertificates({});

    const noId: Domain = domain("no-id.acme.com");
    noId.id = undefined as never;

    const done: Sweep = await sweep({
      domains: [
        domain("upload.acme.com", { isCustomCertificate: true }),
        noId,
        { ...domain(""), fullDomain: "" } as Domain,
        domain("a.acme.com"),
      ],
    });

    expect(done.ordered).toEqual(["a.acme.com"]);
    expect(lookups).toEqual([["a.acme.com"]]);
  });

  test("a domain that has a certificate is recorded as ordered, in one write, and not ordered", async () => {
    withCertificates({ "a.acme.com": 40, "b.acme.com": -1 });

    const done: Sweep = await sweep({
      domains: [
        domain("a.acme.com"),
        domain("b.acme.com"),
        domain("c.acme.com"),
        // Recorded already: no write for it.
        domain("d.acme.com", { isSslOrdered: true }),
      ],
    });

    expect(done.recorded).toEqual([["a.acme.com", "b.acme.com"]]);
    expect(done.ordered).toEqual(["c.acme.com", "d.acme.com"]);
  });

  test("orders at most maxPerRun, and every waiting domain is picked within a few runs", async () => {
    withCertificates({});

    const domains: Array<Domain> = Array.from(
      { length: 12 },
      (_value: unknown, index: number) => {
        return domain(`d${index}.acme.com`);
      },
    );

    const orderedAtAll: Set<string> = new Set<string>();

    for (let run: number = 0; run < 12; run++) {
      jest
        .spyOn(OneUptimeDate, "getCurrentDate")
        .mockReturnValue(new Date(1_800_000_000_000 + run * 15 * 60 * 1000));

      const done: Sweep = await sweep({ domains, maxPerRun: 3 });

      expect(done.ordered).toHaveLength(3);

      for (const name of done.ordered) {
        orderedAtAll.add(name);
      }
    }

    expect(orderedAtAll.size).toBe(12);
  });

  test("a domain waiting after a failed order is skipped, and its slot goes to another", async () => {
    withCertificates({});

    await CertificateOrderFailures.record({
      domain: "failing.acme.com",
      error: "Unable to order certificate for failing.acme.com.",
      now: OneUptimeDate.getCurrentDate(),
    });

    const done: Sweep = await sweep({
      domains: [domain("failing.acme.com"), domain("a.acme.com")],
      maxPerRun: 1,
    });

    expect(done.ordered).toEqual(["a.acme.com"]);
  });

  test("one domain whose order fails does not stop the rest", async () => {
    withCertificates({});

    const done: Sweep = await sweep({
      domains: [
        domain("a.acme.com"),
        domain("broken.acme.com"),
        domain("b.acme.com"),
      ],
      failOrdersFor: ["broken.acme.com"],
    });

    expect(done.ordered.sort()).toEqual([
      "a.acme.com",
      "b.acme.com",
      "broken.acme.com",
    ]);
  });

  test("a write that fails to record does not stop the orders", async () => {
    withCertificates({ "a.acme.com": 40 });

    const done: Sweep = await sweep({
      domains: [domain("a.acme.com"), domain("b.acme.com")],
      failRecording: true,
    });

    expect(done.ordered).toEqual(["b.acme.com"]);
  });

  test("with nothing to order it looks nothing up", async () => {
    const lookups: Array<Array<string>> = withCertificates({});

    const done: Sweep = await sweep({ domains: [] });

    expect(done.ordered).toEqual([]);
    expect(lookups).toEqual([]);
  });
});

describe("CustomDomainOrders.getCertificates (the Status column)", () => {
  test("answers each domain's certificate expiry and last failed order, by domain id", async () => {
    const failing: Domain = domain("Failing.Acme.com");
    const issued: Domain = domain("issued.acme.com");
    const expiresAt: Date = new Date("2026-12-30T00:00:00.000Z");
    const failedAt: Date = new Date("2026-10-03T11:00:00.000Z");

    const states: Mock<(domains: Array<string>) => Promise<unknown>> =
      jest
        .spyOn(CertificateOrder, "getCertificateStates")
        .mockResolvedValue(
          new Map<string, CustomDomainCertificateState>([
            [
              "failing.acme.com",
              {
                lastOrderError: "Unable to order certificate.",
                lastOrderFailedAt: failedAt,
              },
            ],
            ["issued.acme.com", { certificateExpiresAt: expiresAt }],
          ]) as never,
        ) as unknown as Mock<(domains: Array<string>) => Promise<unknown>>;

    const certificates: Array<CustomDomainCertificate> =
      await CustomDomainOrders.getCertificates([failing, issued]);

    expect(states).toHaveBeenCalledWith(["Failing.Acme.com", "issued.acme.com"]);
    expect(certificates).toEqual([
      {
        domainId: failing.id.toString(),
        expiresAt: undefined,
        lastOrderError: "Unable to order certificate.",
        lastOrderFailedAt: failedAt,
      },
      {
        domainId: issued.id.toString(),
        expiresAt: expiresAt,
        lastOrderError: undefined,
        lastOrderFailedAt: undefined,
      },
    ]);
  });

  test("leaves out a row without an id or a name", async () => {
    jest
      .spyOn(CertificateOrder, "getCertificateStates")
      .mockResolvedValue(new Map() as never);

    const noId: Domain = domain("no-id.acme.com");
    noId.id = undefined as never;

    const certificates: Array<CustomDomainCertificate> =
      await CustomDomainOrders.getCertificates([
        noId,
        { ...domain("x"), fullDomain: "" } as Domain,
      ]);

    expect(certificates).toEqual([]);
  });
});
