import AddSensitiveFileServedToRecommendedRules, {
  SENSITIVE_FILE_SERVED_ROLLOUT_NAME,
} from "../../../FeatureSet/Workers/DataMigrations/AddSensitiveFileServedToRecommendedRules";
import Entities from "Common/Models/DatabaseModels/Index";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import DetectionRuleService from "Common/Server/Services/DetectionRuleService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import logger from "Common/Server/Utils/Logger";
import PositiveNumber from "Common/Types/PositiveNumber";
import SecuritySetup, {
  SecuritySetupStatus,
} from "Common/Server/Utils/SecurityEvent/SecuritySetup";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import {
  DetectionRuleLibraryEntry,
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
  SENSITIVE_FILE_SERVED_RULE_ID,
  getDetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import { getDetectionRuleLibraryResponseSteps } from "Common/Types/SecurityEvent/DetectionRuleLibraryResponseSteps";
import { getRulesAddedByOneUptime } from "Common/Utils/SecurityEvent/RecommendedDetectionRules";
import { DataSource } from "Common/node_modules/typeorm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * SENSITIVE FILE SERVED, ADDED ON UPGRADE TO THE PROJECTS THAT RUN EVERY
 * OTHER RECOMMENDED RULE, ON A MIGRATED POSTGRES (#11037).
 *
 * The real statements and the real service, on a copy of the migrated
 * DetectionRule table:
 *
 *   - the projects read are those with a rule, on, of another recommended
 *     rule - by its id, or by its name in any case - a page at a time;
 *   - a project that runs every other recommended rule, and has none of
 *     Sensitive file served, gets it: on, opening cases, with the library's
 *     response steps, created by nobody, and addedByOneUptimeAt set - which
 *     the Overview's read (SecuritySetup.getStatus) then names;
 *   - one that turned a recommended rule off, deleted one, or has the rule
 *     already - off, or renamed - is left exactly as it was;
 *   - a second run adds nothing, and two at once add it once.
 *
 * The project's lock is a lock in this process here: Semaphore needs Redis.
 *
 * Opt in with RUN_POSTGRES_SENSITIVE_FILE_SERVED_ROLLOUT_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. The DetectionRule
 * table's STRUCTURE is cloned into a unique schema (search_path holds only
 * that schema), dropped afterwards; every row is synthetic. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * SENSITIVE_FILE_SERVED_ROLLOUT_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from SENSITIVE_FILE_SERVED_ROLLOUT_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SENSITIVE_FILE_SERVED_ROLLOUT_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const SERVED: DetectionRuleLibraryEntry = getDetectionRuleLibraryEntry(
  SENSITIVE_FILE_SERVED_RULE_ID,
)!;

function projectId(index: number): string {
  return `11037000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

interface StoredRule {
  _id: string;
  projectId: string;
  name: string;
  sigmaRuleYaml: string;
  isEnabled: boolean;
  shouldCreateCase: boolean;
  shouldCreateAlert: boolean;
  createdByUserId: string | null;
  addedByOneUptimeAt: Date | null;
  version: number;
  updatedAt: Date;
}

describePostgres(
  "Sensitive file served for the projects that run every other recommended rule (Postgres)",
  () => {
    const schema: string = `sensitive_file_rollout_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;
    // The locks held in this process, by key.
    let held: Map<string, Promise<void>>;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SENSITIVE_FILE_SERVED_ROLLOUT_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["SENSITIVE_FILE_SERVED_ROLLOUT_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SENSITIVE_FILE_SERVED_ROLLOUT_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."DetectionRule" (LIKE public."DetectionRule" INCLUDING ALL)`,
      );
    }, 120000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);

      // A project's lock: the next turn waits for the one before it.
      held = new Map();
      jest.spyOn(Semaphore, "lock").mockImplementation((async (data: {
        key: string;
        namespace: string;
      }) => {
        const key: string = `${data.namespace}:${data.key}`;
        let release: () => void = (): void => {
          return undefined;
        };
        const previous: Promise<void> = held.get(key) || Promise.resolve();
        const mine: Promise<void> = new Promise<void>((resolve: () => void) => {
          release = resolve;
        });
        held.set(
          key,
          previous.then(() => {
            return mine;
          }),
        );
        await previous;
        return { key, release } as never;
      }) as never);
      jest.spyOn(Semaphore, "release").mockImplementation((async (mutex: {
        release: () => void;
      }) => {
        mutex.release();
      }) as never);

      await database.query(`DELETE FROM "${schema}"."DetectionRule"`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // A project's rule of a library entry, as Turn on recommended once wrote it.
    async function insertRule(data: {
      project: string;
      entry: DetectionRuleLibraryEntry;
      isEnabled?: boolean;
      name?: string;
      // A YAML that lost the library's id: the rule is known by its name.
      withoutId?: boolean;
    }): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."DetectionRule" ("_id", "version", "projectId", "name", "sigmaRuleYaml", "isEnabled", "evaluationIntervalInMinutes", "matchCountThreshold", "shouldCreateCase", "shouldCreateAlert", "shouldCreateIncident", "shouldWriteDetectionFinding") VALUES ($1, 1, $2, $3, $4, $5, 5, 1, true, false, false, true)`,
        [
          ObjectID.generate().toString(),
          data.project,
          data.name || data.entry.title,
          data.withoutId
            ? `title: ${data.entry.title}\ndetection:\n  sel:\n    a: b\n  condition: sel\n`
            : data.entry.sigmaRuleYaml,
          data.isEnabled === undefined ? true : data.isEnabled,
        ],
      );
    }

    async function insertEveryOther(project: string): Promise<void> {
      for (const entry of getRecommendedDetectionRules()) {
        if (entry.id !== SERVED.id) {
          await insertRule({ project, entry });
        }
      }
    }

    async function rulesOf(project: string): Promise<Array<StoredRule>> {
      return (await database.query(
        `SELECT "_id", "projectId", "name", "sigmaRuleYaml", "isEnabled", "shouldCreateCase", "shouldCreateAlert", "createdByUserId", "addedByOneUptimeAt", "version", "updatedAt" FROM "${schema}"."DetectionRule" WHERE "projectId" = $1 ORDER BY "createdAt", "_id"`,
        [project],
      )) as Array<StoredRule>;
    }

    async function servedRulesOf(project: string): Promise<Array<StoredRule>> {
      return (await rulesOf(project)).filter((rule: StoredRule): boolean => {
        return (
          rule.sigmaRuleYaml.includes(`id: ${SERVED.id}`) ||
          rule.name.trim().toLowerCase() === SERVED.title.toLowerCase()
        );
      });
    }

    test("a project that runs every other recommended rule gets Sensitive file served, on and opening cases, said to be OneUptime's", async () => {
      await insertEveryOther(projectId(1));

      const before: number = (await rulesOf(projectId(1))).length;
      const startedAt: number = Date.now();

      await new AddSensitiveFileServedToRecommendedRules().migrate();

      const rules: Array<StoredRule> = await rulesOf(projectId(1));
      const served: Array<StoredRule> = await servedRulesOf(projectId(1));

      expect(rules).toHaveLength(before + 1);
      expect(served).toHaveLength(1);
      expect(served[0]!.name).toBe("Sensitive file served");
      expect(served[0]!.sigmaRuleYaml).toBe(SERVED.sigmaRuleYaml);
      expect(served[0]!.isEnabled).toBe(true);
      expect(served[0]!.shouldCreateCase).toBe(true);
      expect(served[0]!.shouldCreateAlert).toBe(false);
      // Nobody created it: OneUptime did, and says when.
      expect(served[0]!.createdByUserId).toBeNull();
      expect(served[0]!.addedByOneUptimeAt).toBeInstanceOf(Date);
      expect(served[0]!.addedByOneUptimeAt!.getTime()).toBeGreaterThanOrEqual(
        startedAt - 1000,
      );

      // The library's response steps, through the real service.
      const read: Array<DetectionRule> = await DetectionRuleService.findBy({
        query: { projectId: new ObjectID(projectId(1)), name: SERVED.title },
        select: {
          _id: true,
          name: true,
          sigmaRuleYaml: true,
          isEnabled: true,
          responseSteps: true,
          addedByOneUptimeAt: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

      expect(read).toHaveLength(1);
      expect(read[0]!.responseSteps).toEqual(
        getDetectionRuleLibraryResponseSteps(SERVED.id),
      );

      // ...which the Overview names as OneUptime's.
      expect(
        getRulesAddedByOneUptime({ rules: read, now: new Date() }),
      ).toEqual([
        {
          ruleId: read[0]!.id!.toString(),
          libraryRuleId: SERVED.id,
          name: SERVED.title,
          addedAt: served[0]!.addedByOneUptimeAt!.toISOString(),
        },
      ]);
    });

    test("the Overview of such a project, read as its owner would, says so - and names nothing missing", async () => {
      await insertEveryOther(projectId(1));
      await new AddSensitiveFileServedToRecommendedRules().migrate();

      // The events it counts are ClickHouse's, which this suite has none of.
      jest
        .spyOn(SecurityEventService, "countBy")
        .mockResolvedValue(new PositiveNumber(0) as never);
      jest.spyOn(SecurityEventService, "findBy").mockResolvedValue([]);
      jest.spyOn(logger, "error").mockImplementation(() => {
        return undefined as never;
      });

      const status: SecuritySetupStatus = await SecuritySetup.getStatus({
        projectId: new ObjectID(projectId(1)),
        props: { isRoot: true },
      });

      expect(status.recommendedRulesNotAdded).toEqual([]);
      expect(status.recommendedRulesOn).toBe(
        getRecommendedDetectionRules().length,
      );
      expect(
        status.rulesAddedByOneUptime.map(
          (rule: { libraryRuleId: string }): string => {
            return rule.libraryRuleId;
          },
        ),
      ).toEqual([SERVED.id]);
    });

    test("a project that chose its own set, or has the rule already, is left exactly as it was", async () => {
      // Turned one off.
      await insertEveryOther(projectId(2));
      await database.query(
        `UPDATE "${schema}"."DetectionRule" SET "isEnabled" = false WHERE "projectId" = $1 AND "sigmaRuleYaml" LIKE $2`,
        [projectId(2), `%id: ${SCANNING_FOR_SENSITIVE_FILES_RULE_ID}%`],
      );
      // Deleted one.
      await insertEveryOther(projectId(3));
      await database.query(
        `DELETE FROM "${schema}"."DetectionRule" WHERE "projectId" = $1 AND "sigmaRuleYaml" LIKE $2`,
        [projectId(3), `%id: ${SCANNING_FOR_SENSITIVE_FILES_RULE_ID}%`],
      );
      // Has it, off.
      await insertEveryOther(projectId(4));
      await insertRule({
        project: projectId(4),
        entry: SERVED,
        isEnabled: false,
      });
      // Has it, renamed.
      await insertEveryOther(projectId(5));
      await insertRule({
        project: projectId(5),
        entry: SERVED,
        name: "Leaked secrets",
      });
      // Has it by its name alone, in another case.
      await insertEveryOther(projectId(6));
      await insertRule({
        project: projectId(6),
        entry: SERVED,
        name: "SENSITIVE FILE SERVED",
        withoutId: true,
      });

      const before: Map<string, Array<StoredRule>> = new Map();

      for (const index of [2, 3, 4, 5, 6]) {
        before.set(projectId(index), await rulesOf(projectId(index)));
      }

      await new AddSensitiveFileServedToRecommendedRules().migrate();

      for (const index of [2, 3, 4, 5, 6]) {
        expect({
          project: index,
          rules: await rulesOf(projectId(index)),
        }).toEqual({ project: index, rules: before.get(projectId(index)) });
      }
    });

    test("a sibling known only by its name, in another case, still makes the project one to read", async () => {
      const sibling: DetectionRuleLibraryEntry =
        getRecommendedDetectionRules()[0]!;

      for (const entry of getRecommendedDetectionRules()) {
        if (entry.id === SERVED.id) {
          continue;
        }

        await insertRule({
          project: projectId(7),
          entry,
          ...(entry.id === sibling.id
            ? { name: `  ${sibling.title.toUpperCase()} `, withoutId: true }
            : {}),
        });
      }

      await new AddSensitiveFileServedToRecommendedRules().migrate();

      expect(await servedRulesOf(projectId(7))).toHaveLength(1);
    });

    test("run twice, the second adds nothing and changes nothing; two at once add it once", async () => {
      await insertEveryOther(projectId(8));
      await insertEveryOther(projectId(9));

      await new AddSensitiveFileServedToRecommendedRules().migrate();

      const afterFirst: Array<StoredRule> = await rulesOf(projectId(8));

      await new AddSensitiveFileServedToRecommendedRules().migrate();

      expect(await rulesOf(projectId(8))).toEqual(afterFirst);

      await insertEveryOther(projectId(10));

      await Promise.all([
        new AddSensitiveFileServedToRecommendedRules().migrate(),
        new AddSensitiveFileServedToRecommendedRules().migrate(),
      ]);

      expect(await servedRulesOf(projectId(10))).toHaveLength(1);
      expect(await servedRulesOf(projectId(9))).toHaveLength(1);
      // Each turn under its project's lock, in the migration's namespace.
      expect(
        jest
          .mocked(Semaphore.lock)
          .mock.calls.every((call: Array<unknown>): boolean => {
            return (
              (call[0] as { namespace: string }).namespace ===
              SENSITIVE_FILE_SERVED_ROLLOUT_NAME
            );
          }),
      ).toBe(true);
    });

    test("more projects than a page: each one is read, once", async () => {
      // Only the sibling: a candidate, never one that runs every other.
      const sibling: DetectionRuleLibraryEntry =
        getRecommendedDetectionRules()[0]!;

      for (let index: number = 100; index < 100 + 510; index++) {
        await insertRule({ project: projectId(index), entry: sibling });
      }

      await insertEveryOther(projectId(700));

      const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        DetectionRuleService,
        "findBy",
      );

      await new AddSensitiveFileServedToRecommendedRules().migrate();

      const projectsRead: Array<string> = findBy.mock.calls.map(
        (call: Array<unknown>): string => {
          return String(
            (call[0] as { query: { projectId: ObjectID } }).query.projectId,
          );
        },
      );

      expect(projectsRead).toHaveLength(511);
      expect(new Set(projectsRead).size).toBe(511);
      expect(await servedRulesOf(projectId(700))).toHaveLength(1);
      expect(await servedRulesOf(projectId(100))).toHaveLength(0);
    }, 120000);
  },
);
