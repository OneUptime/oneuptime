/**
 * A LET'S ENCRYPT CERTIFICATE'S KEY IS STORED ENCRYPTED, AND NGINX STILL
 * SERVES IT.
 *
 * AcmeCertificate.certificateKey is kept encrypted at rest. These hold the
 * whole way a key takes, through the real services and the real nginx
 * jobs, with only the table, the certificate authority, the cron, Redis
 * and the disk replaced:
 *
 *   1. ordering a domain's first certificate stores the key its CSR was
 *      made with encrypted, never as it is;
 *   2. renewing it stores the new key encrypted too;
 *   3. nginx's AcmeWriteCertificates job writes each stored key to disk as
 *      the key it is, so every custom domain is served as before - the key
 *      of an order, of a renewal, and a key stored before the encryption
 *      that the data migration has not reached yet;
 *   4. WriteServerCertToDisk writes the server's own host key the same way,
 *      and writes nothing (no nginx reload) while the disk holds the key the
 *      table holds, encrypted or not;
 *   5. a key that reads back empty - encrypted under another
 *      ENCRYPTION_SECRET - is not written over the files that still serve
 *      its domain, and the other domains are written as ever;
 *   6. no log line on the way carries a key, and neither does the error an
 *      order that failed is refused with.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AcmeCertificate from "../../../../Models/DatabaseModels/AcmeCertificate";
import AcmeCertificateService from "../../../../Server/Services/AcmeCertificateService";
import DashboardDomainService from "../../../../Server/Services/DashboardDomainService";
import FormDomainService from "../../../../Server/Services/FormDomainService";
import StatusPageDomainService from "../../../../Server/Services/StatusPageDomainService";
import { CertificateOrderReason } from "../../../../Server/Utils/Greenlock/CertificateOrderBudget";
import { CertificateOrderOutcome } from "../../../../Server/Utils/Greenlock/CertificateOrderOutcome";
import GreenlockUtil from "../../../../Server/Utils/Greenlock/Greenlock";
import Encryption from "../../../../Server/Utils/Encryption";
import LocalFile from "../../../../Server/Utils/LocalFile";
import logger from "../../../../Server/Utils/Logger";
import AcmeWriteCertificatesJob from "../../../../../Nginx/Jobs/AcmeWriteCertificates";
import WriteServerCertToDiskJob from "../../../../../Nginx/Jobs/WriteServerCertToDisk";
import NginxConfigurator from "../../../../../Nginx/Utils/NginxConfigurator";
import { useInMemoryRedis } from "./InMemoryRedis";

type CronProps = {
  jobName: string;
  options: { schedule: string; runOnStartup: boolean };
  runFunction: () => Promise<void>;
};

const mockRegisteredCrons: Array<CronProps> = [];

// What the certificate authority hands back for the next order.
const mockOrder: {
  key: string;
  certificate: string;
  issuedAt: Date;
  expiresAt: Date;
} = {
  key: "",
  certificate: "",
  issuedAt: new Date("2026-10-01T00:00:00.000Z"),
  expiresAt: new Date("2026-12-30T00:00:00.000Z"),
};

// Hoisted above the imports; nothing here is read until a test runs.
jest.mock("../../../../Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CronProps): void => {
      mockRegisteredCrons.push(props);
    },
  };
});

jest.mock("acme-client", () => {
  return {
    __esModule: true,
    default: {
      Client: class {
        public async auto(): Promise<string> {
          return mockOrder.certificate;
        }
      },
      // Its own axios instance, which Greenlock routes (#10442).
      axios: {
        interceptors: {
          request: {
            use: (): number => {
              return 0;
            },
          },
        },
      },
      directory: {
        letsencrypt: {
          production: "https://acme.example.com/directory",
        },
      },
      crypto: {
        // As acme-client hands them: the key and the CSR, as Buffers.
        createCsr: async (): Promise<Array<Buffer>> => {
          return [Buffer.from(mockOrder.key), Buffer.from("csr")];
        },
        readCertificateInfo: (): { notBefore: Date; notAfter: Date } => {
          return {
            notBefore: mockOrder.issuedAt,
            notAfter: mockOrder.expiresAt,
          };
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
    ProvisionSsl: true,
    Host: "oneuptime.acme.com",
  };
});

jest.mock("../../../../../Nginx/Utils/NginxConfigurator", () => {
  return {
    __esModule: true,
    default: {
      ensurePrimarySslConfigured: jest.fn(async (): Promise<void> => {}),
    },
  };
});

const CUSTOM_DOMAIN_CERTS: string = "/etc/nginx/certs/StatusPageCerts";
const SERVER_CERTS: string = "/etc/nginx/certs/ServerCerts";

function keyFor(name: string): string {
  return `-----BEGIN PRIVATE KEY-----\nMIIEv-${name}-private-key-body\n-----END PRIVATE KEY-----\n`;
}

function certificateFor(name: string): string {
  return `-----BEGIN CERTIFICATE-----\nMIIF-${name}-certificate-body\n-----END CERTIFICATE-----\n`;
}

type StoredRow = Record<string, unknown>;

/*
 * The AcmeCertificate table: what the service stores, as Postgres would
 * hold it. find() answers a query's plain values as WHERE does; save() and
 * update() write what they are handed, encrypted columns as the service
 * encrypted them.
 */
interface Table {
  rows: Array<StoredRow>;
}

function useTable(rows: Array<StoredRow>): Table {
  const table: Table = { rows: rows };
  let nextId: number = 1;

  const matches: (row: StoredRow, where: unknown) => boolean = (
    row: StoredRow,
    where: unknown,
  ): boolean => {
    for (const [column, value] of Object.entries(
      (where as Record<string, unknown>) || {},
    )) {
      if (
        (typeof value === "string" || typeof value === "number") &&
        row[column] !== value
      ) {
        return false;
      }
    }

    return true;
  };

  jest.spyOn(AcmeCertificateService, "getRepository").mockReturnValue({
    metadata: { tableName: "AcmeCertificate" },
    find: async (options: { where?: unknown }): Promise<unknown> => {
      return table.rows
        .filter((row: StoredRow): boolean => {
          return matches(row, options.where);
        })
        .map((row: StoredRow): AcmeCertificate => {
          return Object.assign(new AcmeCertificate(), { ...row });
        });
    },
    save: async (entity: StoredRow): Promise<unknown> => {
      const stored: StoredRow = {};

      for (const [column, value] of Object.entries(entity)) {
        if (value !== undefined && typeof value !== "function") {
          stored[column] = value;
        }
      }

      stored["_id"] =
        stored["_id"] || `00000000-0000-4000-8000-00000000000${nextId++}`;
      table.rows.push(stored);

      return Object.assign(entity, { _id: stored["_id"] });
    },
    update: async (
      criteria: StoredRow,
      values: StoredRow,
    ): Promise<unknown> => {
      const row: StoredRow | undefined = table.rows.find(
        (candidate: StoredRow): boolean => {
          return candidate["_id"] === criteria["_id"];
        },
      );

      for (const [column, value] of Object.entries(values)) {
        if (row && value !== undefined && typeof value !== "function") {
          row[column] = value;
        }
      }

      return { affected: row ? 1 : 0, raw: [], generatedMaps: [] };
    },
  } as never);

  jest
    .spyOn(AcmeCertificateService, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AcmeCertificateService, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);

  return table;
}

// The disk nginx serves from.
function useDisk(files?: Map<string, string>): Map<string, string> {
  const disk: Map<string, string> = files || new Map<string, string>();

  jest.spyOn(LocalFile, "makeDirectory").mockResolvedValue(undefined as never);
  jest.spyOn(LocalFile, "write").mockImplementation((async (
    filePath: string,
    content: string,
  ): Promise<void> => {
    disk.set(filePath, content);
  }) as never);
  jest.spyOn(LocalFile, "doesFileExist").mockImplementation((async (
    filePath: string,
  ): Promise<boolean> => {
    return disk.has(filePath);
  }) as never);
  jest.spyOn(LocalFile, "read").mockImplementation((async (
    filePath: string,
  ): Promise<string> => {
    return disk.get(filePath) || "";
  }) as never);

  return disk;
}

// No custom domain serves a certificate its owner uploaded.
function noUploadedCertificates(): void {
  for (const service of [
    StatusPageDomainService,
    DashboardDomainService,
    FormDomainService,
  ]) {
    jest.spyOn(service, "findAllBy").mockResolvedValue([] as never);
  }
}

// Every line logged, at any level, as one text.
function useLogs(): () => string {
  const lines: Array<unknown> = [];

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation(((
      ...args: Array<unknown>
    ): void => {
      lines.push(args);
    }) as never);
  }

  return (): string => {
    return JSON.stringify(lines, (_key: string, value: unknown): unknown => {
      return value instanceof Error
        ? { ...value, message: value.message, stack: value.stack }
        : value;
    });
  };
}

async function order(domain: string, key: string): Promise<void> {
  mockOrder.key = key;
  mockOrder.certificate = certificateFor(domain);

  const outcome: CertificateOrderOutcome = await GreenlockUtil.orderCert({
    domain: domain,
    reason: CertificateOrderReason.FirstCertificate,
    validateCname: async (): Promise<boolean> => {
      return true;
    },
  });

  expect(outcome).toBe(CertificateOrderOutcome.Ordered);
}

async function runCron(init: () => void, jobName: string): Promise<void> {
  mockRegisteredCrons.length = 0;
  init();

  const cron: CronProps | undefined = mockRegisteredCrons.find(
    (registered: CronProps): boolean => {
      return registered.jobName === jobName;
    },
  );

  expect(cron).toBeDefined();
  await cron!.runFunction();
}

async function runAcmeWriteCertificates(): Promise<void> {
  await runCron(() => {
    AcmeWriteCertificatesJob.init();
  }, "StatusPageCerts:WriteAcmeCertsToDisk");
}

async function runWriteServerCertToDisk(): Promise<void> {
  await runCron(() => {
    WriteServerCertToDiskJob.init();
  }, "CoreSSL:WritePrimaryHostCertificateToDisk");
}

function storedKeyOf(table: Table, domain: string): string {
  const row: StoredRow | undefined = table.rows.find(
    (candidate: StoredRow): boolean => {
      return candidate["domain"] === domain;
    },
  );

  expect(row).toBeDefined();

  return row!["certificateKey"] as string;
}

describe("a Let's Encrypt certificate's key, at rest and on disk", () => {
  beforeEach(() => {
    mockRegisteredCrons.length = 0;
    // The name's order lock and the account's order budget.
    useInMemoryRedis();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an order stores the key encrypted, never as it is", async () => {
    const logged: () => string = useLogs();
    const table: Table = useTable([]);
    const key: string = keyFor("status.acme.com");

    await order("status.acme.com", key);

    expect(table.rows).toHaveLength(1);

    const stored: string = storedKeyOf(table, "status.acme.com");

    expect(stored).not.toBe(key);
    expect(stored).not.toContain("private-key-body");
    expect(Encryption.looksEncrypted(stored)).toBe(true);
    expect(await Encryption.decrypt(stored)).toBe(key);
    // The certificate itself is public, and stays as it is.
    expect(table.rows[0]!["certificate"]).toBe(
      certificateFor("status.acme.com"),
    );

    expect(logged()).not.toContain("private-key-body");
  });

  test("a renewal stores the new key encrypted too", async () => {
    const logged: () => string = useLogs();
    const table: Table = useTable([]);

    await order("status.acme.com", keyFor("first"));
    await order("status.acme.com", keyFor("renewed"));

    // Renewed in place: one row, holding the new key.
    expect(table.rows).toHaveLength(1);

    const stored: string = storedKeyOf(table, "status.acme.com");

    expect(Encryption.looksEncrypted(stored)).toBe(true);
    expect(await Encryption.decrypt(stored)).toBe(keyFor("renewed"));

    expect(logged()).not.toContain("private-key-body");
  });

  test("nginx writes every stored key to disk as the key it is, encrypted or not migrated yet", async () => {
    const logged: () => string = useLogs();
    const table: Table = useTable([
      // Stored before the encryption; the migration has not reached it.
      {
        _id: "00000000-0000-4000-8000-0000000000a1",
        domain: "legacy.acme.com",
        certificate: certificateFor("legacy.acme.com"),
        certificateKey: keyFor("legacy.acme.com"),
        issuedAt: mockOrder.issuedAt,
        expiresAt: mockOrder.expiresAt,
      },
    ]);
    const disk: Map<string, string> = useDisk();
    noUploadedCertificates();

    await order("status.acme.com", keyFor("status.acme.com"));
    await order("dash.acme.com", keyFor("dash.acme.com"));

    await runAcmeWriteCertificates();

    for (const domain of [
      "legacy.acme.com",
      "status.acme.com",
      "dash.acme.com",
    ]) {
      expect(disk.get(`${CUSTOM_DOMAIN_CERTS}/${domain}.key`)).toBe(
        keyFor(domain),
      );
      expect(disk.get(`${CUSTOM_DOMAIN_CERTS}/${domain}.crt`)).toBe(
        certificateFor(domain),
      );
    }

    // What the table holds is still encrypted: the read decrypts a copy.
    expect(
      Encryption.looksEncrypted(storedKeyOf(table, "status.acme.com")),
    ).toBe(true);

    expect(logged()).not.toContain("private-key-body");
  });

  test("nginx serves the renewed key after a renewal", async () => {
    useLogs();
    useTable([]);
    const disk: Map<string, string> = useDisk();
    noUploadedCertificates();

    await order("status.acme.com", keyFor("first"));
    await runAcmeWriteCertificates();

    expect(disk.get(`${CUSTOM_DOMAIN_CERTS}/status.acme.com.key`)).toBe(
      keyFor("first"),
    );

    await order("status.acme.com", keyFor("renewed"));
    await runAcmeWriteCertificates();

    expect(disk.get(`${CUSTOM_DOMAIN_CERTS}/status.acme.com.key`)).toBe(
      keyFor("renewed"),
    );
  });

  test("a key the data migration encrypts in place is served as the key nginx served before", async () => {
    useLogs();
    const legacyKey: string = keyFor("legacy.acme.com");
    const table: Table = useTable([
      {
        _id: "00000000-0000-4000-8000-0000000000a1",
        domain: "legacy.acme.com",
        certificate: certificateFor("legacy.acme.com"),
        certificateKey: legacyKey,
        issuedAt: mockOrder.issuedAt,
        expiresAt: mockOrder.expiresAt,
      },
    ]);
    const disk: Map<string, string> = useDisk();
    noUploadedCertificates();

    await runAcmeWriteCertificates();

    const servedBefore: string | undefined = disk.get(
      `${CUSTOM_DOMAIN_CERTS}/legacy.acme.com.key`,
    );

    // What EncryptLetsEncryptKeys writes in raw SQL.
    table.rows[0]!["certificateKey"] = await Encryption.encrypt(legacyKey);

    await runAcmeWriteCertificates();

    expect(servedBefore).toBe(legacyKey);
    expect(disk.get(`${CUSTOM_DOMAIN_CERTS}/legacy.acme.com.key`)).toBe(
      servedBefore,
    );
  });

  test("the server's own host key is written to disk as the key it is", async () => {
    const logged: () => string = useLogs();
    useTable([]);
    const disk: Map<string, string> = useDisk();

    await order("oneuptime.acme.com", keyFor("oneuptime.acme.com"));
    await runWriteServerCertToDisk();

    expect(disk.get(`${SERVER_CERTS}/oneuptime.acme.com.key`)).toBe(
      keyFor("oneuptime.acme.com"),
    );
    expect(disk.get(`${SERVER_CERTS}/oneuptime.acme.com.crt`)).toBe(
      certificateFor("oneuptime.acme.com"),
    );
    expect(NginxConfigurator.ensurePrimarySslConfigured).toHaveBeenCalledWith({
      hostname: "oneuptime.acme.com",
      forceReload: true,
    });

    expect(logged()).not.toContain("private-key-body");
  });

  test("the host key on disk is not rewritten, nor nginx reloaded, while the table holds the same key - encrypted by the migration or not", async () => {
    useLogs();
    const hostKey: string = keyFor("oneuptime.acme.com");
    const table: Table = useTable([
      {
        _id: "00000000-0000-4000-8000-0000000000b1",
        domain: "oneuptime.acme.com",
        certificate: certificateFor("oneuptime.acme.com"),
        certificateKey: hostKey,
        issuedAt: mockOrder.issuedAt,
        expiresAt: mockOrder.expiresAt,
      },
    ]);
    const disk: Map<string, string> = useDisk(
      new Map<string, string>([
        [
          `${SERVER_CERTS}/oneuptime.acme.com.crt`,
          certificateFor("oneuptime.acme.com"),
        ],
        [`${SERVER_CERTS}/oneuptime.acme.com.key`, hostKey],
      ]),
    );

    // Not migrated yet, then migrated: the same key either way.
    for (const stored of [hostKey, await Encryption.encrypt(hostKey)]) {
      table.rows[0]!["certificateKey"] = stored;
      (LocalFile.write as unknown as jest.Mock).mockClear();
      (
        NginxConfigurator.ensurePrimarySslConfigured as unknown as jest.Mock
      ).mockClear();

      await runWriteServerCertToDisk();

      expect(LocalFile.write).not.toHaveBeenCalled();
      expect(NginxConfigurator.ensurePrimarySslConfigured).toHaveBeenCalledWith(
        {
          hostname: "oneuptime.acme.com",
          forceReload: false,
        },
      );
    }

    expect(disk.get(`${SERVER_CERTS}/oneuptime.acme.com.key`)).toBe(hostKey);
  });

  test("a key that reads back empty is not written over the files that still serve its domain", async () => {
    const logged: () => string = useLogs();
    const unreadable: string = await Encryption.encrypt(
      keyFor("unreadable.acme.com"),
    );
    const decrypt: (text: string) => Promise<string> =
      Encryption.decrypt.bind(Encryption);

    // As a key encrypted under another ENCRYPTION_SECRET reads: empty.
    jest
      .spyOn(Encryption, "decrypt")
      .mockImplementation(async (text: string): Promise<string> => {
        return text === unreadable ? "" : await decrypt(text);
      });

    useTable([
      {
        _id: "00000000-0000-4000-8000-0000000000c1",
        domain: "unreadable.acme.com",
        certificate: certificateFor("unreadable.acme.com"),
        certificateKey: unreadable,
        issuedAt: mockOrder.issuedAt,
        expiresAt: mockOrder.expiresAt,
      },
      {
        _id: "00000000-0000-4000-8000-0000000000c2",
        domain: "status.acme.com",
        certificate: certificateFor("status.acme.com"),
        certificateKey: await Encryption.encrypt(keyFor("status.acme.com")),
        issuedAt: mockOrder.issuedAt,
        expiresAt: mockOrder.expiresAt,
      },
    ]);

    const disk: Map<string, string> = useDisk(
      new Map<string, string>([
        [
          `${CUSTOM_DOMAIN_CERTS}/unreadable.acme.com.crt`,
          certificateFor("unreadable.acme.com"),
        ],
        [
          `${CUSTOM_DOMAIN_CERTS}/unreadable.acme.com.key`,
          keyFor("unreadable.acme.com"),
        ],
      ]),
    );
    noUploadedCertificates();

    await runAcmeWriteCertificates();

    // The domain is still served with the last key written for it ...
    expect(disk.get(`${CUSTOM_DOMAIN_CERTS}/unreadable.acme.com.key`)).toBe(
      keyFor("unreadable.acme.com"),
    );
    expect(LocalFile.write).not.toHaveBeenCalledWith(
      `${CUSTOM_DOMAIN_CERTS}/unreadable.acme.com.key`,
      expect.anything(),
    );
    expect(LocalFile.write).not.toHaveBeenCalledWith(
      `${CUSTOM_DOMAIN_CERTS}/unreadable.acme.com.crt`,
      expect.anything(),
    );

    // ... the others are written as ever, and the log says which, not what.
    expect(disk.get(`${CUSTOM_DOMAIN_CERTS}/status.acme.com.key`)).toBe(
      keyFor("status.acme.com"),
    );
    expect(logged()).toContain("unreadable.acme.com");
    expect(logged()).toContain("ENCRYPTION_SECRET");
    expect(logged()).not.toContain("private-key-body");
  });

  test("an order that fails is refused without the key, and logs none", async () => {
    const logged: () => string = useLogs();
    const table: Table = useTable([]);

    jest
      .spyOn(AcmeCertificateService, "create")
      .mockRejectedValue(new Error("the table is not there") as never);

    mockOrder.key = keyFor("broken.acme.com");
    mockOrder.certificate = certificateFor("broken.acme.com");

    let refusal: Error | null = null;

    try {
      await GreenlockUtil.orderCert({
        domain: "broken.acme.com",
        reason: CertificateOrderReason.FirstCertificate,
        validateCname: async (): Promise<boolean> => {
          return true;
        },
      });
    } catch (err) {
      refusal = err as Error;
    }

    expect(refusal).not.toBeNull();
    expect(refusal!.message).not.toContain("private-key-body");
    expect(JSON.stringify(refusal)).not.toContain("private-key-body");
    expect(table.rows).toHaveLength(0);
    expect(logged()).not.toContain("private-key-body");
  });
});
