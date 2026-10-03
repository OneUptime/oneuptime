/**
 * nginx's AcmeWriteCertificates job writes every Let's Encrypt certificate
 * to the directory nginx serves custom domains from, one file per name.
 *
 * WriteCustomCertsToDisk writes the certificates customers upload into the
 * same files. A domain that switched from Let's Encrypt to an uploaded
 * certificate still has its old Let's Encrypt row, and if both jobs write
 * that name they overwrite each other every 15 minutes: the domain serves
 * whichever ran last. These pin that the uploaded certificate wins - the
 * Let's Encrypt writer leaves those names alone - for status page and
 * dashboard domains alike.
 *
 * The job module from packages/Nginx runs for real; the cron, the file
 * system and the tables are replaced.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AcmeCertificateService from "../../../../Server/Services/AcmeCertificateService";
import StatusPageDomainService from "../../../../Server/Services/StatusPageDomainService";
import DashboardDomainService from "../../../../Server/Services/DashboardDomainService";
import LocalFile from "../../../../Server/Utils/LocalFile";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import OneUptimeDate from "../../../../Types/Date";
import AcmeWriteCertificatesJob from "../../../../../Nginx/Jobs/AcmeWriteCertificates";

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

const NOT_NULL: { notNull: true } = { notNull: true };

type FindAllByCall = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
};

type Harness = {
  files: Map<string, string>;
  uploadQueries: Array<FindAllByCall>;
};

function letsEncrypt(
  domain: string,
  expiresInDays: number = 60,
): {
  domain: string;
  certificate: string;
  certificateKey: string;
  expiresAt: Date;
} {
  return {
    domain: domain,
    certificate: `lets-encrypt certificate for ${domain}`,
    certificateKey: `lets-encrypt key for ${domain}`,
    expiresAt: OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      expiresInDays,
    ),
  };
}

function setUp(data: {
  acmeDomains: Array<string>;
  statusPageUploads: Array<string> | Error;
  dashboardUploads: Array<string> | Error;
  // Domains whose Let's Encrypt certificate expired this many days ago.
  expired?: Record<string, number>;
}): Harness {
  const harness: Harness = {
    files: new Map<string, string>(),
    uploadQueries: [],
  };

  jest.spyOn(QueryHelper, "notNull").mockReturnValue(NOT_NULL as never);

  jest.spyOn(AcmeCertificateService, "findAllBy").mockResolvedValue(
    data.acmeDomains.map((domain: string) => {
      const expiredDaysAgo: number | undefined = data.expired?.[domain];

      return letsEncrypt(
        domain,
        expiredDaysAgo === undefined ? 60 : -expiredDaysAgo,
      );
    }) as never,
  );

  const answer: (
    uploads: Array<string> | Error,
  ) => (call: FindAllByCall) => Promise<Array<{ fullDomain: string }>> = (
    uploads: Array<string> | Error,
  ) => {
    return async (
      call: FindAllByCall,
    ): Promise<Array<{ fullDomain: string }>> => {
      harness.uploadQueries.push(call);

      if (uploads instanceof Error) {
        throw uploads;
      }

      return uploads.map((fullDomain: string) => {
        return { fullDomain: fullDomain };
      });
    };
  };

  jest
    .spyOn(StatusPageDomainService, "findAllBy")
    .mockImplementation(answer(data.statusPageUploads) as never);

  jest
    .spyOn(DashboardDomainService, "findAllBy")
    .mockImplementation(answer(data.dashboardUploads) as never);

  jest.spyOn(LocalFile, "makeDirectory").mockResolvedValue(undefined as never);

  jest.spyOn(LocalFile, "write").mockImplementation((async (
    filePath: string,
    content: string,
  ): Promise<void> => {
    harness.files.set(filePath, content);
  }) as never);

  return harness;
}

async function runJob(): Promise<void> {
  mockRegisteredCrons.length = 0;
  AcmeWriteCertificatesJob.init();

  expect(mockRegisteredCrons).toHaveLength(1);
  await mockRegisteredCrons[0]!.runFunction();
}

function writtenDomains(harness: Harness): Array<string> {
  return [
    ...new Set(
      [...harness.files.keys()].map((filePath: string) => {
        return filePath
          .slice(CERTS_DIRECTORY.length + 1)
          .replace(/\.(crt|key)$/, "");
      }),
    ),
  ].sort();
}

describe("nginx AcmeWriteCertificates", () => {
  beforeEach(() => {
    mockRegisteredCrons.length = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes every Let's Encrypt certificate when no domain has uploaded one", async () => {
    const harness: Harness = setUp({
      acmeDomains: ["status.acme.com", "dash.acme.com"],
      statusPageUploads: [],
      dashboardUploads: [],
    });

    await runJob();

    expect(writtenDomains(harness)).toEqual([
      "dash.acme.com",
      "status.acme.com",
    ]);
    expect(harness.files.get(`${CERTS_DIRECTORY}/dash.acme.com.crt`)).toBe(
      letsEncrypt("dash.acme.com").certificate,
    );
  });

  test("leaves alone a name whose status page or dashboard domain serves an uploaded certificate", async () => {
    const harness: Harness = setUp({
      acmeDomains: [
        "status.acme.com",
        "uploaded-status.acme.com",
        "dash.acme.com",
        "uploaded-dash.acme.com",
      ],
      statusPageUploads: ["uploaded-status.acme.com"],
      dashboardUploads: ["Uploaded-Dash.Acme.com "],
    });

    await runJob();

    expect(writtenDomains(harness)).toEqual([
      "dash.acme.com",
      "status.acme.com",
    ]);
  });

  test("asks both tables only for domains with an uploaded certificate and key, as root", async () => {
    const harness: Harness = setUp({
      acmeDomains: [],
      statusPageUploads: [],
      dashboardUploads: [],
    });

    await runJob();

    expect(harness.uploadQueries).toHaveLength(2);

    for (const query of harness.uploadQueries) {
      expect(query.query).toEqual({
        isCustomCertificate: true,
        customCertificate: NOT_NULL,
        customCertificateKey: NOT_NULL,
      });
      expect(query.select).toEqual({ fullDomain: true });
      expect(query.props).toEqual({ isRoot: true });
    }
  });

  /*
   * An expired certificate serves nobody, and the file already on disk is no
   * worse: for a domain switched back from an uploaded certificate it is the
   * uploaded one, which keeps serving until the renewal replaces this one.
   */
  test("never writes an expired certificate over the file on disk", async () => {
    const harness: Harness = setUp({
      acmeDomains: ["switched-back.acme.com", "dash.acme.com"],
      statusPageUploads: [],
      dashboardUploads: [],
      expired: { "switched-back.acme.com": 20 },
    });

    await runJob();

    expect(writtenDomains(harness)).toEqual(["dash.acme.com"]);
  });

  /*
   * Not knowing which names are uploaded must not leave every custom domain
   * without a certificate: the job writes everything, as it did before.
   */
  test("when the uploaded-certificate domains cannot be read, every Let's Encrypt certificate is still written", async () => {
    const harness: Harness = setUp({
      acmeDomains: ["status.acme.com", "dash.acme.com"],
      statusPageUploads: ["status.acme.com"],
      dashboardUploads: new Error("dashboard table unavailable"),
    });

    await expect(runJob()).resolves.toBeUndefined();

    expect(writtenDomains(harness)).toEqual([
      "dash.acme.com",
      "status.acme.com",
    ]);
  });
});
