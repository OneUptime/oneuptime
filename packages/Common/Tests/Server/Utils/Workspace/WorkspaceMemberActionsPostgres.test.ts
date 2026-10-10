jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock(
  "../../../../Server/Infrastructure/Postgres/DataSourceOptions",
  () => {
    return {};
  },
);

import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import Entities from "../../../../Models/DatabaseModels/Index";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import { OnCreate } from "../../../../Server/Types/Database/Hooks";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import Response from "../../../../Server/Utils/Response";
import {
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsOnCallDutyActionType,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsOnCallDutyActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/OnCallDutyPolicy";
import SlackActionType from "../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackAuthAction, {
  SlackAction,
  SlackRequest,
} from "../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackIncidentActions from "../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import Permission from "../../../../Types/Permission";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import {
  WorkspaceDropdownBlock,
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import { DataSource, Logger } from "typeorm";

/*
 * WHAT A SLACK OR MICROSOFT TEAMS BUTTON WRITES, AND FOR WHOM, against a
 * migrated Postgres.
 *
 * Acknowledge, Resolve, Change State, Add Note and Execute On-Call Policy
 * are made with the props of the OneUptime member the chat account is
 * connected to, as the same write the dashboard makes for that member
 * (WorkspaceMemberActions). The unit suites pin which props and which rows;
 * what only a database can show is what those props then reach - every read
 * and every check of the create here runs the production permission
 * pipeline over the real join tables:
 *
 *   - Slack's request is authorized from the stored workspace rows, and the
 *     member's permission rows are read from TeamPermission and
 *     TeamPermissionLabel, as the dashboard reads them;
 *   - a member whose incident read is limited to a label acknowledges,
 *     changes the state of, notes and pages for the incidents carrying it:
 *     the row is stored with them as its creator (and as who triggered the
 *     page), exactly once;
 *   - the same buttons on an incident without that label, or on another
 *     project's incident, are refused like a record that is not there, and
 *     nothing is written - neither are they for a member who may only read;
 *   - the change-state form offers the states the member may read, in the
 *     project's order, and says so when there are none;
 *   - Teams' Escalate pages for the card's incident with a policy the
 *     member may read, records an archived policy's page as not executed,
 *     and answers a card that names no record plainly;
 *   - the creates themselves - the timeline row, the note, the execution
 *     log - refuse a record outside the member's labels, whatever asked
 *     for them;
 *   - the AI assistant's actions are the same writes, with the props of the
 *     person who asked: an acknowledge, a resolve or a page is stored with
 *     them as its creator, and refused, with nothing written, for a record
 *     outside their labels, for a person who may edit incidents and alerts
 *     but not change their state, for one whose state changes are limited
 *     to other labels, and for a run that is no person at all.
 *
 * What follows a saved row - the incident's current state, the feed, the
 * page itself - is OneUptime's own write, made by each service's success
 * hook and tested with it: here those hooks hand the row back untouched, so
 * the rows below are exactly the member's own.
 *
 * Opt in with RUN_POSTGRES_WORKSPACE_MEMBER_ACTION_TESTS=true against a
 * database the registered migrations have been applied to, e.g. from
 * packages/Common:
 *
 *   RUN_POSTGRES_WORKSPACE_MEMBER_ACTION_TESTS=true \
 *   WORKSPACE_MEMBER_ACTION_TEST_DATABASE_HOST=127.0.0.1 \
 *   WORKSPACE_MEMBER_ACTION_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Utils/Workspace/WorkspaceMemberActionsPostgres.test.ts --forceExit
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Without the
 * flag the suite is skipped, so the Common test job - whose Postgres is not
 * migrated - never runs it.
 *
 * The tables it writes are copied (LIKE ... INCLUDING ALL) from public into
 * a uniquely named schema that is dropped afterwards; every other table a
 * read joins is found, empty, in public. Every row is synthetic. Only what
 * lies outside OneUptime's database is stubbed: Slack and Teams themselves,
 * the permission cache and the state-change lock (Valkey), and the HTTP
 * response.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_WORKSPACE_MEMBER_ACTION_TESTS"] === "true"
    ? describe
    : describe.skip;

// The tables this suite writes; every other table is read from public.
const TABLES: Array<string> = [
  "Project",
  "User",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "Incident",
  "IncidentLabel",
  "IncidentState",
  "IncidentStateTimeline",
  "IncidentInternalNote",
  "Alert",
  "AlertLabel",
  "AlertState",
  "AlertStateTimeline",
  "OnCallDutyPolicy",
  "OnCallDutyPolicyLabel",
  "OnCallDutyPolicyExecutionLog",
  "WorkspaceProjectAuthToken",
  "WorkspaceUserAuthToken",
];

// Every statement Postgres refuses, even one a caller swallowed.
class QueryRecorder implements Logger {
  public failures: Array<string> = [];

  public logQuery(): void {
    return;
  }

  public logQueryError(error: string | Error, query: string): void {
    this.failures.push(
      `${error instanceof Error ? error.message : error} in: ${query}`,
    );
  }

  public logQuerySlow(): void {
    return;
  }

  public logSchemaBuild(): void {
    return;
  }

  public logMigration(): void {
    return;
  }

  public log(): void {
    return;
  }
}

interface PermissionRow {
  permission: Permission;
  labelIds?: Array<ObjectID>;
}

// A stored row, as Postgres hands it back.
type StoredRow = Dictionary<string | number | boolean | Date | null>;

describePostgres("Slack and Microsoft Teams buttons, on Postgres", () => {
  const schema: string = `workspace_member_actions_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const recorder: QueryRecorder = new QueryRecorder();
  let database: DataSource;

  const SLACK_TEAM_ID: string = "T0PAYMENTS";
  const PROJECT_AUTH_TOKEN: string = "xoxb-synthetic-project-token";

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  // People, by what they hold in the project.
  const responderId: ObjectID = ObjectID.generate();
  const projectMemberId: ObjectID = ObjectID.generate();
  const viewerId: ObjectID = ObjectID.generate();
  const stateBlindId: ObjectID = ObjectID.generate();
  // Edits incidents and alerts, but changes the state of neither.
  const editorId: ObjectID = ObjectID.generate();
  // Reads every incident and alert; changes the state of payments ones only.
  const paymentsStateChangerId: ObjectID = ObjectID.generate();

  // Their Slack accounts.
  const SLACK_RESPONDER: string = "U0RESPONDER";
  const SLACK_PROJECT_MEMBER: string = "U0PROJECTMEMBER";
  const SLACK_VIEWER: string = "U0VIEWER";
  const SLACK_STATE_BLIND: string = "U0STATEBLIND";

  const paymentsLabelId: ObjectID = ObjectID.generate();
  const searchLabelId: ObjectID = ObjectID.generate();
  const otherLabelId: ObjectID = ObjectID.generate();

  // The project's incident states, in its order, and one of another project.
  const createdStateId: ObjectID = ObjectID.generate();
  const acknowledgedStateId: ObjectID = ObjectID.generate();
  const resolvedStateId: ObjectID = ObjectID.generate();
  const otherProjectStateId: ObjectID = ObjectID.generate();

  // One incident per label, and one of another project.
  const paymentsIncidentId: ObjectID = ObjectID.generate();
  const searchIncidentId: ObjectID = ObjectID.generate();
  const otherIncidentId: ObjectID = ObjectID.generate();

  // The timeline rows the incidents were declared with.
  const seededTimelineIds: Array<ObjectID> = [];

  // The project's alert states, in its order.
  const alertCreatedStateId: ObjectID = ObjectID.generate();
  const alertAcknowledgedStateId: ObjectID = ObjectID.generate();
  const alertResolvedStateId: ObjectID = ObjectID.generate();

  // One alert per label.
  const paymentsAlertId: ObjectID = ObjectID.generate();
  const searchAlertId: ObjectID = ObjectID.generate();

  // The timeline rows the alerts were raised with.
  const seededAlertTimelineIds: Array<ObjectID> = [];

  const paymentsPolicyId: ObjectID = ObjectID.generate();
  const searchPolicyId: ObjectID = ObjectID.generate();
  const archivedPaymentsPolicyId: ObjectID = ObjectID.generate();
  const otherPolicyId: ObjectID = ObjectID.generate();

  const NOT_FOUND: string =
    WorkspaceActionAuthorization.NOT_FOUND_OR_NOT_READABLE;

  let directMessageSpy: SpyInstance<typeof SlackUtil.sendDirectMessageToUser>;
  let showModalSpy: SpyInstance<typeof SlackUtil.showModalToUser>;

  async function insert(
    table: string,
    row: Dictionary<unknown>,
  ): Promise<void> {
    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        const value: unknown = row[column];
        return value instanceof ObjectID ? value.toString() : value;
      }),
    );
  }

  async function seedNamed(
    table: string,
    data: {
      id: ObjectID;
      project: ObjectID;
      name: string;
      labelTable?: string;
      labelColumn?: string;
      labelIds?: Array<ObjectID>;
      extra?: Dictionary<unknown>;
    },
  ): Promise<void> {
    await insert(table, {
      _id: data.id,
      projectId: data.project,
      name: data.name,
      slug: `${data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${data.id.toString()}`,
      version: 1,
      ...(data.extra || {}),
    });

    for (const labelId of data.labelIds || []) {
      await insert(data.labelTable!, {
        [data.labelColumn!]: data.id,
        labelId: labelId,
      });
    }
  }

  async function seedTeam(data: {
    project: ObjectID;
    name: string;
    members: Array<ObjectID>;
    permissions: Array<PermissionRow>;
  }): Promise<void> {
    const teamId: ObjectID = ObjectID.generate();

    await insert("Team", {
      _id: teamId,
      projectId: data.project,
      name: data.name,
      slug: `team-${teamId.toString()}`,
      version: 1,
    });

    for (const userId of data.members) {
      await insert("TeamMember", {
        _id: ObjectID.generate(),
        projectId: data.project,
        teamId: teamId,
        userId: userId,
        hasAcceptedInvitation: true,
        version: 1,
      });
    }

    for (const row of data.permissions) {
      const permissionId: ObjectID = ObjectID.generate();

      await insert("TeamPermission", {
        _id: permissionId,
        projectId: data.project,
        teamId: teamId,
        permission: row.permission,
        isBlockPermission: false,
        scope:
          row.labelIds && row.labelIds.length > 0
            ? PermissionScope.Labels
            : PermissionScope.All,
        version: 1,
      });

      for (const labelId of row.labelIds || []) {
        await insert("TeamPermissionLabel", {
          teamPermissionId: permissionId,
          labelId: labelId,
        });
      }
    }
  }

  async function seedIncident(data: {
    id: ObjectID;
    project: ObjectID;
    title: string;
    stateId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    await insert("Incident", {
      _id: data.id,
      projectId: data.project,
      title: data.title,
      slug: `incident-${data.id.toString()}`,
      currentIncidentStateId: data.stateId,
      // The severity table is not read here.
      incidentSeverityId: ObjectID.generate(),
      version: 1,
    });

    for (const labelId of data.labelIds) {
      await insert("IncidentLabel", {
        incidentId: data.id,
        labelId: labelId,
      });
    }

    // Declared an hour ago, in the state it is in.
    const timelineId: ObjectID = ObjectID.generate();
    seededTimelineIds.push(timelineId);

    await insert("IncidentStateTimeline", {
      _id: timelineId,
      projectId: data.project,
      incidentId: data.id,
      incidentStateId: data.stateId,
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
      version: 1,
    });
  }

  async function seedAlert(data: {
    id: ObjectID;
    title: string;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    await insert("Alert", {
      _id: data.id,
      projectId: projectId,
      title: data.title,
      currentAlertStateId: alertCreatedStateId,
      // The severity table is not read here.
      alertSeverityId: ObjectID.generate(),
      version: 1,
    });

    for (const labelId of data.labelIds) {
      await insert("AlertLabel", {
        alertId: data.id,
        labelId: labelId,
      });
    }

    // Raised an hour ago, in the created state.
    const timelineId: ObjectID = ObjectID.generate();
    seededAlertTimelineIds.push(timelineId);

    await insert("AlertStateTimeline", {
      _id: timelineId,
      projectId: projectId,
      alertId: data.id,
      alertStateId: alertCreatedStateId,
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
      version: 1,
    });
  }

  async function connectSlackAccount(
    userId: ObjectID,
    slackUserId: string,
  ): Promise<void> {
    await insert("WorkspaceUserAuthToken", {
      _id: ObjectID.generate(),
      projectId: projectId,
      userId: userId,
      authToken: `xoxp-synthetic-${slackUserId}`,
      workspaceUserId: slackUserId,
      workspaceType: WorkspaceType.Slack,
      miscData: JSON.stringify({ userId: slackUserId }),
      version: 1,
    });
  }

  // The state changes made since the incidents were declared.
  async function newStateChanges(): Promise<Array<StoredRow>> {
    return await database.query(
      `SELECT "incidentId", "incidentStateId", "projectId", "createdByUserId"
         FROM "${schema}"."IncidentStateTimeline"
        WHERE NOT ("_id" = ANY($1::uuid[]))
        ORDER BY "createdAt"`,
      [
        seededTimelineIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ],
    );
  }

  // The alert state changes made since the alerts were raised.
  async function newAlertStateChanges(): Promise<Array<StoredRow>> {
    return await database.query(
      `SELECT "alertId", "alertStateId", "projectId", "createdByUserId"
         FROM "${schema}"."AlertStateTimeline"
        WHERE NOT ("_id" = ANY($1::uuid[]))
        ORDER BY "createdAt"`,
      [
        seededAlertTimelineIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ],
    );
  }

  async function notes(): Promise<Array<StoredRow>> {
    return await database.query(
      `SELECT "incidentId", "projectId", "note", "createdByUserId"
         FROM "${schema}"."IncidentInternalNote"
        ORDER BY "createdAt"`,
    );
  }

  async function executionLogs(): Promise<Array<StoredRow>> {
    return await database.query(
      `SELECT "onCallDutyPolicyId", "projectId", "triggeredByIncidentId",
              "triggeredByUserId", "createdByUserId", "status",
              "statusMessage", "userNotificationEventType"
         FROM "${schema}"."OnCallDutyPolicyExecutionLog"
        ORDER BY "createdAt"`,
    );
  }

  async function nothingWritten(): Promise<void> {
    expect(await newStateChanges()).toEqual([]);
    expect(await newAlertStateChanges()).toEqual([]);
    expect(await notes()).toEqual([]);
    expect(await executionLogs()).toEqual([]);
  }

  // The member's props, built from their rows as every chat action builds them.
  async function memberProps(
    userId: ObjectID,
  ): Promise<DatabaseCommonInteractionProps> {
    return await WorkspaceActionAuthorization.getProjectMemberProps({
      userId: userId,
      projectId: projectId,
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["WORKSPACE_MEMBER_ACTION_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["WORKSPACE_MEMBER_ACTION_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["WORKSPACE_MEMBER_ACTION_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      /*
       * No schema of its own: table names stay unqualified, so the tables
       * copied into the test schema are found first and every other table a
       * read joins is found, empty, in public.
       */
      synchronize: false,
      logger: recorder,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // Permissions are read from the tables every time: nothing is cached.
    jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
    jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
    jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined as never);

    // The incident's state-change lock lives in Valkey.
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

    // Workflows run elsewhere.
    jest
      .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);

    // The record of which button was pressed is not what is tested here.
    jest
      .spyOn(WorkspaceNotificationLogService, "logButtonPressed")
      .mockResolvedValue(undefined as never);

    /*
     * What follows a saved row is OneUptime's own write, tested with each
     * service: the rows below are exactly what the member wrote.
     */
    jest
      .spyOn(
        IncidentStateTimelineService as unknown as {
          onCreateSuccess: (
            onCreate: OnCreate<IncidentStateTimeline>,
            createdItem: IncidentStateTimeline,
          ) => Promise<IncidentStateTimeline>;
        },
        "onCreateSuccess",
      )
      .mockImplementation(
        async (
          _onCreate: OnCreate<IncidentStateTimeline>,
          createdItem: IncidentStateTimeline,
        ): Promise<IncidentStateTimeline> => {
          return createdItem;
        },
      );
    jest
      .spyOn(
        AlertStateTimelineService as unknown as {
          onCreateSuccess: (
            onCreate: OnCreate<AlertStateTimeline>,
            createdItem: AlertStateTimeline,
          ) => Promise<AlertStateTimeline>;
        },
        "onCreateSuccess",
      )
      .mockImplementation(
        async (
          _onCreate: OnCreate<AlertStateTimeline>,
          createdItem: AlertStateTimeline,
        ): Promise<AlertStateTimeline> => {
          return createdItem;
        },
      );
    jest
      .spyOn(IncidentInternalNoteService, "onCreateSuccess")
      .mockImplementation(
        async (
          _onCreate: OnCreate<IncidentInternalNote>,
          createdItem: IncidentInternalNote,
        ): Promise<IncidentInternalNote> => {
          return createdItem;
        },
      );
    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService as unknown as {
          onCreateSuccess: (
            onCreate: OnCreate<OnCallDutyPolicyExecutionLog>,
            createdItem: OnCallDutyPolicyExecutionLog,
          ) => Promise<OnCallDutyPolicyExecutionLog>;
        },
        "onCreateSuccess",
      )
      .mockImplementation(
        async (
          _onCreate: OnCreate<OnCallDutyPolicyExecutionLog>,
          createdItem: OnCallDutyPolicyExecutionLog,
        ): Promise<OnCallDutyPolicyExecutionLog> => {
          return createdItem;
        },
      );

    for (const [id, name] of [
      [projectId, "Payments project"],
      [otherProjectId, "Acme Corp"],
    ] as Array<[ObjectID, string]>) {
      await insert("Project", {
        _id: id,
        name: name,
        slug: `project-${id.toString()}`,
        version: 1,
      });
    }

    for (const [id, name] of [
      [responderId, "Payments Responder"],
      [projectMemberId, "Project Member"],
      [viewerId, "Project Viewer"],
      [stateBlindId, "State Blind"],
      [editorId, "Incident Editor"],
      [paymentsStateChangerId, "Payments State Changer"],
    ] as Array<[ObjectID, string]>) {
      await insert("User", {
        _id: id,
        name: name,
        email: `${id.toString()}@example.com`,
        slug: `user-${id.toString()}`,
        version: 1,
      });
    }

    for (const [id, project, name] of [
      [paymentsLabelId, projectId, "payments"],
      [searchLabelId, projectId, "search"],
      [otherLabelId, otherProjectId, "acme-corp-payroll"],
    ] as Array<[ObjectID, ObjectID, string]>) {
      await seedNamed("Label", {
        id: id,
        project: project,
        name: name,
        extra: { color: "#000000" },
      });
    }

    for (const [id, project, name, order, flags] of [
      [createdStateId, projectId, "Created", 1, { isCreatedState: true }],
      [
        acknowledgedStateId,
        projectId,
        "Acknowledged",
        2,
        { isAcknowledgedState: true },
      ],
      [resolvedStateId, projectId, "Resolved", 3, { isResolvedState: true }],
      [
        otherProjectStateId,
        otherProjectId,
        "Acme Corp created",
        1,
        { isCreatedState: true },
      ],
    ] as Array<[ObjectID, ObjectID, string, number, Dictionary<boolean>]>) {
      await seedNamed("IncidentState", {
        id: id,
        project: project,
        name: name,
        extra: { color: "#FF0000", order: order, ...flags },
      });
    }

    for (const [id, name, order, flags] of [
      [alertCreatedStateId, "Created", 1, { isCreatedState: true }],
      [
        alertAcknowledgedStateId,
        "Acknowledged",
        2,
        { isAcknowledgedState: true },
      ],
      [alertResolvedStateId, "Resolved", 3, { isResolvedState: true }],
    ] as Array<[ObjectID, string, number, Dictionary<boolean>]>) {
      await insert("AlertState", {
        _id: id,
        projectId: projectId,
        name: name,
        color: "#FF0000",
        order: order,
        version: 1,
        ...flags,
      });
    }

    await seedAlert({
      id: paymentsAlertId,
      title: "Checkout error rate is high",
      labelIds: [paymentsLabelId],
    });
    await seedAlert({
      id: searchAlertId,
      title: "Search latency is high",
      labelIds: [searchLabelId],
    });

    await seedIncident({
      id: paymentsIncidentId,
      project: projectId,
      title: "Checkout is down",
      stateId: createdStateId,
      labelIds: [paymentsLabelId],
    });
    await seedIncident({
      id: searchIncidentId,
      project: projectId,
      title: "Search is slow",
      stateId: createdStateId,
      labelIds: [searchLabelId],
    });
    await seedIncident({
      id: otherIncidentId,
      project: otherProjectId,
      title: "Acme Corp payroll is down",
      stateId: otherProjectStateId,
      labelIds: [otherLabelId],
    });

    for (const [id, project, name, labelIds, isArchived] of [
      [
        paymentsPolicyId,
        projectId,
        "Payments on-call",
        [paymentsLabelId],
        false,
      ],
      [searchPolicyId, projectId, "Search on-call", [searchLabelId], false],
      [
        archivedPaymentsPolicyId,
        projectId,
        "Old payments on-call",
        [paymentsLabelId],
        true,
      ],
      [
        otherPolicyId,
        otherProjectId,
        "Acme Corp on-call",
        [otherLabelId],
        false,
      ],
    ] as Array<[ObjectID, ObjectID, string, Array<ObjectID>, boolean]>) {
      await seedNamed("OnCallDutyPolicy", {
        id: id,
        project: project,
        name: name,
        labelTable: "OnCallDutyPolicyLabel",
        labelColumn: "onCallDutyPolicyId",
        labelIds: labelIds,
        extra: { isArchived: isArchived },
      });
    }

    /*
     * The payments responders: they read the incidents, alerts and on-call
     * policies carrying the payments label - nothing else of any - and may
     * move an incident's or an alert's state, note an incident and page for
     * it, as a team built in the dashboard from those permissions may.
     */
    await seedTeam({
      project: projectId,
      name: "Payments responders",
      members: [responderId],
      permissions: [
        {
          permission: Permission.ReadProjectIncident,
          labelIds: [paymentsLabelId],
        },
        { permission: Permission.ReadIncidentState },
        { permission: Permission.CreateIncidentStateTimeline },
        { permission: Permission.ReadIncidentStateTimeline },
        { permission: Permission.CreateIncidentInternalNote },
        { permission: Permission.ReadIncidentInternalNote },
        { permission: Permission.CreateProjectOnCallDutyPolicyExecutionLog },
        { permission: Permission.ReadProjectOnCallDutyPolicyExecutionLog },
        {
          permission: Permission.ReadProjectOnCallDutyPolicy,
          labelIds: [paymentsLabelId],
        },
        {
          permission: Permission.ReadAlert,
          labelIds: [paymentsLabelId],
        },
        { permission: Permission.ReadAlertState },
        { permission: Permission.CreateAlertStateTimeline },
        { permission: Permission.ReadAlertStateTimeline },
      ],
    });

    // A project-wide member, for contrast.
    await seedTeam({
      project: projectId,
      name: "Members",
      members: [projectMemberId],
      permissions: [{ permission: Permission.ProjectMember }],
    });

    // Reads everything, changes nothing.
    await seedTeam({
      project: projectId,
      name: "Viewers",
      members: [viewerId],
      permissions: [{ permission: Permission.Viewer }],
    });

    // May move an incident's state, but read none of the project's states.
    await seedTeam({
      project: projectId,
      name: "State blind",
      members: [stateBlindId],
      permissions: [
        { permission: Permission.ReadProjectIncident },
        { permission: Permission.CreateIncidentStateTimeline },
        { permission: Permission.ReadIncidentStateTimeline },
      ],
    });

    // Edits incidents and alerts, but may change the state of neither.
    await seedTeam({
      project: projectId,
      name: "Editors",
      members: [editorId],
      permissions: [
        { permission: Permission.ReadProjectIncident },
        { permission: Permission.EditProjectIncident },
        { permission: Permission.ReadIncidentState },
        { permission: Permission.ReadIncidentStateTimeline },
        { permission: Permission.ReadAlert },
        { permission: Permission.EditAlert },
        { permission: Permission.ReadAlertState },
        { permission: Permission.ReadAlertStateTimeline },
      ],
    });

    /*
     * Reads every incident and alert, and may change the state of the ones
     * carrying the payments label - of no other.
     */
    await seedTeam({
      project: projectId,
      name: "Payments state changers",
      members: [paymentsStateChangerId],
      permissions: [
        { permission: Permission.ReadProjectIncident },
        { permission: Permission.ReadIncidentState },
        { permission: Permission.ReadIncidentStateTimeline },
        {
          permission: Permission.CreateIncidentStateTimeline,
          labelIds: [paymentsLabelId],
        },
        { permission: Permission.ReadAlert },
        { permission: Permission.ReadAlertState },
        { permission: Permission.ReadAlertStateTimeline },
        {
          permission: Permission.CreateAlertStateTimeline,
          labelIds: [paymentsLabelId],
        },
      ],
    });

    // The Slack workspace connected to the project.
    await insert("WorkspaceProjectAuthToken", {
      _id: ObjectID.generate(),
      projectId: projectId,
      authToken: PROJECT_AUTH_TOKEN,
      workspaceType: WorkspaceType.Slack,
      workspaceProjectId: SLACK_TEAM_ID,
      miscData: JSON.stringify({
        botUserId: "B0BOT",
        teamId: SLACK_TEAM_ID,
        teamName: "Payments",
      }),
      version: 1,
    });

    await connectSlackAccount(responderId, SLACK_RESPONDER);
    await connectSlackAccount(projectMemberId, SLACK_PROJECT_MEMBER);
    await connectSlackAccount(viewerId, SLACK_VIEWER);
    await connectSlackAccount(stateBlindId, SLACK_STATE_BLIND);
  });

  beforeEach(() => {
    recorder.failures = [];

    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(() => {});
    jest.spyOn(Response, "sendTextResponse").mockImplementation(() => {});
    jest.spyOn(Response, "sendErrorResponse").mockImplementation(() => {});
    directMessageSpy = jest
      .spyOn(SlackUtil, "sendDirectMessageToUser")
      .mockResolvedValue();
    showModalSpy = jest.spyOn(SlackUtil, "showModalToUser").mockResolvedValue();
  });

  afterEach(async () => {
    // A refused statement fails the test, even if a caller swallowed it.
    expect(recorder.failures).toEqual([]);

    directMessageSpy.mockRestore();
    showModalSpy.mockRestore();

    // Each test starts from the incidents as they were declared.
    await database.query(
      `DELETE FROM "${schema}"."IncidentStateTimeline"
        WHERE NOT ("_id" = ANY($1::uuid[]))`,
      [
        seededTimelineIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ],
    );
    await database.query(
      `DELETE FROM "${schema}"."AlertStateTimeline"
        WHERE NOT ("_id" = ANY($1::uuid[]))`,
      [
        seededAlertTimelineIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ],
    );
    await database.query(`DELETE FROM "${schema}"."IncidentInternalNote"`);
    await database.query(
      `DELETE FROM "${schema}"."OnCallDutyPolicyExecutionLog"`,
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  const req: ExpressRequest = {} as ExpressRequest;
  const res: ExpressResponse = {} as ExpressResponse;

  function directMessageTexts(): Array<string> {
    return directMessageSpy.mock.calls.map(
      (call: Parameters<typeof SlackUtil.sendDirectMessageToUser>) => {
        return (call[0].messageBlocks[0] as WorkspacePayloadMarkdown).text;
      },
    );
  }

  // A button pressed on a Slack message, authorized from the stored rows.
  async function pressSlackButton(
    slackUserId: string,
    actionType: SlackActionType,
    value: string,
  ): Promise<void> {
    const slackRequest: SlackRequest = await SlackAuthAction.isAuthorized({
      req: {
        body: {
          payload: JSON.stringify({
            type: "block_actions",
            user: { id: slackUserId, username: "jane" },
            team: { id: SLACK_TEAM_ID },
            channel: { id: "C0INCIDENTS" },
            trigger_id: "trigger-1",
            actions: [{ action_id: actionType, value: value }],
          }),
        },
      } as unknown as ExpressRequest,
    });
    expect(slackRequest.isAuthorized).toBe(true);

    await SlackIncidentActions.handleIncidentAction({
      slackRequest: slackRequest,
      action: slackRequest.actions![0]!,
      req: req,
      res: res,
    });
  }

  // A Slack form submitted, authorized from the stored rows.
  async function submitSlackForm(
    slackUserId: string,
    actionType: SlackActionType,
    incidentId: ObjectID,
    values: JSONObject,
  ): Promise<void> {
    const slackRequest: SlackRequest = await SlackAuthAction.isAuthorized({
      req: {
        body: {
          payload: JSON.stringify({
            type: "view_submission",
            user: { id: slackUserId, username: "jane" },
            team: { id: SLACK_TEAM_ID },
            view: {
              callback_id: actionType,
              private_metadata: incidentId.toString(),
              state: { values: values },
            },
          }),
        },
      } as unknown as ExpressRequest,
    });
    expect(slackRequest.isAuthorized).toBe(true);

    await SlackIncidentActions.handleIncidentAction({
      slackRequest: slackRequest,
      action: slackRequest.actions!.find((action: SlackAction): boolean => {
        return action.actionType === actionType;
      })!,
      req: req,
      res: res,
    });
  }

  // The options, in order, of the one form Slack was asked to show.
  function shownOptions(): Dictionary<Array<string>> {
    expect(showModalSpy).toHaveBeenCalledTimes(1);
    const modal: WorkspaceModalBlock =
      showModalSpy.mock.calls[0]![0].modalBlock;
    const dropdowns: Dictionary<Array<string>> = {};

    for (const block of modal.blocks) {
      if (block._type !== "WorkspaceDropdownBlock") {
        continue;
      }

      const dropdown: WorkspaceDropdownBlock = block as WorkspaceDropdownBlock;
      dropdowns[dropdown.blockId] = dropdown.options.map(
        (option: { label: string }): string => {
          return option.label;
        },
      );
    }

    return dropdowns;
  }

  function createTurnContext(): TurnContext {
    return {
      activity: {},
      deleteActivity: jest.fn(async (): Promise<void> => {}),
      sendActivity: jest.fn(async (): Promise<void> => {}),
    } as unknown as TurnContext;
  }

  function sentActivities(turnContext: TurnContext): Array<unknown> {
    return (turnContext.sendActivity as unknown as jest.Mock).mock.calls.map(
      (call: Array<unknown>): unknown => {
        return call[0];
      },
    );
  }

  describe("Slack's Acknowledge button", () => {
    test("on an incident carrying the member's label, writes the acknowledged state change once, created by the member", async () => {
      await pressSlackButton(
        SLACK_RESPONDER,
        SlackActionType.AcknowledgeIncident,
        paymentsIncidentId.toString(),
      );

      expect(directMessageTexts()).toEqual([]);
      expect(await newStateChanges()).toEqual([
        {
          incidentId: paymentsIncidentId.toString(),
          incidentStateId: acknowledgedStateId.toString(),
          projectId: projectId.toString(),
          createdByUserId: responderId.toString(),
        },
      ]);
    });

    test.each([
      {
        name: "an incident outside the member's label",
        incidentId: searchIncidentId,
      },
      {
        name: "another project's incident",
        incidentId: otherIncidentId,
      },
    ])(
      "on $name, is refused like a record that is not there, and nothing is written",
      async (row: { incidentId: ObjectID }) => {
        await pressSlackButton(
          SLACK_RESPONDER,
          SlackActionType.AcknowledgeIncident,
          row.incidentId.toString(),
        );

        expect(directMessageTexts()).toEqual([
          `@jane, You do not have permission to acknowledge this incident: the incident ${NOT_FOUND}`,
        ]);
        await nothingWritten();
      },
    );

    test("pressed by a member who may only read, is refused, and nothing is written", async () => {
      await pressSlackButton(
        SLACK_VIEWER,
        SlackActionType.AcknowledgeIncident,
        paymentsIncidentId.toString(),
      );

      expect(directMessageTexts()).toHaveLength(1);
      expect(directMessageTexts()[0]).toContain(
        "You do not have permission to acknowledge this incident.",
      );
      await nothingWritten();
    });
  });

  describe("Slack's Add Note form", () => {
    function privateNote(text: string): JSONObject {
      return {
        noteType: {
          noteType: { selected_option: { value: "private" } },
        },
        note: { note: { value: text } },
      };
    }

    test("posts the note on an incident carrying the member's label, as the member", async () => {
      await submitSlackForm(
        SLACK_RESPONDER,
        SlackActionType.SubmitIncidentNote,
        paymentsIncidentId,
        privateNote("Rolled back the checkout deploy."),
      );

      expect(directMessageTexts()).toEqual([]);
      expect(await notes()).toEqual([
        {
          incidentId: paymentsIncidentId.toString(),
          projectId: projectId.toString(),
          note: "Rolled back the checkout deploy.",
          createdByUserId: responderId.toString(),
        },
      ]);
    });

    test("on an incident outside the member's label, is refused like a record that is not there, and no note is posted", async () => {
      await submitSlackForm(
        SLACK_RESPONDER,
        SlackActionType.SubmitIncidentNote,
        searchIncidentId,
        privateNote("Looking into it."),
      );

      expect(directMessageTexts()).toEqual([
        `@jane, You do not have permission to add a private note to this incident: the incident ${NOT_FOUND}`,
      ]);
      await nothingWritten();
    });
  });

  describe("Slack's Change State form", () => {
    test("offers the states the member may read, in the project's order", async () => {
      await pressSlackButton(
        SLACK_RESPONDER,
        SlackActionType.ViewChangeIncidentState,
        paymentsIncidentId.toString(),
      );

      expect(shownOptions()).toEqual({
        incidentState: ["Created", "Acknowledged", "Resolved"],
      });
      expect(directMessageTexts()).toEqual([]);
    });

    test("tells a member who may read no incident state so, and shows no form", async () => {
      await pressSlackButton(
        SLACK_STATE_BLIND,
        SlackActionType.ViewChangeIncidentState,
        paymentsIncidentId.toString(),
      );

      expect(showModalSpy).not.toHaveBeenCalled();
      expect(directMessageTexts()).toEqual([
        `@jane, ${SlackIncidentActions.NO_STATES_MESSAGE}`,
      ]);
    });

    test("submitted, moves the incident into the picked state as the member", async () => {
      await submitSlackForm(
        SLACK_RESPONDER,
        SlackActionType.SubmitChangeIncidentState,
        paymentsIncidentId,
        {
          incidentState: {
            incidentState: {
              selected_option: { value: resolvedStateId.toString() },
            },
          },
        },
      );

      expect(directMessageTexts()).toEqual([]);
      expect(await newStateChanges()).toEqual([
        {
          incidentId: paymentsIncidentId.toString(),
          incidentStateId: resolvedStateId.toString(),
          projectId: projectId.toString(),
          createdByUserId: responderId.toString(),
        },
      ]);
    });

    test("submitted with another project's state, is refused, and nothing is written", async () => {
      await submitSlackForm(
        SLACK_RESPONDER,
        SlackActionType.SubmitChangeIncidentState,
        paymentsIncidentId,
        {
          incidentState: {
            incidentState: {
              selected_option: { value: otherProjectStateId.toString() },
            },
          },
        },
      );

      expect(directMessageTexts()).toHaveLength(1);
      expect(directMessageTexts()[0]).toContain(
        "Could not change the state of the incident:",
      );
      await nothingWritten();
    });
  });

  describe("Microsoft Teams' incident buttons", () => {
    async function pressTeamsButton(
      userId: ObjectID,
      actionType: MicrosoftTeamsIncidentActionType,
      incidentId: ObjectID,
      turnContext: TurnContext,
      value: JSONObject = {},
    ): Promise<void> {
      await MicrosoftTeamsIncidentActions.handleBotIncidentAction({
        actionType: actionType,
        actionValue: incidentId.toString(),
        value: value,
        projectId: projectId,
        oneUptimeUserId: userId,
        databaseProps: await memberProps(userId),
        turnContext: turnContext,
      });
    }

    test("Resolve, pressed by a project-wide member, writes the resolved state change as them", async () => {
      const turnContext: TurnContext = createTurnContext();

      await pressTeamsButton(
        projectMemberId,
        MicrosoftTeamsIncidentActionType.ResolveIncident,
        searchIncidentId,
        turnContext,
      );

      expect(sentActivities(turnContext)).toEqual(["✅ Incident resolved."]);
      expect(await newStateChanges()).toEqual([
        {
          incidentId: searchIncidentId.toString(),
          incidentStateId: resolvedStateId.toString(),
          projectId: projectId.toString(),
          createdByUserId: projectMemberId.toString(),
        },
      ]);
    });

    test("Resolve on an incident outside the member's label is refused like a record that is not there, and nothing is written", async () => {
      const turnContext: TurnContext = createTurnContext();

      await expect(
        pressTeamsButton(
          responderId,
          MicrosoftTeamsIncidentActionType.ResolveIncident,
          searchIncidentId,
          turnContext,
        ),
      ).rejects.toThrow(
        `You do not have permission to resolve this incident: the incident ${NOT_FOUND}`,
      );

      expect(sentActivities(turnContext)).toEqual([]);
      await nothingWritten();
    });

    test("Acknowledge pressed by a member who may only read is refused, and nothing is written", async () => {
      const turnContext: TurnContext = createTurnContext();

      await expect(
        pressTeamsButton(
          viewerId,
          MicrosoftTeamsIncidentActionType.AckIncident,
          paymentsIncidentId,
          turnContext,
        ),
      ).rejects.toThrow(NotAuthorizedException);

      expect(sentActivities(turnContext)).toEqual([]);
      await nothingWritten();
    });

    test("the change-state card offers the states the member may read, and says so when there are none", async () => {
      const responderContext: TurnContext = createTurnContext();

      await pressTeamsButton(
        responderId,
        MicrosoftTeamsIncidentActionType.ViewChangeIncidentState,
        paymentsIncidentId,
        responderContext,
      );

      const card: JSONObject = (
        (sentActivities(responderContext)[0] as JSONObject)[
          "attachments"
        ] as Array<JSONObject>
      )[0]!["content"] as JSONObject;
      const choiceSet: JSONObject = (card["body"] as Array<JSONObject>).find(
        (element: JSONObject): boolean => {
          return element["type"] === "Input.ChoiceSet";
        },
      )!;

      expect(
        (choiceSet["choices"] as Array<JSONObject>).map(
          (choice: JSONObject): unknown => {
            return choice["title"];
          },
        ),
      ).toEqual(["Created", "Acknowledged", "Resolved"]);

      const stateBlindContext: TurnContext = createTurnContext();

      await pressTeamsButton(
        stateBlindId,
        MicrosoftTeamsIncidentActionType.ViewChangeIncidentState,
        paymentsIncidentId,
        stateBlindContext,
      );

      expect(sentActivities(stateBlindContext)).toEqual([
        MicrosoftTeamsIncidentActions.NO_STATES_MESSAGE,
      ]);
    });
  });

  describe("Microsoft Teams' Escalate button", () => {
    async function escalate(
      userId: ObjectID,
      actionPayload: JSONObject,
      turnContext: TurnContext,
    ): Promise<void> {
      await MicrosoftTeamsOnCallDutyActions.handleBotOnCallDutyAction({
        actionType: MicrosoftTeamsOnCallDutyActionType.EscalateOnCall,
        turnContext: turnContext,
        actionPayload: actionPayload,
        projectId: projectId,
        databaseProps: await memberProps(userId),
      });
    }

    test("on an incident's card, pages for that incident with the member as who triggered it", async () => {
      const turnContext: TurnContext = createTurnContext();

      await escalate(
        responderId,
        {
          onCallDutyPolicyId: paymentsPolicyId.toString(),
          incidentId: paymentsIncidentId.toString(),
        },
        turnContext,
      );

      expect(sentActivities(turnContext)).toEqual([
        "On-call policy escalated successfully",
      ]);
      expect(await executionLogs()).toEqual([
        {
          onCallDutyPolicyId: paymentsPolicyId.toString(),
          projectId: projectId.toString(),
          triggeredByIncidentId: paymentsIncidentId.toString(),
          triggeredByUserId: responderId.toString(),
          createdByUserId: responderId.toString(),
          status: OnCallDutyPolicyStatus.Scheduled,
          statusMessage: "Scheduled.",
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
        },
      ]);
    });

    test("with a policy outside the member's label, is refused like a policy that is not there, and nobody is paged", async () => {
      const turnContext: TurnContext = createTurnContext();

      await expect(
        escalate(
          responderId,
          {
            onCallDutyPolicyId: searchPolicyId.toString(),
            incidentId: paymentsIncidentId.toString(),
          },
          turnContext,
        ),
      ).rejects.toThrow(
        `You do not have permission to execute this on-call policy for this incident: the on-call policy ${NOT_FOUND}`,
      );

      await nothingWritten();
    });

    test("on an incident outside the member's label, is refused, and nobody is paged", async () => {
      const turnContext: TurnContext = createTurnContext();

      await expect(
        escalate(
          responderId,
          {
            onCallDutyPolicyId: paymentsPolicyId.toString(),
            incidentId: searchIncidentId.toString(),
          },
          turnContext,
        ),
      ).rejects.toThrow(
        `You do not have permission to execute this on-call policy for this incident: the incident ${NOT_FOUND}`,
      );

      await nothingWritten();
    });

    test("on a card that names no record, is answered plainly, and nobody is paged", async () => {
      const turnContext: TurnContext = createTurnContext();

      await escalate(
        responderId,
        { onCallDutyPolicyId: paymentsPolicyId.toString() },
        turnContext,
      );

      expect(sentActivities(turnContext)).toEqual([
        MicrosoftTeamsOnCallDutyActions.ESCALATE_NEEDS_RECORD_MESSAGE,
      ]);
      await nothingWritten();
    });

    test("with an archived policy, records why nobody was paged", async () => {
      const turnContext: TurnContext = createTurnContext();

      await escalate(
        responderId,
        {
          onCallDutyPolicyId: archivedPaymentsPolicyId.toString(),
          incidentId: paymentsIncidentId.toString(),
        },
        turnContext,
      );

      expect(await executionLogs()).toEqual([
        expect.objectContaining({
          onCallDutyPolicyId: archivedPaymentsPolicyId.toString(),
          triggeredByIncidentId: paymentsIncidentId.toString(),
          createdByUserId: responderId.toString(),
          status: OnCallDutyPolicyStatus.Error,
          statusMessage: ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
        }),
      ]);
    });
  });

  describe("the writes themselves, whatever asked for them", () => {
    test("a state change made with a label-limited member's props refuses an incident outside their labels", async () => {
      const timeline: IncidentStateTimeline = new IncidentStateTimeline();
      timeline.projectId = projectId;
      timeline.incidentId = searchIncidentId;
      timeline.incidentStateId = acknowledgedStateId;

      // Answered like an incident that is not there, as the API answers it.
      await expect(
        IncidentStateTimelineService.create({
          data: timeline,
          props: await memberProps(responderId),
        }),
      ).rejects.toThrow(
        `This incident state timeline references records that are not in this project: Incident "${searchIncidentId.toString()}".`,
      );

      await nothingWritten();
    });

    test("so does a note", async () => {
      await expect(
        IncidentInternalNoteService.addNote({
          incidentId: searchIncidentId,
          projectId: projectId,
          note: "Looking into it.",
          props: await memberProps(responderId),
        }),
      ).rejects.toThrow(
        `This incident internal note references records that are not in this project: Incident "${searchIncidentId.toString()}".`,
      );

      await nothingWritten();
    });

    test("and so does a page for a policy outside their labels", async () => {
      const executionLog: OnCallDutyPolicyExecutionLog =
        new OnCallDutyPolicyExecutionLog();
      executionLog.projectId = projectId;
      executionLog.onCallDutyPolicyId = searchPolicyId;
      executionLog.triggeredByIncidentId = paymentsIncidentId;
      executionLog.userNotificationEventType =
        UserNotificationEventType.IncidentCreated;

      await expect(
        OnCallDutyPolicyExecutionLogService.create({
          data: executionLog,
          props: await memberProps(responderId),
        }),
      ).rejects.toThrow(
        `This on-call duty execution log references records that are not in this project: On-Call Policy "${searchPolicyId.toString()}".`,
      );

      await nothingWritten();
    });

    test("the module refuses an incident outside the member's labels before anything about it is told", async () => {
      await expect(
        WorkspaceMemberActions.acknowledge({
          event: {
            type: WorkspaceEventType.Incident,
            id: searchIncidentId,
          },
          props: await memberProps(responderId),
        }),
      ).rejects.toThrow(`The incident ${NOT_FOUND}`);

      await nothingWritten();
    });
  });

  /*
   * The AI assistant's actions (AIToolbox), asked by a person in chat. The
   * tool runs with that person's props, built as the dashboard builds them,
   * and makes the write the dashboard makes for the same action - so every
   * check below is the production one, over the rows seeded above.
   */
  describe("the AI assistant's actions, made as the person who asked", () => {
    async function askAssistant(data: {
      userId: ObjectID;
      tool: string;
      args: JSONObject;
    }): Promise<ToolCallOutcome> {
      return await AIToolbox.executeTool({
        name: data.tool,
        args: data.args,
        ctx: {
          projectId: projectId,
          props: await memberProps(data.userId),
        },
      });
    }

    interface StateTool {
      tool: string;
      kind: string;
      argument: string;
      // A record carrying the payments label, and one carrying another.
      paymentsRecordId: ObjectID;
      searchRecordId: ObjectID;
      // The state the tool moves the record into.
      stateId: ObjectID;
      permissionTitle: string;
    }

    const STATE_TOOLS: Array<StateTool> = [
      {
        tool: "acknowledge_incident",
        kind: "an incident",
        argument: "incidentId",
        paymentsRecordId: paymentsIncidentId,
        searchRecordId: searchIncidentId,
        stateId: acknowledgedStateId,
        permissionTitle: "Create Incident State Timeline",
      },
      {
        tool: "resolve_incident",
        kind: "an incident",
        argument: "incidentId",
        paymentsRecordId: paymentsIncidentId,
        searchRecordId: searchIncidentId,
        stateId: resolvedStateId,
        permissionTitle: "Create Incident State Timeline",
      },
      {
        tool: "acknowledge_alert",
        kind: "an alert",
        argument: "alertId",
        paymentsRecordId: paymentsAlertId,
        searchRecordId: searchAlertId,
        stateId: alertAcknowledgedStateId,
        permissionTitle: "Create Alert State Timeline",
      },
      {
        tool: "resolve_alert",
        kind: "an alert",
        argument: "alertId",
        paymentsRecordId: paymentsAlertId,
        searchRecordId: searchAlertId,
        stateId: alertResolvedStateId,
        permissionTitle: "Create Alert State Timeline",
      },
    ];

    // The state changes made since the records were seeded, of either kind.
    async function stateChanges(): Promise<Array<StoredRow>> {
      const incidentChanges: Array<StoredRow> = (await newStateChanges()).map(
        (row: StoredRow): StoredRow => {
          return {
            recordId: row["incidentId"]!,
            stateId: row["incidentStateId"]!,
            projectId: row["projectId"]!,
            createdByUserId: row["createdByUserId"]!,
          };
        },
      );
      const alertChanges: Array<StoredRow> = (await newAlertStateChanges()).map(
        (row: StoredRow): StoredRow => {
          return {
            recordId: row["alertId"]!,
            stateId: row["alertStateId"]!,
            projectId: row["projectId"]!,
            createdByUserId: row["createdByUserId"]!,
          };
        },
      );

      return [...incidentChanges, ...alertChanges];
    }

    test.each(STATE_TOOLS)(
      "$tool, asked by a person whose labels reach $kind, writes its state change once, created by them",
      async (row: StateTool) => {
        const outcome: ToolCallOutcome = await askAssistant({
          userId: responderId,
          tool: row.tool,
          args: { [row.argument]: row.paymentsRecordId.toString() },
        });

        expect(outcome.errorMessage).toBeUndefined();
        expect(outcome.success).toBe(true);
        expect(await stateChanges()).toEqual([
          {
            recordId: row.paymentsRecordId.toString(),
            stateId: row.stateId.toString(),
            projectId: projectId.toString(),
            createdByUserId: responderId.toString(),
          },
        ]);
      },
    );

    test.each(STATE_TOOLS)(
      "$tool on $kind outside the person's labels is refused like one that is not there, and nothing is written",
      async (row: StateTool) => {
        const outcome: ToolCallOutcome = await askAssistant({
          userId: responderId,
          tool: row.tool,
          args: { [row.argument]: row.searchRecordId.toString() },
        });

        expect(outcome.success).toBe(false);
        expect(outcome.textForLlm).toContain(
          "not found (or you do not have access to it).",
        );
        await nothingWritten();
      },
    );

    test.each(STATE_TOOLS)(
      "$tool, asked by a person who may edit $kind but not change its state, is refused, says what it needs, and nothing is written",
      async (row: StateTool) => {
        const outcome: ToolCallOutcome = await askAssistant({
          userId: editorId,
          tool: row.tool,
          args: { [row.argument]: row.paymentsRecordId.toString() },
        });

        expect(outcome.success).toBe(false);
        expect(outcome.errorMessage).toBe(
          `Permission denied for tool: ${row.tool}`,
        );
        expect(outcome.textForLlm).toContain(row.permissionTitle);
        await nothingWritten();
      },
    );

    test.each(STATE_TOOLS)(
      "$tool, asked by a person who reads $kind but may change the state of other labels only, is refused plainly, and nothing is written",
      async (row: StateTool) => {
        const outcome: ToolCallOutcome = await askAssistant({
          userId: paymentsStateChangerId,
          tool: row.tool,
          args: { [row.argument]: row.searchRecordId.toString() },
        });

        expect(outcome.success).toBe(false);
        // The create's own refusal, told to the model as one: no retry.
        expect(outcome.textForLlm).toMatch(
          new RegExp(
            `^Refused: ${row.tool} was not allowed for the current user\\. `,
          ),
        );
        expect(outcome.textForLlm).toContain(
          "Do not retry it. Tell the user plainly that it was not done, and why.",
        );
        await nothingWritten();
      },
    );

    test.each(STATE_TOOLS)(
      "$tool, asked by that same person for $kind carrying their label, writes the change as them",
      async (row: StateTool) => {
        const outcome: ToolCallOutcome = await askAssistant({
          userId: paymentsStateChangerId,
          tool: row.tool,
          args: { [row.argument]: row.paymentsRecordId.toString() },
        });

        expect(outcome.errorMessage).toBeUndefined();
        expect(outcome.success).toBe(true);
        expect(await stateChanges()).toEqual([
          {
            recordId: row.paymentsRecordId.toString(),
            stateId: row.stateId.toString(),
            projectId: projectId.toString(),
            createdByUserId: paymentsStateChangerId.toString(),
          },
        ]);
      },
    );

    test.each(STATE_TOOLS)(
      "$tool in a run that is no person - OneUptime itself - changes nothing",
      async (row: StateTool) => {
        const outcome: ToolCallOutcome = await AIToolbox.executeTool({
          name: row.tool,
          args: { [row.argument]: row.paymentsRecordId.toString() },
          ctx: { projectId: projectId, props: { isRoot: true } },
        });

        expect(outcome.success).toBe(false);
        expect(outcome.errorMessage).toBe(
          `Permission denied for tool: ${row.tool} (no signed-in person to act as)`,
        );
        await nothingWritten();
      },
    );

    test("page_on_call_policy pages for the incident, with the person as who triggered it", async () => {
      const outcome: ToolCallOutcome = await askAssistant({
        userId: responderId,
        tool: "page_on_call_policy",
        args: {
          onCallDutyPolicyId: paymentsPolicyId.toString(),
          incidentId: paymentsIncidentId.toString(),
        },
      });

      expect(outcome.errorMessage).toBeUndefined();
      expect(outcome.success).toBe(true);
      expect(await executionLogs()).toEqual([
        {
          onCallDutyPolicyId: paymentsPolicyId.toString(),
          projectId: projectId.toString(),
          triggeredByIncidentId: paymentsIncidentId.toString(),
          triggeredByUserId: responderId.toString(),
          createdByUserId: responderId.toString(),
          status: OnCallDutyPolicyStatus.Scheduled,
          statusMessage: "Scheduled.",
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
        },
      ]);
    });

    test("page_on_call_policy with a policy outside the person's labels is refused, and nobody is paged", async () => {
      const outcome: ToolCallOutcome = await askAssistant({
        userId: responderId,
        tool: "page_on_call_policy",
        args: {
          onCallDutyPolicyId: searchPolicyId.toString(),
          incidentId: paymentsIncidentId.toString(),
        },
      });

      expect(outcome.success).toBe(false);
      expect(outcome.textForLlm).toContain(
        "On-call duty policy not found (or you do not have access to it).",
      );
      await nothingWritten();
    });

    test("page_on_call_policy for an incident outside the person's labels is refused, and nobody is paged", async () => {
      const outcome: ToolCallOutcome = await askAssistant({
        userId: responderId,
        tool: "page_on_call_policy",
        args: {
          onCallDutyPolicyId: paymentsPolicyId.toString(),
          incidentId: searchIncidentId.toString(),
        },
      });

      expect(outcome.success).toBe(false);
      expect(outcome.textForLlm).toContain(
        "Incident not found (or you do not have access to it).",
      );
      await nothingWritten();
    });

    test("page_on_call_policy asked by a person who may only read is refused, says what it needs, and nobody is paged", async () => {
      const outcome: ToolCallOutcome = await askAssistant({
        userId: viewerId,
        tool: "page_on_call_policy",
        args: {
          onCallDutyPolicyId: paymentsPolicyId.toString(),
          incidentId: paymentsIncidentId.toString(),
        },
      });

      expect(outcome.success).toBe(false);
      expect(outcome.errorMessage).toBe(
        "Permission denied for tool: page_on_call_policy",
      );
      expect(outcome.textForLlm).toContain(
        "Create On-Call Duty Policy Execution Log",
      );
      await nothingWritten();
    });
  });
});
