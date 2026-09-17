import StatusPagePrivateUserSession from "../../../Models/DatabaseModels/StatusPagePrivateUserSession";
import UserSession from "../../../Models/DatabaseModels/UserSession";
import DatabaseService from "../../../Server/Services/DatabaseService";
import Services from "../../../Server/Services/Index";
import { Service as PrivateSessionService } from "../../../Server/Services/StatusPagePrivateUserSessionService";
import { Service as UserSessionService } from "../../../Server/Services/UserSessionService";
import FindBy from "../../../Server/Types/Database/FindBy";
import logger from "../../../Server/Utils/Logger";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { EVERY_DAY } from "../../../Utils/CronTime";
import { getJestSpyOn } from "../../Spy";
import RunCron from "../../../../App/FeatureSet/Workers/Utils/Cron";
import "../../../../App/FeatureSet/Workers/Jobs/HardDelete/HardDeleteItemsInDatabase";
import fs from "fs";
import path from "path";
import { DeleteResult, FindOperator, Repository } from "typeorm";

jest.mock("../../../../App/FeatureSet/Workers/Utils/Cron", () => {
  return { __esModule: true, default: jest.fn() };
});

/*
 * Run the real worker and session services, with its registry narrowed to the
 * two session tables. A separate assertion checks the production registration.
 */
jest.mock("../../../Server/Services/Index", () => {
  return { __esModule: true, default: [] };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: false,
    IsDevelopment: false,
  };
});

// Small batches exercise the worker's loop without allocating 10,001 rows.
jest.mock("../../../Types/Database/LimitMax", () => {
  return { __esModule: true, default: 2 };
});

type Session = StatusPagePrivateUserSession | UserSession;
type CronHandler = () => Promise<void>;

interface SessionCase {
  name: string;
  service: DatabaseService<Session>;
}

interface RetentionQuery {
  refreshTokenExpiresAt: FindOperator<Date>;
  _id?: FindOperator<Array<string>>;
}

interface RepositoryBoundary {
  rows: Array<Session>;
  find: jest.SpyInstance;
  deleteRows: jest.Mock;
}

const NOW: Date = new Date("2026-09-17T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;
const CUTOFF: Date = new Date(NOW.getTime() - 30 * DAY_MS);
const JOB_NAME: string = "HardDelete:HardDeleteOlderItemsInDatabase";

const SESSION_CASES: Array<SessionCase> = [
  {
    name: "StatusPagePrivateUserSession",
    service: new PrivateSessionService(),
  },
  { name: "UserSession", service: new UserSessionService() },
];

function sessionRow(
  entry: SessionCase,
  expiresAt: Date,
  fields: Partial<Session> = {},
): Session {
  const row: Session = new entry.service.modelType();
  row.id = ObjectID.generate();
  row.refreshTokenExpiresAt = expiresAt;
  row.isRevoked = false;
  row.createdAt = new Date(NOW.getTime() - 365 * DAY_MS);
  row.lastActiveAt = row.createdAt;
  row.ipAddress = "192.0.2.10";
  row.userAgent = "Test browser";
  row.deviceName = "Test device";
  Object.assign(row, fields);
  return row;
}

function queryCutoff(query: RetentionQuery): Date {
  const operator: FindOperator<Date> = query.refreshTokenExpiresAt;
  expect(Object.keys(query).sort()).toEqual(
    query._id ? ["_id", "refreshTokenExpiresAt"] : ["refreshTokenExpiresAt"],
  );
  expect(operator.getSql!("expiry")).toMatch(/^\(expiry < :\w+\)$/);
  const cutoff: Date = Object.values(operator.objectLiteralParameters!)[0];
  expect(cutoff).toEqual(CUTOFF);
  return cutoff;
}

/*
 * Only the database reads and physical DELETE are replaced. The cron callback,
 * configured retention, permission scoping, batch selection, and hardDeleteBy
 * run unchanged, including the expiry predicate on the final DELETE.
 */
function installRepositoryBoundary(
  entry: SessionCase,
  initialRows: Array<Session>,
  beforeDelete?: (() => void) | undefined,
): RepositoryBoundary {
  const rows: Array<Session> = [...initialRows];
  const find: jest.SpyInstance = getJestSpyOn(
    entry.service,
    "_findBy",
  ).mockImplementation(
    async (
      request: FindBy<Session>,
      includeDeleted: boolean,
    ): Promise<Array<Session>> => {
      expect(includeDeleted).toBe(true);
      expect(request.props.isRoot).toBe(true);
      expect(request.limit).toBe(LIMIT_MAX);
      expect(request.skip).toBe(0);
      const cutoff: Date = queryCutoff(
        request.query as unknown as RetentionQuery,
      );
      return rows
        .filter((row: Session): boolean => {
          return Boolean(
            row.refreshTokenExpiresAt && row.refreshTokenExpiresAt < cutoff,
          );
        })
        .slice(0, LIMIT_MAX);
    },
  );
  const deleteRows: jest.Mock = jest.fn(
    async (query: RetentionQuery): Promise<DeleteResult> => {
      beforeDelete?.();
      const cutoff: Date = queryCutoff(query);
      expect(query._id?.getSql!("id")).toMatch(/^\(id IN \(:\.\.\.\w+\)\)$/);
      const ids: Array<string> = Object.values(
        query._id!.objectLiteralParameters!,
      )[0];
      let affected: number = 0;
      for (let index: number = rows.length - 1; index >= 0; index--) {
        const row: Session = rows[index]!;
        if (
          ids.includes(row.id!.toString()) &&
          row.refreshTokenExpiresAt &&
          row.refreshTokenExpiresAt < cutoff
        ) {
          rows.splice(index, 1);
          affected++;
        }
      }
      return { affected, raw: [] };
    },
  );
  getJestSpyOn(entry.service, "getRepository").mockReturnValue({
    delete: deleteRows,
  } as unknown as Repository<Session>);
  return { rows, find, deleteRows };
}

function jobRegistration(): [
  string,
  { schedule: string; runOnStartup: boolean },
  CronHandler,
] {
  const registration: Array<unknown> | undefined = (
    RunCron as jest.Mock
  ).mock.calls.find((call: Array<unknown>): boolean => {
    return call[0] === JOB_NAME;
  });
  expect(registration).toBeDefined();
  return registration as [
    string,
    { schedule: string; runOnStartup: boolean },
    CronHandler,
  ];
}

describe("session personal data retention", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    Services.splice(0, Services.length);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("runs daily without requiring billing or running immediately at startup", () => {
    expect(jobRegistration()[1]).toEqual({
      schedule: EVERY_DAY,
      runOnStartup: false,
    });
  });

  test.each(SESSION_CASES)(
    "$name is registered and retains 30 days after credential expiry",
    (entry: SessionCase) => {
      expect(entry.service.hardDeleteItemByColumnName).toBe(
        "refreshTokenExpiresAt",
      );
      expect(entry.service.hardDeleteItemsOlderThanDays).toBe(30);
      const registry: string = fs.readFileSync(
        path.resolve(__dirname, "../../../Server/Services/Index.ts"),
        "utf8",
      );
      expect(registry).toContain(
        `import ${entry.name}Service from "./${entry.name}Service";`,
      );
      expect(registry).toMatch(new RegExp(`^  ${entry.name}Service,$`, "m"));
      const workers: string = fs.readFileSync(
        path.resolve(__dirname, "../../../../App/FeatureSet/Workers/Index.ts"),
        "utf8",
      );
      expect(workers).toContain(
        'import "./Jobs/HardDelete/HardDeleteItemsInDatabase";',
      );
    },
  );

  test.each(SESSION_CASES)(
    "$name physically deletes expired, revoked, and abandoned code sessions across batches",
    async (entry: SessionCase) => {
      const expired: Session = sessionRow(
        entry,
        new Date(CUTOFF.getTime() - 1),
      );
      const revoked: Session = sessionRow(
        entry,
        new Date(CUTOFF.getTime() - DAY_MS),
        { isRevoked: true, revokedAt: new Date(NOW.getTime() - 60 * DAY_MS) },
      );
      const abandonedCode: Session = sessionRow(
        entry,
        new Date(CUTOFF.getTime() - 5 * 60 * 1000),
        { additionalInfo: { oneuptimeStatusPageSessionPurpose: "login-code" } },
      );
      const softDeleted: Session = sessionRow(
        entry,
        new Date(CUTOFF.getTime() - DAY_MS),
        { deletedAt: new Date(NOW.getTime() - DAY_MS) },
      );
      const recentExpired: Session = sessionRow(
        entry,
        new Date(NOW.getTime() - DAY_MS),
      );
      const boundary: Session = sessionRow(entry, CUTOFF);
      const renewed: Session = sessionRow(
        entry,
        new Date(NOW.getTime() + 30 * DAY_MS),
      );
      const recentlyRevoked: Session = sessionRow(
        entry,
        new Date(NOW.getTime() + DAY_MS),
        { isRevoked: true, revokedAt: NOW },
      );
      const retained: Array<Session> = [
        recentExpired,
        boundary,
        renewed,
        recentlyRevoked,
      ];
      const database: RepositoryBoundary = installRepositoryBoundary(entry, [
        expired,
        revoked,
        abandonedCode,
        softDeleted,
        ...retained,
      ]);
      Services.push(entry.service);

      await jobRegistration()[2]();

      expect(database.rows).toEqual(retained);
      expect(database.deleteRows).toHaveBeenCalledTimes(2);
      expect(database.find).toHaveBeenCalledTimes(3);
      expect(renewed.ipAddress).toBe("192.0.2.10");
    },
  );

  test.each(SESSION_CASES)(
    "$name keeps the expiry condition on the physical delete",
    async (entry: SessionCase) => {
      const row: Session = sessionRow(entry, new Date(CUTOFF.getTime() - 1));
      const database: RepositoryBoundary = installRepositoryBoundary(
        entry,
        [row],
        (): void => {
          row.refreshTokenExpiresAt = new Date(NOW.getTime() + 30 * DAY_MS);
        },
      );
      Services.push(entry.service);

      await jobRegistration()[2]();

      expect(database.rows).toEqual([row]);
      expect(database.deleteRows).toHaveBeenCalledTimes(1);
    },
  );

  test("continues purging the other session table if one table fails", async () => {
    const privateSessions: SessionCase = SESSION_CASES[0]!;
    const userSessions: SessionCase = SESSION_CASES[1]!;
    const failure: Error = new Error("Database unavailable");
    getJestSpyOn(privateSessions.service, "hardDeleteBy").mockRejectedValue(
      failure,
    );
    const log: jest.SpyInstance = getJestSpyOn(
      logger,
      "error",
    ).mockImplementation(() => {});
    const database: RepositoryBoundary = installRepositoryBoundary(
      userSessions,
      [sessionRow(userSessions, new Date(CUTOFF.getTime() - 1))],
    );
    Services.push(privateSessions.service, userSessions.service);

    await jobRegistration()[2]();

    expect(log).toHaveBeenCalledWith(failure);
    expect(database.rows).toEqual([]);
  });
});
