/**
 * Where GreenlockUtil.orderCert stores the certificate the CA issued.
 *
 * It looks the name's row up first and then updates it in place, or creates
 * one. The row can disappear between those two steps - a domain deleted
 * meanwhile, or the daily cleanup removing an expired certificate nobody
 * owned just as its domain is added back - and the update then finds
 * nothing. The certificate the CA has just issued must be stored anyway,
 * not dropped.
 *
 * acme-client is replaced, so no order ever reaches a CA, and so is the
 * certificate table.
 */

import GreenlockUtil from "../../../../Server/Utils/Greenlock/Greenlock";
import { CertificateOrderReason } from "../../../../Server/Utils/Greenlock/CertificateOrderBudget";
import { CertificateOrderOutcome } from "../../../../Server/Utils/Greenlock/CertificateOrderOutcome";
import AcmeCertificateService from "../../../../Server/Services/AcmeCertificateService";
import AcmeCertificate from "../../../../Models/DatabaseModels/AcmeCertificate";
import OneUptimeDate from "../../../../Types/Date";
import { useInMemoryRedis } from "./InMemoryRedis";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

const mockIssuedAt: Date = new Date("2026-10-01T00:00:00.000Z");
const mockExpiresAt: Date = new Date("2026-12-30T00:00:00.000Z");

// Hoisted above the imports; nothing here is read until a test orders.
jest.mock("acme-client", () => {
  return {
    __esModule: true,
    default: {
      Client: class {
        public async auto(): Promise<string> {
          return "-----BEGIN CERTIFICATE-----\nissued\n-----END CERTIFICATE-----";
        }
      },
      directory: {
        letsencrypt: {
          production: "https://acme.example.com/directory",
        },
      },
      crypto: {
        createCsr: async (): Promise<Array<string>> => {
          return ["-----BEGIN PRIVATE KEY-----", "csr"];
        },
        readCertificateInfo: (): { notBefore: Date; notAfter: Date } => {
          return { notBefore: mockIssuedAt, notAfter: mockExpiresAt };
        },
      },
    },
  };
});

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    __esModule: true,
    LetsEncryptAccountKey: Buffer.from("account key").toString("base64"),
    LetsEncryptNotificationEmail: "certificates@example.com",
  };
});

type Store = {
  updates: Array<Record<string, unknown>>;
  creates: Array<AcmeCertificate>;
};

function setUpStore(data: {
  existingRow: boolean;
  rowsUpdated: number;
}): Store {
  const store: Store = { updates: [], creates: [] };

  jest
    .spyOn(AcmeCertificateService, "findOneBy")
    .mockResolvedValue((data.existingRow ? { _id: "row-id" } : null) as never);

  jest
    .spyOn(AcmeCertificateService, "updateBy")
    .mockImplementation((async (updateBy: {
      data: Record<string, unknown>;
    }): Promise<number> => {
      store.updates.push(updateBy.data);
      return data.rowsUpdated;
    }) as never);

  jest
    .spyOn(AcmeCertificateService, "create")
    .mockImplementation((async (createBy: {
      data: AcmeCertificate;
    }): Promise<AcmeCertificate> => {
      store.creates.push(createBy.data);
      return createBy.data;
    }) as never);

  return store;
}

async function order(): Promise<void> {
  const outcome: CertificateOrderOutcome = await GreenlockUtil.orderCert({
    domain: "Dash.Acme.com",
    reason: CertificateOrderReason.FirstCertificate,
    validateCname: async (): Promise<boolean> => {
      return true;
    },
  });

  expect(outcome).toBe(CertificateOrderOutcome.Ordered);
}

describe("GreenlockUtil.orderCert storing the issued certificate", () => {
  beforeEach(() => {
    // The name's order lock and the account's order budget.
    useInMemoryRedis();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("updates the name's existing row in place", async () => {
    const store: Store = setUpStore({ existingRow: true, rowsUpdated: 1 });

    await order();

    expect(store.updates).toHaveLength(1);
    expect(store.updates[0]!["expiresAt"]).toEqual(mockExpiresAt);
    expect(store.creates).toEqual([]);
  });

  test("creates a row for a name that has none", async () => {
    const store: Store = setUpStore({ existingRow: false, rowsUpdated: 0 });

    await order();

    expect(store.updates).toEqual([]);
    expect(store.creates).toHaveLength(1);
    expect(store.creates[0]!.domain).toBe("dash.acme.com");
    expect(store.creates[0]!.issuedAt).toEqual(mockIssuedAt);
    expect(store.creates[0]!.expiresAt).toEqual(mockExpiresAt);
  });

  /*
   * A failed CNAME check refuses the order and deletes nothing, for every
   * reason an order is placed. It used to remove the name's certificate by
   * default, so a DNS blip during a renewal or a dashboard order took a
   * working domain off HTTPS with weeks left on its certificate.
   */
  test.each(Object.values(CertificateOrderReason))(
    "a failed CNAME check refuses a %s order and keeps the certificate",
    async (reason: CertificateOrderReason) => {
      const store: Store = setUpStore({ existingRow: true, rowsUpdated: 1 });
      const removeSpy: SpyInstance<(domain: string) => Promise<void>> = jest
        .spyOn(GreenlockUtil, "removeDomain")
        .mockResolvedValue(undefined);
      const deleteSpy: SpyInstance<any> = jest
        .spyOn(AcmeCertificateService, "deleteBy")
        .mockResolvedValue(1 as never);

      await expect(
        GreenlockUtil.orderCert({
          domain: "dash.acme.com",
          reason: reason,
          validateCname: async (): Promise<boolean> => {
            return false;
          },
        }),
      ).rejects.toThrow("Cname is not valid");

      expect(removeSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(store.updates).toEqual([]);
      expect(store.creates).toEqual([]);
    },
  );

  test("creates a row when the one it found was removed before the write", async () => {
    const store: Store = setUpStore({ existingRow: true, rowsUpdated: 0 });

    await order();

    expect(store.updates).toHaveLength(1);
    expect(store.creates).toHaveLength(1);
    expect(store.creates[0]!.domain).toBe("dash.acme.com");
    expect(
      OneUptimeDate.isAfter(
        store.creates[0]!.expiresAt as Date,
        store.creates[0]!.issuedAt as Date,
      ),
    ).toBe(true);
  });
});
