import Entities from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentService from "../../../Server/Services/IncidentService";
import {
  ALERT_EPISODE_REFERENCE,
  EpisodeMembershipReferenceColumn,
  INCIDENT_EPISODE_REFERENCE,
} from "../../../Server/Utils/Episode/EpisodeMembershipReference";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { DataSource } from "typeorm";

/*
 * An incident's or alert's episode, against a migrated Postgres: it follows
 * the episode's members and nothing else. A create or update that names it
 * is refused - from a person, an API key (as Terraform and the MCP tools
 * use), a workflow step (root, in its project) or a master admin - and the
 * row is left as it was: no record is made, no number is taken, and the
 * reference stays where membership put it. Joining and leaving through the
 * episode's members still moves it, which is OneUptime's own write.
 *
 * Opt in with RUN_POSTGRES_EPISODE_REFERENCE_WRITE_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_EPISODE_REFERENCE_WRITE_TESTS=true \
 *   EPISODE_REFERENCE_WRITE_TEST_DATABASE_HOST=127.0.0.1 \
 *   EPISODE_REFERENCE_WRITE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/EpisodeReferenceWritePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database.
 *
 * The rows are real ones: each test's fixture is created under its own
 * project, which is deleted afterwards.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EPISODE_REFERENCE_WRITE_TESTS"] === "true"
    ? describe
    : describe.skip;

interface Kind {
  name: "Incident" | "Alert";
  reference: EpisodeMembershipReferenceColumn;
  service: typeof IncidentService | typeof AlertService;
  memberService:
    | typeof IncidentEpisodeMemberService
    | typeof AlertEpisodeMemberService;
  // The project's counter its numbers are taken from.
  counterColumn: "incidentCounter" | "alertCounter";
  // A project role that may create and edit the record and its episode's members.
  memberRole: Permission;
}

const KINDS: Array<Kind> = [
  {
    name: "Incident",
    reference: INCIDENT_EPISODE_REFERENCE,
    service: IncidentService,
    memberService: IncidentEpisodeMemberService,
    counterColumn: "incidentCounter",
    memberRole: Permission.IncidentMember,
  },
  {
    name: "Alert",
    reference: ALERT_EPISODE_REFERENCE,
    service: AlertService,
    memberService: AlertEpisodeMemberService,
    counterColumn: "alertCounter",
    memberRole: Permission.AlertMember,
  },
];

// A project with one record, in no episode yet, and an episode it could join.
interface Seeded {
  projectId: ObjectID;
  stateId: string;
  severityId: string;
  recordId: string;
  episodeId: string;
}

interface Caller {
  caller: string;
  props: (kind: Kind, projectId: ObjectID) => DatabaseCommonInteractionProps;
}

function tenantPermission(
  projectId: ObjectID,
  permission: Permission,
): UserTenantAccessPermission {
  return {
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
  };
}

// An API key: no person on the request, so nothing is credited to one.
function apiKeyProps(
  kind: Kind,
  projectId: ObjectID,
): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userType: UserType.API,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission(projectId, kind.memberRole),
    },
  };
}

// Everyone who writes in a project.
const CALLERS: Array<Caller> = [
  {
    caller: "a project admin",
    props: (_kind: Kind, projectId: ObjectID) => {
      return {
        tenantId: projectId,
        userId: ObjectID.generate(),
        userType: UserType.User,
        userTenantAccessPermission: {
          [projectId.toString()]: tenantPermission(
            projectId,
            Permission.ProjectAdmin,
          ),
        },
      };
    },
  },
  {
    caller: "an API key, as Terraform and the MCP tools use",
    props: apiKeyProps,
  },
  {
    caller: "a workflow step",
    props: (_kind: Kind, projectId: ObjectID) => {
      return { isRoot: true, tenantId: projectId };
    },
  },
  {
    caller: "a master admin",
    props: (_kind: Kind, projectId: ObjectID) => {
      return {
        isMasterAdmin: true,
        tenantId: projectId,
        userId: ObjectID.generate(),
      };
    },
  },
];

describePostgres(
  "an episode reference written directly, against a migrated Postgres",
  () => {
    let database: DataSource;
    const projects: Array<string> = [];

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["EPISODE_REFERENCE_WRITE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["EPISODE_REFERENCE_WRITE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["EPISODE_REFERENCE_WRITE_TEST_DATABASE_NAME"] ||
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

    async function seed(kind: Kind): Promise<Seeded> {
      const k: string = kind.name;
      const lower: string = k.toLowerCase();
      const id: () => string = () => {
        return ObjectID.generate().toString();
      };
      const projectId: string = id();
      const stateId: string = id();
      const severityId: string = id();
      const recordId: string = id();
      const episodeId: string = id();
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
      await database.query(
        `INSERT INTO "${k}Episode" ("_id","projectId","title","current${k}StateId","version") VALUES ($1,$2,'e',$3,1)`,
        [episodeId, projectId, stateId],
      );

      const slugColumn: string = k === "Incident" ? `,"slug"` : "";
      const slugValue: string = k === "Incident" ? `,'s${recordId}'` : "";
      await database.query(
        `INSERT INTO "${k}" ("_id","projectId","title","current${k}StateId","${lower}SeverityId","version"${slugColumn}) VALUES ($1,$2,'t',$3,$4,1${slugValue})`,
        [recordId, projectId, stateId, severityId],
      );

      return {
        projectId: new ObjectID(projectId),
        stateId,
        severityId,
        recordId,
        episodeId,
      };
    }

    // The column the episode's overview finds its incidents or alerts by.
    async function episodeReferenceOf(
      kind: Kind,
      recordId: string,
    ): Promise<string | null> {
      const rows: Array<{ episodeId: string | null }> = await database.query(
        `SELECT "${kind.reference.keys[0]}" AS "episodeId" FROM "${kind.name}" WHERE "_id" = $1`,
        [recordId],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!.episodeId;
    }

    // What the episode's Members tab lists.
    async function membersOf(kind: Kind, episodeId: string): Promise<number> {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT count(*) AS "count" FROM "${kind.name}EpisodeMember" WHERE "${kind.name.toLowerCase()}EpisodeId" = $1`,
        [episodeId],
      );
      return Number(rows[0]?.count);
    }

    async function recordsTitled(
      kind: Kind,
      projectId: ObjectID,
      title: string,
    ): Promise<number> {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT count(*) AS "count" FROM "${kind.name}" WHERE "projectId" = $1 AND "title" = $2`,
        [projectId.toString(), title],
      );
      return Number(rows[0]?.count);
    }

    async function counterOf(kind: Kind, projectId: ObjectID): Promise<number> {
      const rows: Array<Record<string, number>> = await database.query(
        `SELECT "${kind.counterColumn}" AS "counter" FROM "Project" WHERE "_id" = $1`,
        [projectId.toString()],
      );
      return Number(rows[0]?.["counter"]);
    }

    // The write's refusal, or null when it went through.
    async function refusalOf(write: Promise<unknown>): Promise<unknown> {
      try {
        await write;
      } catch (error) {
        return error;
      }

      return null;
    }

    function newRecord(kind: Kind, s: Seeded, title: string): Incident | Alert {
      if (kind.name === "Incident") {
        const incident: Incident = new Incident();
        incident.projectId = s.projectId;
        incident.title = title;
        incident.incidentSeverityId = new ObjectID(s.severityId);
        return incident;
      }

      const alert: Alert = new Alert();
      alert.projectId = s.projectId;
      alert.title = title;
      alert.alertSeverityId = new ObjectID(s.severityId);
      return alert;
    }

    describe.each(KINDS)("$name", (kind: Kind) => {
      const [idColumn, relation] = kind.reference.keys as [string, string];

      test.each(CALLERS)(
        "$caller cannot put it in an episode, or take it out, by writing its episode",
        async ({ props }: Caller) => {
          const s: Seeded = await seed(kind);

          for (const data of [
            { [idColumn]: new ObjectID(s.episodeId) },
            { [relation]: { _id: s.episodeId } },
            { [idColumn]: null },
          ]) {
            const refusal: unknown = await refusalOf(
              kind.service.updateOneById({
                id: new ObjectID(s.recordId),
                data: data as never,
                props: props(kind, s.projectId),
              }),
            );

            expect(refusal).toBeInstanceOf(BadDataException);
            expect((refusal as Error).message).toBe(kind.reference.refusal);
          }

          // The overview would not list it, and the members do not.
          expect(await episodeReferenceOf(kind, s.recordId)).toBeNull();
          expect(await membersOf(kind, s.episodeId)).toBe(0);
        },
      );

      test.each(CALLERS)(
        "$caller cannot create it in an episode: no record is made and no number taken",
        async ({ props }: Caller) => {
          const s: Seeded = await seed(kind);
          const title: string = `In an episode ${ObjectID.generate().toString()}`;

          for (const values of [
            { [idColumn]: new ObjectID(s.episodeId) },
            { [relation]: { _id: s.episodeId } },
          ]) {
            const record: Incident | Alert = newRecord(kind, s, title);
            Object.assign(record, values);

            const refusal: unknown = await refusalOf(
              kind.service.create({
                data: record as never,
                props: props(kind, s.projectId),
              }),
            );

            expect(refusal).toBeInstanceOf(BadDataException);
            expect((refusal as Error).message).toBe(kind.reference.refusal);
          }

          expect(await recordsTitled(kind, s.projectId, title)).toBe(0);
          expect(await counterOf(kind, s.projectId)).toBe(0);
          expect(await membersOf(kind, s.episodeId)).toBe(0);
        },
      );

      test("it joins and leaves through the episode's members, and its episode follows", async () => {
        const s: Seeded = await seed(kind);
        const props: DatabaseCommonInteractionProps = apiKeyProps(
          kind,
          s.projectId,
        );

        const member: IncidentEpisodeMember | AlertEpisodeMember =
          kind.name === "Incident"
            ? new IncidentEpisodeMember()
            : new AlertEpisodeMember();
        member.projectId = s.projectId;
        member.setColumnValue(
          `${kind.name.toLowerCase()}EpisodeId`,
          new ObjectID(s.episodeId),
        );
        member.setColumnValue(
          `${kind.name.toLowerCase()}Id`,
          new ObjectID(s.recordId),
        );

        const created: IncidentEpisodeMember | AlertEpisodeMember = await (
          kind.memberService as unknown as {
            create: (createBy: {
              data: IncidentEpisodeMember | AlertEpisodeMember;
              props: DatabaseCommonInteractionProps;
            }) => Promise<IncidentEpisodeMember | AlertEpisodeMember>;
          }
        ).create({ data: member, props: props });

        expect(await membersOf(kind, s.episodeId)).toBe(1);
        expect(await episodeReferenceOf(kind, s.recordId)).toBe(s.episodeId);

        await kind.memberService.deleteOneById({
          id: created.id!,
          props: props,
        });

        expect(await membersOf(kind, s.episodeId)).toBe(0);
        expect(await episodeReferenceOf(kind, s.recordId)).toBeNull();
      });
    });
  },
);
