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
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import CreateScopeException from "../../../Server/Types/Database/Permissions/CreateScopeException";
import {
  ALERT_IDS_TO_ADD_KEY,
  ALERT_NOT_FOUND_REASON,
  EpisodeMembersAddResult,
  INCIDENT_IDS_TO_ADD_KEY,
  INCIDENT_NOT_FOUND_REASON,
} from "../../../Types/Episode/EpisodeMembersAdd";
import {
  ALERT_SINGLE_MEMBERSHIP,
  EpisodeSingleMembershipKind,
  INCIDENT_SINGLE_MEMBERSHIP,
} from "../../../Types/Episode/EpisodeSingleMembership";
import BadDataException from "../../../Types/Exception/BadDataException";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
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
 *   - Each is added only as the person may add it as a member of their own:
 *     a person who reads every one but whose permission to add them is
 *     scoped to Owned adds only the ones they own - another team's is not
 *     added, and says why, and an episode created with one is not created.
 *     An episode's state changes move what it holds: who may put one in an
 *     episode is who may add it as a member of their own.
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
  // Reads every one: Incident Viewer, Alert Viewer.
  viewerPermission: Permission;
  // Adds them to episodes and changes them: Incident Member, Alert Member.
  memberPermission: Permission;
  // The table of the people who own one, and its key column.
  ownerUserTable: "IncidentOwnerUser" | "AlertOwnerUser";
  // What adding one the person does not own is refused with.
  ownedRefusal: string;
  ownerEngine: AnyService;
  labelEngine: AnyService;
  onCallEngine: AnyService;
  // One episode per record (EpisodeSingleMembership): the switch and words.
  singleMembership: EpisodeSingleMembershipKind;
  memberModel: { new (): DatabaseBaseModel };
  episodePrefix: string;
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
    viewerPermission: Permission.IncidentViewer,
    memberPermission: Permission.IncidentMember,
    ownerUserTable: "IncidentOwnerUser",
    ownedRefusal:
      "Your access lets you create Incident Episode Members only for the Incidents you or your teams own.",
    ownerEngine: IncidentEpisodeOwnerRuleEngineService as unknown as AnyService,
    labelEngine: IncidentEpisodeLabelRuleEngineService as unknown as AnyService,
    onCallEngine:
      IncidentEpisodeOnCallRuleEngineService as unknown as AnyService,
    singleMembership: INCIDENT_SINGLE_MEMBERSHIP,
    memberModel: IncidentEpisodeMember,
    episodePrefix: "IE-",
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
    viewerPermission: Permission.AlertViewer,
    memberPermission: Permission.AlertMember,
    ownerUserTable: "AlertOwnerUser",
    ownedRefusal:
      "Your access lets you create Alert Episode Members only for the Alerts you or your teams own.",
    ownerEngine: AlertEpisodeOwnerRuleEngineService as unknown as AnyService,
    labelEngine: AlertEpisodeLabelRuleEngineService as unknown as AnyService,
    onCallEngine: AlertEpisodeOnCallRuleEngineService as unknown as AnyService,
    singleMembership: ALERT_SINGLE_MEMBERSHIP,
    memberModel: AlertEpisodeMember,
    episodePrefix: "AE-",
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

/*
 * A person whose team holds `rows`, each at its scope: a grant over the
 * whole project beside one scoped to Owned, say.
 */
function scopedProps(
  projectId: ObjectID,
  userId: ObjectID,
  rows: Array<{ permission: Permission; scope: PermissionScope }>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userId: userId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        _type: "UserTenantAccessPermission",
        permissions: rows.map(
          (row: { permission: Permission; scope: PermissionScope }) => {
            return {
              _type: "UserPermission",
              permission: row.permission,
              labelIds: [],
              isBlockPermission: false,
              scope: row.scope,
            };
          },
        ),
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

      /*
       * A person who reads every one, and whose permissions to add them to
       * episodes - and to change them - are scoped to Owned: the shape of
       * "everyone sees everything, each team looks after its own". They add
       * the ones they or their teams own, as they would one by one through
       * the member's own route.
       */
      describe("a person whose permission to add them is scoped to Owned", () => {
        // The person owns `recordId`.
        async function own(s: Seeded, recordId: ObjectID): Promise<void> {
          await database.query(
            `INSERT INTO "${kind.ownerUserTable}" ("_id","projectId","${kind.recordIdColumn}","userId","version") VALUES ($1,$2,$3,$4,1)`,
            [
              ObjectID.generate().toString(),
              s.projectId.toString(),
              recordId.toString(),
              personId.toString(),
            ],
          );
        }

        function readsEveryOneChangesTheirOwn(
          s: Seeded,
        ): DatabaseCommonInteractionProps {
          return scopedProps(s.projectId, personId, [
            { permission: kind.viewerPermission, scope: PermissionScope.All },
            {
              permission: kind.memberPermission,
              scope: PermissionScope.Owned,
            },
          ]);
        }

        test(`adds the ${kind.plural} they own; another team's is not added, and says why`, async () => {
          const s: Seeded = await seed(kind);
          await own(s, s.minorRecordId);

          const result: EpisodeMembersAddResult = await add(
            kind,
            s.episodeId,
            [s.criticalRecordId.toString(), s.minorRecordId.toString()],
            readsEveryOneChangesTheirOwn(s),
          );

          expect(result).toEqual({
            added: [s.minorRecordId.toString()],
            alreadyInEpisode: [],
            notAdded: [
              { id: s.criticalRecordId.toString(), reason: kind.ownedRefusal },
            ],
          });

          expect(
            (await membersOf(kind, s.episodeId)).map(
              (member: MemberRow): string => {
                return member.recordId;
              },
            ),
          ).toEqual([s.alreadyRecordId.toString(), s.minorRecordId.toString()]);
          expect(await recordEpisodeId(kind, s.criticalRecordId)).toBeNull();

          // The episode's side names the one added, and only it.
          expect(await episodeFeed(kind, s.episodeId)).toEqual([
            `**${kind.name} ${await numberOf(kind, s.minorRecordId)}** added to episode: ${MINOR_TITLE}`,
          ]);
        });

        test(`none they own: nothing is added, and nothing about the episode is written`, async () => {
          const s: Seeded = await seed(kind);

          const result: EpisodeMembersAddResult = await add(
            kind,
            s.episodeId,
            [s.criticalRecordId.toString(), s.minorRecordId.toString()],
            readsEveryOneChangesTheirOwn(s),
          );

          expect(result.added).toEqual([]);
          expect(result.notAdded).toEqual([
            { id: s.criticalRecordId.toString(), reason: kind.ownedRefusal },
            { id: s.minorRecordId.toString(), reason: kind.ownedRefusal },
          ]);
          expect(await membersOf(kind, s.episodeId)).toHaveLength(1);
          expect(await episodeFeed(kind, s.episodeId)).toEqual([]);
          expect(postedMarkdown()).toEqual([]);

          const episode: {
            count: number;
            lastAddedAt: Date | null;
            severityId: string | null;
          } = await episodeRow(kind, s.episodeId);
          expect(episode.count).toBe(1);
          expect(episode.lastAddedAt).toBeNull();
          expect(episode.severityId).toBe(s.minorSeverityId.toString());
        });

        test(`an episode created with another team's ${kind.name.toLowerCase()} is not created, and uses no number`, async () => {
          const s: Seeded = await seed(kind);
          await own(s, s.minorRecordId);

          const counterBefore: Array<Record<string, number | null>> =
            await database.query(
              `SELECT "${kind.counterColumn}" AS "counter" FROM "Project" WHERE "_id" = $1`,
              [s.projectId.toString()],
            );

          const episode: DatabaseBaseModel = new kind.episodeModel();
          episode.setColumnValue("projectId", s.projectId);
          episode.setColumnValue("title", "Checkout and payments");

          const error: Error = await refusalOf(
            kind.episodeService["create"]!({
              data: episode,
              props: readsEveryOneChangesTheirOwn(s),
              miscDataProps: {
                [kind.idsToAddKey]: [
                  s.minorRecordId.toString(),
                  s.criticalRecordId.toString(),
                ],
              },
            }),
          );

          expect(error).toBeInstanceOf(CreateScopeException);
          expect(error.message).toBe(kind.ownedRefusal);

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
          expect(await recordEpisodeId(kind, s.criticalRecordId)).toBeNull();
          expect(await recordEpisodeId(kind, s.minorRecordId)).toBeNull();
        });

        test(`an episode created with only the ${kind.plural} they own is created with them, and is theirs`, async () => {
          const s: Seeded = await seed(kind);
          await own(s, s.minorRecordId);

          const episode: DatabaseBaseModel = new kind.episodeModel();
          episode.setColumnValue("projectId", s.projectId);
          episode.setColumnValue("title", "Checkout slowness");

          const created: DatabaseBaseModel = (await kind.episodeService[
            "create"
          ]!({
            data: episode,
            props: readsEveryOneChangesTheirOwn(s),
            miscDataProps: {
              [kind.idsToAddKey]: [s.minorRecordId.toString()],
            },
          })) as DatabaseBaseModel;

          const createdId: ObjectID = new ObjectID(created._id!.toString());

          expect(
            (await membersOf(kind, createdId)).map(
              (member: MemberRow): string => {
                return member.recordId;
              },
            ),
          ).toEqual([s.minorRecordId.toString()]);

          // Created under a grant scoped to Owned: its creator owns it.
          const owners: Array<{ userId: string }> = await database.query(
            `SELECT "userId" FROM "${kind.name}EpisodeOwnerUser" WHERE "${kind.episodeIdColumn}" = $1`,
            [createdId.toString()],
          );
          expect(
            owners.map((owner: { userId: string }): string => {
              return owner.userId;
            }),
          ).toEqual([personId.toString()]);
        }, 60_000);

        test(`with the same permissions over the whole project, they add every ${kind.name.toLowerCase()} they read`, async () => {
          const s: Seeded = await seed(kind);

          const result: EpisodeMembersAddResult = await add(
            kind,
            s.episodeId,
            [s.criticalRecordId.toString(), s.minorRecordId.toString()],
            scopedProps(s.projectId, personId, [
              { permission: kind.viewerPermission, scope: PermissionScope.All },
              {
                permission: kind.memberPermission,
                scope: PermissionScope.All,
              },
            ]),
          );

          expect(result).toEqual({
            added: [s.criticalRecordId.toString(), s.minorRecordId.toString()],
            alreadyInEpisode: [],
            notAdded: [],
          });
        });
      });

      /*
       * A project that allows an incident (or alert) in only one episode
       * (EpisodeSingleMembership): the switch is the project's own column,
       * read by the member services against the real rows.
       */
      describe("one episode per record", () => {
        async function setSwitch(
          projectId: ObjectID,
          isOn: boolean,
        ): Promise<void> {
          await database.query(
            `UPDATE "Project" SET "${kind.singleMembership.column}" = $1 WHERE "_id" = $2`,
            [isOn, projectId.toString()],
          );
        }

        // Another episode of the seeded project, the person can see, numbered.
        async function insertEpisodeLike(
          s: Seeded,
          title: string,
          number: number,
        ): Promise<ObjectID> {
          const k: string = kind.name;
          const lower: string = k.toLowerCase();
          const episodeId: string = ObjectID.generate().toString();
          await database.query(
            `INSERT INTO "${k}Episode" ("_id","projectId","title","current${k}StateId","${lower}SeverityId","isPrivate","${kind.countColumn}","episodeNumber","episodeNumberWithPrefix","version") SELECT $1, "projectId", $2, "current${k}StateId", "${lower}SeverityId", false, 0, $3, $4, 1 FROM "${k}Episode" WHERE "_id" = $5`,
            [
              episodeId,
              title,
              number,
              `${kind.episodePrefix}${number}`,
              s.episodeId.toString(),
            ],
          );
          return new ObjectID(episodeId);
        }

        async function numberEpisode(
          episodeId: ObjectID,
          number: number,
        ): Promise<void> {
          await database.query(
            `UPDATE "${kind.name}Episode" SET "episodeNumber" = $1, "episodeNumberWithPrefix" = $2 WHERE "_id" = $3`,
            [number, `${kind.episodePrefix}${number}`, episodeId.toString()],
          );
        }

        function memberIdsOf(rows: Array<MemberRow>): Array<string> {
          return rows.map((member: MemberRow): string => {
            return member.recordId;
          });
        }

        test(`switch on: one in another episode is not added, and stays where it is; the rest are`, async () => {
          const s: Seeded = await seed(kind);
          await setSwitch(s.projectId, true);
          const second: ObjectID = await insertEpisodeLike(s, "Second", 8);

          const result: EpisodeMembersAddResult = await add(
            kind,
            second,
            [s.alreadyRecordId.toString(), s.minorRecordId.toString()],
            userProps(s.projectId, personId, Permission.ProjectMember),
          );

          expect(result).toEqual({
            added: [s.minorRecordId.toString()],
            alreadyInEpisode: [],
            notAdded: [
              {
                id: s.alreadyRecordId.toString(),
                reason: kind.singleMembership.inAnotherEpisodeReason,
              },
            ],
          });
          expect(memberIdsOf(await membersOf(kind, second))).toEqual([
            s.minorRecordId.toString(),
          ]);
          expect(memberIdsOf(await membersOf(kind, s.episodeId))).toEqual([
            s.alreadyRecordId.toString(),
          ]);
          // Its episode is not moved to the one it was refused from.
          expect(await recordEpisodeId(kind, s.alreadyRecordId)).not.toBe(
            second.toString(),
          );
          // The one added names its new episode, as always.
          expect(await recordEpisodeId(kind, s.minorRecordId)).toBe(
            second.toString(),
          );
        });

        test(`switch off: the same add puts it in both episodes, as always`, async () => {
          const s: Seeded = await seed(kind);
          const second: ObjectID = await insertEpisodeLike(s, "Second", 8);

          const result: EpisodeMembersAddResult = await add(
            kind,
            second,
            [s.alreadyRecordId.toString()],
            userProps(s.projectId, personId, Permission.ProjectMember),
          );

          expect(result.added).toEqual([s.alreadyRecordId.toString()]);
          expect(memberIdsOf(await membersOf(kind, second))).toEqual([
            s.alreadyRecordId.toString(),
          ]);
          expect(memberIdsOf(await membersOf(kind, s.episodeId))).toEqual([
            s.alreadyRecordId.toString(),
          ]);
        });

        test(`switch on: a member created on its own is refused, naming the ${kind.name.toLowerCase()} and the episode it is in`, async () => {
          const s: Seeded = await seed(kind);
          await setSwitch(s.projectId, true);
          await numberEpisode(s.episodeId, 7);
          const second: ObjectID = await insertEpisodeLike(s, "Second", 8);

          const member: DatabaseBaseModel = new kind.memberModel();
          member.setColumnValue("projectId", s.projectId);
          member.setColumnValue(kind.episodeIdColumn, second);
          member.setColumnValue(kind.recordIdColumn, s.alreadyRecordId);
          member.setColumnValue("addedBy", "api");

          const error: Error = await refusalOf(
            kind.memberService["create"]!({
              data: member,
              props: userProps(s.projectId, personId, Permission.ProjectMember),
            }),
          );

          const label: string = await numberOf(kind, s.alreadyRecordId);

          expect(error).toBeInstanceOf(BadDataException);
          expect(error.message).toBe(
            `${kind.name} ${label} is already in episode ${kind.episodePrefix}7, and ${kind.singleMembership.rule}. Remove it from episode ${kind.episodePrefix}7 first, or turn this off in ${kind.singleMembership.settingLocation}.`,
          );
          expect(await membersOf(kind, second)).toEqual([]);
        });

        test(`switch on: an episode created with one that is in an episode is not created`, async () => {
          const s: Seeded = await seed(kind);
          await setSwitch(s.projectId, true);

          const before: Array<{ count: string }> = await database.query(
            `SELECT COUNT(*) AS "count" FROM "${kind.name}Episode" WHERE "projectId" = $1`,
            [s.projectId.toString()],
          );

          const episode: DatabaseBaseModel = new kind.episodeModel();
          episode.setColumnValue("projectId", s.projectId);
          episode.setColumnValue("title", "Checkout outage");

          const error: Error = await refusalOf(
            kind.episodeService["create"]!({
              data: episode,
              props: userProps(s.projectId, personId, Permission.ProjectMember),
              miscDataProps: {
                [kind.idsToAddKey]: [
                  s.minorRecordId.toString(),
                  s.alreadyRecordId.toString(),
                ],
              },
            }),
          );

          const label: string = await numberOf(kind, s.alreadyRecordId);

          expect(error.message).toBe(
            `${kind.name} ${label} is already in an episode, and ${kind.singleMembership.rule}. Leave it out, or remove it from its episode first.`,
          );

          const after: Array<{ count: string }> = await database.query(
            `SELECT COUNT(*) AS "count" FROM "${kind.name}Episode" WHERE "projectId" = $1`,
            [s.projectId.toString()],
          );
          expect(Number(after[0]!.count)).toBe(Number(before[0]!.count));
        });

        test(`turning it on takes nobody out: one in two episodes stays in both, and only a third is refused`, async () => {
          const s: Seeded = await seed(kind);
          const second: ObjectID = await insertEpisodeLike(s, "Second", 8);
          const third: ObjectID = await insertEpisodeLike(s, "Third", 9);
          const props: DatabaseCommonInteractionProps = userProps(
            s.projectId,
            personId,
            Permission.ProjectMember,
          );

          // Before the switch: in two episodes.
          expect(
            (await add(kind, second, [s.alreadyRecordId.toString()], props))
              .added,
          ).toEqual([s.alreadyRecordId.toString()]);

          await setSwitch(s.projectId, true);

          expect(memberIdsOf(await membersOf(kind, s.episodeId))).toEqual([
            s.alreadyRecordId.toString(),
          ]);
          expect(memberIdsOf(await membersOf(kind, second))).toEqual([
            s.alreadyRecordId.toString(),
          ]);

          // In either already: left as it is.
          expect(
            await add(kind, s.episodeId, [s.alreadyRecordId.toString()], props),
          ).toEqual({
            added: [],
            alreadyInEpisode: [s.alreadyRecordId.toString()],
            notAdded: [],
          });

          // A third: refused.
          expect(
            (await add(kind, third, [s.alreadyRecordId.toString()], props))
              .notAdded,
          ).toEqual([
            {
              id: s.alreadyRecordId.toString(),
              reason: kind.singleMembership.inAnotherEpisodeReason,
            },
          ]);
          expect(await membersOf(kind, third)).toEqual([]);
        });

        /*
         * TWO ADDS OF ONE RECORD, AT ONE MOMENT (#4933).
         *
         * Both read the record's memberships before either is written - held
         * here until both have read, as two requests on two servers can be -
         * and both found none. The database takes one first membership per
         * record (isFirstMembership), so the add that loses is refused by it
         * and made again: refused while the switch is on, added as a second
         * membership while it is off.
         */
        type FindLatest = (...args: Array<unknown>) => Promise<unknown>;

        async function raceTwoAdds(
          s: Seeded,
          episodes: [ObjectID, ObjectID],
        ): Promise<Array<PromiseSettledResult<unknown>>> {
          const service: { findLatestEpisodeIdOf: FindLatest } =
            kind.memberService as unknown as {
              findLatestEpisodeIdOf: FindLatest;
            };
          // The service's own read, from its class: never a stand-in left over.
          const read: FindLatest = (
            Object.getPrototypeOf(service) as {
              findLatestEpisodeIdOf: FindLatest;
            }
          ).findLatestEpisodeIdOf.bind(service);

          let reads: number = 0;
          let release: () => void = (): void => {};
          const bothRead: Promise<void> = new Promise<void>(
            (resolve: () => void): void => {
              release = resolve;
            },
          );

          const held: { mockRestore: () => void } = jest
            .spyOn(service, "findLatestEpisodeIdOf")
            .mockImplementation((async (...args: Array<unknown>) => {
              const latest: unknown = await read(...args);
              reads++;

              if (reads === 2) {
                release();
              }

              // The two first reads wait for each other; a later one does not.
              if (reads <= 2) {
                await bothRead;
              }

              return latest;
            }) as never);

          const props: DatabaseCommonInteractionProps = userProps(
            s.projectId,
            personId,
            Permission.ProjectMember,
          );

          try {
            return await Promise.allSettled(
              episodes.map((episodeId: ObjectID): Promise<unknown> => {
                const member: DatabaseBaseModel = new kind.memberModel();
                member.setColumnValue("projectId", s.projectId);
                member.setColumnValue(kind.episodeIdColumn, episodeId);
                member.setColumnValue(kind.recordIdColumn, s.minorRecordId);
                member.setColumnValue("addedBy", "api");

                return kind.memberService["create"]!({
                  data: member,
                  props: props,
                }) as Promise<unknown>;
              }),
            );
          } finally {
            held.mockRestore();
          }
        }

        interface Membership {
          episodeId: string;
          isFirst: boolean;
        }

        async function membershipsOf(
          recordId: ObjectID,
        ): Promise<Array<Membership>> {
          return await database.query(
            `SELECT "${kind.episodeIdColumn}" AS "episodeId", "isFirstMembership" AS "isFirst" FROM "${kind.name}EpisodeMember" WHERE "${kind.recordIdColumn}" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt"`,
            [recordId.toString()],
          );
        }

        test(`switch on: two adds of one in no episode, at one moment, to two episodes: one is added, the other refused`, async () => {
          const s: Seeded = await seed(kind);
          await setSwitch(s.projectId, true);
          const second: ObjectID = await insertEpisodeLike(s, "Second", 8);
          const third: ObjectID = await insertEpisodeLike(s, "Third", 9);

          const results: Array<PromiseSettledResult<unknown>> =
            await raceTwoAdds(s, [second, third]);

          const added: Array<PromiseSettledResult<unknown>> = results.filter(
            (result: PromiseSettledResult<unknown>): boolean => {
              return result.status === "fulfilled";
            },
          );
          // Why each refused add was refused.
          const refused: Array<{ reason: unknown }> = results
            .filter((result: PromiseSettledResult<unknown>): boolean => {
              return result.status === "rejected";
            })
            .map(
              (result: PromiseSettledResult<unknown>): { reason: unknown } => {
                return result as unknown as { reason: unknown };
              },
            );

          expect(added).toHaveLength(1);
          expect(refused).toHaveLength(1);
          expect(refused[0]!.reason).toBeInstanceOf(BadDataException);
          expect((refused[0]!.reason as Error).message).toContain(
            "is already in episode",
          );
          expect((refused[0]!.reason as Error).message).toContain(
            kind.singleMembership.rule,
          );

          // In one episode only, as its first membership.
          const memberships: Array<Membership> = await membershipsOf(
            s.minorRecordId,
          );

          expect(memberships).toHaveLength(1);
          expect(memberships[0]!.isFirst).toBe(true);
          expect([second.toString(), third.toString()]).toContain(
            memberships[0]!.episodeId,
          );
        });

        test(`switch off: the same two adds put it in both episodes, the second as its second membership`, async () => {
          const s: Seeded = await seed(kind);
          const second: ObjectID = await insertEpisodeLike(s, "Second", 8);
          const third: ObjectID = await insertEpisodeLike(s, "Third", 9);

          const results: Array<PromiseSettledResult<unknown>> =
            await raceTwoAdds(s, [second, third]);

          // Each answer, or why it was refused.
          expect(
            results.map((result: PromiseSettledResult<unknown>): string => {
              return result.status === "rejected"
                ? String((result as unknown as { reason: unknown }).reason)
                : result.status;
            }),
          ).toEqual(["fulfilled", "fulfilled"]);

          const memberships: Array<Membership> = await membershipsOf(
            s.minorRecordId,
          );

          expect(
            memberships
              .map((membership: Membership): string => {
                return membership.episodeId;
              })
              .sort(),
          ).toEqual([second.toString(), third.toString()].sort());
          expect(
            memberships.filter((membership: Membership): boolean => {
              return membership.isFirst;
            }),
          ).toHaveLength(1);
        });

        test(`an add of one in no episode is its first membership; one in an episode already is not`, async () => {
          const s: Seeded = await seed(kind);
          const second: ObjectID = await insertEpisodeLike(s, "Second", 8);
          const props: DatabaseCommonInteractionProps = userProps(
            s.projectId,
            personId,
            Permission.ProjectMember,
          );

          expect(
            await add(kind, second, [s.minorRecordId.toString()], props),
          ).toEqual({
            added: [s.minorRecordId.toString()],
            alreadyInEpisode: [],
            notAdded: [],
          });
          expect(
            (await add(kind, second, [s.alreadyRecordId.toString()], props))
              .added,
          ).toEqual([s.alreadyRecordId.toString()]);

          expect(await membershipsOf(s.minorRecordId)).toEqual([
            { episodeId: second.toString(), isFirst: true },
          ]);
          expect(
            (await membershipsOf(s.alreadyRecordId)).map(
              (membership: Membership): boolean => {
                return membership.isFirst;
              },
            ),
          ).toEqual([false, false]);
        });

        test(`the database itself takes one first membership per ${kind.name.toLowerCase()}`, async () => {
          const s: Seeded = await seed(kind);
          const second: ObjectID = await insertEpisodeLike(s, "Second", 8);
          const third: ObjectID = await insertEpisodeLike(s, "Third", 9);

          const insert: (
            episodeId: ObjectID,
            isFirst: boolean,
          ) => Promise<unknown> = (
            episodeId: ObjectID,
            isFirst: boolean,
          ): Promise<unknown> => {
            return database.query(
              `INSERT INTO "${kind.name}EpisodeMember" ("_id","projectId","${kind.episodeIdColumn}","${kind.recordIdColumn}","addedBy","isFirstMembership","version") VALUES ($1,$2,$3,$4,'api',$5,1)`,
              [
                ObjectID.generate().toString(),
                s.projectId.toString(),
                episodeId.toString(),
                s.minorRecordId.toString(),
                isFirst,
              ],
            );
          };

          await insert(second, true);

          let refusal: unknown = null;

          try {
            await insert(third, true);
          } catch (error) {
            refusal = error;
          }

          expect(
            PostgresErrorTranslator.isUniqueViolationOf(
              refusal,
              `IDX_${kind.name}EpisodeMember_first_membership`,
            ),
          ).toBe(true);

          // A second membership that is not a first is taken.
          await expect(insert(third, false)).resolves.toBeDefined();
        });
      });
    });
  },
);
