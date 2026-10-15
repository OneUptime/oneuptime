import AlertEpisodeLabelRuleEngineService from "../../../Server/Services/AlertEpisodeLabelRuleEngineService";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeOnCallRuleEngineService from "../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeOwnerRuleEngineService from "../../../Server/Services/AlertEpisodeOwnerRuleEngineService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeLabelRuleEngineService from "../../../Server/Services/IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeOnCallRuleEngineService from "../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOwnerRuleEngineService from "../../../Server/Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ALERT_IDS_TO_ADD_KEY,
  ALERT_NOT_FOUND_REASON,
  EpisodeMembersAddResult,
  INCIDENT_IDS_TO_ADD_KEY,
  INCIDENT_NOT_FOUND_REASON,
} from "../../../Types/Episode/EpisodeMembersAdd";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { DataSource } from "typeorm";

/*
 * Adding several incidents (or alerts) to an episode in one request, and
 * creating an episode with them, against a migrated Postgres - the paths
 * behind the lists' Add to Existing Episode and Add to New Episode, and an
 * episode's own Add Alerts / Add Incidents.
 *
 *   - Each one is read as the person, so the real privacy rules decide: a
 *     private one they do not own, one of another project, and one that does
 *     not exist get the same answer, and are not added. One in the episode
 *     already is left as it was.
 *   - Each added one is a member row, by the person, and its record now
 *     names the episode and has its own feed entry.
 *   - The episode's side is written once: its count, its last-added time,
 *     its severity raised to the most severe one added, and ONE feed entry -
 *     and one Slack / Microsoft Teams post - naming them all.
 *   - An episode created with them is created at their most severe severity,
 *     holds them as founding members (its "created" notification covers
 *     them), and names them in one entry after "Episode Created". One the
 *     person cannot see refuses the whole create: no episode, no number.
 *
 * Opt in with RUN_POSTGRES_EPISODE_MEMBERS_BULK_ADD_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_EPISODE_MEMBERS_BULK_ADD_TESTS=true \
 *   EPISODE_MEMBERS_BULK_ADD_TEST_DATABASE_HOST=127.0.0.1 \
 *   EPISODE_MEMBERS_BULK_ADD_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/EpisodeMembersBulkAddPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database.
 *
 * The rows are real ones: each test's fixture is created under its own
 * project, which is deleted afterwards, as are the people.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EPISODE_MEMBERS_BULK_ADD_TESTS"] === "true"
    ? describe
    : describe.skip;

type AnyFunction = (...args: Array<any>) => any;
type AnyService = Record<string, AnyFunction>;

interface Kind {
  name: "Incident" | "Alert";
  plural: "incidents" | "alerts";
  memberService: AnyService;
  episodeService: AnyService;
  episodeModel: { new (): DatabaseBaseModel };
  addMethod: "addIncidentsToEpisode" | "addAlertsToEpisode";
  idsKey: "incidentIds" | "alertIds";
  episodeIdKey: "incidentEpisodeId" | "alertEpisodeId";
  idsToAddKey: string;
  recordIdColumn: "incidentId" | "alertId";
  episodeIdColumn: "incidentEpisodeId" | "alertEpisodeId";
  severityIdColumn: "incidentSeverityId" | "alertSeverityId";
  countColumn: "incidentCount" | "alertCount";
  lastAddedColumn: "lastIncidentAddedAt" | "lastAlertAddedAt";
  founderColumn:
    | "isOwnerNotifiedOfIncidentAdded"
    | "isOwnerNotifiedOfAlertAdded";
  counterColumn: "incidentEpisodeCounter" | "alertEpisodeCounter";
  notFoundReason: string;
  episodeRefusal: string;
  newEpisodeRefusal: string;
  ownerEngine: AnyService;
  labelEngine: AnyService;
  onCallEngine: AnyService;
}

const KINDS: Array<Kind> = [
  {
    name: "Incident",
    plural: "incidents",
    memberService: IncidentEpisodeMemberService as unknown as AnyService,
    episodeService: IncidentEpisodeService as unknown as AnyService,
    episodeModel: IncidentEpisode,
    addMethod: "addIncidentsToEpisode",
    idsKey: "incidentIds",
    episodeIdKey: "incidentEpisodeId",
    idsToAddKey: INCIDENT_IDS_TO_ADD_KEY,
    recordIdColumn: "incidentId",
    episodeIdColumn: "incidentEpisodeId",
    severityIdColumn: "incidentSeverityId",
    countColumn: "incidentCount",
    lastAddedColumn: "lastIncidentAddedAt",
    founderColumn: "isOwnerNotifiedOfIncidentAdded",
    counterColumn: "incidentEpisodeCounter",
    notFoundReason: INCIDENT_NOT_FOUND_REASON,
    episodeRefusal:
      "The episode to add the incidents to does not exist in this project, or you do not have access to it.",
    newEpisodeRefusal:
      "Some of the incidents to add to the episode do not exist in this project, or you do not have access to them.",
    ownerEngine: IncidentEpisodeOwnerRuleEngineService as unknown as AnyService,
    labelEngine: IncidentEpisodeLabelRuleEngineService as unknown as AnyService,
    onCallEngine:
      IncidentEpisodeOnCallRuleEngineService as unknown as AnyService,
  },
  {
    name: "Alert",
    plural: "alerts",
    memberService: AlertEpisodeMemberService as unknown as AnyService,
    episodeService: AlertEpisodeService as unknown as AnyService,
    episodeModel: AlertEpisode,
    addMethod: "addAlertsToEpisode",
    idsKey: "alertIds",
    episodeIdKey: "alertEpisodeId",
    idsToAddKey: ALERT_IDS_TO_ADD_KEY,
    recordIdColumn: "alertId",
    episodeIdColumn: "alertEpisodeId",
    severityIdColumn: "alertSeverityId",
    countColumn: "alertCount",
    lastAddedColumn: "lastAlertAddedAt",
    founderColumn: "isOwnerNotifiedOfAlertAdded",
    counterColumn: "alertEpisodeCounter",
    notFoundReason: ALERT_NOT_FOUND_REASON,
    episodeRefusal:
      "The episode to add the alerts to does not exist in this project, or you do not have access to it.",
    newEpisodeRefusal:
      "Some of the alerts to add to the episode do not exist in this project, or you do not have access to them.",
    ownerEngine: AlertEpisodeOwnerRuleEngineService as unknown as AnyService,
    labelEngine: AlertEpisodeLabelRuleEngineService as unknown as AnyService,
    onCallEngine: AlertEpisodeOnCallRuleEngineService as unknown as AnyService,
  },
];

const EPISODE_TITLE: string = "Checkout degradation";
const PRIVATE_EPISODE_TITLE: string = "Payroll data breach";
const MINOR_TITLE: string = "Checkout p95 above 2 s";
const CRITICAL_TITLE: string = "Checkout API is offline";
const ALREADY_TITLE: string = "Cart service restarts";
const PRIVATE_TITLE: string = "Payroll export is leaking salaries";

/*
 * One project: a public episode at Minor holding one record already, a
 * private episode, a Minor and a Critical public record, a private record
 * nobody below owns, and the people who add them.
 */
interface Seeded {
  projectId: ObjectID;
  minorSeverityId: ObjectID;
  criticalSeverityId: ObjectID;
  episodeId: ObjectID;
  privateEpisodeId: ObjectID;
  minorRecordId: ObjectID;
  criticalRecordId: ObjectID;
  alreadyRecordId: ObjectID;
  privateRecordId: ObjectID;
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

describePostgres(
  "adding several to an episode at once, against a migrated Postgres",
  () => {
    let database: DataSource;
    let posts: jest.SpyInstance;
    // A project member who owns nothing private.
    let personId: ObjectID;
    // What another project holds: one record of each kind.
    let otherProjectId: ObjectID;
    const otherProjectRecords: Record<string, ObjectID> = {};
    const projects: Array<string> = [];
    const users: Array<string> = [];

    // The episode create's follow-ons that are not under test have ended.
    const chain: { ended: () => void } = { ended: () => {} };

    async function insertUser(): Promise<ObjectID> {
      const userId: string = ObjectID.generate().toString();
      users.push(userId);
      await database.query(
        `INSERT INTO "User" ("_id","email","slug","version") VALUES ($1,$2,$3,1)`,
        [userId, `episode-bulk-${userId}@example.com`, `s${userId}`],
      );
      return new ObjectID(userId);
    }

    async function insertProject(): Promise<string> {
      const projectId: string = ObjectID.generate().toString();
      projects.push(projectId);
      await database.query(
        `INSERT INTO "Project" ("_id","name","slug","version") VALUES ($1,'t',$2,1)`,
        [projectId, `s${projectId}`],
      );
      return projectId;
    }

    // A project's created state and a severity, for a kind.
    async function insertStateAndSeverity(
      kind: Kind,
      projectId: string,
      severityOrder: number,
    ): Promise<{ stateId: string; severityId: string }> {
      const k: string = kind.name;
      const stateId: string = ObjectID.generate().toString();
      const severityId: string = ObjectID.generate().toString();
      const stateSlugColumn: string = k === "Incident" ? `,"slug"` : "";
      const stateSlugValue: string = k === "Incident" ? `,'s${stateId}'` : "";
      await database.query(
        `INSERT INTO "${k}State" ("_id","projectId","name","color","order","isCreatedState","version"${stateSlugColumn}) VALUES ($1,$2,'Created','#fff',1,true,1${stateSlugValue})`,
        [stateId, projectId],
      );
      await database.query(
        `INSERT INTO "${k}Severity" ("_id","projectId","name","slug","color","order","version") VALUES ($1,$2,$3,$4,'#fff',$5,1)`,
        [
          severityId,
          projectId,
          severityOrder === 1 ? "Critical" : "Minor",
          `s${severityId}`,
          severityOrder,
        ],
      );
      return { stateId, severityId };
    }

    // Each record's number, as the project's counter would have given it.
    let nextNumber: number = 100;

    async function insertRecord(
      kind: Kind,
      data: {
        projectId: string;
        stateId: string;
        severityId: string;
        title: string;
        isPrivate: boolean;
      },
    ): Promise<string> {
      const k: string = kind.name;
      const lower: string = k.toLowerCase();
      const recordId: string = ObjectID.generate().toString();
      const slugColumn: string = k === "Incident" ? `,"slug"` : "";
      const slugValue: string = k === "Incident" ? `,'s${recordId}'` : "";
      nextNumber++;
      await database.query(
        `INSERT INTO "${k}" ("_id","projectId","title","current${k}StateId","${lower}SeverityId","isPrivate","${lower}Number","${lower}NumberWithPrefix","version"${slugColumn}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1${slugValue})`,
        [
          recordId,
          data.projectId,
          data.title,
          data.stateId,
          data.severityId,
          data.isPrivate,
          nextNumber,
          `#${nextNumber}`,
        ],
      );
      return recordId;
    }

    async function numberOf(kind: Kind, recordId: ObjectID): Promise<string> {
      const lower: string = kind.name.toLowerCase();
      const rows: Array<{ label: string }> = await database.query(
        `SELECT "${lower}NumberWithPrefix" AS "label" FROM "${kind.name}" WHERE "_id" = $1`,
        [recordId.toString()],
      );
      return rows[0]!.label;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["EPISODE_MEMBERS_BULK_ADD_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["EPISODE_MEMBERS_BULK_ADD_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["EPISODE_MEMBERS_BULK_ADD_TEST_DATABASE_NAME"] ||
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

      // The episode number's lock is a Redis one; one process needs none.
      jest
        .spyOn(Semaphore, "lock")
        .mockResolvedValue({ name: "lock" } as unknown as SemaphoreMutex);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

      personId = await insertUser();

      otherProjectId = new ObjectID(await insertProject());
      for (const kind of KINDS) {
        const { stateId, severityId } = await insertStateAndSeverity(
          kind,
          otherProjectId.toString(),
          1,
        );
        otherProjectRecords[kind.name] = new ObjectID(
          await insertRecord(kind, {
            projectId: otherProjectId.toString(),
            stateId,
            severityId,
            title: "Another project's",
            isPrivate: false,
          }),
        );
      }

      /*
       * Adding notifies workflows and open dashboards, and an episode's
       * create runs its rules, opens its channels and pages its on-call
       * policies; here only what is added, and what the feeds say, matters.
       * The feed entries are written for real; what would be posted to Slack
       * and Microsoft Teams is kept to be read.
       */
      for (const kind of KINDS) {
        for (const service of [kind.memberService, kind.episodeService]) {
          jest
            .spyOn(service, "onTriggerWorkflow")
            .mockResolvedValue(undefined as never);
          jest
            .spyOn(service, "onTriggerRealtime")
            .mockResolvedValue(undefined as never);
        }
        jest
          .spyOn(kind.episodeService, "handleEpisodeWorkspaceOperationsAsync")
          .mockResolvedValue([] as never);
        jest
          .spyOn(kind.episodeService, "changeEpisodeState")
          .mockResolvedValue(undefined as never);
        jest
          .spyOn(kind.ownerEngine, "applyRulesToEpisode")
          .mockResolvedValue(undefined as never);
        jest
          .spyOn(kind.labelEngine, "applyRulesToEpisode")
          .mockResolvedValue(undefined as never);
        jest
          .spyOn(kind.onCallEngine, "applyRulesToEpisode")
          .mockResolvedValue(undefined as never);
        jest
          .spyOn(kind.episodeService, "executeEpisodeOnCallDutyPoliciesAsync")
          .mockImplementation((async () => {
            chain.ended();
          }) as never);
      }
      posts = jest
        .spyOn(
          WorkspaceNotificationRuleService,
          "sendWorkspaceMarkdownNotification",
        )
        .mockResolvedValue(undefined as never);
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
      const projectId: string = await insertProject();
      const { stateId, severityId: minorSeverityId } =
        await insertStateAndSeverity(kind, projectId, 2);
      const criticalSeverityId: string = ObjectID.generate().toString();
      await database.query(
        `INSERT INTO "${k}Severity" ("_id","projectId","name","slug","color","order","version") VALUES ($1,$2,'Critical',$3,'#f00',1,1)`,
        [criticalSeverityId, projectId, `s${criticalSeverityId}`],
      );

      const insertEpisode: (
        title: string,
        isPrivate: boolean,
      ) => Promise<string> = async (
        title: string,
        isPrivate: boolean,
      ): Promise<string> => {
        const episodeId: string = ObjectID.generate().toString();
        await database.query(
          `INSERT INTO "${k}Episode" ("_id","projectId","title","current${k}StateId","${lower}SeverityId","isPrivate","${kind.countColumn}","version") VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
          [
            episodeId,
            projectId,
            title,
            stateId,
            minorSeverityId,
            isPrivate,
            isPrivate ? 0 : 1,
          ],
        );
        return episodeId;
      };

      const episodeId: string = await insertEpisode(EPISODE_TITLE, false);
      const privateEpisodeId: string = await insertEpisode(
        PRIVATE_EPISODE_TITLE,
        true,
      );

      const record: (
        title: string,
        severityId: string,
        isPrivate: boolean,
      ) => Promise<string> = (
        title: string,
        severityId: string,
        isPrivate: boolean,
      ): Promise<string> => {
        return insertRecord(kind, {
          projectId,
          stateId,
          severityId,
          title,
          isPrivate,
        });
      };

      const minorRecordId: string = await record(
        MINOR_TITLE,
        minorSeverityId,
        false,
      );
      const criticalRecordId: string = await record(
        CRITICAL_TITLE,
        criticalSeverityId,
        false,
      );
      const alreadyRecordId: string = await record(
        ALREADY_TITLE,
        minorSeverityId,
        false,
      );
      const privateRecordId: string = await record(
        PRIVATE_TITLE,
        criticalSeverityId,
        true,
      );

      // The person is on one of the project's teams, as its people are.
      const teamId: string = ObjectID.generate().toString();
      await database.query(
        `INSERT INTO "Team" ("_id","projectId","name","slug","version") VALUES ($1,$2,'Members',$3,1)`,
        [teamId, projectId, `s${teamId}`],
      );
      await database.query(
        `INSERT INTO "TeamMember" ("_id","projectId","teamId","userId","hasAcceptedInvitation","version") VALUES ($1,$2,$3,$4,true,1)`,
        [
          ObjectID.generate().toString(),
          projectId,
          teamId,
          personId.toString(),
        ],
      );

      // In the episode already, as a grouping rule put it there.
      await database.query(
        `INSERT INTO "${k}EpisodeMember" ("_id","projectId","${kind.episodeIdColumn}","${kind.recordIdColumn}","addedBy","version") VALUES ($1,$2,$3,$4,'rule',1)`,
        [ObjectID.generate().toString(), projectId, episodeId, alreadyRecordId],
      );

      return {
        projectId: new ObjectID(projectId),
        minorSeverityId: new ObjectID(minorSeverityId),
        criticalSeverityId: new ObjectID(criticalSeverityId),
        episodeId: new ObjectID(episodeId),
        privateEpisodeId: new ObjectID(privateEpisodeId),
        minorRecordId: new ObjectID(minorRecordId),
        criticalRecordId: new ObjectID(criticalRecordId),
        alreadyRecordId: new ObjectID(alreadyRecordId),
        privateRecordId: new ObjectID(privateRecordId),
      };
    }

    async function add(
      kind: Kind,
      episodeId: ObjectID,
      ids: Array<string>,
      props: DatabaseCommonInteractionProps,
    ): Promise<EpisodeMembersAddResult> {
      return (await kind.memberService[kind.addMethod]!({
        [kind.episodeIdKey]: episodeId.toString(),
        [kind.idsKey]: ids,
        props: props,
      })) as EpisodeMembersAddResult;
    }

    async function refusalOf(promise: Promise<unknown>): Promise<Error> {
      let outcome: unknown = "went on";
      try {
        await promise;
      } catch (error) {
        outcome = error;
      }
      expect(outcome).toBeInstanceOf(Error);
      return outcome as Error;
    }

    interface MemberRow {
      recordId: string;
      addedBy: string;
      addedByUserId: string | null;
      founder: boolean | null;
    }

    async function membersOf(
      kind: Kind,
      episodeId: ObjectID,
    ): Promise<Array<MemberRow>> {
      return await database.query(
        `SELECT "${kind.recordIdColumn}" AS "recordId", "addedBy", "addedByUserId", "${kind.founderColumn}" AS "founder" FROM "${kind.name}EpisodeMember" WHERE "${kind.episodeIdColumn}" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt"`,
        [episodeId.toString()],
      );
    }

    async function episodeRow(
      kind: Kind,
      episodeId: ObjectID,
    ): Promise<{
      count: number;
      lastAddedAt: Date | null;
      severityId: string | null;
    }> {
      const rows: Array<{
        count: number;
        lastAddedAt: Date | null;
        severityId: string | null;
      }> = await database.query(
        `SELECT "${kind.countColumn}" AS "count", "${kind.lastAddedColumn}" AS "lastAddedAt", "${kind.severityIdColumn}" AS "severityId" FROM "${kind.name}Episode" WHERE "_id" = $1`,
        [episodeId.toString()],
      );
      return rows[0]!;
    }

    async function episodeFeed(
      kind: Kind,
      episodeId: ObjectID,
    ): Promise<Array<string>> {
      const rows: Array<{ markdown: string }> = await database.query(
        `SELECT "feedInfoInMarkdown" AS "markdown" FROM "${kind.name}EpisodeFeed" WHERE "${kind.episodeIdColumn}" = $1 ORDER BY "createdAt", "postedAt"`,
        [episodeId.toString()],
      );
      return rows.map((row: { markdown: string }): string => {
        return row.markdown;
      });
    }

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

    async function recordEpisodeId(
      kind: Kind,
      recordId: ObjectID,
    ): Promise<string | null> {
      const rows: Array<{ episodeId: string | null }> = await database.query(
        `SELECT "${kind.episodeIdColumn}" AS "episodeId" FROM "${kind.name}" WHERE "_id" = $1`,
        [recordId.toString()],
      );
      return rows[0]?.episodeId || null;
    }

    function postedMarkdown(): Array<string> {
      return posts.mock.calls.map((args: Array<unknown>): string => {
        return (args[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
      });
    }

    describe.each(KINDS)("$name", (kind: Kind) => {
      test(`a project member adds several ${kind.plural} in one request: each is answered, and the episode's side is written once`, async () => {
        const s: Seeded = await seed(kind);
        const props: DatabaseCommonInteractionProps = userProps(
          s.projectId,
          personId,
          Permission.ProjectMember,
        );
        const missingId: string = ObjectID.generate().toString();

        const result: EpisodeMembersAddResult = await add(
          kind,
          s.episodeId,
          [
            s.criticalRecordId.toString(),
            s.alreadyRecordId.toString(),
            s.privateRecordId.toString(),
            otherProjectRecords[kind.name]!.toString(),
            s.minorRecordId.toString().toUpperCase(),
            missingId,
            s.criticalRecordId.toString(),
          ],
          props,
        );

        expect(result).toEqual({
          added: [s.criticalRecordId.toString(), s.minorRecordId.toString()],
          alreadyInEpisode: [s.alreadyRecordId.toString()],
          notAdded: [
            { id: s.privateRecordId.toString(), reason: kind.notFoundReason },
            {
              id: otherProjectRecords[kind.name]!.toString(),
              reason: kind.notFoundReason,
            },
            { id: missingId, reason: kind.notFoundReason },
          ],
        });

        // The member rows: the one there already, then each added, by them.
        const members: Array<MemberRow> = await membersOf(kind, s.episodeId);
        expect(
          members.map((member: MemberRow): string => {
            return member.recordId;
          }),
        ).toEqual([
          s.alreadyRecordId.toString(),
          s.criticalRecordId.toString(),
          s.minorRecordId.toString(),
        ]);
        for (const member of members.slice(1)) {
          expect(member.addedBy).toBe("manual");
          expect(member.addedByUserId).toBe(personId.toString());
          // Its owners are told it was added, as for one added alone.
          expect(member.founder).toBe(false);
        }

        // Each record now names the episode, and says so in its own feed.
        for (const recordId of [s.criticalRecordId, s.minorRecordId]) {
          expect(await recordEpisodeId(kind, recordId)).toBe(
            s.episodeId.toString(),
          );
          expect(await recordFeed(kind, recordId)).toEqual([
            expect.stringContaining(`: ${EPISODE_TITLE}`),
          ]);
        }
        expect(await recordEpisodeId(kind, s.privateRecordId)).toBeNull();

        // The episode: recounted, stamped, raised to Critical.
        const episode: {
          count: number;
          lastAddedAt: Date | null;
          severityId: string | null;
        } = await episodeRow(kind, s.episodeId);
        expect(episode.count).toBe(3);
        expect(episode.lastAddedAt).not.toBeNull();
        expect(episode.severityId).toBe(s.criticalSeverityId.toString());

        /*
         * ONE entry, naming both by number and title in the order they were
         * asked for - then, on an incident episode, the severity it raised
         * (IncidentEpisodeService.updateEpisodeSeverity says so).
         */
        const entries: Array<string> = await episodeFeed(kind, s.episodeId);
        expect(entries).toEqual(
          kind.name === "Incident"
            ? [
                expect.stringContaining("added to episode"),
                "Episode severity changed to **Critical**",
              ]
            : [expect.stringContaining("added to episode")],
        );
        expect(entries[0]!.split("\n")).toEqual([
          `**2 ${kind.plural}** added to episode:`,
          "",
          `- **${kind.name} ${await numberOf(kind, s.criticalRecordId)}**: ${CRITICAL_TITLE}`,
          `- **${kind.name} ${await numberOf(kind, s.minorRecordId)}**: ${MINOR_TITLE}`,
        ]);

        // And one Slack / Microsoft Teams post naming them: that entry.
        expect(
          postedMarkdown().filter((markdown: string): boolean => {
            return markdown.includes("added to episode");
          }),
        ).toEqual([entries[0]]);
      });

      test(`adding the same ${kind.plural} again adds nothing and writes nothing`, async () => {
        const s: Seeded = await seed(kind);
        const props: DatabaseCommonInteractionProps = userProps(
          s.projectId,
          personId,
          Permission.ProjectMember,
        );
        const ids: Array<string> = [
          s.criticalRecordId.toString(),
          s.minorRecordId.toString(),
        ];

        await add(kind, s.episodeId, ids, props);
        const entriesBefore: Array<string> = await episodeFeed(
          kind,
          s.episodeId,
        );
        posts.mockClear();

        expect(await add(kind, s.episodeId, ids, props)).toEqual({
          added: [],
          alreadyInEpisode: ids,
          notAdded: [],
        });

        expect(await membersOf(kind, s.episodeId)).toHaveLength(3);
        expect(await episodeFeed(kind, s.episodeId)).toEqual(entriesBefore);
        expect(postedMarkdown()).toEqual([]);
      });

      test(`a Viewer, who can read them, may not add ${kind.plural} to an episode: refused, and nothing is written`, async () => {
        const s: Seeded = await seed(kind);

        const error: Error = await refusalOf(
          add(
            kind,
            s.episodeId,
            [s.minorRecordId.toString()],
            userProps(s.projectId, personId, Permission.Viewer),
          ),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(await membersOf(kind, s.episodeId)).toHaveLength(1);
        expect(await episodeFeed(kind, s.episodeId)).toEqual([]);
        expect(postedMarkdown()).toEqual([]);
      });

      test(`a private episode the person cannot see is answered as one that does not exist`, async () => {
        const s: Seeded = await seed(kind);
        const props: DatabaseCommonInteractionProps = userProps(
          s.projectId,
          personId,
          Permission.ProjectMember,
        );

        for (const episodeId of [s.privateEpisodeId, ObjectID.generate()]) {
          const error: Error = await refusalOf(
            add(kind, episodeId, [s.minorRecordId.toString()], props),
          );

          expect(error).toBeInstanceOf(BadDataException);
          expect(error.message).toBe(kind.episodeRefusal);
        }

        expect(await membersOf(kind, s.privateEpisodeId)).toEqual([]);
        expect(await recordEpisodeId(kind, s.minorRecordId)).toBeNull();
      });

      test(`an episode created with ${kind.plural} starts at their most severe severity, holds them as founding members, and names them after Episode Created`, async () => {
        const s: Seeded = await seed(kind);
        const ended: Promise<void> = new Promise<void>(
          (resolve: () => void) => {
            chain.ended = resolve;
          },
        );

        const episode: DatabaseBaseModel = new kind.episodeModel();
        episode.setColumnValue("projectId", s.projectId);
        episode.setColumnValue("title", "Checkout outage");

        const created: DatabaseBaseModel = (await kind.episodeService[
          "create"
        ]!({
          data: episode,
          props: userProps(s.projectId, personId, Permission.ProjectMember),
          miscDataProps: {
            [kind.idsToAddKey]: [
              s.minorRecordId.toString(),
              s.criticalRecordId.toString(),
            ],
          },
        })) as DatabaseBaseModel;

        const createdId: ObjectID = new ObjectID(created._id!.toString());

        // In it as soon as the create answers.
        const members: Array<MemberRow> = await membersOf(kind, createdId);
        expect(
          members.map((member: MemberRow): string => {
            return member.recordId;
          }),
        ).toEqual([s.minorRecordId.toString(), s.criticalRecordId.toString()]);
        for (const member of members) {
          expect(member.addedBy).toBe("manual");
          expect(member.addedByUserId).toBe(personId.toString());
          // The episode's "created" notification covers them.
          expect(member.founder).toBe(true);
        }

        const row: {
          count: number;
          lastAddedAt: Date | null;
          severityId: string | null;
        } = await episodeRow(kind, createdId);
        expect(row.count).toBe(2);
        expect(row.severityId).toBe(s.criticalSeverityId.toString());

        await Promise.race([
          ended,
          new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 20_000);
          }),
        ]);

        const entries: Array<string> = await episodeFeed(kind, createdId);
        expect(entries).toHaveLength(2);
        expect(entries[0]).toContain("Created");
        expect(entries[1]!.split("\n")[0]).toBe(
          `**2 ${kind.plural}** added to episode:`,
        );
        expect(postedMarkdown()).toContain(entries[1]);
      }, 60_000);

      test(`an episode created with an ${kind.name.toLowerCase()} the person cannot see is not created, and uses no number`, async () => {
        const s: Seeded = await seed(kind);

        const counterBefore: Array<Record<string, number | null>> =
          await database.query(
            `SELECT "${kind.counterColumn}" AS "counter" FROM "Project" WHERE "_id" = $1`,
            [s.projectId.toString()],
          );

        const episode: DatabaseBaseModel = new kind.episodeModel();
        episode.setColumnValue("projectId", s.projectId);
        episode.setColumnValue("title", "Payroll");

        const error: Error = await refusalOf(
          kind.episodeService["create"]!({
            data: episode,
            props: userProps(s.projectId, personId, Permission.ProjectMember),
            miscDataProps: {
              [kind.idsToAddKey]: [
                s.minorRecordId.toString(),
                s.privateRecordId.toString(),
              ],
            },
          }),
        );

        expect(error.message).toBe(kind.newEpisodeRefusal);

        const episodes: Array<{ count: string }> = await database.query(
          `SELECT COUNT(*) AS "count" FROM "${kind.name}Episode" WHERE "projectId" = $1`,
          [s.projectId.toString()],
        );
        expect(Number(episodes[0]!.count)).toBe(2);

        const counterAfter: Array<Record<string, number | null>> =
          await database.query(
            `SELECT "${kind.counterColumn}" AS "counter" FROM "Project" WHERE "_id" = $1`,
            [s.projectId.toString()],
          );
        expect(counterAfter[0]!["counter"]).toEqual(
          counterBefore[0]!["counter"],
        );
      });
    });
  },
);
