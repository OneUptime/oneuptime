import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import CertificateReissueUtil from "../../../Utils/CertificateReissue";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * reissueCert - the service behind the dashboard's "Reissue SSL" button, on
 * both custom-domain surfaces.
 *
 * Every certificate OneUptime orders is ordered against a single Let's
 * Encrypt account shared by the whole installation, and the automated renewal
 * cron spends from the same allowance. A customer-pressable button on top of
 * that is only safe if three things hold, and each of them is a way the
 * feature can quietly stop protecting anything:
 *
 *   1. The cooldown is claimed BEFORE the order is attempted, and is not
 *      rolled back when the order fails. A failed order still costs a
 *      validation attempt at the CA, and a failing domain is exactly the one
 *      somebody presses again.
 *   2. The cooldown is claimed by the WRITE, not by a read above it - two
 *      clicks that arrive together both see a row that is not cooling down,
 *      so only a conditional update can pick a winner.
 *   3. A domain with nothing to reissue never reaches the CA at all.
 *
 * No database and no ACME client: findOneBy, updateOneBy and orderCert are
 * all spied on, so what is asserted is the ORDER and the CONDITIONS of those
 * calls, which is precisely where the protection lives.
 */

type DomainRow = {
  _id: string;
  id: ObjectID;
  fullDomain: string;
  isCnameVerified: boolean;
  isSslOrdered: boolean;
  isCustomCertificate: boolean;
  certificateReissueRequestedAt?: Date | undefined;
};

const DOMAIN_ID: ObjectID = ObjectID.generate();

type MakeDomainFunction = (overrides?: Partial<DomainRow>) => DomainRow;

const makeDomain: MakeDomainFunction = (
  overrides: Partial<DomainRow> = {},
): DomainRow => {
  return {
    _id: DOMAIN_ID.toString(),
    id: DOMAIN_ID,
    fullDomain: "status.example.com",
    isCnameVerified: true,
    isSslOrdered: true,
    isCustomCertificate: false,
    certificateReissueRequestedAt: undefined,
    ...overrides,
  };
};

type ReissueService = {
  reissueCert: (id: ObjectID) => Promise<void>;
};

type HarnessCalls = {
  // Every updateOneBy the service made, in order.
  updates: Array<{
    query: Record<string, unknown>;
    data: Record<string, unknown>;
  }>;
  // Domains handed to orderCert, in order.
  ordered: Array<string>;
};

type SetUpHarnessFunction = (data: {
  service: unknown;
  domain: DomainRow | null;
  // Rows the conditional claim reports as written. 1 = claim won, 0 = lost.
  claimedRowCount?: number;
  orderCertThrows?: Error;
}) => HarnessCalls;

const setUpHarness: SetUpHarnessFunction = (data: {
  service: unknown;
  domain: DomainRow | null;
  claimedRowCount?: number;
  orderCertThrows?: Error;
}): HarnessCalls => {
  const calls: HarnessCalls = { updates: [], ordered: [] };

  jest
    .spyOn(data.service as never, "findOneBy")
    .mockResolvedValue(data.domain as never);

  jest
    .spyOn(data.service as never, "updateOneBy")
    .mockImplementation((async (update: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<number> => {
      calls.updates.push({ query: update.query, data: update.data });
      return data.claimedRowCount === undefined ? 1 : data.claimedRowCount;
    }) as never);

  jest
    .spyOn(data.service as never, "orderCert")
    .mockImplementation((async (domain: {
      fullDomain?: string;
    }): Promise<void> => {
      calls.ordered.push(domain.fullDomain as string);

      if (data.orderCertThrows) {
        throw data.orderCertThrows;
      }
    }) as never);

  return calls;
};

const services: Array<[string, unknown]> = [
  ["StatusPageDomainService", StatusPageDomainService],
  ["DashboardDomainService", DashboardDomainService],
];

describe.each(services)("%s.reissueCert", (_name: string, service: unknown) => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("orders a fresh certificate for an eligible domain", async () => {
    const calls: HarnessCalls = setUpHarness({
      service,
      domain: makeDomain(),
    });

    await (service as ReissueService).reissueCert(DOMAIN_ID);

    expect(calls.ordered).toEqual(["status.example.com"]);
  });

  /*
   * The whole point of a reissue: it must reach the CA even though the
   * domain already has a working certificate. order-ssl refuses in exactly
   * this state ("SSL is already provisioned"), which is why this button had
   * to exist at all.
   */
  test("reissues a domain that already has a provisioned certificate", async () => {
    const calls: HarnessCalls = setUpHarness({
      service,
      domain: makeDomain({ isSslOrdered: true }),
    });

    await (service as ReissueService).reissueCert(DOMAIN_ID);

    expect(calls.ordered).toHaveLength(1);
  });

  describe("the cooldown", () => {
    test("stamps the request before ordering anything", async () => {
      const order: Array<string> = [];

      jest
        .spyOn(service as never, "findOneBy")
        .mockResolvedValue(makeDomain() as never);

      jest
        .spyOn(service as never, "updateOneBy")
        .mockImplementation((async (): Promise<number> => {
          order.push("stamp");
          return 1;
        }) as never);

      jest
        .spyOn(service as never, "orderCert")
        .mockImplementation((async (): Promise<void> => {
          order.push("order");
        }) as never);

      await (service as ReissueService).reissueCert(DOMAIN_ID);

      expect(order).toEqual(["stamp", "order"]);
    });

    /*
     * The regression that would make the throttle useless. A domain whose
     * CNAME is half broken fails validation on every attempt, and Let's
     * Encrypt allows only five failed validations per hostname per hour.
     * If a failed order released the cooldown, that budget - which the
     * renewal cron shares - could be spent in seconds.
     */
    test("keeps the stamp when the order fails", async () => {
      const calls: HarnessCalls = setUpHarness({
        service,
        domain: makeDomain(),
        orderCertThrows: new Error("CA refused the order"),
      });

      await expect(
        (service as ReissueService).reissueCert(DOMAIN_ID),
      ).rejects.toThrow("CA refused the order");

      expect(calls.updates).toHaveLength(1);
      expect(
        calls.updates[0]!.data["certificateReissueRequestedAt"],
      ).toBeInstanceOf(Date);
    });

    test("claims the row with the cooldown in the query, not with a read", async () => {
      /*
       * Two clicks that arrive together both read a row that is not cooling
       * down. Only a write whose WHERE clause carries the cooldown can pick
       * a winner - which is why the condition has to be in the query.
       */
      const calls: HarnessCalls = setUpHarness({
        service,
        domain: makeDomain(),
      });

      await (service as ReissueService).reissueCert(DOMAIN_ID);

      expect(calls.updates).toHaveLength(1);
      expect(calls.updates[0]!.query["_id"]).toBe(DOMAIN_ID.toString());
      expect(
        calls.updates[0]!.query["certificateReissueRequestedAt"],
      ).toBeDefined();
    });

    /*
     * The condition is rendered to SQL rather than compared by shape,
     * because the two mistakes worth catching here both produce a
     * FindOperator that looks identical from the outside.
     */
    test("a never-reissued domain is eligible, so the first press works", async () => {
      const calls: HarnessCalls = setUpHarness({
        service,
        domain: makeDomain(),
      });

      await (service as ReissueService).reissueCert(DOMAIN_ID);

      const claim: FindOperator<Date> = calls.updates[0]!.query[
        "certificateReissueRequestedAt"
      ] as FindOperator<Date>;

      /*
       * The OR IS NULL half. Without it every domain that has never been
       * reissued - which is every domain that exists the day this ships -
       * fails the claim and the button refuses on its very first press.
       */
      const sql: string = claim.getSql!("col");

      expect(sql).toContain("IS NULL");
      expect(sql).toContain("<=");
    });

    test("the claim compares against exactly the cutoff the dashboard renders", async () => {
      const calls: HarnessCalls = setUpHarness({
        service,
        domain: makeDomain(),
      });

      const before: Date = OneUptimeDate.getCurrentDate();
      await (service as ReissueService).reissueCert(DOMAIN_ID);
      const after: Date = OneUptimeDate.getCurrentDate();

      const claim: FindOperator<Date> = calls.updates[0]!.query[
        "certificateReissueRequestedAt"
      ] as FindOperator<Date>;

      const boundValues: Array<unknown> = Object.values(
        claim.objectLiteralParameters as Record<string, unknown>,
      );

      expect(boundValues).toHaveLength(1);

      const boundCutoff: Date = OneUptimeDate.fromString(
        boundValues[0] as Date,
      );

      /*
       * "now" moves between the assertion and the call, so the bound cutoff
       * is pinned to the window the call could have observed rather than to
       * a single instant. Anything other than one cooldown behind now -
       * a cooldown ahead, or no offset at all - falls outside it.
       */
      expect(boundCutoff.getTime()).toBeGreaterThanOrEqual(
        CertificateReissueUtil.getCooldownCutoff(before).getTime(),
      );
      expect(boundCutoff.getTime()).toBeLessThanOrEqual(
        CertificateReissueUtil.getCooldownCutoff(after).getTime(),
      );
    });

    test("refuses with a 429 when the claim finds the row still cooling down", async () => {
      const calls: HarnessCalls = setUpHarness({
        service,
        domain: makeDomain({
          certificateReissueRequestedAt: OneUptimeDate.addRemoveHours(
            OneUptimeDate.getCurrentDate(),
            -1,
          ),
        }),
        claimedRowCount: 0,
      });

      await expect(
        (service as ReissueService).reissueCert(DOMAIN_ID),
      ).rejects.toThrow(TooManyRequestsException);

      expect(calls.ordered).toEqual([]);
    });

    test("the refusal tells the customer how long is left", async () => {
      setUpHarness({
        service,
        domain: makeDomain({
          certificateReissueRequestedAt: OneUptimeDate.addRemoveHours(
            OneUptimeDate.getCurrentDate(),
            -1,
          ),
        }),
        claimedRowCount: 0,
      });

      await expect(
        (service as ReissueService).reissueCert(DOMAIN_ID),
      ).rejects.toThrow(/try again in/i);
    });

    /*
     * Losing the claim race against a request that landed a millisecond
     * earlier looks identical to a cooldown at the database, but the row
     * this request read has no stamp on it yet. It must still refuse rather
     * than fall through and order.
     */
    test("refuses when the claim is lost and there is no stamp to explain it", async () => {
      const calls: HarnessCalls = setUpHarness({
        service,
        domain: makeDomain({ certificateReissueRequestedAt: undefined }),
        claimedRowCount: 0,
      });

      await expect(
        (service as ReissueService).reissueCert(DOMAIN_ID),
      ).rejects.toThrow(BadDataException);

      expect(calls.ordered).toEqual([]);
    });
  });

  describe("domains with nothing to reissue never reach the CA", () => {
    test("a domain that does not exist", async () => {
      const calls: HarnessCalls = setUpHarness({ service, domain: null });

      await expect(
        (service as ReissueService).reissueCert(DOMAIN_ID),
      ).rejects.toThrow(BadDataException);

      expect(calls.ordered).toEqual([]);
      expect(calls.updates).toEqual([]);
    });

    test("a domain using a customer-uploaded certificate", async () => {
      const calls: HarnessCalls = setUpHarness({
        service,
        domain: makeDomain({ isCustomCertificate: true }),
      });

      await expect(
        (service as ReissueService).reissueCert(DOMAIN_ID),
      ).rejects.toThrow(BadDataException);

      expect(calls.ordered).toEqual([]);
      expect(calls.updates).toEqual([]);
    });

    test("a domain whose CNAME is not verified", async () => {
      const calls: HarnessCalls = setUpHarness({
        service,
        domain: makeDomain({ isCnameVerified: false }),
      });

      await expect(
        (service as ReissueService).reissueCert(DOMAIN_ID),
      ).rejects.toThrow(/CNAME is not verified/i);

      expect(calls.ordered).toEqual([]);
      expect(calls.updates).toEqual([]);
    });

    test("a domain that never ordered a certificate in the first place", async () => {
      const calls: HarnessCalls = setUpHarness({
        service,
        domain: makeDomain({ isSslOrdered: false }),
      });

      await expect(
        (service as ReissueService).reissueCert(DOMAIN_ID),
      ).rejects.toThrow(/order one first/i);

      expect(calls.ordered).toEqual([]);
      expect(calls.updates).toEqual([]);
    });

    test("a domain with no full domain resolved", async () => {
      const calls: HarnessCalls = setUpHarness({
        service,
        domain: makeDomain({ fullDomain: "" }),
      });

      await expect(
        (service as ReissueService).reissueCert(DOMAIN_ID),
      ).rejects.toThrow(BadDataException);

      expect(calls.ordered).toEqual([]);
      expect(calls.updates).toEqual([]);
    });

    /*
     * An ineligible domain must be refused without a stamp: refusing it AND
     * burning its cooldown would leave a customer who fixed their CNAME
     * waiting a day for a button that never cost the CA anything.
     */
    test("an ineligible domain does not burn its cooldown", async () => {
      const calls: HarnessCalls = setUpHarness({
        service,
        domain: makeDomain({ isCnameVerified: false }),
      });

      await expect(
        (service as ReissueService).reissueCert(DOMAIN_ID),
      ).rejects.toThrow();

      expect(calls.updates).toEqual([]);
    });
  });

  describe("what the service reads", () => {
    test("selects every field the eligibility checks depend on", async () => {
      const selects: Array<Record<string, unknown>> = [];

      jest
        .spyOn(service as never, "findOneBy")
        .mockImplementation((async (find: {
          select: Record<string, unknown>;
        }): Promise<DomainRow> => {
          selects.push(find.select);
          return makeDomain();
        }) as never);

      jest.spyOn(service as never, "updateOneBy").mockResolvedValue(1 as never);
      jest
        .spyOn(service as never, "orderCert")
        .mockResolvedValue(undefined as never);

      await (service as ReissueService).reissueCert(DOMAIN_ID);

      /*
       * A field that is not selected reads back as undefined, which is
       * falsy - so a forgotten select here would silently turn a guard into
       * a refusal for everybody, or (for isCustomCertificate) into a hole.
       */
      for (const field of [
        "fullDomain",
        "isCnameVerified",
        "isSslOrdered",
        "isCustomCertificate",
        "certificateReissueRequestedAt",
      ]) {
        expect(selects[0]![field]).toBe(true);
      }
    });
  });
});
