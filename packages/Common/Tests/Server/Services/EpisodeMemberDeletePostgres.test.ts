import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * Removing an episode member against a migrated Postgres must clear the
 * incident / alert's episode reference (TypeORM ignores `undefined`, so the
 * cleanup has to write `null`).
 *
 * Opt in with RUN_POSTGRES_EPISODE_MEMBER_DELETE_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_EPISODE_MEMBER_DELETE_TESTS=true \
 *   EPISODE_MEMBER_DELETE_TEST_DATABASE_HOST=127.0.0.1 \
 *   EPISODE_MEMBER_DELETE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/EpisodeMemberDeletePostgres.test.ts
 *
 * Each test fixture is created under its own project, which is dropped afterwards.
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

interface Seeded {
  projectId: string;
  episodeId: string;
  records: Array<string>;
  members: Array<string>;
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

  async function seed(kind: Kind, count: number): Promise<Seeded> {
    const k: string = kind.name;
    const lower: string = k.toLowerCase();
    const id: () => string = () => {
      return ObjectID.generate().toString();
    };
    const projectId: string = id();
    const state: string = id();
    const severity: string = id();
    const episodeId: string = id();
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
    await database.query(
      `INSERT INTO "${k}Episode" ("_id","projectId","title","current${k}StateId","version") VALUES ($1,$2,'e',$3,1)`,
      [episodeId, projectId, state],
    );

    const records: Array<string> = [];
    const members: Array<string> = [];
    for (let i: number = 0; i < count; i++) {
      const record: string = id();
      const member: string = id();
      const slugColumn: string = k === "Incident" ? `,"slug"` : "";
      const slugValue: string = k === "Incident" ? `,'s${record}'` : "";
      await database.query(
        `INSERT INTO "${k}" ("_id","projectId","title","current${k}StateId","${lower}SeverityId","${lower}EpisodeId","version"${slugColumn}) VALUES ($1,$2,'t',$3,$4,$5,1${slugValue})`,
        [record, projectId, state, severity, episodeId],
      );
      await database.query(
        `INSERT INTO "${k}EpisodeMember" ("_id","projectId","${lower}EpisodeId","${lower}Id","version","createdAt") VALUES ($1,$2,$3,$4,1, now() - ($5 || ' seconds')::interval)`,
        [member, projectId, episodeId, record, String(count - i)],
      );
      records.push(record);
      members.push(member);
    }
    return { projectId, episodeId, records, members };
  }

  async function state(
    kind: Kind,
    s: Seeded,
  ): Promise<{
    deleted: Array<number>;
    cleared: Array<number>;
    count: number;
  }> {
    const k: string = kind.name;
    const lower: string = k.toLowerCase();
    const kept: Set<string> = new Set(
      (
        await database.query(
          `SELECT "_id" FROM "${k}EpisodeMember" WHERE "_id" = ANY($1)`,
          [s.members],
        )
      ).map((r: { _id: string }) => {
        return r._id;
      }),
    );
    const refs: Array<{ _id: string; ref: string | null }> =
      await database.query(
        `SELECT "_id", "${lower}EpisodeId" AS ref FROM "${k}" WHERE "_id" = ANY($1)`,
        [s.records],
      );
    const refOf: Map<string, string | null> = new Map(
      refs.map((r: { _id: string; ref: string | null }) => {
        return [r._id, r.ref];
      }),
    );
    const count: Array<Record<string, number>> = await database.query(
      `SELECT "${lower}Count" AS c FROM "${k}Episode" WHERE "_id" = $1`,
      [s.episodeId],
    );

    return {
      deleted: s.members
        .map((m: string, i: number) => {
          return kept.has(m) ? -1 : i;
        })
        .filter((i: number) => {
          return i >= 0;
        }),
      cleared: s.records
        .map((r: string, i: number) => {
          return refOf.get(r) === null ? i : -1;
        })
        .filter((i: number) => {
          return i >= 0;
        }),
      count: Number(count[0]?.["c"]),
    };
  }

  describe.each(KINDS)("$name", (kind: Kind) => {
    test("deleting one member by id clears its record", async () => {
      const s: Seeded = await seed(kind, 1);

      await kind.service.deleteOneById({
        id: new ObjectID(s.members[0]!),
        props: { isRoot: true },
      });

      const after: Awaited<ReturnType<typeof state>> = await state(kind, s);
      expect(after.deleted).toEqual([0]);
      expect(after.cleared).toEqual([0]);
      expect(after.count).toBe(0);
    });
  });
});
