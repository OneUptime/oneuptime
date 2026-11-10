import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import { getGroupingWaitKey } from "../../../Server/Utils/Rules/GroupingRuleEpisodeWait";
import ObjectID from "../../../Types/ObjectID";
import { MAX_RECORDS_TO_OPEN_EPISODE } from "../../../Utils/Episode/EpisodeOpeningThreshold";
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
 * THE RECORDS A GROUPING RULE HOLDS BACK, ON A MIGRATED POSTGRES (issue
 * #5374).
 *
 * A rule that waits for more incidents (or alerts) marks each one it holds
 * back with the group it waits in (groupingWaitKey), and reads the group's
 * waiting records when the next one arrives. Against the real columns, the
 * real partial index and the real state lists:
 *
 *   - the read finds the group's waiting records that are in no episode and
 *     still ongoing, newest first - not another group's, not another
 *     project's, not one resolved, not one in an episode, not a deleted one,
 *     never the arriving record itself;
 *   - with a time window, only the run that arrived close together;
 *   - at most as many as an episode opens with;
 *   - the mark is written and cleared as bookkeeping: the record's version
 *     and updatedAt stay as they were;
 *   - the partial index is there, as the model declares it.
 *
 * Opt in with RUN_POSTGRES_GROUPING_WAIT_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_GROUPING_WAIT_TESTS=true \
 *   GROUPING_WAIT_TEST_DATABASE_HOST=127.0.0.1 \
 *   GROUPING_WAIT_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/GroupingWaitPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database. Each
 * kind's rows are made under projects of their own, deleted afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_GROUPING_WAIT_TESTS"] === "true"
    ? describe
    : describe.skip;

const MINUTE_MS: number = 60 * 1000;

type GroupedRecord = Incident | Alert;

// The engine's own steps, as it takes them for a record of a waiting rule.
interface EngineInternals {
  findWaiting: (data: {
    record: GroupedRecord;
    groupingWaitKey: string;
    timeWindowMinutes: number | null;
  }) => Promise<Array<GroupedRecord>>;
  waitForEpisode: (
    record: GroupedRecord,
    groupingWaitKey: string | null,
  ) => Promise<void>;
}

interface Kind {
  name: "Incident" | "Alert";
  engine: EngineInternals;
  newRecord: (data: { id: string; projectId: string }) => GroupedRecord;
}

const KINDS: Array<Kind> = [
  {
    name: "Incident",
    engine: {
      findWaiting: (data: {
        record: GroupedRecord;
        groupingWaitKey: string;
        timeWindowMinutes: number | null;
      }): Promise<Array<GroupedRecord>> => {
        return (
          IncidentGroupingEngineService as unknown as {
            findIncidentsWaitingForEpisode: (data: {
              incident: GroupedRecord;
              groupingWaitKey: string;
              timeWindowMinutes: number | null;
            }) => Promise<Array<GroupedRecord>>;
          }
        ).findIncidentsWaitingForEpisode({
          incident: data.record,
          groupingWaitKey: data.groupingWaitKey,
          timeWindowMinutes: data.timeWindowMinutes,
        });
      },
      waitForEpisode: (
        record: GroupedRecord,
        groupingWaitKey: string | null,
      ): Promise<void> => {
        return (
          IncidentGroupingEngineService as unknown as EngineInternals
        ).waitForEpisode.call(
          IncidentGroupingEngineService,
          record,
          groupingWaitKey,
        );
      },
    },
    newRecord: (data: { id: string; projectId: string }): Incident => {
      const incident: Incident = new Incident();
      incident.id = new ObjectID(data.id);
      incident.projectId = new ObjectID(data.projectId);
      return incident;
    },
  },
  {
    name: "Alert",
    engine: {
      findWaiting: (data: {
        record: GroupedRecord;
        groupingWaitKey: string;
        timeWindowMinutes: number | null;
      }): Promise<Array<GroupedRecord>> => {
        return (
          AlertGroupingEngineService as unknown as {
            findAlertsWaitingForEpisode: (data: {
              alert: GroupedRecord;
              groupingWaitKey: string;
              timeWindowMinutes: number | null;
            }) => Promise<Array<GroupedRecord>>;
          }
        ).findAlertsWaitingForEpisode({
          alert: data.record,
          groupingWaitKey: data.groupingWaitKey,
          timeWindowMinutes: data.timeWindowMinutes,
        });
      },
      waitForEpisode: (
        record: GroupedRecord,
        groupingWaitKey: string | null,
      ): Promise<void> => {
        return (
          AlertGroupingEngineService as unknown as EngineInternals
        ).waitForEpisode.call(
          AlertGroupingEngineService,
          record,
          groupingWaitKey,
        );
      },
    },
    newRecord: (data: { id: string; projectId: string }): Alert => {
      const alert: Alert = new Alert();
      alert.id = new ObjectID(data.id);
      alert.projectId = new ObjectID(data.projectId);
      return alert;
    },
  },
];

describePostgres(
  "records waiting for an episode, against a migrated Postgres",
  () => {
    let database: DataSource;
    const projects: Array<string> = [];

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["GROUPING_WAIT_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["GROUPING_WAIT_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["GROUPING_WAIT_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        synchronize: false,
      });
      await database.initialize();

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
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

    describe.each(KINDS)("$name", (kind: Kind) => {
      const k: string = kind.name;
      const lower: string = k.toLowerCase();

      const ruleId: ObjectID = ObjectID.generate();
      const otherRuleId: ObjectID = ObjectID.generate();
      const WAIT_KEY: string = getGroupingWaitKey({
        ruleId: ruleId,
        groupingKey: "default",
      });
      const OTHER_GROUP_KEY: string = getGroupingWaitKey({
        ruleId: ruleId,
        groupingKey: "monitor:another",
      });
      const OTHER_RULE_KEY: string = getGroupingWaitKey({
        ruleId: otherRuleId,
        groupingKey: "default",
      });

      interface Project {
        projectId: string;
        ongoingStateId: string;
        resolvedStateId: string;
        severityId: string;
        episodeId: string;
      }

      let project: Project;
      let otherProject: Project;
      let nextNumber: number = 500;

      async function insertProject(): Promise<Project> {
        const projectId: string = ObjectID.generate().toString();
        const ongoingStateId: string = ObjectID.generate().toString();
        const resolvedStateId: string = ObjectID.generate().toString();
        const severityId: string = ObjectID.generate().toString();
        const episodeId: string = ObjectID.generate().toString();
        projects.push(projectId);

        await database.query(
          `INSERT INTO "Project" ("_id","name","slug","version") VALUES ($1,'t',$2,1)`,
          [projectId, `s${projectId}`],
        );

        const slugColumn: string = k === "Incident" ? `,"slug"` : "";

        for (const [stateId, name, order, flags] of [
          [ongoingStateId, "Created", 1, `"isCreatedState"`],
          [resolvedStateId, "Resolved", 2, `"isResolvedState"`],
        ] as Array<[string, string, number, string]>) {
          const slugValue: string = k === "Incident" ? `,'s${stateId}'` : "";
          await database.query(
            `INSERT INTO "${k}State" ("_id","projectId","name","color","order",${flags},"version"${slugColumn}) VALUES ($1,$2,$3,'#fff',$4,true,1${slugValue})`,
            [stateId, projectId, name, order],
          );
        }

        await database.query(
          `INSERT INTO "${k}Severity" ("_id","projectId","name","slug","color","order","version") VALUES ($1,$2,'Critical',$3,'#fff',1,1)`,
          [severityId, projectId, `s${severityId}`],
        );

        await database.query(
          `INSERT INTO "${k}Episode" ("_id","projectId","title","current${k}StateId","version") VALUES ($1,$2,'Episode',$3,1)`,
          [episodeId, projectId, ongoingStateId],
        );

        return {
          projectId,
          ongoingStateId,
          resolvedStateId,
          severityId,
          episodeId,
        };
      }

      async function insertRecord(data: {
        project: Project;
        minutesAgo: number;
        groupingWaitKey: string | null;
        resolved?: boolean | undefined;
        inEpisode?: boolean | undefined;
        deleted?: boolean | undefined;
      }): Promise<string> {
        const recordId: string = ObjectID.generate().toString();
        const slugColumn: string = k === "Incident" ? `,"slug"` : "";
        const slugValue: string = k === "Incident" ? `,'s${recordId}'` : "";
        const createdAt: Date = new Date(
          Date.now() - data.minutesAgo * MINUTE_MS,
        );
        nextNumber++;

        await database.query(
          `INSERT INTO "${k}" ("_id","projectId","title","current${k}StateId","${lower}SeverityId","isPrivate","${lower}Number","${lower}NumberWithPrefix","version","createdAt","updatedAt","groupingWaitKey","${lower}EpisodeId","deletedAt"${slugColumn}) VALUES ($1,$2,'Checkout is down',$3,$4,false,$5,$6,1,$7,$7,$8,$9,$10${slugValue})`,
          [
            recordId,
            data.project.projectId,
            data.resolved
              ? data.project.resolvedStateId
              : data.project.ongoingStateId,
            data.project.severityId,
            nextNumber,
            `#${nextNumber}`,
            createdAt,
            data.groupingWaitKey,
            data.inEpisode ? data.project.episodeId : null,
            data.deleted ? new Date() : null,
          ],
        );

        return recordId;
      }

      async function waitingIds(data: {
        arrivingId: string;
        timeWindowMinutes: number | null;
        groupingWaitKey?: string | undefined;
      }): Promise<Array<string>> {
        const found: Array<GroupedRecord> = await kind.engine.findWaiting({
          record: kind.newRecord({
            id: data.arrivingId,
            projectId: project.projectId,
          }),
          groupingWaitKey: data.groupingWaitKey || WAIT_KEY,
          timeWindowMinutes: data.timeWindowMinutes,
        });

        return found.map((record: GroupedRecord): string => {
          return String(record.id);
        });
      }

      let newest: string;
      let older: string;
      let oldest: string;
      let arriving: string;
      let resolved: string;
      let inEpisode: string;
      let deleted: string;
      let otherGroup: string;
      let otherRule: string;
      let otherProjects: string;

      beforeAll(async () => {
        project = await insertProject();
        otherProject = await insertProject();

        // The group's waiting records: 2, 8 and 90 minutes ago.
        newest = await insertRecord({
          project,
          minutesAgo: 2,
          groupingWaitKey: WAIT_KEY,
        });
        older = await insertRecord({
          project,
          minutesAgo: 8,
          groupingWaitKey: WAIT_KEY,
        });
        oldest = await insertRecord({
          project,
          minutesAgo: 90,
          groupingWaitKey: WAIT_KEY,
        });

        // The record arriving now, marked already as a later one would find it.
        arriving = await insertRecord({
          project,
          minutesAgo: 0,
          groupingWaitKey: WAIT_KEY,
        });

        // None of these count.
        resolved = await insertRecord({
          project,
          minutesAgo: 3,
          groupingWaitKey: WAIT_KEY,
          resolved: true,
        });
        inEpisode = await insertRecord({
          project,
          minutesAgo: 4,
          groupingWaitKey: WAIT_KEY,
          inEpisode: true,
        });
        deleted = await insertRecord({
          project,
          minutesAgo: 5,
          groupingWaitKey: WAIT_KEY,
          deleted: true,
        });
        otherGroup = await insertRecord({
          project,
          minutesAgo: 6,
          groupingWaitKey: OTHER_GROUP_KEY,
        });
        otherRule = await insertRecord({
          project,
          minutesAgo: 7,
          groupingWaitKey: OTHER_RULE_KEY,
        });
        otherProjects = await insertRecord({
          project: otherProject,
          minutesAgo: 1,
          groupingWaitKey: WAIT_KEY,
        });
        // Never waited.
        await insertRecord({ project, minutesAgo: 1, groupingWaitKey: null });
      }, 120_000);

      test("with no time window, finds the group's ongoing records in no episode, newest first", async () => {
        expect(
          await waitingIds({ arrivingId: arriving, timeWindowMinutes: null }),
        ).toEqual([newest, older, oldest]);
      });

      test("never finds one resolved, one in an episode, a deleted one, another group's, another rule's or another project's", async () => {
        const found: Array<string> = await waitingIds({
          arrivingId: arriving,
          timeWindowMinutes: null,
        });

        for (const left of [
          resolved,
          inEpisode,
          deleted,
          otherGroup,
          otherRule,
          otherProjects,
          arriving,
        ]) {
          expect(found).not.toContain(left);
        }
      });

      test("with a time window, finds only the run that arrived close together", async () => {
        // 0 -> 2 -> 8 are each within 10 minutes; 8 -> 90 is not.
        expect(
          await waitingIds({ arrivingId: arriving, timeWindowMinutes: 10 }),
        ).toEqual([newest, older]);
        // Within a minute of now, nothing waited.
        expect(
          await waitingIds({ arrivingId: arriving, timeWindowMinutes: 1 }),
        ).toEqual([]);
        // Within 90 minutes of each other, all three.
        expect(
          await waitingIds({ arrivingId: arriving, timeWindowMinutes: 90 }),
        ).toEqual([newest, older, oldest]);
      });

      test("reads at most as many as an episode opens with, besides the arriving one", async () => {
        const crowdKey: string = getGroupingWaitKey({
          ruleId: ruleId,
          groupingKey: "crowd",
        });

        for (
          let index: number = 0;
          index < MAX_RECORDS_TO_OPEN_EPISODE + 5;
          index++
        ) {
          await insertRecord({
            project,
            minutesAgo: 10 + index,
            groupingWaitKey: crowdKey,
          });
        }

        const found: Array<string> = await waitingIds({
          arrivingId: arriving,
          timeWindowMinutes: null,
          groupingWaitKey: crowdKey,
        });

        expect(found).toHaveLength(MAX_RECORDS_TO_OPEN_EPISODE - 1);
      }, 120_000);

      test("hands back what the episode is opened with", async () => {
        const found: Array<GroupedRecord> = await kind.engine.findWaiting({
          record: kind.newRecord({
            id: arriving,
            projectId: project.projectId,
          }),
          groupingWaitKey: WAIT_KEY,
          timeWindowMinutes: null,
        });

        for (const record of found) {
          expect(record.title).toBe("Checkout is down");
          expect(record.createdAt).toBeInstanceOf(Date);
          expect(record.isPrivate).toBe(false);
          expect(String(record.projectId)).toBe(project.projectId);
        }
      });

      test("marks and clears a record as bookkeeping: its version and updatedAt stay as they were", async () => {
        const recordId: string = await insertRecord({
          project,
          minutesAgo: 30,
          groupingWaitKey: null,
        });

        type Row = {
          groupingWaitKey: string | null;
          version: number;
          updatedAt: Date;
        };

        async function read(): Promise<Row> {
          const rows: Array<Row> = await database.query(
            `SELECT "groupingWaitKey", "version", "updatedAt" FROM "${k}" WHERE "_id" = $1`,
            [recordId],
          );
          return rows[0]!;
        }

        const before: Row = await read();
        const record: GroupedRecord = kind.newRecord({
          id: recordId,
          projectId: project.projectId,
        });

        await kind.engine.waitForEpisode(record, WAIT_KEY);
        const marked: Row = await read();

        expect(marked.groupingWaitKey).toBe(WAIT_KEY);
        expect(marked.version).toBe(before.version);
        expect(new Date(marked.updatedAt).getTime()).toBe(
          new Date(before.updatedAt).getTime(),
        );

        await kind.engine.waitForEpisode(record, null);
        const cleared: Row = await read();

        expect(cleared.groupingWaitKey).toBeNull();
        expect(cleared.version).toBe(before.version);
      });

      test("is read through the partial index the model declares", async () => {
        const indexes: Array<{ indexdef: string }> = await database.query(
          `SELECT "indexdef" FROM pg_indexes WHERE "tablename" = $1 AND "indexdef" LIKE '%groupingWaitKey%'`,
          [k],
        );

        expect(indexes).toHaveLength(1);
        expect(indexes[0]!.indexdef).toContain(
          `("groupingWaitKey", "createdAt") WHERE (("groupingWaitKey" IS NOT NULL) AND ("deletedAt" IS NULL))`,
        );
      });
    });
  },
);
