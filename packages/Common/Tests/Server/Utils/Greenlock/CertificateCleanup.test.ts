/**
 * The cleanup of certificates nobody owns.
 *
 * Each owner's renewal run renews and removes only its own certificates, so
 * a certificate whose owner is gone - its domain row removed by a cascading
 * delete of the project, status page, dashboard or parent domain, which
 * skips the hook that removes the certificate - is touched by no renewal run
 * at all. GreenlockUtil.removeExpiredCertificatesNobodyOwns deletes those,
 * and only those: certificates that expired more than
 * REMOVE_UNOWNED_AFTER_EXPIRY_IN_DAYS ago and that no owner claims.
 *
 * The certificate table and the owners' lookups are in memory; the
 * selection, ownership and deletion logic run for real.
 */

import GreenlockUtil from "../../../../Server/Utils/Greenlock/Greenlock";
import CertificateOwners, {
  CertificateOwner,
} from "../../../../Server/Utils/Greenlock/CertificateOwners";
import AcmeCertificateService from "../../../../Server/Services/AcmeCertificateService";
import StatusPageDomainService from "../../../../Server/Services/StatusPageDomainService";
import DashboardDomainService from "../../../../Server/Services/DashboardDomainService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import AcmeCertificate from "../../../../Models/DatabaseModels/AcmeCertificate";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

type Row = {
  id: ObjectID;
  domain?: string;
  expiresAt: Date;
};

type Table = {
  rows: Array<Row>;
  deletedIds: Array<string>;
};

function expiredDaysAgo(domain: string | undefined, days: number): Row {
  const row: Row = {
    id: ObjectID.generate(),
    expiresAt: OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -days,
    ),
  };

  if (domain !== undefined) {
    row.domain = domain;
  }

  return row;
}

function expiresInDays(domain: string, days: number): Row {
  return expiredDaysAgo(domain, -days);
}

const GRACE: number = GreenlockUtil.REMOVE_UNOWNED_AFTER_EXPIRY_IN_DAYS;

/*
 * The certificate table, answering the cleanup's "expired before X" query
 * page by page, and recording what is deleted.
 */
function setUpTable(rows: Array<Row>): Table {
  const table: Table = { rows: [...rows], deletedIds: [] };

  jest.spyOn(QueryHelper, "lessThan").mockImplementation(((value: Date) => {
    return { lessThan: value };
  }) as never);

  jest.spyOn(QueryHelper, "any").mockImplementation(((
    values: Array<string>,
  ) => {
    return { inList: values.map(String) };
  }) as never);

  jest
    .spyOn(AcmeCertificateService, "findBy")
    .mockImplementation((async (call: {
      query: { expiresAt: { lessThan: Date } };
      skip?: number;
      limit?: number;
    }) => {
      const before: Date = call.query.expiresAt.lessThan;
      const skip: number = Number(call.skip || 0);
      const limit: number = Number(call.limit || table.rows.length);

      return table.rows
        .filter((row: Row) => {
          return row.expiresAt.getTime() < before.getTime();
        })
        .sort((a: Row, b: Row) => {
          return a.expiresAt.getTime() - b.expiresAt.getTime();
        })
        .slice(skip, skip + limit)
        .map((row: Row) => {
          const certificate: AcmeCertificate = new AcmeCertificate();
          certificate.id = row.id;
          if (row.domain !== undefined) {
            certificate.domain = row.domain;
          }
          certificate.expiresAt = row.expiresAt;
          return certificate;
        });
    }) as never);

  jest
    .spyOn(AcmeCertificateService, "deleteBy")
    .mockImplementation((async (deleteBy: {
      query: { _id: string };
    }): Promise<number> => {
      const index: number = table.rows.findIndex((row: Row) => {
        return row.id.toString() === deleteBy.query._id;
      });

      if (index === -1) {
        return 0;
      }

      table.rows.splice(index, 1);
      table.deletedIds.push(deleteBy.query._id);
      return 1;
    }) as never);

  return table;
}

function owner(name: string, claims: Array<string>): CertificateOwner {
  return {
    name: name,
    getOwnedDomains: async (domains: Array<string>) => {
      return domains.filter((domain: string) => {
        return claims.includes(domain);
      });
    },
  };
}

function idsOf(rows: Array<Row>): Array<string> {
  return rows
    .map((row: Row) => {
      return row.id.toString();
    })
    .sort();
}

describe("GreenlockUtil.removeExpiredCertificatesNobodyOwns", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("deletes a certificate that expired over a month ago and nobody claims, and nothing else", async () => {
    const abandoned: Row = expiredDaysAgo("gone.example.com", GRACE + 10);
    const statusPages: Row = expiredDaysAgo("status.acme.com", GRACE + 10);
    const dashboards: Row = expiredDaysAgo("dash.acme.com", GRACE + 10);
    const recentlyExpired: Row = expiredDaysAgo(
      "recent.example.com",
      GRACE - 5,
    );
    const fresh: Row = expiresInDays("fresh.example.com", 60);

    const table: Table = setUpTable([
      abandoned,
      statusPages,
      dashboards,
      recentlyExpired,
      fresh,
    ]);

    const removed: number =
      await GreenlockUtil.removeExpiredCertificatesNobodyOwns({
        owners: [
          owner("status page domains", ["status.acme.com"]),
          owner("dashboard domains", ["dash.acme.com"]),
        ],
      });

    expect(removed).toBe(1);
    expect(table.deletedIds).toEqual([abandoned.id.toString()]);
    expect(idsOf(table.rows)).toEqual(
      idsOf([statusPages, dashboards, recentlyExpired, fresh]),
    );
  });

  test("asks every owner about every expired certificate before deleting any", async () => {
    const asked: Array<string> = [];

    setUpTable([
      expiredDaysAgo("a.example.com", GRACE + 1),
      expiredDaysAgo("b.example.com", GRACE + 2),
    ]);

    const recordingOwner: (name: string) => CertificateOwner = (
      name: string,
    ): CertificateOwner => {
      return {
        name: name,
        getOwnedDomains: async (domains: Array<string>) => {
          asked.push(`${name}: ${[...domains].sort().join(",")}`);
          return [];
        },
      };
    };

    await GreenlockUtil.removeExpiredCertificatesNobodyOwns({
      owners: [recordingOwner("first"), recordingOwner("second")],
    });

    expect(asked).toEqual([
      "first: a.example.com,b.example.com",
      "second: a.example.com,b.example.com",
    ]);
  });

  test("when any owner cannot answer, nothing is deleted", async () => {
    const table: Table = setUpTable([
      expiredDaysAgo("gone.example.com", GRACE + 10),
    ]);

    await expect(
      GreenlockUtil.removeExpiredCertificatesNobodyOwns({
        owners: [
          owner("status page domains", []),
          {
            name: "dashboard domains",
            getOwnedDomains: async (): Promise<Array<string>> => {
              throw new Error("database unavailable");
            },
          },
        ],
      }),
    ).rejects.toThrow("database unavailable");

    expect(table.deletedIds).toEqual([]);
    expect(table.rows).toHaveLength(1);
  });

  test("deletes by id: a newer certificate for the same name is never touched", async () => {
    const old: Row = expiredDaysAgo("gone.example.com", GRACE + 10);
    const newer: Row = expiresInDays("gone.example.com", 80);

    const table: Table = setUpTable([old, newer]);

    await GreenlockUtil.removeExpiredCertificatesNobodyOwns({
      owners: [owner("status page domains", [])],
    });

    expect(table.deletedIds).toEqual([old.id.toString()]);
    expect(table.rows).toEqual([newer]);
  });

  test("deletes at most REMOVE_UNOWNED_MAX_PER_RUN in a run, the longest expired first", async () => {
    const max: number = GreenlockUtil.REMOVE_UNOWNED_MAX_PER_RUN;

    const rows: Array<Row> = Array.from(
      { length: max + 20 },
      (_value: unknown, index: number) => {
        return expiredDaysAgo(`gone${index}.example.com`, GRACE + 1 + index);
      },
    );

    const table: Table = setUpTable(rows);

    const removed: number =
      await GreenlockUtil.removeExpiredCertificatesNobodyOwns({
        owners: [owner("status page domains", [])],
      });

    expect(removed).toBe(max);

    // The 20 left are the ones that expired most recently.
    expect(idsOf(table.rows)).toEqual(idsOf(rows.slice(0, 20)));
  });

  test("with nothing expired long enough, no owner is asked and nothing is deleted", async () => {
    let asked: number = 0;

    const table: Table = setUpTable([
      expiredDaysAgo("recent.example.com", GRACE - 1),
      expiresInDays("fresh.example.com", 30),
    ]);

    const removed: number =
      await GreenlockUtil.removeExpiredCertificatesNobodyOwns({
        owners: [
          {
            name: "status page domains",
            getOwnedDomains: async (): Promise<Array<string>> => {
              asked++;
              return [];
            },
          },
        ],
      });

    expect(removed).toBe(0);
    expect(asked).toBe(0);
    expect(table.deletedIds).toEqual([]);
  });

  test("a row without a domain is left alone", async () => {
    const table: Table = setUpTable([expiredDaysAgo(undefined, GRACE + 10)]);

    await GreenlockUtil.removeExpiredCertificatesNobodyOwns({
      owners: [owner("status page domains", [])],
    });

    expect(table.deletedIds).toEqual([]);
  });
});

describe("CertificateOwners", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("names every kind of certificate owner: status pages, dashboards and the primary host", () => {
    expect(
      CertificateOwners.getAll().map((each: CertificateOwner) => {
        return each.name;
      }),
    ).toEqual(["status page domains", "dashboard domains", "primary host"]);
  });

  test("the status page and dashboard owners are those services' own lookups", async () => {
    const statusPageQueries: Array<Array<string>> = [];
    const dashboardQueries: Array<Array<string>> = [];

    jest
      .spyOn(StatusPageDomainService, "getOwnedDomains")
      .mockImplementation((async (domains: Array<string>) => {
        statusPageQueries.push(domains);
        return ["status.acme.com"];
      }) as never);
    jest
      .spyOn(DashboardDomainService, "getOwnedDomains")
      .mockImplementation((async (domains: Array<string>) => {
        dashboardQueries.push(domains);
        return ["dash.acme.com"];
      }) as never);

    const owners: Array<CertificateOwner> = CertificateOwners.getAll();
    const domains: Array<string> = ["status.acme.com", "dash.acme.com"];

    await expect(owners[0]!.getOwnedDomains(domains)).resolves.toEqual([
      "status.acme.com",
    ]);
    await expect(owners[1]!.getOwnedDomains(domains)).resolves.toEqual([
      "dash.acme.com",
    ]);
    expect(statusPageQueries).toEqual([domains]);
    expect(dashboardQueries).toEqual([domains]);
  });

  test("the primary host owner claims the installation's own host and nothing else", async () => {
    jest
      .spyOn(CertificateOwners, "getPrimaryHostname")
      .mockReturnValue("oneuptime.example.com");

    const primaryHost: CertificateOwner = CertificateOwners.getAll()[2]!;

    await expect(
      primaryHost.getOwnedDomains(["status.acme.com", "oneuptime.example.com"]),
    ).resolves.toEqual(["oneuptime.example.com"]);
  });

  test("with no HOST configured the primary host owner claims nothing", async () => {
    jest.spyOn(CertificateOwners, "getPrimaryHostname").mockReturnValue("");

    await expect(
      CertificateOwners.getAll()[2]!.getOwnedDomains([""]),
    ).resolves.toEqual([]);
  });

  test("the primary hostname is HOST without its port, lower-cased, as CoreSSL orders it", () => {
    expect(
      CertificateOwners.getPrimaryHostname(" OneUptime.Example.com:443 "),
    ).toBe("oneuptime.example.com");
    expect(CertificateOwners.getPrimaryHostname("localhost")).toBe("localhost");
    expect(CertificateOwners.getPrimaryHostname("")).toBe("");
  });

  /*
   * End to end with the real owner list: certificates whose domains still
   * belong to a status page, a dashboard or the primary host stay, however
   * long ago they expired; only the abandoned one goes.
   */
  test("with the real owners, only the certificate nobody owns is deleted", async () => {
    const statusPage: Row = expiredDaysAgo("status.acme.com", GRACE + 10);
    const dashboard: Row = expiredDaysAgo("dash.acme.com", GRACE + 10);
    const primaryHost: Row = expiredDaysAgo(
      "oneuptime.example.com",
      GRACE + 10,
    );
    const abandoned: Row = expiredDaysAgo("gone.example.com", GRACE + 10);

    const table: Table = setUpTable([
      statusPage,
      dashboard,
      primaryHost,
      abandoned,
    ]);

    jest
      .spyOn(CertificateOwners, "getPrimaryHostname")
      .mockReturnValue("oneuptime.example.com");

    const answerFrom: (
      owned: Array<string>,
    ) => (call: { query: { fullDomain: unknown } }) => Promise<unknown> = (
      owned: Array<string>,
    ) => {
      return async (call: { query: { fullDomain: unknown } }) => {
        const asked: Array<string> = (
          call.query.fullDomain as { inList: Array<string> }
        ).inList;

        return owned
          .filter((domain: string) => {
            return asked.includes(domain);
          })
          .map((domain: string) => {
            return { fullDomain: domain, isCustomCertificate: false };
          });
      };
    };

    jest
      .spyOn(StatusPageDomainService, "findBy")
      .mockImplementation(answerFrom(["status.acme.com"]) as never);
    jest
      .spyOn(DashboardDomainService, "findBy")
      .mockImplementation(answerFrom(["dash.acme.com"]) as never);

    await GreenlockUtil.removeExpiredCertificatesNobodyOwns({
      owners: CertificateOwners.getAll(),
    });

    expect(table.deletedIds).toEqual([abandoned.id.toString()]);
    expect(idsOf(table.rows)).toEqual(
      idsOf([statusPage, dashboard, primaryHost]),
    );
  });
});
