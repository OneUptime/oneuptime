import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import ResolvedRecordRetention, {
  DueRecordsCount,
  DueRetentionProject,
  DueRetentionProjectsPage,
  ResolvedRecordRetentionResult,
  ResolvedRecordRetentionSummary,
  buildDueRecordsCountStatement,
  buildProjectsReachedByMaximumStatement,
} from "../../../../Server/Utils/Retention/ResolvedRecordRetention";
import ProjectService, {
  KEPT_POSTMORTEM_STATUS_NOT_THE_PROJECTS_MESSAGE,
} from "../../../../Server/Services/ProjectService";
import CustomFieldFiles from "../../../../Server/Utils/CustomField/CustomFieldFiles";
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

      // Workflows run elsewhere.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        if (projects.length > 0) {
          // Files name their project with no foreign key, so they go first.
          await database.query(
            `DELETE FROM "File" WHERE "projectId" = ANY($1)`,
            [projects],
          );
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

    /*
     * ISSUES #6941, #6943, #6944 AND #6945, against the migrated database:
     * the server's maximum, the count of what a setting deletes, the files
     * attached to what is deleted, and the postmortem statuses that keep an
     * incident. Every read and purge is held to this suite's own projects,
     * and nothing on the server's config is written: the maximum is handed
     * to the reads as GlobalConfig would give it.
     */
    async function addPostmortemStatus(
      project: SeededProject,
      name: string,
      order: number,
    ): Promise<string> {
      const statusId: string = id();

      await database.query(
        `INSERT INTO "IncidentPostmortemStatus" ("_id","projectId","name","slug","color","order","version","isCompletedStatus") VALUES ($1,$2,$3,$4,'#888888',$5,1,false)`,
        [statusId, project.projectId, name, `${name}-${statusId}`, order],
      );

      return statusId;
    }

    async function addFile(project: SeededProject): Promise<string> {
      const fileId: string = id();

      await database.query(
        `INSERT INTO "File" ("_id","version","file","name","fileType","slug","projectId") VALUES ($1,1,$2,'runbook.pdf','application/pdf',$3,$4)`,
        [
          fileId,
          Buffer.from("%PDF-1.7\n"),
          `runbook-${fileId}`,
          project.projectId,
        ],
      );

      return fileId;
    }

    async function attachToNote(data: {
      noteTable: string;
      recordColumn: string;
      recordId: string;
      project: SeededProject;
      fileIds: Array<string>;
    }): Promise<string> {
      const noteId: string = id();
      const joinColumn: string = `${data.noteTable.charAt(0).toLowerCase()}${data.noteTable.slice(1)}Id`;

      await database.query(
        `INSERT INTO "${data.noteTable}" ("_id","projectId","${data.recordColumn}","note","version") VALUES ($1,$2,$3,'See the attached runbook.',1)`,
        [noteId, data.project.projectId, data.recordId],
      );

      for (const fileId of data.fileIds) {
        await database.query(
          `INSERT INTO "${data.noteTable}File" ("${joinColumn}","fileId") VALUES ($1,$2)`,
          [noteId, fileId],
        );
      }

      return noteId;
    }

    // Every page of the projects due, read for this suite's projects alone.
    async function dueProjectsOfOurs(
      kind: ResolvedRecordKind,
      maximumInDays: number | undefined,
    ): Promise<Map<string, DueRetentionProject>> {
      const ours: Map<string, DueRetentionProject> = new Map();
      let afterProjectId: string | undefined = undefined;

      do {
        const page: DueRetentionProjectsPage =
          await ResolvedRecordRetention.findDueProjects({
            kind,
            afterProjectId,
            maximumInDays,
          });

        for (const project of page.projects) {
          if (projects.includes(project.projectId)) {
            ours.set(project.projectId, project);
          }
        }

        afterProjectId = page.nextAfterProjectId;
      } while (afterProjectId);

      return ours;
    }

    describe("the server's maximum (issue #6941)", () => {
      test("every project is held to it: Never and longer lengths read as the maximum, shorter ones keep their own", async () => {
        const never: SeededProject = await seedProject({
          incidentRetentionInDays: 0,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const longer: SeededProject = await seedProject({
          incidentRetentionInDays: 1095,
          alertRetentionInDays: 1095,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const shorter: SeededProject = await seedProject({
          incidentRetentionInDays: 30,
          alertRetentionInDays: 30,
          keepIncidentsWithCompletedPostmortem: false,
        });

        const capped: Map<string, DueRetentionProject> =
          await dueProjectsOfOurs(ResolvedRecordKind.Incident, 90);

        expect(capped.get(never.projectId)?.retentionInDays).toBe(90);
        expect(capped.get(longer.projectId)?.retentionInDays).toBe(90);
        expect(capped.get(shorter.projectId)?.retentionInDays).toBe(30);
        expect(capped.get(shorter.projectId)?.keepCompletedPostmortems).toBe(
          false,
        );
        expect(capped.get(never.projectId)?.keepCompletedPostmortems).toBe(
          true,
        );

        // With no maximum, Never is never due.
        const uncapped: Map<string, DueRetentionProject> =
          await dueProjectsOfOurs(ResolvedRecordKind.Alert, undefined);

        expect(uncapped.has(never.projectId)).toBe(false);
        expect(uncapped.get(longer.projectId)?.retentionInDays).toBe(1095);

        // The projects' own settings are never rewritten.
        const rows: Array<{ incidentRetentionInDays: number }> =
          await database.query(
            `SELECT "incidentRetentionInDays" FROM "Project" WHERE "_id" = $1`,
            [never.projectId],
          );
        expect(rows[0]!.incidentRetentionInDays).toBe(0);
      });

      test("a project at Never loses what is older than the maximum, keeps the rest and its written-up incidents", async () => {
        const never: SeededProject = await seedProject({
          incidentRetentionInDays: 0,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const old: string = await addIncident(never, {
          openedDaysAgo: 400,
          resolvedDaysAgo: 120,
        });
        const recent: string = await addIncident(never, {
          openedDaysAgo: 400,
          resolvedDaysAgo: 60,
        });
        const writtenUp: string = await addIncident(never, {
          openedDaysAgo: 400,
          resolvedDaysAgo: 120,
          postmortemStatusId: never.completedPostmortemStatus,
        });

        const due: DueRetentionProject = (
          await dueProjectsOfOurs(ResolvedRecordKind.Incident, 90)
        ).get(never.projectId)!;

        const result: ResolvedRecordRetentionResult =
          await ResolvedRecordRetention.purgeProject({
            kind: ResolvedRecordKind.Incident,
            projectId: due.projectId,
            retentionInDays: due.retentionInDays,
            keepCompletedPostmortems: due.keepCompletedPostmortems,
            keptPostmortemStatusIds: due.keptPostmortemStatusIds,
          });

        expect(result.records).toBe(1);
        expect(await exists("Incident", old)).toBe(false);
        expect(await exists("Incident", recent)).toBe(true);
        expect(await exists("Incident", writtenUp)).toBe(true);
      });

      test("the projects a new maximum reaches: those at Never and those keeping longer", async () => {
        const never: SeededProject = await seedProject({
          incidentRetentionInDays: 0,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const longer: SeededProject = await seedProject({
          incidentRetentionInDays: 730,
          alertRetentionInDays: 30,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const within: SeededProject = await seedProject({
          incidentRetentionInDays: 180,
          alertRetentionInDays: 30,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const ours: Array<string> = [
          never.projectId,
          longer.projectId,
          within.projectId,
        ];

        // The real predicate, on this suite's projects alone.
        const reached: (
          kind: ResolvedRecordKind,
          maximumInDays: number,
          currentMaximumInDays?: number,
        ) => Promise<number> = async (
          kind: ResolvedRecordKind,
          maximumInDays: number,
          currentMaximumInDays?: number,
        ): Promise<number> => {
          const statement: { sql: string; params: Array<unknown> } =
            buildProjectsReachedByMaximumStatement({
              kind,
              maximumInDays,
              currentMaximumInDays,
            });
          const rows: Array<{ count: number }> = await database.query(
            `${statement.sql} AND p."_id" = ANY($${statement.params.length + 1}::uuid[])`,
            [...statement.params, ours],
          );

          return Number(rows[0]!.count);
        };

        expect(await reached(ResolvedRecordKind.Incident, 365)).toBe(2);
        expect(await reached(ResolvedRecordKind.Incident, 90)).toBe(3);
        expect(await reached(ResolvedRecordKind.Incident, 1095)).toBe(1);
        expect(await reached(ResolvedRecordKind.Alert, 30)).toBe(1);
        // Under a maximum of 365 already, 730 is kept 365: a new 365 reaches nobody new.
        expect(await reached(ResolvedRecordKind.Incident, 365, 365)).toBe(0);
        expect(await reached(ResolvedRecordKind.Incident, 90, 365)).toBe(3);
      });
    });

    describe("how many a setting deletes (issue #6943)", () => {
      test("the count is what the purge then deletes, incidents and alerts alike", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 0,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });

        for (let i: number = 0; i < 3; i++) {
          await addIncident(project, {
            openedDaysAgo: 300,
            resolvedDaysAgo: 200,
          });
        }

        // Kept: resolved lately, open, written up, in an open episode.
        await addIncident(project, { openedDaysAgo: 300, resolvedDaysAgo: 10 });
        await addIncident(project, { openedDaysAgo: 300 });
        await addIncident(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
          postmortemStatusId: project.completedPostmortemStatus,
        });
        const inEpisode: string = await addIncident(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
        });
        await addEpisode(ResolvedRecordKind.Incident, project, {
          members: [inEpisode],
        });

        const dueAlert: string = await addAlert(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
        });
        const linkedAlert: string = await addAlert(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
        });
        await linkAlertToIncident(project, linkedAlert, inEpisode);

        const count: DueRecordsCount =
          await ResolvedRecordRetention.countDueRecords({
            kind: ResolvedRecordKind.Incident,
            projectId: new ObjectID(project.projectId),
            retentionInDays: 90,
            keepCompletedPostmortems: true,
          });
        const alertCount: DueRecordsCount =
          await ResolvedRecordRetention.countDueRecords({
            kind: ResolvedRecordKind.Alert,
            projectId: new ObjectID(project.projectId),
            retentionInDays: 90,
            keepCompletedPostmortems: true,
          });

        expect(count).toEqual({ count: 3, isAtLeast: false });
        expect(alertCount).toEqual({ count: 1, isAtLeast: false });

        // Without keeping completed postmortems, the written-up one is counted too.
        expect(
          (
            await ResolvedRecordRetention.countDueRecords({
              kind: ResolvedRecordKind.Incident,
              projectId: new ObjectID(project.projectId),
              retentionInDays: 90,
              keepCompletedPostmortems: false,
            })
          ).count,
        ).toBe(4);

        // Nothing yet at three years.
        expect(
          (
            await ResolvedRecordRetention.countDueRecords({
              kind: ResolvedRecordKind.Incident,
              projectId: new ObjectID(project.projectId),
              retentionInDays: 1095,
              keepCompletedPostmortems: true,
            })
          ).count,
        ).toBe(0);

        const purged: ResolvedRecordRetentionResult = await purge(
          ResolvedRecordKind.Incident,
          project,
          { retentionInDays: 90, keepCompletedPostmortems: true },
        );
        const purgedAlerts: ResolvedRecordRetentionResult = await purge(
          ResolvedRecordKind.Alert,
          project,
          { retentionInDays: 90, keepCompletedPostmortems: true },
        );

        expect(purged.records).toBe(count.count);
        expect(purgedAlerts.records).toBe(alertCount.count);
        expect(await exists("Alert", dueAlert)).toBe(false);
        expect(await exists("Alert", linkedAlert)).toBe(true);

        // And once it has run, nothing is left to count.
        expect(
          (
            await ResolvedRecordRetention.countDueRecords({
              kind: ResolvedRecordKind.Incident,
              projectId: new ObjectID(project.projectId),
              retentionInDays: 90,
              keepCompletedPostmortems: true,
            })
          ).count,
        ).toBe(0);
      });

      test("under the server's maximum, a project at Never is counted for the maximum", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 0,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });
        await addIncident(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
        });
        await addIncident(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 100,
        });

        const counted: (maximumInDays?: number) => Promise<number> = async (
          maximumInDays?: number,
        ): Promise<number> => {
          return (
            await ResolvedRecordRetention.countDueRecords({
              kind: ResolvedRecordKind.Incident,
              projectId: new ObjectID(project.projectId),
              retentionInDays: 0,
              keepCompletedPostmortems: true,
              maximumInDays,
            })
          ).count;
        };

        expect(await counted()).toBe(0);
        expect(await counted(180)).toBe(1);
        expect(await counted(90)).toBe(2);
      });

      test("the count reads no further than its bound", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 30,
          alertRetentionInDays: 30,
          keepIncidentsWithCompletedPostmortem: true,
        });

        for (let i: number = 0; i < 3; i++) {
          await addIncident(project, {
            openedDaysAgo: 300,
            resolvedDaysAgo: 200,
          });
        }

        const statement: { sql: string; params: Array<unknown> } =
          buildDueRecordsCountStatement({
            kind: ResolvedRecordKind.Incident,
            projectId: project.projectId,
            resolvedStateIds: [project.incidentStates.resolved],
            cutoff: daysAgo(30),
            upTo: 2,
          });

        const rows: Array<{ count: number }> = await database.query(
          statement.sql,
          statement.params,
        );

        expect(Number(rows[0]!.count)).toBe(2);
      });
    });

    describe("the postmortem statuses that keep an incident (issue #6945)", () => {
      test("the statuses a project chose keep their incidents; Not Needed and every other status do not", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 90,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const published: string = await addPostmortemStatus(
          project,
          "Published",
          4,
        );
        const notNeeded: string = await addPostmortemStatus(
          project,
          "Not Needed",
          5,
        );

        await database.query(
          `UPDATE "Project" SET "keepIncidentsInPostmortemStatusIds" = $1::jsonb WHERE "_id" = $2`,
          [
            JSON.stringify([project.completedPostmortemStatus, published]),
            project.projectId,
          ],
        );

        const old: { openedDaysAgo: number; resolvedDaysAgo: number } = {
          openedDaysAgo: 400,
          resolvedDaysAgo: 200,
        };
        const completed: string = await addIncident(project, {
          ...old,
          postmortemStatusId: project.completedPostmortemStatus,
        });
        const inPublished: string = await addIncident(project, {
          ...old,
          postmortemStatusId: published,
        });
        const inNotNeeded: string = await addIncident(project, {
          ...old,
          postmortemStatusId: notNeeded,
        });
        const inDraft: string = await addIncident(project, {
          ...old,
          postmortemStatusId: project.draftPostmortemStatus,
        });
        const withNone: string = await addIncident(project, old);

        const due: DueRetentionProject = (
          await dueProjectsOfOurs(ResolvedRecordKind.Incident, undefined)
        ).get(project.projectId)!;

        // Read from the project's jsonb as the purge reads it.
        expect(due.keptPostmortemStatusIds?.sort()).toEqual(
          [project.completedPostmortemStatus, published].sort(),
        );

        const result: ResolvedRecordRetentionResult =
          await ResolvedRecordRetention.purgeProject({
            kind: ResolvedRecordKind.Incident,
            projectId: due.projectId,
            retentionInDays: due.retentionInDays,
            keepCompletedPostmortems: due.keepCompletedPostmortems,
            keptPostmortemStatusIds: due.keptPostmortemStatusIds,
          });

        expect(result.records).toBe(3);
        expect(await exists("Incident", completed)).toBe(true);
        expect(await exists("Incident", inPublished)).toBe(true);
        expect(await exists("Incident", inNotNeeded)).toBe(false);
        expect(await exists("Incident", inDraft)).toBe(false);
        expect(await exists("Incident", withNone)).toBe(false);
      });

      test("with none chosen, only the Completed status keeps them, as before", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 90,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const published: string = await addPostmortemStatus(
          project,
          "Published",
          4,
        );
        const completed: string = await addIncident(project, {
          openedDaysAgo: 400,
          resolvedDaysAgo: 200,
          postmortemStatusId: project.completedPostmortemStatus,
        });
        const inPublished: string = await addIncident(project, {
          openedDaysAgo: 400,
          resolvedDaysAgo: 200,
          postmortemStatusId: published,
        });

        const due: DueRetentionProject = (
          await dueProjectsOfOurs(ResolvedRecordKind.Incident, undefined)
        ).get(project.projectId)!;

        expect(due.keptPostmortemStatusIds).toBeUndefined();

        await ResolvedRecordRetention.purgeProject({
          kind: ResolvedRecordKind.Incident,
          projectId: due.projectId,
          retentionInDays: due.retentionInDays,
          keepCompletedPostmortems: due.keepCompletedPostmortems,
          keptPostmortemStatusIds: due.keptPostmortemStatusIds,
        });

        expect(await exists("Incident", completed)).toBe(true);
        expect(await exists("Incident", inPublished)).toBe(false);
      });

      test("a project may choose only its own statuses, stored as written", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 90,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const other: SeededProject = await seedProject({
          incidentRetentionInDays: 0,
          alertRetentionInDays: 0,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const published: string = await addPostmortemStatus(
          project,
          "Published",
          4,
        );

        await expect(
          ProjectService.updateOneById({
            id: new ObjectID(project.projectId),
            data: {
              keepIncidentsInPostmortemStatusIds: [
                published,
                other.completedPostmortemStatus,
              ],
            },
            props: { isRoot: true },
          }),
        ).rejects.toThrow(KEPT_POSTMORTEM_STATUS_NOT_THE_PROJECTS_MESSAGE);

        await ProjectService.updateOneById({
          id: new ObjectID(project.projectId),
          data: {
            keepIncidentsInPostmortemStatusIds: [
              published.toUpperCase(),
              project.completedPostmortemStatus,
            ],
          },
          props: { isRoot: true },
        });

        const rows: Array<{
          keepIncidentsInPostmortemStatusIds: Array<string>;
        }> = await database.query(
          `SELECT "keepIncidentsInPostmortemStatusIds" FROM "Project" WHERE "_id" = $1`,
          [project.projectId],
        );

        expect(rows[0]!.keepIncidentsInPostmortemStatusIds).toEqual([
          published,
          project.completedPostmortemStatus,
        ]);
      });
    });

    describe("the files attached to what is deleted (issue #6944)", () => {
      test("every foreign key to File in the database is one the delete reads as holding a file", async () => {
        // A file a foreign key still names is never deleted: some of them cascade (a user's picture).
        const rows: Array<{ tableName: string; columnName: string }> =
          await database.query(`SELECT cl.relname AS "tableName", a.attname AS "columnName"
FROM pg_constraint c
JOIN pg_class cl ON cl.oid = c.conrelid
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f' AND c.confrelid = '"File"'::regclass`);

        const held: Set<string> = new Set(
          CustomFieldFiles.getFileReferenceColumns(
            database.entityMetadatas as unknown as Parameters<
              typeof CustomFieldFiles.getFileReferenceColumns
            >[0],
          ).map((column: { tableName: string; columnName: string }) => {
            return `${column.tableName}.${column.columnName}`;
          }),
        );

        expect(rows.length).toBeGreaterThan(20);

        const missing: Array<string> = rows
          .map((row: { tableName: string; columnName: string }): string => {
            return `${row.tableName}.${row.columnName}`;
          })
          .filter((reference: string): boolean => {
            return !held.has(reference);
          });

        expect(missing).toEqual([]);
      });

      test("an incident's note files and postmortem attachments go with it; a file another note still holds, and a kept incident's, stay", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 90,
          alertRetentionInDays: 90,
          keepIncidentsWithCompletedPostmortem: false,
        });
        const due: string = await addIncident(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
        });
        const kept: string = await addIncident(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 10,
        });

        const internalFile: string = await addFile(project);
        const publicFile: string = await addFile(project);
        const postmortemFile: string = await addFile(project);
        const sharedFile: string = await addFile(project);
        const keptFile: string = await addFile(project);

        await attachToNote({
          noteTable: "IncidentInternalNote",
          recordColumn: "incidentId",
          recordId: due,
          project,
          fileIds: [internalFile, sharedFile],
        });
        await attachToNote({
          noteTable: "IncidentPublicNote",
          recordColumn: "incidentId",
          recordId: due,
          project,
          fileIds: [publicFile],
        });
        await database.query(
          `INSERT INTO "IncidentPostmortemAttachmentFile" ("incidentId","fileId") VALUES ($1,$2)`,
          [due, postmortemFile],
        );
        await attachToNote({
          noteTable: "IncidentInternalNote",
          recordColumn: "incidentId",
          recordId: kept,
          project,
          fileIds: [keptFile, sharedFile],
        });

        const result: ResolvedRecordRetentionResult = await purge(
          ResolvedRecordKind.Incident,
          project,
          { retentionInDays: 90, keepCompletedPostmortems: false },
        );

        expect(result.records).toBe(1);
        expect(await exists("Incident", due)).toBe(false);
        expect(await exists("File", internalFile)).toBe(false);
        expect(await exists("File", publicFile)).toBe(false);
        expect(await exists("File", postmortemFile)).toBe(false);
        expect(await exists("File", sharedFile)).toBe(true);
        expect(await exists("File", keptFile)).toBe(true);
        expect(
          await countWhere("IncidentInternalNoteFile", "fileId", sharedFile),
        ).toBe(1);
      });

      test("a file a status page still uses is never deleted, though a deleted note held it too", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 90,
          alertRetentionInDays: 90,
          keepIncidentsWithCompletedPostmortem: false,
        });
        const due: string = await addIncident(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
        });
        const logo: string = await addFile(project);
        const statusPageId: string = id();

        await database.query(
          `INSERT INTO "StatusPage" ("_id","projectId","name","slug","version","logoFileId") VALUES ($1,$2,'Acme Status',$3,1,$4)`,
          [statusPageId, project.projectId, `status-${statusPageId}`, logo],
        );
        await attachToNote({
          noteTable: "IncidentInternalNote",
          recordColumn: "incidentId",
          recordId: due,
          project,
          fileIds: [logo],
        });

        await purge(ResolvedRecordKind.Incident, project, {
          retentionInDays: 90,
          keepCompletedPostmortems: false,
        });

        expect(await exists("Incident", due)).toBe(false);
        expect(await exists("File", logo)).toBe(true);
        expect(await exists("StatusPage", statusPageId)).toBe(true);
      });

      test("an alert's note files go with it, and an emptied episode's note files with the episode", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 30,
          alertRetentionInDays: 30,
          keepIncidentsWithCompletedPostmortem: false,
        });
        const alert: string = await addAlert(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
        });
        const alertFile: string = await addFile(project);
        await attachToNote({
          noteTable: "AlertInternalNote",
          recordColumn: "alertId",
          recordId: alert,
          project,
          fileIds: [alertFile],
        });

        const member: string = await addIncident(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
        });
        const episode: string = await addEpisode(
          ResolvedRecordKind.Incident,
          project,
          { resolvedDaysAgo: 200, members: [member] },
        );
        const episodeFile: string = await addFile(project);
        await attachToNote({
          noteTable: "IncidentEpisodeInternalNote",
          recordColumn: "incidentEpisodeId",
          recordId: episode,
          project,
          fileIds: [episodeFile],
        });

        await purge(ResolvedRecordKind.Alert, project, {
          retentionInDays: 30,
          keepCompletedPostmortems: false,
        });
        const incidents: ResolvedRecordRetentionResult = await purge(
          ResolvedRecordKind.Incident,
          project,
          { retentionInDays: 30, keepCompletedPostmortems: false },
        );

        expect(await exists("Alert", alert)).toBe(false);
        expect(await exists("File", alertFile)).toBe(false);
        expect(incidents.episodes).toBe(1);
        expect(await exists("IncidentEpisode", episode)).toBe(false);
        expect(await exists("File", episodeFile)).toBe(false);
      });

      test("the files of incidents that stay are never touched", async () => {
        const project: SeededProject = await seedProject({
          incidentRetentionInDays: 90,
          alertRetentionInDays: 90,
          keepIncidentsWithCompletedPostmortem: true,
        });
        const open: string = await addIncident(project, { openedDaysAgo: 300 });
        const writtenUp: string = await addIncident(project, {
          openedDaysAgo: 300,
          resolvedDaysAgo: 200,
          postmortemStatusId: project.completedPostmortemStatus,
        });
        const openFile: string = await addFile(project);
        const writtenUpFile: string = await addFile(project);

        await attachToNote({
          noteTable: "IncidentInternalNote",
          recordColumn: "incidentId",
          recordId: open,
          project,
          fileIds: [openFile],
        });
        await database.query(
          `INSERT INTO "IncidentPostmortemAttachmentFile" ("incidentId","fileId") VALUES ($1,$2)`,
          [writtenUp, writtenUpFile],
        );

        await purge(ResolvedRecordKind.Incident, project, {
          retentionInDays: 90,
          keepCompletedPostmortems: true,
        });

        expect(await exists("File", openFile)).toBe(true);
        expect(await exists("File", writtenUpFile)).toBe(true);
      });
    });

    /*
     * ISSUE #8896: a run starts after the project the last run stopped at
     * and wraps around to the first. The two legs of a pass are bounded by
     * Postgres' own order of ids, so they are read here from the database:
     * between them every project is read once, the one the last run stopped
     * at last.
     */
    describe("where a run starts (issue #8896)", () => {
      // Three projects of this suite that keep incidents 90 days, in the database's order of ids.
      async function threeProjectsInIdOrder(): Promise<Array<string>> {
        const seeded: Array<string> = [];

        for (let index: number = 0; index < 3; index++) {
          seeded.push(
            (
              await seedProject({
                incidentRetentionInDays: 90,
                alertRetentionInDays: 0,
                keepIncidentsWithCompletedPostmortem: true,
              })
            ).projectId,
          );
        }

        const rows: Array<{ projectId: string }> = await database.query(
          `SELECT "_id"::text AS "projectId" FROM "Project" WHERE "_id" = ANY($1::uuid[]) ORDER BY "_id" ASC`,
          [seeded],
        );

        return rows.map((row: { projectId: string }): string => {
          return row.projectId;
        });
      }

      // Every page of one leg, this suite's three projects alone, in the order read.
      async function legOfOurs(data: {
        ours: Array<string>;
        afterProjectId?: string | undefined;
        throughProjectId?: string | undefined;
      }): Promise<Array<string>> {
        const read: Array<string> = [];
        let afterProjectId: string | undefined = data.afterProjectId;

        do {
          const page: DueRetentionProjectsPage =
            await ResolvedRecordRetention.findDueProjects({
              kind: ResolvedRecordKind.Incident,
              afterProjectId,
              throughProjectId: data.throughProjectId,
            });

          for (const project of page.projects) {
            if (data.ours.includes(project.projectId)) {
              read.push(project.projectId);
            }
          }

          afterProjectId = page.nextAfterProjectId;
        } while (afterProjectId);

        return read;
      }

      test("after the place, then from the first project up to it: each project once, the place last", async () => {
        const [first, middle, last] = await threeProjectsInIdOrder();
        const ours: Array<string> = [first!, middle!, last!];

        expect(await legOfOurs({ ours, afterProjectId: middle })).toEqual([
          last,
        ]);
        expect(await legOfOurs({ ours, throughProjectId: middle })).toEqual([
          first,
          middle,
        ]);
        expect(await legOfOurs({ ours, throughProjectId: first })).toEqual([
          first,
        ]);
        expect(await legOfOurs({ ours, afterProjectId: last })).toEqual([]);
      });

      test("a run with a place kept works on every project once, in that order, and ends at the place", async () => {
        const [first, middle, last] = await threeProjectsInIdOrder();
        const started: Array<string> = [];
        let place: string | undefined = middle;

        // The place, kept in memory: there is no cache here.
        const readCursor: jest.SpyInstance = jest
          .spyOn(ResolvedRecordRetention, "readCursor")
          .mockImplementation(async (): Promise<string | undefined> => {
            return place;
          });
        const saveCursor: jest.SpyInstance = jest
          .spyOn(ResolvedRecordRetention, "saveCursor")
          .mockImplementation(
            async (_kind: ResolvedRecordKind, projectId: string) => {
              started.push(projectId);
              place = projectId;
            },
          );

        try {
          const summary: ResolvedRecordRetentionSummary =
            await ResolvedRecordRetention.run({
              kind: ResolvedRecordKind.Incident,
            });

          expect(summary.isCutShort).toBe(false);
          // No project is started twice in a pass.
          expect(new Set(started).size).toBe(started.length);
          expect(
            started.filter((projectId: string): boolean => {
              return [first, middle, last].includes(projectId);
            }),
          ).toEqual([last, first, middle]);
          // The pass ends at the place it started from, and the next starts after it.
          expect(started[started.length - 1]).toBe(middle);
          expect(place).toBe(middle);
        } finally {
          readCursor.mockRestore();
          saveCursor.mockRestore();
        }
      });
    });
  },
);
