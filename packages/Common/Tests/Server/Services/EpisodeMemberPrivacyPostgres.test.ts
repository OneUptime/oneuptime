import Entities from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import Query from "../../../Server/Types/Database/Query";
import Select from "../../../Server/Types/Database/Select";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { DataSource } from "typeorm";

/*
 * An episode's members, read by the people of its project, against a
 * migrated Postgres. A membership row shows its incident (or alert) and its
 * episode through relation joins - the episode's Incidents tab selects
 * `incident: { title }` - and a join runs neither the incident's nor the
 * episode's own read rules. So the rows themselves are narrowed to the ones
 * whose incident and episode the reader may both see: a private one is seen
 * by its owners, directly or through a team, and by the project's owners and
 * admins, as on its own page. The count agrees with the list.
 *
 * Opt in with RUN_POSTGRES_EPISODE_MEMBER_PRIVACY_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_EPISODE_MEMBER_PRIVACY_TESTS=true \
 *   EPISODE_MEMBER_PRIVACY_TEST_DATABASE_HOST=127.0.0.1 \
 *   EPISODE_MEMBER_PRIVACY_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/EpisodeMemberPrivacyPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database.
 *
 * The rows are real ones: each test's fixture is created under its own
 * project, which is deleted afterwards. The people who read it are made once,
 * and deleted afterwards too: what they own is a row in each project.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EPISODE_MEMBER_PRIVACY_TESTS"] === "true"
    ? describe
    : describe.skip;

interface Kind {
  name: "Incident" | "Alert";
  service: DatabaseService<DatabaseBaseModel>;
  // The membership's columns and relations, as its model names them.
  recordIdColumn: "incidentId" | "alertId";
  recordRelation: "incident" | "alert";
  episodeIdColumn: "incidentEpisodeId" | "alertEpisodeId";
  episodeRelation: "incidentEpisode" | "alertEpisode";
  // The service's own read of an episode's records, made as root.
  recordsInEpisode: (episodeId: ObjectID) => Promise<Array<ObjectID>>;
}

const KINDS: Array<Kind> = [
  {
    name: "Incident",
    service:
      IncidentEpisodeMemberService as unknown as DatabaseService<DatabaseBaseModel>,
    recordIdColumn: "incidentId",
    recordRelation: "incident",
    episodeIdColumn: "incidentEpisodeId",
    episodeRelation: "incidentEpisode",
    recordsInEpisode: (episodeId: ObjectID): Promise<Array<ObjectID>> => {
      return IncidentEpisodeMemberService.getIncidentsInEpisode(episodeId);
    },
  },
  {
    name: "Alert",
    service:
      AlertEpisodeMemberService as unknown as DatabaseService<DatabaseBaseModel>,
    recordIdColumn: "alertId",
    recordRelation: "alert",
    episodeIdColumn: "alertEpisodeId",
    episodeRelation: "alertEpisode",
    recordsInEpisode: (episodeId: ObjectID): Promise<Array<ObjectID>> => {
      return AlertEpisodeMemberService.getAlertsInEpisode(episodeId);
    },
  },
];

const PUBLIC_RECORD_TITLE: string = "Checkout is slow";
const PRIVATE_RECORD_TITLE: string = "Payroll export is leaking salaries";
const PUBLIC_EPISODE_TITLE: string = "Checkout degradation";
const PRIVATE_EPISODE_TITLE: string = "Payroll data breach";

/*
 * One project: a public and a private episode, a public and a private
 * incident (or alert), and the people who read them.
 */
interface Seeded {
  projectId: ObjectID;
  publicEpisodeId: ObjectID;
  privateEpisodeId: ObjectID;
  publicRecordId: ObjectID;
  privateRecordId: ObjectID;
  // The public record in the public episode.
  publicMembershipId: ObjectID;
  // The private record in the public episode.
  privateRecordMembershipId: ObjectID;
  // The public record in the private episode.
  privateEpisodeMembershipId: ObjectID;
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

// What a list read shows, and what the count beside it says.
interface Listed {
  ids: Array<string>;
  // The title of the record, or episode, each row shows through its relation.
  titles: Array<string>;
  count: number;
}

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

describePostgres("episode members' privacy against a migrated Postgres", () => {
  let database: DataSource;
  let people: People;
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
        process.env["EPISODE_MEMBER_PRIVACY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["EPISODE_MEMBER_PRIVACY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["EPISODE_MEMBER_PRIVACY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      synchronize: false,
    });
    await database.initialize();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    people = {
      bystanderUserId: await insertUser(),
      recordOwnerUserId: await insertUser(),
      recordTeamOwnerUserId: await insertUser(),
      episodeOwnerUserId: await insertUser(),
    };

    /*
     * Removing a member writes to both feeds and notifies workflows and open
     * dashboards; EpisodeMemberDeletePostgres covers that. Here only whether
     * the row goes matters.
     */
    for (const kind of KINDS) {
      jest
        .spyOn(kind.service, "onTriggerWorkflow")
        .mockResolvedValue(undefined);
      jest
        .spyOn(kind.service, "onTriggerRealtime")
        .mockResolvedValue(undefined);
    }
    jest
      .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined);
    jest
      .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
      .mockResolvedValue(undefined);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined);
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

    const insertMembership: (
      episodeId: string,
      recordId: string,
    ) => Promise<string> = async (
      episodeId: string,
      recordId: string,
    ): Promise<string> => {
      const membershipId: string = id();
      await database.query(
        `INSERT INTO "${k}EpisodeMember" ("_id","projectId","${lower}EpisodeId","${lower}Id","version") VALUES ($1,$2,$3,$4,1)`,
        [membershipId, projectId, episodeId, recordId],
      );
      return membershipId;
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

    const publicMembershipId: string = await insertMembership(
      publicEpisodeId,
      publicRecordId,
    );
    const privateRecordMembershipId: string = await insertMembership(
      publicEpisodeId,
      privateRecordId,
    );
    const privateEpisodeMembershipId: string = await insertMembership(
      privateEpisodeId,
      publicRecordId,
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
      [id(), projectId, people.episodeOwnerUserId.toString(), privateEpisodeId],
    );

    return {
      projectId: new ObjectID(projectId),
      publicEpisodeId: new ObjectID(publicEpisodeId),
      privateEpisodeId: new ObjectID(privateEpisodeId),
      publicRecordId: new ObjectID(publicRecordId),
      privateRecordId: new ObjectID(privateRecordId),
      publicMembershipId: new ObjectID(publicMembershipId),
      privateRecordMembershipId: new ObjectID(privateRecordMembershipId),
      privateEpisodeMembershipId: new ObjectID(privateEpisodeMembershipId),
      ...people,
    };
  }

  function sortedIds(ids: Array<ObjectID>): Array<string> {
    return ids
      .map((id: ObjectID): string => {
        return id.toString();
      })
      .sort();
  }

  /*
   * A list read made as the API's get-list makes it: findBy, then countBy
   * with the same query and props objects. BaseAPI.getList runs the two one
   * after the other, on the same objects, for a service with an onBeforeFind
   * of its own - so the count sees the query the list's hook rewrote.
   * `through` names the relation the rows are shown with: the record, as an
   * episode's tab shows its incidents, or the episode, as a record's
   * episodes would be shown.
   */
  async function list(
    kind: Kind,
    query: Query<DatabaseBaseModel>,
    through: "record" | "episode",
    props: DatabaseCommonInteractionProps,
  ): Promise<Listed> {
    const relation: string =
      through === "record" ? kind.recordRelation : kind.episodeRelation;

    const rows: Array<DatabaseBaseModel> = await kind.service.findBy({
      query: query,
      select: {
        _id: true,
        [relation]: {
          _id: true,
          title: true,
        },
      } as Select<DatabaseBaseModel>,
      limit: 50,
      skip: 0,
      props: props,
    });

    const count: number = (
      await kind.service.countBy({
        query: query,
        props: props,
      })
    ).toNumber();

    return {
      ids: rows
        .map((row: DatabaseBaseModel): string => {
          return row._id!.toString();
        })
        .sort(),
      titles: rows
        .map((row: DatabaseBaseModel): string => {
          const shown: { title?: string } | undefined = (
            row as unknown as Record<string, { title?: string } | undefined>
          )[relation];
          return shown?.title || "";
        })
        .sort(),
      count: count,
    };
  }

  // What the episode's tab asks for: its members, shown with their records.
  function episodeTab(
    kind: Kind,
    s: Seeded,
    episodeId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<Listed> {
    return list(
      kind,
      {
        [kind.episodeIdColumn]: episodeId,
        projectId: s.projectId,
      } as Query<DatabaseBaseModel>,
      "record",
      props,
    );
  }

  async function membershipExists(
    kind: Kind,
    membershipId: ObjectID,
  ): Promise<boolean> {
    const rows: Array<unknown> = await database.query(
      `SELECT 1 FROM "${kind.name}EpisodeMember" WHERE "_id" = $1`,
      [membershipId.toString()],
    );
    return rows.length > 0;
  }

  describe.each(KINDS)("$name", (kind: Kind) => {
    const lower: string = kind.name.toLowerCase();

    test(`the episode's ${lower}s tab shows a project member who owns neither only the public ${lower}, and counts the same`, async () => {
      const s: Seeded = await seed(kind);

      for (const props of [
        userProps(s.projectId, s.bystanderUserId, Permission.ProjectMember),
        userProps(s.projectId, s.bystanderUserId, Permission.Viewer),
        apiKeyProps(s.projectId, Permission.ProjectMember),
      ]) {
        expect(await episodeTab(kind, s, s.publicEpisodeId, props)).toEqual({
          ids: [s.publicMembershipId.toString()],
          titles: [PUBLIC_RECORD_TITLE],
          count: 1,
        });
      }
    });

    test(`the private ${lower}'s owners see it on the tab, directly or through a team`, async () => {
      const s: Seeded = await seed(kind);

      for (const ownerUserId of [
        s.recordOwnerUserId,
        s.recordTeamOwnerUserId,
      ]) {
        expect(
          await episodeTab(
            kind,
            s,
            s.publicEpisodeId,
            userProps(s.projectId, ownerUserId, Permission.ProjectMember),
          ),
        ).toEqual({
          ids: sortedIds([s.publicMembershipId, s.privateRecordMembershipId]),
          titles: [PRIVATE_RECORD_TITLE, PUBLIC_RECORD_TITLE].sort(),
          count: 2,
        });
      }
    });

    test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
      "a %s sees every member of every episode",
      async (role: Permission) => {
        const s: Seeded = await seed(kind);
        const props: DatabaseCommonInteractionProps = userProps(
          s.projectId,
          s.bystanderUserId,
          role,
        );

        expect(await episodeTab(kind, s, s.publicEpisodeId, props)).toEqual({
          ids: sortedIds([s.publicMembershipId, s.privateRecordMembershipId]),
          titles: [PRIVATE_RECORD_TITLE, PUBLIC_RECORD_TITLE].sort(),
          count: 2,
        });

        expect(await episodeTab(kind, s, s.privateEpisodeId, props)).toEqual({
          ids: [s.privateEpisodeMembershipId.toString()],
          titles: [PUBLIC_RECORD_TITLE],
          count: 1,
        });
      },
    );

    test(`a private episode's ${lower}s are listed only to its owners`, async () => {
      const s: Seeded = await seed(kind);

      // Neither a bystander, nor an owner of a record that is not in it.
      for (const userId of [s.bystanderUserId, s.recordOwnerUserId]) {
        expect(
          await episodeTab(
            kind,
            s,
            s.privateEpisodeId,
            userProps(s.projectId, userId, Permission.ProjectMember),
          ),
        ).toEqual({ ids: [], titles: [], count: 0 });
      }

      const episodeOwner: DatabaseCommonInteractionProps = userProps(
        s.projectId,
        s.episodeOwnerUserId,
        Permission.ProjectMember,
      );

      expect(
        await episodeTab(kind, s, s.privateEpisodeId, episodeOwner),
      ).toEqual({
        ids: [s.privateEpisodeMembershipId.toString()],
        titles: [PUBLIC_RECORD_TITLE],
        count: 1,
      });

      // Owning the episode does not open the private record in another one.
      expect(
        await episodeTab(kind, s, s.publicEpisodeId, episodeOwner),
      ).toEqual({
        ids: [s.publicMembershipId.toString()],
        titles: [PUBLIC_RECORD_TITLE],
        count: 1,
      });
    });

    test(`the episodes of a public ${lower} do not name a private one to someone who cannot open it`, async () => {
      const s: Seeded = await seed(kind);

      const episodesOf: (
        props: DatabaseCommonInteractionProps,
      ) => Promise<Listed> = (
        props: DatabaseCommonInteractionProps,
      ): Promise<Listed> => {
        return list(
          kind,
          {
            [kind.recordIdColumn]: s.publicRecordId,
            projectId: s.projectId,
          } as Query<DatabaseBaseModel>,
          "episode",
          props,
        );
      };

      expect(
        await episodesOf(
          userProps(s.projectId, s.bystanderUserId, Permission.ProjectMember),
        ),
      ).toEqual({
        ids: [s.publicMembershipId.toString()],
        titles: [PUBLIC_EPISODE_TITLE],
        count: 1,
      });

      expect(
        await episodesOf(
          userProps(
            s.projectId,
            s.episodeOwnerUserId,
            Permission.ProjectMember,
          ),
        ),
      ).toEqual({
        ids: sortedIds([s.publicMembershipId, s.privateEpisodeMembershipId]),
        titles: [PRIVATE_EPISODE_TITLE, PUBLIC_EPISODE_TITLE].sort(),
        count: 2,
      });
    });

    test("a hidden membership cannot be read by its id", async () => {
      const s: Seeded = await seed(kind);

      const read: (
        membershipId: ObjectID,
        userId: ObjectID,
      ) => Promise<string | null> = async (
        membershipId: ObjectID,
        userId: ObjectID,
      ): Promise<string | null> => {
        const row: DatabaseBaseModel | null = await kind.service.findOneById({
          id: membershipId,
          select: {
            _id: true,
            [kind.recordRelation]: { title: true },
          } as Select<DatabaseBaseModel>,
          props: userProps(s.projectId, userId, Permission.ProjectMember),
        });

        return row ? row._id!.toString() : null;
      };

      expect(
        await read(s.privateRecordMembershipId, s.bystanderUserId),
      ).toBeNull();
      expect(
        await read(s.privateEpisodeMembershipId, s.bystanderUserId),
      ).toBeNull();

      expect(await read(s.privateRecordMembershipId, s.recordOwnerUserId)).toBe(
        s.privateRecordMembershipId.toString(),
      );
      expect(
        await read(s.privateEpisodeMembershipId, s.episodeOwnerUserId),
      ).toBe(s.privateEpisodeMembershipId.toString());
    });

    test(`a project member cannot take a private ${lower} they cannot see out of an episode, but its owner can`, async () => {
      const s: Seeded = await seed(kind);

      for (const membershipId of [
        s.privateRecordMembershipId,
        s.privateEpisodeMembershipId,
      ]) {
        await kind.service.deleteOneById({
          id: membershipId,
          props: userProps(
            s.projectId,
            s.bystanderUserId,
            Permission.ProjectMember,
          ),
        });

        expect(await membershipExists(kind, membershipId)).toBe(true);
      }

      await kind.service.deleteOneById({
        id: s.privateRecordMembershipId,
        props: userProps(
          s.projectId,
          s.recordOwnerUserId,
          Permission.ProjectMember,
        ),
      });
      expect(await membershipExists(kind, s.privateRecordMembershipId)).toBe(
        false,
      );

      // A membership they can see, a bystander removes as before.
      await kind.service.deleteOneById({
        id: s.publicMembershipId,
        props: userProps(
          s.projectId,
          s.bystanderUserId,
          Permission.ProjectMember,
        ),
      });
      expect(await membershipExists(kind, s.publicMembershipId)).toBe(false);
    });

    test("OneUptime's own reads, as root, still see every member", async () => {
      const s: Seeded = await seed(kind);

      expect(
        (
          await kind.service.countBy({
            query: { projectId: s.projectId } as Query<DatabaseBaseModel>,
            props: { isRoot: true },
          })
        ).toNumber(),
      ).toBe(3);

      expect(sortedIds(await kind.recordsInEpisode(s.publicEpisodeId))).toEqual(
        sortedIds([s.publicRecordId, s.privateRecordId]),
      );
      expect(
        sortedIds(await kind.recordsInEpisode(s.privateEpisodeId)),
      ).toEqual([s.publicRecordId.toString()]);
    });
  });
});
