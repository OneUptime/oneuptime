import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import ResolvedRecordRetention, {
  ResolvedRecordRetentionResult,
  ResolvedRecordRetentionSummary,
} from "../../../../Server/Utils/Retention/ResolvedRecordRetention";
import ObjectID from "../../../../Types/ObjectID";
import { ResolvedRecordKind } from "../../../../Types/Retention/ResolvedRecordRetention";
import { DataSource } from "typeorm";

/*
 * DELETING RESOLVED INCIDENTS AND ALERTS A PROJECT NO LONGER KEEPS (issue
 * #6903), against a migrated Postgres: the real statements, the real
 * services' hard deletes and the database's own cascades, over rows written
 * as the product writes them. What is pinned is what a customer would see
 * after the hourly job:
 *
 *   - a resolved incident (alert) goes once it has been resolved for longer
 *     than the project's retention - counted from its last state change -
 *     with its state timeline, notes and feed;
 *   - one that is not resolved, was resolved within the retention, was
 *     opened within it, has a completed postmortem (while the project keeps
 *     those), or is in an episode still open or resolved within it, stays;
 *     an alert linked to an incident stays as long as the incident does;
 *   - an episode goes once it is resolved for longer and none of its members
 *     are left; one that keeps a member has its count put right; an
 *     incident episode with a postmortem written stays while postmortems are
 *     kept;
 *   - a project at 0 - Never, where every project starts - loses nothing;
 *   - a second run deletes nothing more, and a record reopened between the
 *     read and the delete stays.
 *
 * Opt in with RUN_POSTGRES_RESOLVED_RECORD_RETENTION_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_RESOLVED_RECORD_RETENTION_TESTS=true \
 *   RESOLVED_RECORD_RETENTION_TEST_DATABASE_HOST=127.0.0.1 \
 *   RESOLVED_RECORD_RETENTION_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/Retention/ResolvedRecordRetentionPostgres.test.ts
 *
 * Every row is written under projects of the test's own, deleted afterwards.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_RESOLVED_RECORD_RETENTION_TESTS"] === "true"
    ? describe
    : describe.skip;

const DAY_MS: number = 24 * 60 * 60 * 1000;

interface SeededProject {
  projectId: string;
  incidentStates: { created: string; acknowledged: string; resolved: string };
  incidentSeverity: string;
  alertStates: { created: string; acknowledged: string; resolved: string };
  alertSeverity: string;
  completedPostmortemStatus: string;
  draftPostmortemStatus: string;
}

interface RecordShape {
  // Days ago it was opened.
  openedDaysAgo: number;
  // Days ago it was resolved; undefined for one still open.
  resolvedDaysAgo?: number | undefined;
  // Incidents only: its postmortem's status.
  postmortemStatusId?: string | undefined;
  // Whether it has state timeline rows at all (a row written before they were kept).
  withoutTimeline?: boolean | undefined;
}

interface EpisodeShape {
  // Days ago it was resolved; undefined for one still open.
  resolvedDaysAgo?: number | undefined;
  openedDaysAgo?: number | undefined;
  members?: Array<string> | undefined;
  postmortemNote?: string | undefined;
}

describePostgres(
  "resolved record retention against a migrated Postgres",
  () => {
    let database: DataSource;
    const projects: Array<string> = [];

    const id: () => string = (): string => {
      return ObjectID.generate().toString();
    };

    const daysAgo: (days: number) => Date = (days: number): Date => {
      return new Date(Date.now() - days * DAY_MS);
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["RESOLVED_RECORD_RETENTION_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["RESOLVED_RECORD_RETENTION_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["RESOLVED_RECORD_RETENTION_TEST_DATABASE_NAME"] ||
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
    });

    async function seedProject(settings: {
      incidentRetentionInDays: number;
      alertRetentionInDays: number;
      keepIncidentsWithCompletedPostmortem: boolean;
    }): Promise<SeededProject> {
      const projectId: string = id();
      projects.push(projectId);

      await database.query(
        `INSERT INTO "Project" ("_id","name","slug","version","incidentRetentionInDays","alertRetentionInDays","keepIncidentsWithCompletedPostmortem") VALUES ($1,'Retention test',$2,1,$3,$4,$5)`,
        [
          projectId,
          `retention-${projectId}`,
          settings.incidentRetentionInDays,
          settings.alertRetentionInDays,
          settings.keepIncidentsWithCompletedPostmortem,
        ],
      );

      const seeded: SeededProject = {
        projectId,
        incidentStates: { created: id(), acknowledged: id(), resolved: id() },
        incidentSeverity: id(),
        alertStates: { created: id(), acknowledged: id(), resolved: id() },
        alertSeverity: id(),
        completedPostmortemStatus: id(),
        draftPostmortemStatus: id(),
      };

      const states: Array<[string, string, number, string]> = [
        ["created", "Created", 1, "isCreatedState"],
        ["acknowledged", "Acknowledged", 2, "isAcknowledgedState"],
        ["resolved", "Resolved", 3, "isResolvedState"],
      ];

      for (const [key, name, order, flag] of states) {
        await database.query(
          `INSERT INTO "IncidentState" ("_id","projectId","name","slug","color","order","version","${flag}") VALUES ($1,$2,$3,$4,'#000000',$5,1,true)`,
          [
            seeded.incidentStates[key as "created"],
            projectId,
            name,
            `${key}-${projectId}`,
            order,
          ],
        );
        await database.query(
          `INSERT INTO "AlertState" ("_id","projectId","name","color","order","version","${flag}") VALUES ($1,$2,$3,'#000000',$4,1,true)`,
          [seeded.alertStates[key as "created"], projectId, name, order],
        );
      }

      await database.query(
        `INSERT INTO "IncidentSeverity" ("_id","projectId","name","slug","color","order","version") VALUES ($1,$2,'High',$3,'#ff0000',1,1)`,
        [seeded.incidentSeverity, projectId, `high-${projectId}`],
      );
      await database.query(
        `INSERT INTO "AlertSeverity" ("_id","projectId","name","slug","color","order","version") VALUES ($1,$2,'High',$3,'#ff0000',1,1)`,
        [seeded.alertSeverity, projectId, `high-${projectId}`],
      );
      await database.query(
        `INSERT INTO "IncidentPostmortemStatus" ("_id","projectId","name","slug","color","order","version","isCompletedStatus") VALUES ($1,$2,'Completed',$3,'#00ff00',3,1,true), ($4,$2,'Draft',$5,'#cccccc',1,1,false)`,
        [
          seeded.completedPostmortemStatus,
          projectId,
          `completed-${projectId}`,
          seeded.draftPostmortemStatus,
          `draft-${projectId}`,
        ],
      );

      return seeded;
    }

    async function addIncident(
      project: SeededProject,
      shape: RecordShape,
    ): Promise<string> {
      const incidentId: string = id();
      const isResolved: boolean = shape.resolvedDaysAgo !== undefined;

      await database.query(
        `INSERT INTO "Incident" ("_id","projectId","title","slug","currentIncidentStateId","incidentSeverityId","version","createdAt","postmortemStatusId") VALUES ($1,$2,'Checkout is down',$3,$4,$5,1,$6,$7)`,
        [
          incidentId,
          project.projectId,
          `incident-${incidentId}`,
          isResolved
            ? project.incidentStates.resolved
            : project.incidentStates.created,
          project.incidentSeverity,
          daysAgo(shape.openedDaysAgo),
          shape.postmortemStatusId || null,
        ],
      );

      if (!shape.withoutTimeline) {
        await database.query(
          `INSERT INTO "IncidentStateTimeline" ("_id","projectId","incidentId","incidentStateId","version","startsAt","createdAt") VALUES ($1,$2,$3,$4,1,$5,$5)`,
          [
            id(),
            project.projectId,
            incidentId,
            project.incidentStates.created,
            daysAgo(shape.openedDaysAgo),
          ],
        );

        if (isResolved) {
          await database.query(
            `INSERT INTO "IncidentStateTimeline" ("_id","projectId","incidentId","incidentStateId","version","startsAt","createdAt") VALUES ($1,$2,$3,$4,1,$5,$5)`,
            [
              id(),
              project.projectId,
              incidentId,
              project.incidentStates.resolved,
              daysAgo(shape.resolvedDaysAgo!),
            ],
          );
        }
      }

      await database.query(
        `INSERT INTO "IncidentInternalNote" ("_id","projectId","incidentId","note","version") VALUES ($1,$2,$3,'Restarted the payment pods.',1)`,
        [id(), project.projectId, incidentId],
      );
      await database.query(
        `INSERT INTO "IncidentFeed" ("_id","projectId","incidentId","feedInfoInMarkdown","incidentFeedEventType","displayColor","version") VALUES ($1,$2,$3,'Incident created','IncidentCreated','#000000',1)`,
        [id(), project.projectId, incidentId],
      );

      return incidentId;
    }

    async function addAlert(
      project: SeededProject,
      shape: RecordShape,
    ): Promise<string> {
      const alertId: string = id();
      const isResolved: boolean = shape.resolvedDaysAgo !== undefined;

      await database.query(
        `INSERT INTO "Alert" ("_id","projectId","title","currentAlertStateId","alertSeverityId","version","createdAt") VALUES ($1,$2,'Checkout latency',$3,$4,1,$5)`,
        [
          alertId,
          project.projectId,
          isResolved
            ? project.alertStates.resolved
            : project.alertStates.created,
          project.alertSeverity,
          daysAgo(shape.openedDaysAgo),
        ],
      );

      await database.query(
        `INSERT INTO "AlertStateTimeline" ("_id","projectId","alertId","alertStateId","version","startsAt","createdAt") VALUES ($1,$2,$3,$4,1,$5,$5)`,
        [
          id(),
          project.projectId,
          alertId,
          project.alertStates.created,
          daysAgo(shape.openedDaysAgo),
        ],
      );

      if (isResolved) {
        await database.query(
          `INSERT INTO "AlertStateTimeline" ("_id","projectId","alertId","alertStateId","version","startsAt","createdAt") VALUES ($1,$2,$3,$4,1,$5,$5)`,
          [
            id(),
            project.projectId,
            alertId,
            project.alertStates.resolved,
            daysAgo(shape.resolvedDaysAgo!),
          ],
        );
      }

      await database.query(
        `INSERT INTO "AlertInternalNote" ("_id","projectId","alertId","note","version") VALUES ($1,$2,$3,'Scaled the API.',1)`,
        [id(), project.projectId, alertId],
      );
      await database.query(
        `INSERT INTO "AlertFeed" ("_id","projectId","alertId","feedInfoInMarkdown","alertFeedEventType","displayColor","version") VALUES ($1,$2,$3,'Alert created','AlertCreated','#000000',1)`,
        [id(), project.projectId, alertId],
      );

      return alertId;
    }

    async function addEpisode(
      kind: ResolvedRecordKind,
      project: SeededProject,
      shape: EpisodeShape,
    ): Promise<string> {
      const episodeId: string = id();
      const k: string = kind;
      const lower: string = kind.toLowerCase();
      const states: SeededProject["incidentStates"] =
        kind === ResolvedRecordKind.Incident
          ? project.incidentStates
          : project.alertStates;
      const isResolved: boolean = shape.resolvedDaysAgo !== undefined;
      const openedDaysAgo: number =
        shape.openedDaysAgo ?? (shape.resolvedDaysAgo ?? 0) + 10;
      const members: Array<string> = shape.members || [];
      const postmortemColumn: string =
        kind === ResolvedRecordKind.Incident ? `,"postmortemNote"` : "";
      const postmortemValue: string =
        kind === ResolvedRecordKind.Incident ? `,$8` : "";
      const params: Array<unknown> = [
        episodeId,
        project.projectId,
        isResolved ? states.resolved : states.created,
        daysAgo(openedDaysAgo),
        isResolved ? daysAgo(shape.resolvedDaysAgo!) : null,
        members.length,
        `${k} episode`,
      ];

      if (kind === ResolvedRecordKind.Incident) {
        params.push(shape.postmortemNote || null);
      }

      await database.query(
        `INSERT INTO "${k}Episode" ("_id","projectId","current${k}StateId","version","createdAt","resolvedAt","${lower}Count","title"${postmortemColumn}) VALUES ($1,$2,$3,1,$4,$5,$6,$7${postmortemValue})`,
        params,
      );

      await database.query(
        `INSERT INTO "${k}EpisodeStateTimeline" ("_id","projectId","${lower}EpisodeId","${lower}StateId","version","startsAt") VALUES ($1,$2,$3,$4,1,$5)`,
        [
          id(),
          project.projectId,
          episodeId,
          states.created,
          daysAgo(openedDaysAgo),
        ],
      );

      if (isResolved) {
        await database.query(
          `INSERT INTO "${k}EpisodeStateTimeline" ("_id","projectId","${lower}EpisodeId","${lower}StateId","version","startsAt") VALUES ($1,$2,$3,$4,1,$5)`,
          [
            id(),
            project.projectId,
            episodeId,
            states.resolved,
            daysAgo(shape.resolvedDaysAgo!),
          ],
        );
      }

      for (const member of members) {
        await database.query(
          `INSERT INTO "${k}EpisodeMember" ("_id","projectId","${lower}EpisodeId","${lower}Id","version") VALUES ($1,$2,$3,$4,1)`,
          [id(), project.projectId, episodeId, member],
        );
      }

      return episodeId;
    }

    async function linkAlertToIncident(
      project: SeededProject,
      alertId: string,
      incidentId: string,
    ): Promise<void> {
      await database.query(
        `INSERT INTO "IncidentAlert" ("_id","projectId","incidentId","alertId","version") VALUES ($1,$2,$3,$4,1)`,
        [id(), project.projectId, incidentId, alertId],
      );
    }

    async function exists(table: string, rowId: string): Promise<boolean> {
      const rows: Array<unknown> = await database.query(
        `SELECT 1 FROM "${table}" WHERE "_id" = $1`,
        [rowId],
      );
      return rows.length > 0;
    }

    async function countWhere(
      table: string,
      column: string,
      value: string,
    ): Promise<number> {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT count(*)::text AS "count" FROM "${table}" WHERE "${column}" = $1`,
        [value],
      );
      return Number(rows[0]?.count || 0);
    }

    async function purge(
      kind: ResolvedRecordKind,
      project: SeededProject,
      settings: { retentionInDays: number; keepCompletedPostmortems: boolean },
    ): Promise<ResolvedRecordRetentionResult> {
      return await ResolvedRecordRetention.purgeProject({
        kind,
        projectId: project.projectId,
        retentionInDays: settings.retentionInDays,
        keepCompletedPostmortems: settings.keepCompletedPostmortems,
      });
    }

    test("the indexes the cascades lean on were built", async () => {
      const rows: Array<{ indexname: string }> = await database.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)`,
        [
          [
            "IDX_4215567ecaeb1db1ef3d6cc2e6",
            "IDX_336ded09ba7bfaab73f0d05850",
            "IDX_e0815e51bbeb69666c0030d256",
            "IDX_a230899d6c2b16621954c46fb1",
            "IDX_b495684ae5b9c2a5b8dba6c1d4",
            "IDX_eeb0dd05d1dec542c3de5fb507",
            "IDX_0ee3711cdc64957845d9d028c3",
            "IDX_114aa962f2bc3c6736a1469df3",
            "IDX_587fec46a331e53d72bb6c72fd",
            "IDX_cdb94d76dcf480f39d0785a9fc",
          ],
        ],
      );

      expect(rows).toHaveLength(10);
    });

    test("a new project keeps every incident and alert, and keeps completed postmortems", async () => {
      const projectId: string = id();
      projects.push(projectId);

      await database.query(
        `INSERT INTO "Project" ("_id","name","slug","version") VALUES ($1,'Defaults',$2,1)`,
        [projectId, `defaults-${projectId}`],
      );

      const rows: Array<Record<string, unknown>> = await database.query(
        `SELECT "incidentRetentionInDays", "alertRetentionInDays", "keepIncidentsWithCompletedPostmortem" FROM "Project" WHERE "_id" = $1`,
        [projectId],
      );

      expect(rows[0]).toEqual({
        incidentRetentionInDays: 0,
        alertRetentionInDays: 0,
        keepIncidentsWithCompletedPostmortem: true,
      });
    });

    describe("incidents, kept 90 days, completed postmortems kept", () => {
      let project: SeededProject;
      const ids: Record<string, string> = {};
      let result: ResolvedRecordRetentionResult;

      beforeAll(async () => {
        project = await seedProject({
          incidentRetentionInDays: 90,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });

        ids["oldResolved"] = await addIncident(project, {
          openedDaysAgo: 200,
          resolvedDaysAgo: 150,
        });
        ids["resolvedLastWeek"] = await addIncident(project, {
          openedDaysAgo: 400,
          resolvedDaysAgo: 7,
        });
        ids["neverResolved"] = await addIncident(project, {
          openedDaysAgo: 400,
        });
        ids["completedPostmortem"] = await addIncident(project, {
          openedDaysAgo: 200,
          resolvedDaysAgo: 150,
          postmortemStatusId: project.completedPostmortemStatus,
        });
        ids["draftPostmortem"] = await addIncident(project, {
          openedDaysAgo: 200,
          resolvedDaysAgo: 150,
          postmortemStatusId: project.draftPostmortemStatus,
        });
        ids["openedRecentlyNoTimeline"] = await addIncident(project, {
          openedDaysAgo: 20,
          resolvedDaysAgo: 20,
          withoutTimeline: true,
        });
        ids["oldNoTimeline"] = await addIncident(project, {
          openedDaysAgo: 500,
          resolvedDaysAgo: 500,
          withoutTimeline: true,
        });
        ids["inOpenEpisode"] = await addIncident(project, {
          openedDaysAgo: 200,
          resolvedDaysAgo: 150,
        });
        ids["inRecentEpisode"] = await addIncident(project, {
          openedDaysAgo: 200,
          resolvedDaysAgo: 150,
        });
        ids["inOldEpisodeA"] = await addIncident(project, {
          openedDaysAgo: 200,
          resolvedDaysAgo: 150,
        });
        ids["inOldEpisodeB"] = await addIncident(project, {
          openedDaysAgo: 210,
          resolvedDaysAgo: 140,
        });
        ids["inHalfKeptEpisodeGone"] = await addIncident(project, {
          openedDaysAgo: 200,
          resolvedDaysAgo: 150,
        });
        ids["inHalfKeptEpisodeKept"] = await addIncident(project, {
          openedDaysAgo: 200,
          resolvedDaysAgo: 150,
          postmortemStatusId: project.completedPostmortemStatus,
        });

        ids["openEpisode"] = await addEpisode(
          ResolvedRecordKind.Incident,
          project,
          {
            openedDaysAgo: 160,
            members: [ids["inOpenEpisode"]!],
          },
        );
        ids["recentEpisode"] = await addEpisode(
          ResolvedRecordKind.Incident,
          project,
          {
            resolvedDaysAgo: 20,
            members: [ids["inRecentEpisode"]!],
          },
        );
        ids["oldEpisode"] = await addEpisode(
          ResolvedRecordKind.Incident,
          project,
          {
            resolvedDaysAgo: 120,
            members: [ids["inOldEpisodeA"]!, ids["inOldEpisodeB"]!],
          },
        );
        ids["halfKeptEpisode"] = await addEpisode(
          ResolvedRecordKind.Incident,
          project,
          {
            resolvedDaysAgo: 120,
            members: [
              ids["inHalfKeptEpisodeGone"]!,
              ids["inHalfKeptEpisodeKept"]!,
            ],
          },
        );
        ids["oldEmptyEpisodeWithPostmortem"] = await addEpisode(
          ResolvedRecordKind.Incident,
          project,
          {
            resolvedDaysAgo: 120,
            postmortemNote: "The payment provider's certificate expired.",
          },
        );
        ids["oldEmptyEpisodeBlankPostmortem"] = await addEpisode(
          ResolvedRecordKind.Incident,
          project,
          { resolvedDaysAgo: 120, postmortemNote: "   " },
        );
        ids["recentEmptyEpisode"] = await addEpisode(
          ResolvedRecordKind.Incident,
          project,
          {
            resolvedDaysAgo: 10,
          },
        );

        result = await purge(ResolvedRecordKind.Incident, project, {
          retentionInDays: 90,
          keepCompletedPostmortems: true,
        });
      });

      test.each([
        "oldResolved",
        "draftPostmortem",
        "oldNoTimeline",
        "inOldEpisodeA",
        "inOldEpisodeB",
        "inHalfKeptEpisodeGone",
      ])("deletes %s", async (name: string) => {
        expect(await exists("Incident", ids[name]!)).toBe(false);
      });

      test.each([
        "resolvedLastWeek",
        "neverResolved",
        "completedPostmortem",
        "openedRecentlyNoTimeline",
        "inOpenEpisode",
        "inRecentEpisode",
        "inHalfKeptEpisodeKept",
      ])("keeps %s", async (name: string) => {
        expect(await exists("Incident", ids[name]!)).toBe(true);
      });

      test("says how many went", () => {
        expect(result).toEqual({ records: 6, episodes: 2 });
      });

      test("a deleted incident's state timeline, notes and feed go with it; a kept one's stay", async () => {
        for (const table of [
          "IncidentStateTimeline",
          "IncidentInternalNote",
          "IncidentFeed",
        ]) {
          expect(
            await countWhere(table, "incidentId", ids["oldResolved"]!),
          ).toBe(0);
          expect(
            await countWhere(table, "incidentId", ids["resolvedLastWeek"]!),
          ).toBeGreaterThan(0);
        }
      });

      test("an episode with none of its incidents left, resolved long ago, goes - with its own timeline", async () => {
        expect(await exists("IncidentEpisode", ids["oldEpisode"]!)).toBe(false);
        expect(
          await exists(
            "IncidentEpisode",
            ids["oldEmptyEpisodeBlankPostmortem"]!,
          ),
        ).toBe(false);
        expect(
          await countWhere(
            "IncidentEpisodeStateTimeline",
            "incidentEpisodeId",
            ids["oldEpisode"]!,
          ),
        ).toBe(0);
      });

      test("an episode still open, resolved lately, or with a postmortem written stays", async () => {
        for (const name of [
          "openEpisode",
          "recentEpisode",
          "oldEmptyEpisodeWithPostmortem",
          "recentEmptyEpisode",
          "halfKeptEpisode",
        ]) {
          expect({
            name,
            kept: await exists("IncidentEpisode", ids[name]!),
          }).toEqual({
            name,
            kept: true,
          });
        }
      });

      test("an episode that lost a member and stays is counted again", async () => {
        const rows: Array<{ count: number }> = await database.query(
          `SELECT "incidentCount" AS "count" FROM "IncidentEpisode" WHERE "_id" = $1`,
          [ids["halfKeptEpisode"]],
        );

        expect(Number(rows[0]?.count)).toBe(1);
        expect(
          await countWhere(
            "IncidentEpisodeMember",
            "incidentEpisodeId",
            ids["halfKeptEpisode"]!,
          ),
        ).toBe(1);
      });

      test("a second run deletes nothing more", async () => {
        expect(
          await purge(ResolvedRecordKind.Incident, project, {
            retentionInDays: 90,
            keepCompletedPostmortems: true,
          }),
        ).toEqual({ records: 0, episodes: 0 });
      });

      test("a longer retention deletes nothing that a shorter one kept", async () => {
        const before: number = await countWhere(
          "Incident",
          "projectId",
          project.projectId,
        );

        await purge(ResolvedRecordKind.Incident, project, {
          retentionInDays: 365,
          keepCompletedPostmortems: true,
        });

        expect(
          await countWhere("Incident", "projectId", project.projectId),
        ).toBe(before);
      });
    });

    describe("incidents, once a project stops keeping completed postmortems", () => {
      test("an incident with a completed postmortem goes, and so does an emptied episode with a postmortem", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 30,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: false,
        });
        const incidentId: string = await addIncident(project, {
          openedDaysAgo: 100,
          resolvedDaysAgo: 60,
          postmortemStatusId: project.completedPostmortemStatus,
        });
        const episodeId: string = await addEpisode(
          ResolvedRecordKind.Incident,
          project,
          {
            resolvedDaysAgo: 45,
            postmortemNote: "Root cause: an expired certificate.",
          },
        );

        const result: ResolvedRecordRetentionResult = await purge(
          ResolvedRecordKind.Incident,
          project,
          { retentionInDays: 30, keepCompletedPostmortems: false },
        );

        expect(result).toEqual({ records: 1, episodes: 1 });
        expect(await exists("Incident", incidentId)).toBe(false);
        expect(await exists("IncidentEpisode", episodeId)).toBe(false);
      });
    });

    describe("alerts, kept 30 days", () => {
      let project: SeededProject;
      const ids: Record<string, string> = {};

      beforeAll(async () => {
        project = await seedProject({
          incidentRetentionInDays: 90,
          alertRetentionInDays: 30,
          keepIncidentsWithCompletedPostmortem: true,
        });

        ids["openIncident"] = await addIncident(project, {
          openedDaysAgo: 100,
        });
        ids["oldIncident"] = await addIncident(project, {
          openedDaysAgo: 200,
          resolvedDaysAgo: 150,
        });

        ids["oldResolved"] = await addAlert(project, {
          openedDaysAgo: 100,
          resolvedDaysAgo: 60,
        });
        ids["resolvedYesterday"] = await addAlert(project, {
          openedDaysAgo: 100,
          resolvedDaysAgo: 1,
        });
        ids["neverResolved"] = await addAlert(project, { openedDaysAgo: 100 });
        ids["linkedToOpenIncident"] = await addAlert(project, {
          openedDaysAgo: 100,
          resolvedDaysAgo: 60,
        });
        ids["linkedToOldIncident"] = await addAlert(project, {
          openedDaysAgo: 200,
          resolvedDaysAgo: 160,
        });
        ids["inOldEpisode"] = await addAlert(project, {
          openedDaysAgo: 100,
          resolvedDaysAgo: 60,
        });
        ids["inOpenEpisode"] = await addAlert(project, {
          openedDaysAgo: 100,
          resolvedDaysAgo: 60,
        });

        await linkAlertToIncident(
          project,
          ids["linkedToOpenIncident"]!,
          ids["openIncident"]!,
        );
        await linkAlertToIncident(
          project,
          ids["linkedToOldIncident"]!,
          ids["oldIncident"]!,
        );

        ids["oldEpisode"] = await addEpisode(
          ResolvedRecordKind.Alert,
          project,
          {
            resolvedDaysAgo: 45,
            members: [ids["inOldEpisode"]!],
          },
        );
        ids["openEpisode"] = await addEpisode(
          ResolvedRecordKind.Alert,
          project,
          {
            openedDaysAgo: 70,
            members: [ids["inOpenEpisode"]!],
          },
        );
      });

      test("deletes the alerts resolved for longer, keeps the rest, and an alert linked to an incident stays while the incident does", async () => {
        const result: ResolvedRecordRetentionResult = await purge(
          ResolvedRecordKind.Alert,
          project,
          { retentionInDays: 30, keepCompletedPostmortems: false },
        );

        expect(result).toEqual({ records: 2, episodes: 1 });
        expect(await exists("Alert", ids["oldResolved"]!)).toBe(false);
        expect(await exists("Alert", ids["inOldEpisode"]!)).toBe(false);
        expect(await exists("AlertEpisode", ids["oldEpisode"]!)).toBe(false);

        for (const name of [
          "resolvedYesterday",
          "neverResolved",
          "linkedToOpenIncident",
          "linkedToOldIncident",
          "inOpenEpisode",
        ]) {
          expect({ name, kept: await exists("Alert", ids[name]!) }).toEqual({
            name,
            kept: true,
          });
        }

        expect(await exists("AlertEpisode", ids["openEpisode"]!)).toBe(true);

        for (const table of [
          "AlertStateTimeline",
          "AlertInternalNote",
          "AlertFeed",
        ]) {
          expect(await countWhere(table, "alertId", ids["oldResolved"]!)).toBe(
            0,
          );
          expect(
            await countWhere(table, "alertId", ids["resolvedYesterday"]!),
          ).toBeGreaterThan(0);
        }
      });

      test("once the incident it was linked to is deleted, the alert goes on the next run", async () => {
        await purge(ResolvedRecordKind.Incident, project, {
          retentionInDays: 90,
          keepCompletedPostmortems: true,
        });

        expect(await exists("Incident", ids["oldIncident"]!)).toBe(false);
        expect(await exists("Incident", ids["openIncident"]!)).toBe(true);
        expect(
          await countWhere(
            "IncidentAlert",
            "alertId",
            ids["linkedToOldIncident"]!,
          ),
        ).toBe(0);

        const result: ResolvedRecordRetentionResult = await purge(
          ResolvedRecordKind.Alert,
          project,
          { retentionInDays: 30, keepCompletedPostmortems: false },
        );

        expect(result.records).toBe(1);
        expect(await exists("Alert", ids["linkedToOldIncident"]!)).toBe(false);
        expect(await exists("Alert", ids["linkedToOpenIncident"]!)).toBe(true);
      });
    });

    describe("a record reopened between the read and the delete", () => {
      test("stays: the delete is held to the states that count as resolved", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 30,
          alertRetentionInDays: 30,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const incidentId: string = await addIncident(project, {
          openedDaysAgo: 100,
          resolvedDaysAgo: 60,
        });

        // Read as due, then reopened before the delete runs.
        await database.query(
          `UPDATE "Incident" SET "currentIncidentStateId" = $1 WHERE "_id" = $2`,
          [project.incidentStates.acknowledged, incidentId],
        );

        const deleted: number = await ResolvedRecordRetention.deleteRecords({
          kind: ResolvedRecordKind.Incident,
          projectId: new ObjectID(project.projectId),
          ids: [incidentId],
          resolvedStateIds: [new ObjectID(project.incidentStates.resolved)],
        });

        expect(deleted).toBe(0);
        expect(await exists("Incident", incidentId)).toBe(true);
      });

      test("and a delete never reaches another project's records", async () => {
        const mine: SeededProject = await seedProject({
          incidentRetentionInDays: 30,
          alertRetentionInDays: 30,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const theirs: SeededProject = await seedProject({
          incidentRetentionInDays: 0,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const theirAlert: string = await addAlert(theirs, {
          openedDaysAgo: 100,
          resolvedDaysAgo: 60,
        });

        const deleted: number = await ResolvedRecordRetention.deleteRecords({
          kind: ResolvedRecordKind.Alert,
          projectId: new ObjectID(mine.projectId),
          ids: [theirAlert],
          resolvedStateIds: [new ObjectID(theirs.alertStates.resolved)],
        });

        expect(deleted).toBe(0);
        expect(await exists("Alert", theirAlert)).toBe(true);
      });
    });

    describe("run: every project that keeps resolved records for a while", () => {
      test("works on the projects with a length, and never on one at Never", async () => {
        const keeping: SeededProject = await seedProject({
          incidentRetentionInDays: 60,
          alertRetentionInDays: 60,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const never: SeededProject = await seedProject({
          incidentRetentionInDays: 0,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const due: string = await addIncident(keeping, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
        });
        const kept: string = await addIncident(never, {
          openedDaysAgo: 3000,
          resolvedDaysAgo: 2900,
        });
        const keptAlert: string = await addAlert(never, {
          openedDaysAgo: 3000,
          resolvedDaysAgo: 2900,
        });

        const summary: ResolvedRecordRetentionSummary =
          await ResolvedRecordRetention.run({
            kind: ResolvedRecordKind.Incident,
          });
        const alertSummary: ResolvedRecordRetentionSummary =
          await ResolvedRecordRetention.run({ kind: ResolvedRecordKind.Alert });

        expect(summary.failedProjects).toBe(0);
        expect(summary.isCutShort).toBe(false);
        expect(summary.records).toBeGreaterThanOrEqual(1);
        expect(alertSummary.failedProjects).toBe(0);
        expect(await exists("Incident", due)).toBe(false);
        expect(await exists("Incident", kept)).toBe(true);
        expect(await exists("Alert", keptAlert)).toBe(true);
      });

      test("a deleted project's records are never looked at", async () => {
        const gone: SeededProject = await seedProject({
          incidentRetentionInDays: 30,
          alertRetentionInDays: 30,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const incidentId: string = await addIncident(gone, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
        });

        await database.query(
          `UPDATE "Project" SET "deletedAt" = now() WHERE "_id" = $1`,
          [gone.projectId],
        );

        await ResolvedRecordRetention.run({
          kind: ResolvedRecordKind.Incident,
        });

        expect(await exists("Incident", incidentId)).toBe(true);
      });
    });
  },
);
