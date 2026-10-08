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
jest.mock("../../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import IncidentService from "../../../../Server/Services/IncidentService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../../Server/Types/Database/Hooks";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import Response from "../../../../Server/Utils/Response";
import { MicrosoftTeamsIncidentActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsIncidentActions, {
  MicrosoftTeamsNewIncidentFormChoices,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import { MicrosoftTeamsCardChoice } from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices";
import { MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE } from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import SlackActionType from "../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackAuthAction, {
  SlackRequest,
} from "../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackIncidentActions from "../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
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
 * WHAT A SLACK OR MICROSOFT TEAMS "NEW INCIDENT" FORM OFFERS, AND WHAT ITS
 * SUBMIT MAY NAME, against a migrated Postgres.
 *
 * The forms are filled in and submitted as the OneUptime member the chat
 * account is connected to. SlackNewIncidentModalScope.test.ts and the
 * WorkspaceCreate* suites pin that the member's own props reach every read
 * and the create, with the reads and the create stubbed. What only a
 * database can show is what those props then reach - here every read runs
 * the production permission pipeline, query serializer and TypeORM over the
 * real join tables:
 *
 *   - Slack's request is authorized from the stored workspace rows: a Slack
 *     user who never connected an account, or whose OneUptime account has
 *     left the project, is refused before any form is built;
 *   - the member's permission rows are read from TeamPermission and
 *     TeamPermissionLabel, as the dashboard reads them;
 *   - a member whose monitor and on-call policy reads are limited to a label
 *     is offered only the monitors and policies carrying it - on Slack's
 *     modal, on Teams' card and on the Execute On-Call Policy picker - while
 *     a project-wide member is offered every one, and another project's
 *     records are offered to nobody;
 *   - a submit naming a monitor or policy outside that read, or another
 *     project's monitor, is refused like a record the project does not
 *     have, before the incident service's hooks run and before anything is
 *     written; one naming only records the member may name passes every
 *     check (the hooks are where this suite stops: an incident's own
 *     creation is IncidentService's, tested elsewhere).
 *
 * Opt in with RUN_POSTGRES_WORKSPACE_CREATE_FORM_TESTS=true against a
 * database the registered migrations have been applied to, e.g. from
 * packages/Common:
 *
 *   RUN_POSTGRES_WORKSPACE_CREATE_FORM_TESTS=true \
 *   WORKSPACE_CREATE_FORM_TEST_DATABASE_HOST=127.0.0.1 \
 *   WORKSPACE_CREATE_FORM_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Utils/Workspace/WorkspaceCreateFormsScopePostgres.test.ts --forceExit
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Without the
 * flag the suite is skipped, so the Common test job - whose Postgres is not
 * migrated - never runs it.
 *
 * The tables it writes are copied (LIKE ... INCLUDING ALL) from public into
 * a uniquely named schema that is dropped afterwards; every other table a
 * read joins is found, empty, in public. Every row is synthetic. Only what
 * lies outside OneUptime's database is stubbed: Slack and Teams themselves,
 * the permission cache (Redis), and the HTTP response.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_WORKSPACE_CREATE_FORM_TESTS"] === "true"
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
  "Monitor",
  "MonitorLabel",
  "MonitorStatus",
  "IncidentSeverity",
  "OnCallDutyPolicy",
  "OnCallDutyPolicyLabel",
  "Incident",
  "IncidentLabel",
  "IncidentMonitor",
  "IncidentOnCallDutyPolicy",
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

// What the incident service's hooks are handed: the create got past every check.
const PASSED_EVERY_CHECK: string =
  "The create passed every check and reached IncidentService.onBeforeCreate.";

interface PermissionRow {
  permission: Permission;
  labelIds?: Array<ObjectID>;
}

describePostgres(
  "Slack and Microsoft Teams new-incident forms, on Postgres",
  () => {
    const schema: string = `workspace_create_forms_${ObjectID.generate()
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
    const formerMemberId: ObjectID = ObjectID.generate();

    // Their Slack accounts; the stranger never connected one.
    const SLACK_RESPONDER: string = "U0RESPONDER";
    const SLACK_PROJECT_MEMBER: string = "U0PROJECTMEMBER";
    const SLACK_VIEWER: string = "U0VIEWER";
    const SLACK_FORMER_MEMBER: string = "U0FORMERMEMBER";
    const SLACK_STRANGER: string = "U0STRANGER";

    const respondersTeamId: ObjectID = ObjectID.generate();
    const membersTeamId: ObjectID = ObjectID.generate();
    const viewersTeamId: ObjectID = ObjectID.generate();
    const otherTeamId: ObjectID = ObjectID.generate();

    const paymentsLabelId: ObjectID = ObjectID.generate();
    const searchLabelId: ObjectID = ObjectID.generate();
    const otherLabelId: ObjectID = ObjectID.generate();

    const operationalStatusId: ObjectID = ObjectID.generate();
    const offlineStatusId: ObjectID = ObjectID.generate();
    const otherStatusId: ObjectID = ObjectID.generate();

    const criticalSeverityId: ObjectID = ObjectID.generate();
    const minorSeverityId: ObjectID = ObjectID.generate();
    const otherSeverityId: ObjectID = ObjectID.generate();

    const checkoutMonitorId: ObjectID = ObjectID.generate();
    const searchMonitorId: ObjectID = ObjectID.generate();
    const statusPageMonitorId: ObjectID = ObjectID.generate();
    const otherMonitorId: ObjectID = ObjectID.generate();

    const paymentsPolicyId: ObjectID = ObjectID.generate();
    const searchPolicyId: ObjectID = ObjectID.generate();
    const archivedPaymentsPolicyId: ObjectID = ObjectID.generate();
    const otherPolicyId: ObjectID = ObjectID.generate();

    const checkoutIncidentId: ObjectID = ObjectID.generate();

    // Names no reply to anyone outside the read may carry.
    const SEARCH_MONITOR_NAME: string = "Search API";
    const OTHER_MONITOR_NAME: string = "Acme Corp payroll API";
    const SEARCH_POLICY_NAME: string = "Search on-call";

    let directMessageSpy: SpyInstance<typeof SlackUtil.sendDirectMessageToUser>;
    let showModalSpy: SpyInstance<typeof SlackUtil.showModalToUser>;
    let hooksSpy: SpyInstance<
      (createBy: CreateBy<Incident>) => Promise<OnCreate<Incident>>
    >;

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

    async function countRows(table: string): Promise<number> {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*) AS "count" FROM "${schema}"."${table}"`,
      );
      return Number(rows[0]?.count || 0);
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
      id: ObjectID;
      project: ObjectID;
      name: string;
      members: Array<ObjectID>;
      permissions: Array<PermissionRow>;
    }): Promise<void> {
      await insert("Team", {
        _id: data.id,
        projectId: data.project,
        name: data.name,
        slug: `team-${data.id.toString()}`,
        version: 1,
      });

      for (const userId of data.members) {
        await insert("TeamMember", {
          _id: ObjectID.generate(),
          projectId: data.project,
          teamId: data.id,
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
          teamId: data.id,
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

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["WORKSPACE_CREATE_FORM_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["WORKSPACE_CREATE_FORM_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["WORKSPACE_CREATE_FORM_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        /*
         * No schema of its own: table names stay unqualified, so the tables
         * copied into the test schema are found first and every other table
         * a read joins is found, empty, in public.
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
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Permissions are read from the tables every time: nothing is cached.
      jest
        .spyOn(GlobalCache, "getJSONObject")
        .mockResolvedValue(null as never);
      jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockResolvedValue(undefined as never);

      // Workflows run elsewhere.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

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

      for (const id of [
        responderId,
        projectMemberId,
        viewerId,
        formerMemberId,
      ]) {
        await insert("User", {
          _id: id,
          name: "Synthetic User",
          email: `${id.toString()}@example.com`,
          slug: `user-${id.toString()}`,
          version: 1,
        });
      }

      // Labels.
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

      // Monitor statuses and incident severities: no labels of their own.
      for (const [id, project, name, priority] of [
        [operationalStatusId, projectId, "Operational", 1],
        [offlineStatusId, projectId, "Offline", 2],
        [otherStatusId, otherProjectId, "Acme Corp operational", 1],
      ] as Array<[ObjectID, ObjectID, string, number]>) {
        await seedNamed("MonitorStatus", {
          id: id,
          project: project,
          name: name,
          extra: { color: "#00FF00", priority: priority },
        });
      }

      for (const [id, project, name, order] of [
        [criticalSeverityId, projectId, "Critical", 1],
        [minorSeverityId, projectId, "Minor", 2],
        [otherSeverityId, otherProjectId, "Acme Corp critical", 1],
      ] as Array<[ObjectID, ObjectID, string, number]>) {
        await seedNamed("IncidentSeverity", {
          id: id,
          project: project,
          name: name,
          extra: { color: "#FF0000", order: order },
        });
      }

      // Monitors: one per label, one with none, one in the other project.
      for (const [id, project, name, labelIds] of [
        [checkoutMonitorId, projectId, "Checkout API", [paymentsLabelId]],
        [searchMonitorId, projectId, SEARCH_MONITOR_NAME, [searchLabelId]],
        [statusPageMonitorId, projectId, "Status page", []],
        [otherMonitorId, otherProjectId, OTHER_MONITOR_NAME, [otherLabelId]],
      ] as Array<[ObjectID, ObjectID, string, Array<ObjectID>]>) {
        await seedNamed("Monitor", {
          id: id,
          project: project,
          name: name,
          labelTable: "MonitorLabel",
          labelColumn: "monitorId",
          labelIds: labelIds,
          extra: {
            monitorType: "Manual",
            currentMonitorStatusId:
              project.toString() === projectId.toString()
                ? operationalStatusId
                : otherStatusId,
          },
        });
      }

      // On-call policies: one per label, an archived one, one elsewhere.
      for (const [id, project, name, labelIds, isArchived] of [
        [
          paymentsPolicyId,
          projectId,
          "Payments on-call",
          [paymentsLabelId],
          false,
        ],
        [
          searchPolicyId,
          projectId,
          SEARCH_POLICY_NAME,
          [searchLabelId],
          false,
        ],
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
          "Acme Corp executives on-call",
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

      // An incident on the checkout monitor, for the policy picker.
      await insert("Incident", {
        _id: checkoutIncidentId,
        projectId: projectId,
        title: "Checkout is down",
        slug: `incident-${checkoutIncidentId.toString()}`,
        // The state table is not read here.
        currentIncidentStateId: ObjectID.generate(),
        incidentSeverityId: criticalSeverityId,
        version: 1,
      });
      await insert("IncidentLabel", {
        incidentId: checkoutIncidentId,
        labelId: paymentsLabelId,
      });

      /*
       * The payments responders: they may declare incidents and execute
       * on-call policies, and read the monitors and on-call policies
       * carrying the payments label - nothing else of either.
       */
      await seedTeam({
        id: respondersTeamId,
        project: projectId,
        name: "Payments responders",
        members: [responderId],
        permissions: [
          { permission: Permission.IncidentMember },
          { permission: Permission.CreateProjectOnCallDutyPolicyExecutionLog },
          { permission: Permission.ReadProjectMonitorStatus },
          {
            permission: Permission.ReadProjectMonitor,
            labelIds: [paymentsLabelId],
          },
          {
            permission: Permission.ReadProjectOnCallDutyPolicy,
            labelIds: [paymentsLabelId],
          },
        ],
      });

      // A project-wide member, for contrast.
      await seedTeam({
        id: membersTeamId,
        project: projectId,
        name: "Members",
        members: [projectMemberId],
        permissions: [{ permission: Permission.ProjectMember }],
      });

      // Reads everything, declares nothing.
      await seedTeam({
        id: viewersTeamId,
        project: projectId,
        name: "Viewers",
        members: [viewerId],
        permissions: [{ permission: Permission.Viewer }],
      });

      // The former member belongs to the other project only now.
      await seedTeam({
        id: otherTeamId,
        project: otherProjectId,
        name: "Acme Corp owners",
        members: [formerMemberId],
        permissions: [{ permission: Permission.ProjectOwner }],
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
      // Connected while they were a member of the project.
      await connectSlackAccount(formerMemberId, SLACK_FORMER_MEMBER);
    });

    beforeEach(() => {
      recorder.failures = [];

      jest
        .spyOn(Response, "sendJsonObjectResponse")
        .mockImplementation(() => {});
      jest.spyOn(Response, "sendTextResponse").mockImplementation(() => {});
      jest.spyOn(Response, "sendErrorResponse").mockImplementation(() => {});
      directMessageSpy = jest
        .spyOn(SlackUtil, "sendDirectMessageToUser")
        .mockResolvedValue();
      showModalSpy = jest
        .spyOn(SlackUtil, "showModalToUser")
        .mockResolvedValue();
      jest.spyOn(SlackUtil, "sendMessage").mockResolvedValue({
        channelsPosted: [],
        threadPosted: false,
      } as never);
      jest
        .spyOn(SlackUtil, "sendEphemeralMessageToChannel")
        .mockResolvedValue();

      // An incident that passed every check stops here: nothing is written.
      hooksSpy = jest
        .spyOn(
          IncidentService as unknown as {
            onBeforeCreate: (
              createBy: CreateBy<Incident>,
            ) => Promise<OnCreate<Incident>>;
          },
          "onBeforeCreate",
        )
        .mockRejectedValue(new Error(PASSED_EVERY_CHECK));
    });

    afterEach(async () => {
      // A refused statement fails the test, even if a caller swallowed it.
      expect(recorder.failures).toEqual([]);
      // Nothing a test does here creates an incident.
      expect(await countRows("Incident")).toBe(1);
      expect(await countRows("IncidentMonitor")).toBe(0);
      expect(await countRows("IncidentOnCallDutyPolicy")).toBe(0);

      directMessageSpy.mockRestore();
      showModalSpy.mockRestore();
      hooksSpy.mockRestore();
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

    // "/incident Checkout is down", as Slack posts a slash command.
    function slashCommand(slackUserId: string): ExpressRequest {
      return {
        body: {
          command: SlackActionType.NewIncident,
          text: "Checkout is down",
          user_id: slackUserId,
          user_name: "jane",
          team_id: SLACK_TEAM_ID,
          channel_id: "C0INCIDENTS",
          trigger_id: "trigger-1",
        },
      } as unknown as ExpressRequest;
    }

    // The New Incident form submitted, as Slack posts a view submission.
    function formSubmission(
      slackUserId: string,
      named: {
        monitors: Array<ObjectID>;
        onCallDutyPolicies?: Array<ObjectID>;
        labels?: Array<ObjectID>;
      },
    ): ExpressRequest {
      const options: (
        ids: Array<ObjectID>,
      ) => Array<{ value: string }> = (
        ids: Array<ObjectID>,
      ): Array<{ value: string }> => {
        return ids.map((id: ObjectID): { value: string } => {
          return { value: id.toString() };
        });
      };

      return {
        body: {
          payload: JSON.stringify({
            type: "view_submission",
            user: { id: slackUserId, username: "jane" },
            team: { id: SLACK_TEAM_ID },
            view: {
              callback_id: SlackActionType.SubmitNewIncident,
              private_metadata: "C0INCIDENTS",
              state: {
                values: {
                  incidentTitle: {
                    incidentTitle: { value: "Checkout is down" },
                  },
                  incidentDescription: {
                    incidentDescription: { value: "Every payment fails." },
                  },
                  incidentSeverity: {
                    incidentSeverity: {
                      selected_option: {
                        value: criticalSeverityId.toString(),
                      },
                    },
                  },
                  incidentMonitors: {
                    incidentMonitors: {
                      selected_options: options(named.monitors),
                    },
                  },
                  monitorStatus: {
                    monitorStatus: {
                      selected_option: { value: offlineStatusId.toString() },
                    },
                  },
                  onCallDutyPolicies: {
                    onCallDutyPolicies: {
                      selected_options: options(
                        named.onCallDutyPolicies || [],
                      ),
                    },
                  },
                  labels: {
                    labels: { selected_options: options(named.labels || []) },
                  },
                },
              },
            },
          }),
        },
      } as unknown as ExpressRequest;
    }

    function directMessageTexts(): Array<string> {
      return directMessageSpy.mock.calls.map(
        (call: Parameters<typeof SlackUtil.sendDirectMessageToUser>) => {
          return (call[0].messageBlocks[0] as WorkspacePayloadMarkdown).text;
        },
      );
    }

    // The options of each dropdown of the one form Slack was asked to show.
    function shownDropdowns(): Dictionary<Array<string>> {
      expect(showModalSpy).toHaveBeenCalledTimes(1);
      const modal: WorkspaceModalBlock =
        showModalSpy.mock.calls[0]![0].modalBlock;
      const dropdowns: Dictionary<Array<string>> = {};

      for (const block of modal.blocks) {
        if (block._type !== "WorkspaceDropdownBlock") {
          continue;
        }

        const dropdown: WorkspaceDropdownBlock = block as WorkspaceDropdownBlock;
        dropdowns[dropdown.blockId] = dropdown.options
          .map((option: { label: string }) => {
            return option.label;
          })
          .sort();
      }

      return dropdowns;
    }

    async function authorizeSlack(
      request: ExpressRequest,
    ): Promise<SlackRequest> {
      return await SlackAuthAction.isAuthorized({ req: request });
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

    function choiceTitles(choices: Array<MicrosoftTeamsCardChoice>): Array<string> {
      return choices
        .map((choice: MicrosoftTeamsCardChoice): string => {
          return choice.title;
        })
        .sort();
    }

    describe("Slack authorizes /incident and its submit from the stored rows", () => {
      test("a Slack user who never connected an account is told to connect it, and no form is built", async () => {
        const slackRequest: SlackRequest = await authorizeSlack(
          slashCommand(SLACK_STRANGER),
        );

        expect(slackRequest.isAuthorized).toBe(false);
        expect(directMessageTexts()).toHaveLength(1);
        expect(directMessageTexts()[0]).toContain(
          "your slack account is not connected to OneUptime",
        );
        expect(showModalSpy).not.toHaveBeenCalled();
      });

      test("a Slack user who never connected an account cannot submit the form either", async () => {
        const slackRequest: SlackRequest = await authorizeSlack(
          formSubmission(SLACK_STRANGER, { monitors: [checkoutMonitorId] }),
        );

        expect(slackRequest.isAuthorized).toBe(false);
        expect(directMessageTexts()[0]).toContain(
          "your slack account is not connected to OneUptime",
        );
        expect(hooksSpy).not.toHaveBeenCalled();
      });

      test("an account connected by someone who has left the project is refused as not a member", async () => {
        const slackRequest: SlackRequest = await authorizeSlack(
          slashCommand(SLACK_FORMER_MEMBER),
        );

        expect(slackRequest.isAuthorized).toBe(false);
        expect(directMessageTexts()[0]).toContain(
          WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
        );
        expect(showModalSpy).not.toHaveBeenCalled();
      });

      test("a connected member is let through as their OneUptime user", async () => {
        const slackRequest: SlackRequest = await authorizeSlack(
          slashCommand(SLACK_RESPONDER),
        );

        expect(slackRequest.isAuthorized).toBe(true);
        expect(slackRequest.userId?.toString()).toBe(responderId.toString());
        expect(slackRequest.projectId?.toString()).toBe(projectId.toString());
        expect(directMessageSpy).not.toHaveBeenCalled();
      });
    });

    describe("Slack's New Incident form offers what its member may read", () => {
      async function openForm(slackUserId: string): Promise<void> {
        const slackRequest: SlackRequest = await authorizeSlack(
          slashCommand(slackUserId),
        );
        expect(slackRequest.isAuthorized).toBe(true);

        await SlackIncidentActions.viewNewIncidentModal({
          slackRequest: slackRequest,
          action: slackRequest.actions![0]!,
          req: req,
          res: res,
        });
      }

      test("a member whose monitor and policy reads are limited to a label is offered only what carries it", async () => {
        await openForm(SLACK_RESPONDER);

        expect(shownDropdowns()).toEqual({
          incidentSeverity: ["Critical", "Minor"],
          incidentMonitors: ["Checkout API"],
          monitorStatus: ["Offline", "Operational"],
          onCallDutyPolicies: ["Payments on-call"],
          // Labels are read by every member of the project.
          labels: ["payments", "search"],
        });
        expect(directMessageSpy).not.toHaveBeenCalled();
      });

      test("a project-wide member is offered every live record of the project, and nothing of another project", async () => {
        await openForm(SLACK_PROJECT_MEMBER);

        expect(shownDropdowns()).toEqual({
          incidentSeverity: ["Critical", "Minor"],
          incidentMonitors: ["Checkout API", SEARCH_MONITOR_NAME, "Status page"],
          monitorStatus: ["Offline", "Operational"],
          onCallDutyPolicies: ["Payments on-call", SEARCH_POLICY_NAME],
          labels: ["payments", "search"],
        });
      });

      test("a member who may not declare an incident is told so, and no form is built", async () => {
        await openForm(SLACK_VIEWER);

        expect(showModalSpy).not.toHaveBeenCalled();
        expect(directMessageTexts()).toHaveLength(1);
        expect(directMessageTexts()[0]).toContain(
          "You do not have permission to declare an incident.",
        );
      });
    });

    describe("submitting Slack's New Incident form", () => {
      async function submit(
        slackUserId: string,
        named: {
          monitors: Array<ObjectID>;
          onCallDutyPolicies?: Array<ObjectID>;
          labels?: Array<ObjectID>;
        },
      ): Promise<void> {
        const slackRequest: SlackRequest = await authorizeSlack(
          formSubmission(slackUserId, named),
        );
        expect(slackRequest.isAuthorized).toBe(true);

        const action: { actionType?: SlackActionType; actionValue?: string } =
          slackRequest.actions!.find(
            (candidate: { actionType?: SlackActionType }) => {
              return candidate.actionType === SlackActionType.SubmitNewIncident;
            },
          )!;

        await SlackIncidentActions.submitNewIncident({
          slackRequest: slackRequest,
          action: action,
          req: req,
          res: res,
        });
      }

      test.each([
        {
          name: "a monitor outside the label the member's monitor read is limited to",
          named: { monitors: [checkoutMonitorId, searchMonitorId] },
          refusedId: searchMonitorId,
          refusedName: SEARCH_MONITOR_NAME,
        },
        {
          name: "another project's monitor",
          named: { monitors: [checkoutMonitorId, otherMonitorId] },
          refusedId: otherMonitorId,
          refusedName: OTHER_MONITOR_NAME,
        },
        {
          name: "an on-call policy outside the label the member's policy read is limited to",
          named: {
            monitors: [checkoutMonitorId],
            onCallDutyPolicies: [paymentsPolicyId, searchPolicyId],
          },
          refusedId: searchPolicyId,
          refusedName: SEARCH_POLICY_NAME,
        },
      ])(
        "naming $name is refused like a record the project does not have, before anything is written",
        async (row: {
          named: {
            monitors: Array<ObjectID>;
            onCallDutyPolicies?: Array<ObjectID>;
          };
          refusedId: ObjectID;
          refusedName: string;
        }) => {
          await submit(SLACK_RESPONDER, row.named);

          expect(hooksSpy).not.toHaveBeenCalled();
          expect(directMessageTexts()).toHaveLength(1);

          const refusal: string = directMessageTexts()[0]!;
          expect(refusal).toContain("Could not declare the incident:");
          expect(refusal).toContain("not in this project");
          expect(refusal).toContain(row.refusedId.toString());
          // The name of a record outside the member's read is never told.
          expect(refusal).not.toContain(row.refusedName);
        },
      );

      test("naming only records the member may name passes every check of the create", async () => {
        await expect(
          submit(SLACK_RESPONDER, {
            monitors: [checkoutMonitorId],
            onCallDutyPolicies: [paymentsPolicyId],
            labels: [paymentsLabelId],
          }),
        ).rejects.toThrow(PASSED_EVERY_CHECK);

        expect(hooksSpy).toHaveBeenCalledTimes(1);
        const createBy: CreateBy<Incident> = hooksSpy.mock.calls[0]![0];
        expect(createBy.props.isRoot).toBeFalsy();
        expect(createBy.props.userId?.toString()).toBe(responderId.toString());
        expect(directMessageSpy).not.toHaveBeenCalled();
      });

      test("a member who may not declare an incident is told so, and the create is never asked", async () => {
        await submit(SLACK_VIEWER, { monitors: [checkoutMonitorId] });

        expect(hooksSpy).not.toHaveBeenCalled();
        expect(directMessageTexts()[0]).toContain(
          "You do not have permission to declare an incident.",
        );
      });
    });

    describe("Slack's Execute On-Call Policy picker offers what its member may read", () => {
      async function openPicker(slackUserId: string): Promise<void> {
        const slackRequest: SlackRequest = await authorizeSlack({
          body: {
            payload: JSON.stringify({
              type: "block_actions",
              user: { id: slackUserId, username: "jane" },
              team: { id: SLACK_TEAM_ID },
              channel: { id: "C0INCIDENTS" },
              trigger_id: "trigger-2",
              actions: [
                {
                  action_id: SlackActionType.ViewExecuteIncidentOnCallPolicy,
                  value: checkoutIncidentId.toString(),
                },
              ],
            }),
          },
        } as unknown as ExpressRequest);
        expect(slackRequest.isAuthorized).toBe(true);

        await SlackIncidentActions.handleIncidentAction({
          slackRequest: slackRequest,
          action: slackRequest.actions![0]!,
          req: req,
          res: res,
        });
      }

      test("a member whose policy read is limited to a label is offered only the live policies carrying it", async () => {
        await openPicker(SLACK_RESPONDER);

        expect(shownDropdowns()).toEqual({
          onCallPolicy: ["Payments on-call"],
        });
      });

      test("a project-wide member is offered every live policy of the project", async () => {
        await openPicker(SLACK_PROJECT_MEMBER);

        expect(shownDropdowns()).toEqual({
          onCallPolicy: ["Payments on-call", SEARCH_POLICY_NAME],
        });
      });

      test("a member who may not execute a policy is told so, and no picker is built", async () => {
        await openPicker(SLACK_VIEWER);

        expect(showModalSpy).not.toHaveBeenCalled();
        expect(directMessageTexts()[0]).toContain(
          "You do not have permission to execute an on-call policy for this incident.",
        );
      });
    });

    describe("Microsoft Teams' Create New Incident card", () => {
      function createTurnContext(): TurnContext {
        return {
          activity: {},
          deleteActivity: jest.fn(async (): Promise<void> => {}),
          sendActivity: jest.fn(async (): Promise<void> => {}),
        } as unknown as TurnContext;
      }

      function sentMessages(turnContext: TurnContext): Array<string> {
        return (
          turnContext.sendActivity as unknown as jest.Mock
        ).mock.calls.map((call: Array<unknown>): string => {
          return String(call[0]);
        });
      }

      async function submitCard(
        userId: ObjectID,
        named: { monitors: Array<ObjectID>; onCallDutyPolicies?: Array<ObjectID> },
        turnContext: TurnContext,
      ): Promise<void> {
        const value: JSONObject = {
          incidentTitle: "Checkout is down",
          incidentDescription: "Every payment fails.",
          incidentSeverity: criticalSeverityId.toString(),
          incidentMonitors: named.monitors
            .map((id: ObjectID): string => {
              return id.toString();
            })
            .join(","),
          monitorStatus: offlineStatusId.toString(),
          labels: paymentsLabelId.toString(),
          onCallDutyPolicies: (named.onCallDutyPolicies || [])
            .map((id: ObjectID): string => {
              return id.toString();
            })
            .join(","),
        };

        await MicrosoftTeamsIncidentActions.handleBotIncidentAction({
          actionType: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
          actionValue: "",
          value: value,
          projectId: projectId,
          oneUptimeUserId: userId,
          databaseProps: await memberProps(userId),
          turnContext: turnContext,
        });
      }

      test("the lists of a member whose monitor and policy reads are limited to a label hold only what carries it", async () => {
        const choices: MicrosoftTeamsNewIncidentFormChoices =
          await MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
            projectId,
            await memberProps(responderId),
          );

        expect(choiceTitles(choices.severities.choices)).toEqual([
          "Critical",
          "Minor",
        ]);
        expect(choiceTitles(choices.monitors.choices)).toEqual([
          "Checkout API",
        ]);
        // The card's "N not shown" counts what the member may read, too.
        expect(choices.monitors.totalCount).toBe(1);
        expect(choiceTitles(choices.monitorStatuses.choices)).toEqual([
          "Offline",
          "Operational",
        ]);
        expect(choiceTitles(choices.onCallDutyPolicies.choices)).toEqual([
          "Payments on-call",
        ]);
        expect(choices.onCallDutyPolicies.totalCount).toBe(1);
        expect(choiceTitles(choices.labels.choices)).toEqual([
          "payments",
          "search",
        ]);
      });

      test("a project-wide member's lists hold every live record of the project, and nothing of another project", async () => {
        const choices: MicrosoftTeamsNewIncidentFormChoices =
          await MicrosoftTeamsIncidentActions.getNewIncidentFormChoices(
            projectId,
            await memberProps(projectMemberId),
          );

        expect(choiceTitles(choices.monitors.choices)).toEqual([
          "Checkout API",
          SEARCH_MONITOR_NAME,
          "Status page",
        ]);
        expect(choiceTitles(choices.onCallDutyPolicies.choices)).toEqual([
          "Payments on-call",
          SEARCH_POLICY_NAME,
        ]);
      });

      test("someone who has left the project gets no lists: they are not a member", async () => {
        await expect(memberProps(formerMemberId)).rejects.toThrow(
          WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
        );
      });

      test("a submit naming a monitor outside the member's read is refused with the fixed line, before anything is written", async () => {
        const turnContext: TurnContext = createTurnContext();

        await submitCard(
          responderId,
          { monitors: [checkoutMonitorId, searchMonitorId] },
          turnContext,
        );

        expect(hooksSpy).not.toHaveBeenCalled();
        expect(sentMessages(turnContext)).toEqual([
          `❌ Could not create the incident: ${MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE}`,
        ]);
      });

      test("a submit naming another project's monitor is refused the same way", async () => {
        const turnContext: TurnContext = createTurnContext();

        await submitCard(
          responderId,
          { monitors: [otherMonitorId] },
          turnContext,
        );

        expect(hooksSpy).not.toHaveBeenCalled();
        expect(sentMessages(turnContext)).toEqual([
          `❌ Could not create the incident: ${MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE}`,
        ]);
      });

      test("a submit naming only records the member may name passes every check of the create", async () => {
        const turnContext: TurnContext = createTurnContext();

        await submitCard(
          responderId,
          {
            monitors: [checkoutMonitorId],
            onCallDutyPolicies: [paymentsPolicyId],
          },
          turnContext,
        );

        expect(hooksSpy).toHaveBeenCalledTimes(1);
        expect(hooksSpy.mock.calls[0]![0].props.userId?.toString()).toBe(
          responderId.toString(),
        );
        // Stopped at the hooks, so not created - but not refused either.
        expect(sentMessages(turnContext).join("\n")).not.toContain(
          MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE,
        );
      });

      test("a member who may not declare an incident is refused before the create is asked", async () => {
        const turnContext: TurnContext = createTurnContext();

        await expect(
          submitCard(viewerId, { monitors: [checkoutMonitorId] }, turnContext),
        ).rejects.toThrow("You do not have permission to declare an incident.");

        expect(hooksSpy).not.toHaveBeenCalled();
      });
    });
  },
);
