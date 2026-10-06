import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * Removing an incident or alert from an episode, against a migrated Postgres,
 * must leave its episode reference on an episode it is still in, or on none.
 * None has to be written as null: TypeORM leaves a column it is given as
 * undefined unchanged, which is how the reference used to outlive the
 * membership.
 *
 * Opt in with RUN_POSTGRES_EPISODE_MEMBER_DELETE_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_EPISODE_MEMBER_DELETE_TESTS=true \
 *   EPISODE_MEMBER_DELETE_TEST_DATABASE_HOST=127.0.0.1 \
 *   EPISODE_MEMBER_DELETE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/EpisodeMemberDeletePostgres.test.ts
 *
 * The rows are real ones: each test's fixture is created under its own
 * project, which is deleted afterwards.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EPISODE_MEMBER_DELETE_TESTS"] === "true"
    ? describe
    : describe.skip;

interface Kind {
  name: "Incident" | "Alert";
  service:
    | typeof IncidentEpisodeMemberService
    | typeof AlertEpisodeMemberService;
}

/*
 * One incident or alert and the episodes it is in, in the order it was added
 * to them: memberIds[i] puts it in episodeIds[i].
 */
interface Seeded {
  recordId: string;
  episodeIds: Array<string>;
  memberIds: Array<string>;
}

const KINDS: Array<Kind> = [
  { name: "Incident", service: IncidentEpisodeMemberService },
  { name: "Alert", service: AlertEpisodeMemberService },
];

describePostgres("episode member delete against a migrated Postgres", () => {
  let database: DataSource;
  const projects: Array<string> = [];

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["EPISODE_MEMBER_DELETE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["EPISODE_MEMBER_DELETE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["EPISODE_MEMBER_DELETE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      synchronize: false,
    });
    await database.initialize();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
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

  /*
   * The record is added to `episodeCount` episodes, one after another, and
   * points at the last of them - as adding it to each in turn leaves it.
   */
  async function seed(kind: Kind, episodeCount: number): Promise<Seeded> {
    const k: string = kind.name;
    const lower: string = k.toLowerCase();
    const id: () => string = () => {
      return ObjectID.generate().toString();
    };
    const projectId: string = id();
    const state: string = id();
    const severity: string = id();
    const recordId: string = id();
    projects.push(projectId);

    await database.query(
      `INSERT INTO "Project" ("_id","name","slug","version") VALUES ($1,'t',$2,1)`,
      [projectId, `s${projectId}`],
    );
    const stateSlugColumn: string = k === "Incident" ? `,"slug"` : "";
    const stateSlugValue: string = k === "Incident" ? `,'s${state}'` : "";
    await database.query(
      `INSERT INTO "${k}State" ("_id","projectId","name","color","order","version"${stateSlugColumn}) VALUES ($1,$2,'s','#fff',1,1${stateSlugValue})`,
      [state, projectId],
    );
    await database.query(
      `INSERT INTO "${k}Severity" ("_id","projectId","name","slug","color","order","version") VALUES ($1,$2,'s',$3,'#fff',1,1)`,
      [severity, projectId, `s${severity}`],
    );

    const episodeIds: Array<string> = [];
    for (let i: number = 0; i < episodeCount; i++) {
      const episodeId: string = id();
      await database.query(
        `INSERT INTO "${k}Episode" ("_id","projectId","title","current${k}StateId","version") VALUES ($1,$2,'e',$3,1)`,
        [episodeId, projectId, state],
      );
      episodeIds.push(episodeId);
    }

    const slugColumn: string = k === "Incident" ? `,"slug"` : "";
    const slugValue: string = k === "Incident" ? `,'s${recordId}'` : "";
    await database.query(
      `INSERT INTO "${k}" ("_id","projectId","title","current${k}StateId","${lower}SeverityId","${lower}EpisodeId","version"${slugColumn}) VALUES ($1,$2,'t',$3,$4,$5,1${slugValue})`,
      [recordId, projectId, state, severity, episodeIds[episodeCount - 1]],
    );

    const memberIds: Array<string> = [];
    for (let i: number = 0; i < episodeCount; i++) {
      const memberId: string = id();
      await database.query(
        `INSERT INTO "${k}EpisodeMember" ("_id","projectId","${lower}EpisodeId","${lower}Id","version","createdAt") VALUES ($1,$2,$3,$4,1, now() - ($5 || ' seconds')::interval)`,
        [
          memberId,
          projectId,
          episodeIds[i],
          recordId,
          String(episodeCount - i),
        ],
      );
      memberIds.push(memberId);
    }

    return { recordId, episodeIds, memberIds };
  }

  async function removeMember(kind: Kind, memberId: string): Promise<void> {
    await kind.service.deleteOneById({
      id: new ObjectID(memberId),
      props: { isRoot: true },
    });
  }

  async function memberExists(kind: Kind, memberId: string): Promise<boolean> {
    const rows: Array<unknown> = await database.query(
      `SELECT 1 FROM "${kind.name}EpisodeMember" WHERE "_id" = $1`,
      [memberId],
    );
    return rows.length > 0;
  }

  // The record is never deleted with its membership, so it is always found.
  async function episodeReferenceOf(
    kind: Kind,
    recordId: string,
  ): Promise<string | null> {
    const rows: Array<{ episodeId: string | null }> = await database.query(
      `SELECT "${kind.name.toLowerCase()}EpisodeId" AS "episodeId" FROM "${kind.name}" WHERE "_id" = $1`,
      [recordId],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.episodeId;
  }

  async function memberCountOf(kind: Kind, episodeId: string): Promise<number> {
    const rows: Array<{ count: number }> = await database.query(
      `SELECT "${kind.name.toLowerCase()}Count" AS "count" FROM "${kind.name}Episode" WHERE "_id" = $1`,
      [episodeId],
    );
    return Number(rows[0]?.count);
  }

  describe.each(KINDS)("$name", (kind: Kind) => {
    test("leaving its only episode clears its episode reference", async () => {
      const s: Seeded = await seed(kind, 1);

      await removeMember(kind, s.memberIds[0]!);

      expect(await memberExists(kind, s.memberIds[0]!)).toBe(false);
      expect(await episodeReferenceOf(kind, s.recordId)).toBeNull();
      expect(await memberCountOf(kind, s.episodeIds[0]!)).toBe(0);
    });

    test("leaving an earlier episode keeps it on the one it points at", async () => {
      const s: Seeded = await seed(kind, 2);

      await removeMember(kind, s.memberIds[0]!);

      expect(await memberExists(kind, s.memberIds[0]!)).toBe(false);
      expect(await episodeReferenceOf(kind, s.recordId)).toBe(s.episodeIds[1]);
      expect(await memberCountOf(kind, s.episodeIds[0]!)).toBe(0);
    });

    test("leaving the episode it points at moves it to one it is still in", async () => {
      const s: Seeded = await seed(kind, 2);

      await removeMember(kind, s.memberIds[1]!);

      expect(await memberExists(kind, s.memberIds[1]!)).toBe(false);
      expect(await episodeReferenceOf(kind, s.recordId)).toBe(s.episodeIds[0]);
      expect(await memberCountOf(kind, s.episodeIds[1]!)).toBe(0);
    });
  });
});
