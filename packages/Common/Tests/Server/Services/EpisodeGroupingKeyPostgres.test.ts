import Alert from "../../../Models/DatabaseModels/Alert";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * AN EPISODE'S GROUPING KEY, LOOKED UP ON A MIGRATED POSTGRES.
 *
 * An episode a private incident (or alert) opens is stored with the title in
 * its grouping key hashed. One any other record opens - and every episode
 * opened before titles were hashed - is stored with the key as built, the
 * title as it reads. A record looks its group's episode up by both forms, so
 * against the real column:
 *
 *   - an episode stored before titles were hashed is found by a later record
 *     with the same title, private or not - an open one to join, and one
 *     resolved recently to reopen - so no open episode is split by the
 *     change;
 *   - one a private record opens is stored with no trace of the title, and
 *     is found by a later record with the same title, private or not;
 *   - a record with another title finds neither.
 *
 * Opt in with RUN_POSTGRES_EPISODE_GROUPING_KEY_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_EPISODE_GROUPING_KEY_TESTS=true \
 *   EPISODE_GROUPING_KEY_TEST_DATABASE_HOST=127.0.0.1 \
 *   EPISODE_GROUPING_KEY_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/EpisodeGroupingKeyPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database. Each
 * kind's rows are made under a project of their own, deleted afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_EPISODE_GROUPING_KEY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TITLE: string = "Northwind payroll export 2024 copied to a public bucket";
// The same title as the key reads it: only case and the number differ.
const SAME_TITLE: string =
  "NORTHWIND payroll export 2025 copied to a public bucket";
const ANOTHER_TITLE: string = "Checkout is slow";

/*
 * The key a rule grouping by title alone built, and stored every episode
 * with, before titles were hashed.
 */
const KEY_AS_BUILT: string =
  "title:northwind payroll export X copied to a public bucket";

// Anything that gives the title away.
const TITLE_TEXT: RegExp = /northwind|payroll/i;

const MINUTE_MS: number = 60 * 1000;

type GroupingRule = IncidentGroupingRule | AlertGroupingRule;
type GroupedRecord = Incident | Alert;

interface FoundEpisode {
  id?: ObjectID | null;
}

// The engine's own steps, as it takes them for each record it groups.
interface EngineInternals {
  buildGroupingKey: (
    record: GroupedRecord,
    rule: GroupingRule,
  ) => Promise<string>;
  getGroupingKeyToStore: (
    record: GroupedRecord,
    rule: GroupingRule,
    groupingKey: string,
  ) => string;
  getGroupingKeysToMatch: (
    record: GroupedRecord,
    rule: GroupingRule,
    groupingKey: string,
  ) => Array<string>;
  findMatchingActiveEpisode: (
    projectId: ObjectID,
    ruleId: ObjectID,
    groupingKeys: Array<string>,
    timeWindowCutoff: Date | null,
  ) => Promise<FoundEpisode | null>;
  findRecentlyResolvedEpisode: (
    projectId: ObjectID,
    ruleId: ObjectID,
    groupingKeys: Array<string>,
    reopenCutoff: Date,
  ) => Promise<FoundEpisode | null>;
}

interface Kind {
  name: "Incident" | "Alert";
  engine: EngineInternals;
  newRecord: (data: {
    projectId: ObjectID;
    title: string;
    isPrivate: boolean;
  }) => GroupedRecord;
  // A rule that groups by title alone.
  newRule: (ruleId: ObjectID) => GroupingRule;
}

const KINDS: Array<Kind> = [
  {
    name: "Incident",
    engine: IncidentGroupingEngineService as unknown as EngineInternals,
    newRecord: (data: {
      projectId: ObjectID;
      title: string;
      isPrivate: boolean;
    }): Incident => {
      const incident: Incident = new Incident();
      incident.id = ObjectID.generate();
      incident.projectId = data.projectId;
      incident.title = data.title;
      incident.isPrivate = data.isPrivate;
      return incident;
    },
    newRule: (ruleId: ObjectID): IncidentGroupingRule => {
      const rule: IncidentGroupingRule = new IncidentGroupingRule();
      rule.id = ruleId;
      rule.groupByIncidentTitle = true;
      return rule;
    },
  },
  {
    name: "Alert",
    engine: AlertGroupingEngineService as unknown as EngineInternals,
    newRecord: (data: {
      projectId: ObjectID;
      title: string;
      isPrivate: boolean;
    }): Alert => {
      const alert: Alert = new Alert();
      alert.id = ObjectID.generate();
      alert.projectId = data.projectId;
      alert.title = data.title;
      alert.isPrivate = data.isPrivate;
      return alert;
    },
    newRule: (ruleId: ObjectID): AlertGroupingRule => {
      const rule: AlertGroupingRule = new AlertGroupingRule();
      rule.id = ruleId;
      rule.groupByAlertTitle = true;
      return rule;
    },
  },
];

describePostgres("episode grouping keys against a migrated Postgres", () => {
  let database: DataSource;
  const projects: Array<string> = [];

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["EPISODE_GROUPING_KEY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["EPISODE_GROUPING_KEY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["EPISODE_GROUPING_KEY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      synchronize: false,
    });
    await database.initialize();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  /*
   * Deleting a project checks every table that can name one - hundreds of
   * foreign keys - which takes most of a minute on a migrated database.
   */
  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      if (projects.length > 0) {
        await database.query(`DELETE FROM "Project" WHERE "_id" = ANY($1)`, [
          projects,
        ]);
      }
      await database.destroy();
    }
  }, 300_000);

  describe.each(KINDS)("$name episodes", (kind: Kind) => {
    const k: string = kind.name;
    const lower: string = k.toLowerCase();

    const projectId: ObjectID = ObjectID.generate();
    /*
     * Its episodes were stored before titles were hashed: an open one, and
     * one resolved recently.
     */
    const earlierRuleId: ObjectID = ObjectID.generate();
    const earlierOpenEpisodeId: ObjectID = ObjectID.generate();
    const earlierResolvedEpisodeId: ObjectID = ObjectID.generate();
    // Its episode was opened by a private record.
    const privateRuleId: ObjectID = ObjectID.generate();
    const privateEpisodeId: ObjectID = ObjectID.generate();

    async function insertEpisode(data: {
      episodeId: ObjectID;
      ruleId: ObjectID;
      stateId: string;
      groupingKey: string;
      resolvedAt: Date | null;
    }): Promise<void> {
      await database.query(
        `INSERT INTO "${k}Episode" ("_id","projectId","title","current${k}StateId","${lower}GroupingRuleId","groupingKey","resolvedAt","version") VALUES ($1,$2,'Episode',$3,$4,$5,$6,1)`,
        [
          data.episodeId.toString(),
          projectId.toString(),
          data.stateId,
          data.ruleId.toString(),
          data.groupingKey,
          data.resolvedAt,
        ],
      );
    }

    // The keys the engine looks a record's group up by, under the rule.
    async function keysToMatch(
      ruleId: ObjectID,
      title: string,
      isPrivate: boolean,
    ): Promise<Array<string>> {
      const record: GroupedRecord = kind.newRecord({
        projectId: projectId,
        title: title,
        isPrivate: isPrivate,
      });
      const rule: GroupingRule = kind.newRule(ruleId);

      return kind.engine.getGroupingKeysToMatch(
        record,
        rule,
        await kind.engine.buildGroupingKey(record, rule),
      );
    }

    async function openEpisodeFound(
      ruleId: ObjectID,
      title: string,
      isPrivate: boolean,
    ): Promise<string | null> {
      const episode: FoundEpisode | null =
        await kind.engine.findMatchingActiveEpisode(
          projectId,
          ruleId,
          await keysToMatch(ruleId, title, isPrivate),
          null,
        );
      return episode?.id?.toString() || null;
    }

    async function resolvedEpisodeFound(
      ruleId: ObjectID,
      title: string,
      isPrivate: boolean,
    ): Promise<string | null> {
      const episode: FoundEpisode | null =
        await kind.engine.findRecentlyResolvedEpisode(
          projectId,
          ruleId,
          await keysToMatch(ruleId, title, isPrivate),
          new Date(Date.now() - 30 * MINUTE_MS),
        );
      return episode?.id?.toString() || null;
    }

    beforeAll(async () => {
      const stateId: string = ObjectID.generate().toString();
      projects.push(projectId.toString());

      await database.query(
        `INSERT INTO "Project" ("_id","name","slug","version") VALUES ($1,'t',$2,1)`,
        [projectId.toString(), `s${projectId.toString()}`],
      );
      const stateSlugColumn: string = k === "Incident" ? `,"slug"` : "";
      const stateSlugValue: string = k === "Incident" ? `,'s${stateId}'` : "";
      await database.query(
        `INSERT INTO "${k}State" ("_id","projectId","name","color","order","version"${stateSlugColumn}) VALUES ($1,$2,'s','#fff',1,1${stateSlugValue})`,
        [stateId, projectId.toString()],
      );
      for (const ruleId of [earlierRuleId, privateRuleId]) {
        await database.query(
          `INSERT INTO "${k}GroupingRule" ("_id","projectId","name","version") VALUES ($1,$2,'Repeats',1)`,
          [ruleId.toString(), projectId.toString()],
        );
      }

      await insertEpisode({
        episodeId: earlierOpenEpisodeId,
        ruleId: earlierRuleId,
        stateId: stateId,
        groupingKey: KEY_AS_BUILT,
        resolvedAt: null,
      });
      await insertEpisode({
        episodeId: earlierResolvedEpisodeId,
        ruleId: earlierRuleId,
        stateId: stateId,
        groupingKey: KEY_AS_BUILT,
        resolvedAt: new Date(Date.now() - 5 * MINUTE_MS),
      });

      // Stored as the engine stores the episode a private record opens.
      const opener: GroupedRecord = kind.newRecord({
        projectId: projectId,
        title: TITLE,
        isPrivate: true,
      });
      const privateRule: GroupingRule = kind.newRule(privateRuleId);
      await insertEpisode({
        episodeId: privateEpisodeId,
        ruleId: privateRuleId,
        stateId: stateId,
        groupingKey: kind.engine.getGroupingKeyToStore(
          opener,
          privateRule,
          await kind.engine.buildGroupingKey(opener, privateRule),
        ),
        resolvedAt: null,
      });
    });

    test.each([
      ["a private one", true],
      ["one that is not private", false],
    ])(
      "an open episode stored before titles were hashed is joined by a later record with the same title: %s",
      async (_label: string, isPrivate: boolean) => {
        expect(
          await openEpisodeFound(earlierRuleId, SAME_TITLE, isPrivate),
        ).toBe(earlierOpenEpisodeId.toString());
      },
    );

    test.each([
      ["a private one", true],
      ["one that is not private", false],
    ])(
      "one resolved recently, stored before titles were hashed, is reopened for a later record with the same title: %s",
      async (_label: string, isPrivate: boolean) => {
        expect(
          await resolvedEpisodeFound(earlierRuleId, SAME_TITLE, isPrivate),
        ).toBe(earlierResolvedEpisodeId.toString());
      },
    );

    test("the episode a private record opened is stored with no trace of its title", async () => {
      const rows: Array<{ groupingKey: string }> = await database.query(
        `SELECT "groupingKey" FROM "${k}Episode" WHERE "_id" = $1`,
        [privateEpisodeId.toString()],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.groupingKey).toMatch(/^titleHmac:[0-9a-f]{64}$/);
      expect(rows[0]!.groupingKey).not.toMatch(TITLE_TEXT);
    });

    test.each([
      ["a private one", true],
      ["one that is not private", false],
    ])(
      "the episode a private record opened is joined by a later record with the same title: %s",
      async (_label: string, isPrivate: boolean) => {
        expect(
          await openEpisodeFound(privateRuleId, SAME_TITLE, isPrivate),
        ).toBe(privateEpisodeId.toString());
      },
    );

    test.each([
      ["a private one", true],
      ["one that is not private", false],
    ])(
      "a record with another title finds none of them: %s",
      async (_label: string, isPrivate: boolean) => {
        for (const ruleId of [earlierRuleId, privateRuleId]) {
          expect(
            await openEpisodeFound(ruleId, ANOTHER_TITLE, isPrivate),
          ).toBeNull();
          expect(
            await resolvedEpisodeFound(ruleId, ANOTHER_TITLE, isPrivate),
          ).toBeNull();
        }
      },
    );
  });
});
