/**
 * nginx's WriteCustomCertsToDisk job writes the certificates customers upload
 * themselves to the directory nginx serves every custom domain from.
 *
 * It used to read status page domains only, so "Upload Custom Certificate" on
 * a dashboard domain was stored and never served: nginx had no file for the
 * name and the TLS handshake failed. These pin that both kinds of custom
 * domain are written, and that neither kind can keep the other off disk.
 *
 * The job module from packages/Nginx runs for real; the cron, the file system
 * and the two domain tables are replaced.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import StatusPageDomainService from "../../../../Server/Services/StatusPageDomainService";
import DashboardDomainService from "../../../../Server/Services/DashboardDomainService";
import LocalFile from "../../../../Server/Utils/LocalFile";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from "../../../../Utils/CronTime";
import WriteCustomCertsToDiskJob from "../../../../../Nginx/Jobs/WriteCustomCertsToDisk";

type CronProps = {
  jobName: string;
  options: { schedule: string; runOnStartup: boolean };
  runFunction: () => Promise<void>;
};

const mockRegisteredCrons: Array<CronProps> = [];

// Hoisted above the imports; the job reads the cron only when init() runs.
jest.mock("../../../../Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CronProps): void => {
      mockRegisteredCrons.push(props);
    },
  };
});

const CERTS_DIRECTORY: string = "/etc/nginx/certs/StatusPageCerts";

type Row = {
  fullDomain?: string;
  customCertificate?: string;
  customCertificateKey?: string;
};

type FindAllByCall = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
};

type Harness = {
  files: Map<string, string>;
  statusPageQueries: Array<FindAllByCall>;
  dashboardQueries: Array<FindAllByCall>;
};

const NOT_NULL: { notNull: true } = { notNull: true };

function setUp(data: {
  statusPageRows: Array<Row> | Error;
  dashboardRows: Array<Row> | Error;
  failWritesFor?: Array<string>;
}): Harness {
  const harness: Harness = {
    files: new Map<string, string>(),
    statusPageQueries: [],
    dashboardQueries: [],
  };

  jest.spyOn(QueryHelper, "notNull").mockReturnValue(NOT_NULL as never);

  const answer: (
    rows: Array<Row> | Error,
    queries: Array<FindAllByCall>,
  ) => (call: FindAllByCall) => Promise<Array<Row>> = (
    rows: Array<Row> | Error,
    queries: Array<FindAllByCall>,
  ) => {
    return async (call: FindAllByCall): Promise<Array<Row>> => {
      queries.push(call);

      if (rows instanceof Error) {
        throw rows;
      }

      return rows;
    };
  };

  jest
    .spyOn(StatusPageDomainService, "findAllBy")
    .mockImplementation(
      answer(data.statusPageRows, harness.statusPageQueries) as never,
    );

  jest
    .spyOn(DashboardDomainService, "findAllBy")
    .mockImplementation(
      answer(data.dashboardRows, harness.dashboardQueries) as never,
    );

  jest.spyOn(LocalFile, "makeDirectory").mockResolvedValue(undefined as never);

  jest.spyOn(LocalFile, "write").mockImplementation((async (
    filePath: string,
    content: string,
  ): Promise<void> => {
    if (
      (data.failWritesFor || []).some((domain: string) => {
        return filePath.startsWith(`${CERTS_DIRECTORY}/${domain}.`);
      })
    ) {
      throw new Error(`disk full writing ${filePath}`);
    }

    harness.files.set(filePath, content);
  }) as never);

  return harness;
}

async function runJob(): Promise<void> {
  mockRegisteredCrons.length = 0;
  WriteCustomCertsToDiskJob.init();

  expect(mockRegisteredCrons).toHaveLength(1);
  await mockRegisteredCrons[0]!.runFunction();
}

function uploaded(domain: string): Row {
  return {
    fullDomain: domain,
    customCertificate: `-----BEGIN CERTIFICATE-----\n${domain}\n-----END CERTIFICATE-----`,
    customCertificateKey: `-----BEGIN PRIVATE KEY-----\n${domain}\n-----END PRIVATE KEY-----`,
  };
}

describe("nginx WriteCustomCertsToDisk", () => {
  beforeEach(() => {
    mockRegisteredCrons.length = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes a dashboard domain's uploaded certificate where nginx serves custom domains from", async () => {
    const harness: Harness = setUp({
      statusPageRows: [],
      dashboardRows: [uploaded("dash.acme.com")],
    });

    await runJob();

    expect(harness.files.get(`${CERTS_DIRECTORY}/dash.acme.com.crt`)).toBe(
      uploaded("dash.acme.com").customCertificate,
    );
    expect(harness.files.get(`${CERTS_DIRECTORY}/dash.acme.com.key`)).toBe(
      uploaded("dash.acme.com").customCertificateKey,
    );
  });

  test("still writes status page certificates, next to the dashboard ones", async () => {
    const harness: Harness = setUp({
      statusPageRows: [uploaded("status.acme.com")],
      dashboardRows: [uploaded("dash.acme.com")],
    });

    await runJob();

    expect([...harness.files.keys()].sort()).toEqual([
      `${CERTS_DIRECTORY}/dash.acme.com.crt`,
      `${CERTS_DIRECTORY}/dash.acme.com.key`,
      `${CERTS_DIRECTORY}/status.acme.com.crt`,
      `${CERTS_DIRECTORY}/status.acme.com.key`,
    ]);
  });

  test("asks each table only for domains with an uploaded certificate and key, as root", async () => {
    const harness: Harness = setUp({ statusPageRows: [], dashboardRows: [] });

    await runJob();

    for (const queries of [
      harness.statusPageQueries,
      harness.dashboardQueries,
    ]) {
      expect(queries).toHaveLength(1);
      expect(queries[0]!.query).toEqual({
        isCustomCertificate: true,
        customCertificate: NOT_NULL,
        customCertificateKey: NOT_NULL,
      });
      expect(queries[0]!.select).toEqual({
        fullDomain: true,
        customCertificate: true,
        customCertificateKey: true,
      });
      expect(queries[0]!.props).toEqual({ isRoot: true });
    }
  });

  test("names the files the way nginx looks them up: the domain, trimmed and lower-cased", async () => {
    const harness: Harness = setUp({
      statusPageRows: [],
      dashboardRows: [
        { ...uploaded("x"), fullDomain: "  Dash.Acme.COM " } as Row,
      ],
    });

    await runJob();

    expect([...harness.files.keys()].sort()).toEqual([
      `${CERTS_DIRECTORY}/dash.acme.com.crt`,
      `${CERTS_DIRECTORY}/dash.acme.com.key`,
    ]);
  });

  test("a failure reading dashboard domains does not keep status page certificates off disk", async () => {
    const harness: Harness = setUp({
      statusPageRows: [uploaded("status.acme.com")],
      dashboardRows: new Error("dashboard table unavailable"),
    });

    await expect(runJob()).resolves.toBeUndefined();

    expect(harness.files.has(`${CERTS_DIRECTORY}/status.acme.com.crt`)).toBe(
      true,
    );
  });

  test("a failure reading status page domains does not keep dashboard certificates off disk", async () => {
    const harness: Harness = setUp({
      statusPageRows: new Error("status page table unavailable"),
      dashboardRows: [uploaded("dash.acme.com")],
    });

    await expect(runJob()).resolves.toBeUndefined();

    expect(harness.files.has(`${CERTS_DIRECTORY}/dash.acme.com.crt`)).toBe(
      true,
    );
  });

  test("one certificate that cannot be written does not keep the rest off disk", async () => {
    const harness: Harness = setUp({
      statusPageRows: [],
      dashboardRows: [uploaded("broken.acme.com"), uploaded("dash.acme.com")],
      failWritesFor: ["broken.acme.com"],
    });

    await runJob();

    expect(harness.files.has(`${CERTS_DIRECTORY}/dash.acme.com.crt`)).toBe(
      true,
    );
    expect(harness.files.has(`${CERTS_DIRECTORY}/dash.acme.com.key`)).toBe(
      true,
    );
  });

  test("skips a row without a domain, a certificate or a key instead of writing a broken file", async () => {
    const harness: Harness = setUp({
      statusPageRows: [],
      dashboardRows: [
        { ...uploaded("no-domain.acme.com"), fullDomain: "" } as Row,
        { fullDomain: "no-cert.acme.com", customCertificateKey: "key" },
        { fullDomain: "no-key.acme.com", customCertificate: "cert" },
        uploaded("dash.acme.com"),
      ],
    });

    await runJob();

    expect([...harness.files.keys()].sort()).toEqual([
      `${CERTS_DIRECTORY}/dash.acme.com.crt`,
      `${CERTS_DIRECTORY}/dash.acme.com.key`,
    ]);
  });

  test("keeps its job name and runs on startup, then every 15 minutes outside development", () => {
    setUp({ statusPageRows: [], dashboardRows: [] });

    WriteCustomCertsToDiskJob.init();

    expect(mockRegisteredCrons).toHaveLength(1);
    expect(mockRegisteredCrons[0]!.jobName).toBe(
      "StatusPageCerts:WriteCustomCertsToDisk",
    );
    expect(mockRegisteredCrons[0]!.options.runOnStartup).toBe(true);
    expect([EVERY_FIFTEEN_MINUTE, EVERY_MINUTE]).toContain(
      mockRegisteredCrons[0]!.options.schedule,
    );
  });
});
