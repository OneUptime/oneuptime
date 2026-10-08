import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { DataSource } from "typeorm";

/*
 * Adding an incident (or an alert) to an episode, by the people of its
 * project, against a migrated Postgres. A person may only add an incident
 * they can see to an episode they can see - read as them, so the real
 * privacy rules decide: a private one is seen by its owners, directly or
 * through a team, and by the project's owners and admins. Whatever they
 * cannot open gets the answer a missing one gets. OneUptime's own writes, as
 * root, add whatever the grouping engine matched.
 *
 * And each side's feed entry is read by its own side's audience, so the
 * episode's entry - and its Slack / Microsoft Teams post - never names a
 * private incident, and the incident's entry never names a private episode.
 * The entries are read back from the feed tables.
 *
 * Opt in with RUN_POSTGRES_EPISODE_MEMBER_PRIVATE_ENDS_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_EPISODE_MEMBER_PRIVATE_ENDS_TESTS=true \
 *   EPISODE_MEMBER_PRIVATE_ENDS_TEST_DATABASE_HOST=127.0.0.1 \
 *   EPISODE_MEMBER_PRIVATE_ENDS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/EpisodeMemberPrivateEndsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database.
 *
 * The rows are real ones: each test's fixture is created under its own
 * project, which is deleted afterwards. The people who add are made once,
 * and deleted afterwards too: what they own is a row in each project.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EPISODE_MEMBER_PRIVATE_ENDS_TESTS"] === "true"
    ? describe
    : describe.skip;

interface Kind {
  name: "Incident" | "Alert";
  noun: "incident" | "alert";
  service: DatabaseService<DatabaseBaseModel>;
  memberModel: { new (): DatabaseBaseModel };
  // The member's columns, as its model names them.
  recordIdColumn: "incidentId" | "alertId";
  episodeIdColumn: "incidentEpisodeId" | "alertEpisodeId";
  /*
   * The refusals for a record, or an episode, the caller cannot see. The
   * record is the one a member row is created under, so one the caller may
   * not read is answered like one that does not exist, naming it, before the
   * episode's own checks run (CreatePermission.checkParentPermission).
   */
  hiddenRecord: (recordId: ObjectID) => string;
  hiddenEpisode: string;
}

const KINDS: Array<Kind> = [
  {
    name: "Incident",
    noun: "incident",
    service:
      IncidentEpisodeMemberService as unknown as DatabaseService<DatabaseBaseModel>,
    memberModel: IncidentEpisodeMember,
    recordIdColumn: "incidentId",
    episodeIdColumn: "incidentEpisodeId",
    hiddenRecord: (recordId: ObjectID): string => {
      return `This incident episode member references records that are not in this project: Incident "${recordId.toString()}". Please pick values from this project and try again.`;
    },
    hiddenEpisode:
      "The episode to add the incident to does not exist in this project, or you do not have access to it.",
  },
  {
    name: "Alert",
    noun: "alert",
    service:
      AlertEpisodeMemberService as unknown as DatabaseService<DatabaseBaseModel>,
    memberModel: AlertEpisodeMember,
    recordIdColumn: "alertId",
    episodeIdColumn: "alertEpisodeId",
    hiddenRecord: (recordId: ObjectID): string => {
      return `This alert episode member references records that are not in this project: Alert "${recordId.toString()}". Please pick values from this project and try again.`;
    },
    hiddenEpisode:
      "The episode to add the alert to does not exist in this project, or you do not have access to it.",
  },
];

const PUBLIC_RECORD_TITLE: string = "Checkout is slow";
const PRIVATE_RECORD_TITLE: string = "Payroll export is leaking salaries";
const PUBLIC_EPISODE_TITLE: string = "Checkout degradation";
const PRIVATE_EPISODE_TITLE: string = "Payroll data breach";

/*
 * One project: a public and a private episode, a public and a private
 * incident (or alert), none of them in an episode yet, and the people who
 * add them.
 */
interface Seeded {
  projectId: ObjectID;
  publicEpisodeId: ObjectID;
  privateEpisodeId: ObjectID;
  publicRecordId: ObjectID;
  privateRecordId: ObjectID;
  // A project member who owns neither private one.
  bystanderUserId: ObjectID;
  // Owns the private record, directly.
  recordOwnerUserId: ObjectID;
  // Owns the private record through a team.
  recordTeamOwnerUserId: ObjectID;
  // Owns the private episode, directly.
  episodeOwnerUserId: ObjectID;
}

// The people every fixture names: see Seeded.
type People = Pick<
  Seeded,
  | "bystanderUserId"
  | "recordOwnerUserId"
  | "recordTeamOwnerUserId"
  | "episodeOwnerUserId"
>;

function userProps(
  projectId: ObjectID,
  userId: ObjectID,
  permission: Permission,
): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userId: userId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        _type: "UserTenantAccessPermission",
        permissions: [
          {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  };
}

// An API key: no person on the request, so nobody to own anything.
function apiKeyProps(
  projectId: ObjectID,
  permission: Permission,
): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = userProps(
    projectId,
    ObjectID.generate(),
    permission,
  );
  delete props.userId;
  props.userType = UserType.API;
  return props;
}

describePostgres(
  "adding to an episode, and what its entries say, against a migrated Postgres",
  () => {
    let database: DataSource;
    let people: People;
    let posts: jest.SpyInstance;
    const projects: Array<string> = [];
    const users: Array<string> = [];

    async function insertUser(): Promise<ObjectID> {
      const userId: string = ObjectID.generate().toString();
      users.push(userId);
      await database.query(
        `INSERT INTO "User" ("_id","email","slug","version") VALUES ($1,$2,$3,1)`,
        [userId, `episode-member-${userId}@example.com`, `s${userId}`],
      );
      return new ObjectID(userId);
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["EPISODE_MEMBER_PRIVATE_ENDS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["EPISODE_MEMBER_PRIVATE_ENDS_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["EPISODE_MEMBER_PRIVATE_ENDS_TEST_DATABASE_NAME"] ||
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

      people = {
        bystanderUserId: await insertUser(),
        recordOwnerUserId: await insertUser(),
        recordTeamOwnerUserId: await insertUser(),
        episodeOwnerUserId: await insertUser(),
      };

      /*
       * Adding a member notifies workflows and open dashboards; here only
       * who may add, and what the feeds say, matters. The feed entries are
       * written for real; what the episode's would post to Slack and
       * Microsoft Teams is kept to be read.
       */
      for (const kind of KINDS) {
        jest
          .spyOn(kind.service, "onTriggerWorkflow")
          .mockResolvedValue(undefined);
        jest
          .spyOn(kind.service, "onTriggerRealtime")
          .mockResolvedValue(undefined);
      }
      posts = jest
        .spyOn(
          WorkspaceNotificationRuleService,
          "sendWorkspaceMarkdownNotification",
        )
        .mockResolvedValue(undefined);
    });

    beforeEach(() => {
      posts.mockClear();
    });

    /*
     * Deleting a project, or a user, checks every table that can name one -
     * hundreds of foreign keys - which takes most of a minute on a migrated
     * database, more than a hook is given by default.
     */
    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        if (projects.length > 0) {
          await database.query(`DELETE FROM "Project" WHERE "_id" = ANY($1)`, [
            projects,
          ]);
        }
        if (users.length > 0) {
          await database.query(`DELETE FROM "User" WHERE "_id" = ANY($1)`, [
            users,
          ]);
        }
        await database.destroy();
      }
    }, 300_000);

    async function seed(kind: Kind): Promise<Seeded> {
      const k: string = kind.name;
      const lower: string = k.toLowerCase();
      const id: () => string = () => {
        return ObjectID.generate().toString();
      };
      const projectId: string = id();
      const stateId: string = id();
      const severityId: string = id();
      projects.push(projectId);

      await database.query(
        `INSERT INTO "Project" ("_id","name","slug","version") VALUES ($1,'t',$2,1)`,
        [projectId, `s${projectId}`],
      );
      const stateSlugColumn: string = k === "Incident" ? `,"slug"` : "";
      const stateSlugValue: string = k === "Incident" ? `,'s${stateId}'` : "";
      await database.query(
        `INSERT INTO "${k}State" ("_id","projectId","name","color","order","version"${stateSlugColumn}) VALUES ($1,$2,'s','#fff',1,1${stateSlugValue})`,
        [stateId, projectId],
      );
      await database.query(
        `INSERT INTO "${k}Severity" ("_id","projectId","name","slug","color","order","version") VALUES ($1,$2,'s',$3,'#fff',1,1)`,
        [severityId, projectId, `s${severityId}`],
      );

      const insertEpisode: (
        title: string,
        isPrivate: boolean,
      ) => Promise<string> = async (
        title: string,
        isPrivate: boolean,
      ): Promise<string> => {
        const episodeId: string = id();
        await database.query(
          `INSERT INTO "${k}Episode" ("_id","projectId","title","current${k}StateId","isPrivate","version") VALUES ($1,$2,$3,$4,$5,1)`,
          [episodeId, projectId, title, stateId, isPrivate],
        );
        return episodeId;
      };

      const insertRecord: (
        title: string,
        isPrivate: boolean,
      ) => Promise<string> = async (
        title: string,
        isPrivate: boolean,
      ): Promise<string> => {
        const recordId: string = id();
        const slugColumn: string = k === "Incident" ? `,"slug"` : "";
        const slugValue: string = k === "Incident" ? `,'s${recordId}'` : "";
        await database.query(
          `INSERT INTO "${k}" ("_id","projectId","title","current${k}StateId","${lower}SeverityId","isPrivate","version"${slugColumn}) VALUES ($1,$2,$3,$4,$5,$6,1${slugValue})`,
          [recordId, projectId, title, stateId, severityId, isPrivate],
        );
        return recordId;
      };

      const publicEpisodeId: string = await insertEpisode(
        PUBLIC_EPISODE_TITLE,
        false,
      );
      const privateEpisodeId: string = await insertEpisode(
        PRIVATE_EPISODE_TITLE,
        true,
      );
      const publicRecordId: string = await insertRecord(
        PUBLIC_RECORD_TITLE,
        false,
      );
      const privateRecordId: string = await insertRecord(
        PRIVATE_RECORD_TITLE,
        true,
      );

      await database.query(
        `INSERT INTO "${k}OwnerUser" ("_id","projectId","userId","${lower}Id","version") VALUES ($1,$2,$3,$4,1)`,
        [id(), projectId, people.recordOwnerUserId.toString(), privateRecordId],
      );

      const teamId: string = id();
      await database.query(
        `INSERT INTO "Team" ("_id","projectId","name","slug","version") VALUES ($1,$2,'Payroll',$3,1)`,
        [teamId, projectId, `s${teamId}`],
      );
      await database.query(
        `INSERT INTO "TeamMember" ("_id","projectId","teamId","userId","version") VALUES ($1,$2,$3,$4,1)`,
        [id(), projectId, teamId, people.recordTeamOwnerUserId.toString()],
      );
      await database.query(
        `INSERT INTO "${k}OwnerTeam" ("_id","projectId","teamId","${lower}Id","version") VALUES ($1,$2,$3,$4,1)`,
        [id(), projectId, teamId, privateRecordId],
      );

      await database.query(
        `INSERT INTO "${k}EpisodeOwnerUser" ("_id","projectId","userId","${lower}EpisodeId","version") VALUES ($1,$2,$3,$4,1)`,
        [
          id(),
          projectId,
          people.episodeOwnerUserId.toString(),
          privateEpisodeId,
        ],
      );

      return {
        projectId: new ObjectID(projectId),
        publicEpisodeId: new ObjectID(publicEpisodeId),
        privateEpisodeId: new ObjectID(privateEpisodeId),
        publicRecordId: new ObjectID(publicRecordId),
        privateRecordId: new ObjectID(privateRecordId),
        ...people,
      };
    }

    // Adds the record to the episode as `props`: the refusal, or nothing.
    async function add(
      kind: Kind,
      s: Seeded,
      episodeId: ObjectID,
      recordId: ObjectID,
      props: DatabaseCommonInteractionProps,
    ): Promise<Error | null> {
      const row: DatabaseBaseModel = new kind.memberModel();
      row.setColumnValue("projectId", s.projectId);
      row.setColumnValue(kind.episodeIdColumn, episodeId);
      row.setColumnValue(kind.recordIdColumn, recordId);

      try {
        await kind.service.create({ data: row, props: props });
        return null;
      } catch (error) {
        return error as Error;
      }
    }

    async function membersOf(
      kind: Kind,
      episodeId: ObjectID,
    ): Promise<Array<string>> {
      const rows: Array<{ recordId: string }> = await database.query(
        `SELECT "${kind.recordIdColumn}" AS "recordId" FROM "${kind.name}EpisodeMember" WHERE "${kind.episodeIdColumn}" = $1 AND "deletedAt" IS NULL`,
        [episodeId.toString()],
      );
      return rows.map((row: { recordId: string }): string => {
        return row.recordId;
      });
    }

    // The entries an episode's feed holds, oldest first.
    async function episodeFeed(
      kind: Kind,
      episodeId: ObjectID,
    ): Promise<Array<string>> {
      const rows: Array<{ markdown: string }> = await database.query(
        `SELECT "feedInfoInMarkdown" AS "markdown" FROM "${kind.name}EpisodeFeed" WHERE "${kind.episodeIdColumn}" = $1 ORDER BY "createdAt"`,
        [episodeId.toString()],
      );
      return rows.map((row: { markdown: string }): string => {
        return row.markdown;
      });
    }

    // The entries an incident's (or alert's) feed holds about its episodes.
    async function recordFeed(
      kind: Kind,
      recordId: ObjectID,
    ): Promise<Array<string>> {
      const rows: Array<{ markdown: string }> = await database.query(
        `SELECT "feedInfoInMarkdown" AS "markdown" FROM "${kind.name}Feed" WHERE "${kind.recordIdColumn}" = $1 AND "feedInfoInMarkdown" LIKE '%Episode%' ORDER BY "createdAt"`,
        [recordId.toString()],
      );
      return rows.map((row: { markdown: string }): string => {
        return row.markdown;
      });
    }

    function postedMarkdown(): Array<string> {
      return posts.mock.calls.map((args: Array<unknown>): string => {
        return (args[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
      });
    }

    describe.each(KINDS)("$name", (kind: Kind) => {
      test(`a project member who owns neither cannot add the private ${kind.noun}, and hears what a missing one gets`, async () => {
        const s: Seeded = await seed(kind);

        for (const props of [
          userProps(s.projectId, s.bystanderUserId, Permission.ProjectMember),
          userProps(
            s.projectId,
            s.episodeOwnerUserId,
            Permission.ProjectMember,
          ),
          apiKeyProps(s.projectId, Permission.ProjectMember),
        ]) {
          for (const recordId of [s.privateRecordId, ObjectID.generate()]) {
            const refusal: Error | null = await add(
              kind,
              s,
              s.publicEpisodeId,
              recordId,
              props,
            );

            expect(refusal?.message).toBe(kind.hiddenRecord(recordId));
          }
        }

        expect(await membersOf(kind, s.publicEpisodeId)).toEqual([]);
        expect(await episodeFeed(kind, s.publicEpisodeId)).toEqual([]);
        expect(postedMarkdown()).toEqual([]);
      });

      test(`nor add to the private episode, even the ${kind.noun} they own`, async () => {
        const s: Seeded = await seed(kind);

        for (const [userId, recordId] of [
          [s.bystanderUserId, s.publicRecordId],
          [s.recordOwnerUserId, s.privateRecordId],
        ] as Array<[ObjectID, ObjectID]>) {
          for (const episodeId of [s.privateEpisodeId, ObjectID.generate()]) {
            const refusal: Error | null = await add(
              kind,
              s,
              episodeId,
              recordId,
              userProps(s.projectId, userId, Permission.ProjectMember),
            );

            expect(refusal?.message).toBe(kind.hiddenEpisode);
          }
        }

        expect(await membersOf(kind, s.privateEpisodeId)).toEqual([]);
      });

      test(`the private ${kind.noun}'s owners add it, directly or through a team, and the episode's entry and post do not name it`, async () => {
        for (const owner of [
          "recordOwnerUserId",
          "recordTeamOwnerUserId",
        ] as Array<keyof People>) {
          posts.mockClear();
          const s: Seeded = await seed(kind);

          expect(
            await add(
              kind,
              s,
              s.publicEpisodeId,
              s.privateRecordId,
              userProps(s.projectId, s[owner], Permission.ProjectMember),
            ),
          ).toBeNull();

          expect(await membersOf(kind, s.publicEpisodeId)).toEqual([
            s.privateRecordId.toString(),
          ]);

          const onEpisode: Array<string> = await episodeFeed(
            kind,
            s.publicEpisodeId,
          );
          expect(onEpisode).toHaveLength(1);
          expect(onEpisode[0]).toContain(
            `(private ${kind.noun}) added to episode`,
          );
          expect(onEpisode[0]).not.toContain(PRIVATE_RECORD_TITLE);
          expect(postedMarkdown()).toEqual(onEpisode);

          // The episode is not private: the record's own entry names it.
          expect(await recordFeed(kind, s.privateRecordId)).toEqual([
            expect.stringContaining(`: ${PUBLIC_EPISODE_TITLE}`),
          ]);
        }
      });

      test(`the private episode's owner adds a public ${kind.noun} to it, and the ${kind.noun}'s entry does not name the episode`, async () => {
        const s: Seeded = await seed(kind);

        expect(
          await add(
            kind,
            s,
            s.privateEpisodeId,
            s.publicRecordId,
            userProps(
              s.projectId,
              s.episodeOwnerUserId,
              Permission.ProjectMember,
            ),
          ),
        ).toBeNull();

        const onRecord: Array<string> = await recordFeed(
          kind,
          s.publicRecordId,
        );
        expect(onRecord).toHaveLength(1);
        expect(onRecord[0]).toContain("(private episode)");
        expect(onRecord[0]).not.toContain(PRIVATE_EPISODE_TITLE);

        // The record is not private: the episode's own entry names it.
        expect(await episodeFeed(kind, s.privateEpisodeId)).toEqual([
          expect.stringContaining(`: ${PUBLIC_RECORD_TITLE}`),
        ]);
      });

      test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
        `a %s adds the private ${kind.noun} to the private episode, and neither title crosses over`,
        async (role: Permission) => {
          const s: Seeded = await seed(kind);

          expect(
            await add(
              kind,
              s,
              s.privateEpisodeId,
              s.privateRecordId,
              userProps(s.projectId, s.bystanderUserId, role),
            ),
          ).toBeNull();

          const entries: Array<string> = [
            ...(await episodeFeed(kind, s.privateEpisodeId)),
            ...(await recordFeed(kind, s.privateRecordId)),
            ...postedMarkdown(),
          ];

          expect(entries).toHaveLength(3);

          for (const entry of entries) {
            expect(entry).not.toContain(PRIVATE_RECORD_TITLE);
            expect(entry).not.toContain(PRIVATE_EPISODE_TITLE);
          }
        },
      );

      test(`a workflow step, acting as a Project Admin of its project, adds the private ${kind.noun} to the private episode`, async () => {
        const s: Seeded = await seed(kind);

        expect(
          await add(
            kind,
            s,
            s.privateEpisodeId,
            s.privateRecordId,
            WorkflowPrincipal.getPropsWithoutPlan({
              projectId: s.projectId,
              workflowId: ObjectID.generate(),
            }),
          ),
        ).toBeNull();

        expect(await membersOf(kind, s.privateEpisodeId)).toEqual([
          s.privateRecordId.toString(),
        ]);
      });

      test(`OneUptime's own writes, as root, add the private ${kind.noun} - and the episode's entry still does not name it, nor when it leaves`, async () => {
        const s: Seeded = await seed(kind);

        expect(
          await add(kind, s, s.publicEpisodeId, s.privateRecordId, {
            isRoot: true,
          }),
        ).toBeNull();

        await kind.service.deleteBy({
          query: {
            [kind.episodeIdColumn]: s.publicEpisodeId,
            [kind.recordIdColumn]: s.privateRecordId,
          },
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        });

        const onEpisode: Array<string> = await episodeFeed(
          kind,
          s.publicEpisodeId,
        );
        expect(onEpisode).toEqual([
          expect.stringContaining(`(private ${kind.noun}) added to episode`),
          expect.stringContaining(
            `(private ${kind.noun}) removed from episode`,
          ),
        ]);
        expect(postedMarkdown()).toEqual(onEpisode);

        for (const entry of onEpisode) {
          expect(entry).not.toContain(PRIVATE_RECORD_TITLE);
        }
      });

      test(`a public ${kind.noun} in a public episode is named as before, by a project member`, async () => {
        const s: Seeded = await seed(kind);

        expect(
          await add(
            kind,
            s,
            s.publicEpisodeId,
            s.publicRecordId,
            userProps(s.projectId, s.bystanderUserId, Permission.ProjectMember),
          ),
        ).toBeNull();

        expect(await episodeFeed(kind, s.publicEpisodeId)).toEqual([
          expect.stringMatching(
            new RegExp(`added to episode: ${PUBLIC_RECORD_TITLE}$`),
          ),
        ]);
        expect(await recordFeed(kind, s.publicRecordId)).toEqual([
          expect.stringMatching(
            new RegExp(
              `^Added to \\*\\*Episode .+\\*\\*: ${PUBLIC_EPISODE_TITLE}$`,
            ),
          ),
        ]);
      });
    });
  },
);
