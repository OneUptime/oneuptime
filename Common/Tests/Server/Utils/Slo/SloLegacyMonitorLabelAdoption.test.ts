import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import {
  MIGRATED_MONITOR_RULE_DESCRIPTION,
  MIGRATED_MONITOR_RULE_NAME,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1793000000000-BackfillSloMonitorRulesAndAffectedResources";
import SloLegacyMonitorLabelAdoption, {
  SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT,
  SLO_LEGACY_MONITOR_LABEL_LOCK_STATEMENT,
} from "../../../../Server/Utils/Slo/SloLegacyMonitorLabelAdoption";
import DatabaseNotConnectedException from "../../../../Types/Exception/DatabaseNotConnectedException";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Contract under test: the runtime adoption of an SLO's deprecated label list
 * into a monitor rule, for label lists written by previous-release pods after
 * the one-shot backfill (see SloLegacyMonitorLabelAdoption).
 *
 * What would silently regress if this drifted:
 *   - a rule the user deleted coming back (the "no rule row at all" guard);
 *   - a duplicate rule when two monitor edits race (lock first, one
 *     transaction);
 *   - another tenant's SLO being adopted (project pin);
 *   - previous-release pods losing the list they still read (never DELETE).
 *
 * Fake DataSource only here. The two statements were also executed against
 * Postgres 15 when written: only an SLO with label rows and no rule rows was
 * adopted (upper-case ids included), a second run inserted nothing, and a
 * disabled rule, a soft-deleted SLO, an SLO outside the id list and another
 * project's SLO were all left alone, with the label rows untouched.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_SLO_ID: string = "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a";

interface RecordedQuery {
  sql: string;
  parameters: Array<unknown>;
}

interface FakeDataSource {
  queries: Array<RecordedQuery>;
  transactionCount: number;
}

type InstallFakeDataSourceFunction = (
  adoptedRows: Array<{
    serviceLevelObjectiveId: string;
  }>,
) => FakeDataSource;

const installFakeDataSource: InstallFakeDataSourceFunction = (
  adoptedRows: Array<{ serviceLevelObjectiveId: string }>,
): FakeDataSource => {
  const fake: FakeDataSource = { queries: [], transactionCount: 0 };

  const manager: {
    query: (sql: string, parameters: Array<unknown>) => Promise<unknown>;
  } = {
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<unknown> => {
      fake.queries.push({ sql: sql, parameters: parameters });

      return sql === SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT
        ? adoptedRows
        : [];
    },
  };

  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
    transaction: async (
      work: (entityManager: typeof manager) => Promise<unknown>,
    ): Promise<unknown> => {
      fake.transactionCount++;
      return await work(manager);
    },
  } as never);

  return fake;
};

describe("SloLegacyMonitorLabelAdoption.adoptLegacyMonitorLabels", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an empty id list never touches the database", async () => {
    const getDataSourceSpy: jest.SpyInstance = jest.spyOn(
      PostgresAppInstance,
      "getDataSource",
    );

    await expect(
      SloLegacyMonitorLabelAdoption.adoptLegacyMonitorLabels({
        projectId: PROJECT_ID,
        serviceLevelObjectiveIds: [],
      }),
    ).resolves.toEqual([]);

    expect(getDataSourceSpy).not.toHaveBeenCalled();
  });

  test("locks the SLOs, then adopts, in one transaction - with de-duplicated lower-cased ids, the project and the backfill's name and description bound as parameters", async () => {
    const fake: FakeDataSource = installFakeDataSource([
      { serviceLevelObjectiveId: SLO_ID.toUpperCase() },
    ]);

    const adopted: Array<string> =
      await SloLegacyMonitorLabelAdoption.adoptLegacyMonitorLabels({
        projectId: PROJECT_ID,
        serviceLevelObjectiveIds: [
          SLO_ID.toUpperCase(),
          new ObjectID(SLO_ID),
          OTHER_SLO_ID,
        ],
      });

    expect(adopted).toEqual([SLO_ID]);
    expect(fake.transactionCount).toBe(1);
    expect(fake.queries).toHaveLength(2);

    expect(fake.queries[0]!.sql).toBe(SLO_LEGACY_MONITOR_LABEL_LOCK_STATEMENT);
    expect(fake.queries[0]!.parameters).toEqual([
      [SLO_ID, OTHER_SLO_ID],
      PROJECT_ID.toString(),
    ]);

    expect(fake.queries[1]!.sql).toBe(SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT);
    expect(fake.queries[1]!.parameters).toEqual([
      [SLO_ID, OTHER_SLO_ID],
      PROJECT_ID.toString(),
      MIGRATED_MONITOR_RULE_NAME,
      MIGRATED_MONITOR_RULE_DESCRIPTION,
    ]);
  });

  test("throws when Postgres is not connected, so the engine can hold off releasing monitors", async () => {
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(null);

    await expect(
      SloLegacyMonitorLabelAdoption.adoptLegacyMonitorLabels({
        projectId: PROJECT_ID,
        serviceLevelObjectiveIds: [SLO_ID],
      }),
    ).rejects.toBeInstanceOf(DatabaseNotConnectedException);
  });
});

describe("SloLegacyMonitorLabelAdoption SQL", () => {
  test("the lock is pinned to the project, taken in id order so two runs cannot deadlock", () => {
    expect(SLO_LEGACY_MONITOR_LABEL_LOCK_STATEMENT).toContain(
      `WHERE "_id" = ANY($1::uuid[]) AND "projectId" = $2`,
    );
    expect(SLO_LEGACY_MONITOR_LABEL_LOCK_STATEMENT).toMatch(
      /ORDER BY "_id" FOR UPDATE$/,
    );
  });

  test("adopts only a live SLO of the project that has label rows and NO monitor rule row at all", () => {
    expect(SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT).toContain(
      `WHERE slo."_id" = ANY($1::uuid[]) AND slo."projectId" = $2 AND slo."deletedAt" IS NULL`,
    );
    expect(SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT).toContain(
      `EXISTS (SELECT 1 FROM "ServiceLevelObjectiveMonitorLabel" sml WHERE sml."serviceLevelObjectiveId" = slo."_id")`,
    );
    /*
     * Any rule - not only one with the backfill's name. A renamed, edited or
     * disabled rule is the user's decision and must stop adoption.
     */
    expect(SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT).toContain(
      `NOT EXISTS (SELECT 1 FROM "ServiceLevelObjectiveMonitorRule" existing WHERE existing."serviceLevelObjectiveId" = slo."_id")`,
    );
    expect(SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT).not.toMatch(
      /existing\."(name|isEnabled)"/,
    );
  });

  test("writes an enabled legacy-label rule carrying exactly the SLO's labels, and returns the adopted SLO ids", () => {
    expect(SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT).toContain(
      `INSERT INTO "ServiceLevelObjectiveMonitorRule" ("_id", "version", "projectId", "serviceLevelObjectiveId", "name", "description", "isEnabled") SELECT uuid_generate_v4(), 1, slo."projectId", slo."_id", $3, $4, true`,
    );
    expect(SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT).toContain(
      `INSERT INTO "ServiceLevelObjectiveMonitorRuleMonitorLabel" ("serviceLevelObjectiveMonitorRuleId", "labelId") SELECT "adoptedRules"."_id", sml."labelId" FROM "adoptedRules" INNER JOIN "ServiceLevelObjectiveMonitorLabel" sml ON sml."serviceLevelObjectiveId" = "adoptedRules"."serviceLevelObjectiveId" ON CONFLICT DO NOTHING`,
    );
    expect(SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT).toMatch(
      /SELECT "serviceLevelObjectiveId" FROM "adoptedRules"$/,
    );
  });

  test("never deletes the label rows previous-release pods still read, and inlines no values", () => {
    for (const statement of [
      SLO_LEGACY_MONITOR_LABEL_LOCK_STATEMENT,
      SLO_LEGACY_MONITOR_LABEL_ADOPT_STATEMENT,
    ]) {
      expect(statement).not.toMatch(/\bDELETE\b|\bUPDATE\b(?! *$)/);
      expect(statement).not.toContain(MIGRATED_MONITOR_RULE_NAME);
      expect(statement).not.toContain("'");
    }
  });
});
