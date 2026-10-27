import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * Tests for tenant -> project resolution in MicrosoftTeamsUtil.
 *
 * Bot Framework activities carry a Microsoft tenant id and nothing else, so
 * the tenant is the only key the bot can resolve a OneUptime project by. A
 * single tenant may legitimately be connected to several OneUptime projects
 * (saveChatToProjectAuthTokens fans out across every matching row for exactly
 * that reason).
 *
 * This used to be a bare
 *   WorkspaceProjectAuthTokenService.findOneBy({ workspaceType, workspaceProjectId })
 * with no projectId scope and no unique constraint behind it, so when a tenant
 * was connected to two projects the bot silently served whichever row sorted
 * first — its incidents, alerts and AI assistant answers — to anyone in the
 * tenant. The bot message path performs no per-user authorization, so guessing
 * is a cross-project data disclosure.
 *
 * The fix reads ALL matching rows (findBy + LIMIT_MAX) and refuses to guess:
 *
 * - resolveProjectByTenantId returns { projectAuth, isAmbiguous,
 *   candidateProjectIds }; more than one usable PROJECT means projectAuth ===
 *   null and isAmbiguous === true.
 * - Rows with a falsy projectId are dropped, and rows repeating a projectId
 *   already seen are collapsed, BEFORE the count is taken - so one good row
 *   plus one orphaned row, or two rows for the same project, still resolve
 *   cleanly.
 * - getTenantResolutionFailureMessage gives the ambiguous case a different
 *   remedy from the not-found case.
 * - Both bot entry points (handleBotMessageActivity for typed messages and
 *   handleBotInvokeActivity for adaptive-card clicks) go through it, and both
 *   scope everything they read afterwards to the project it resolved.
 *
 * These tests fail if the code ever reverts to findOneBy, if either entry point
 * starts serving a project it merely guessed at, or if a resolved tenant's
 * downstream reads are scoped to any project other than the resolved one.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

/*
 * Same botbuilder module factory as MicrosoftTeamsChats.test.ts — the repo-wide
 * manual mock does not expose everything MicrosoftTeams.ts touches at import
 * time.
 */
jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: {
      text: jest.fn(),
      attachment: jest.fn(),
    },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: {
      getMembers: jest.fn(),
      getPagedMembers: jest.fn(),
    },
  };
});

import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsAuthAction from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsCommands, {
  MicrosoftTeamsListCommand,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCommands";
import MicrosoftTeamsCreateCommands from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCreateCommands";
import { MicrosoftTeamsHomeActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsHome";
import MicrosoftTeamsProjectChoice from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsProjectChoice";
import { DRAWN_FOR_PROJECT_ID_FIELD } from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardProject";
import WorkspaceProjectChoiceStore, {
  WorkspaceProjectChoicePress,
} from "../../../../Server/Utils/Workspace/WorkspaceProjectChoiceStore";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import WorkspaceOpenRecords from "../../../../Server/Utils/Workspace/WorkspaceOpenRecords";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import IncidentService from "../../../../Server/Services/IncidentService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ProjectService from "../../../../Server/Services/ProjectService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceProjectResolver, {
  WorkspaceProjectEvidence,
} from "../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import ObjectID from "../../../../Types/ObjectID";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import {
  MessageFactory,
  CardFactory,
  TeamsInfo,
  type TurnContext,
} from "botbuilder";

const TENANT_ID: string = "tenant-abc";
const BOT_RECIPIENT_ID: string = "bot-recipient-id";
const AAD_OBJECT_ID: string = "aad-object-id-1";
const TURN_CONTEXT_SERVICE_URL: string =
  "https://smba.trafficmanager.net/emea/";

/*
 * Distinguishing substrings of the two failure messages. Deliberately short so
 * that copy edits to the surrounding sentence do not break these tests.
 */
const AMBIGUOUS_FRAGMENT: string = "more than one OneUptime project";
const NOT_FOUND_FRAGMENT: string = "couldn't find your project configuration";
const NO_TENANT_FRAGMENT: string = "couldn't identify your organization";
// The help card's first words (WorkspaceCommands.getHelpAnswer).
const HELP_FRAGMENT: string = "Here's what I can do.";

interface CapturedFindByCall {
  query: JSONObject;
  select: JSONObject;
  limit: number;
  skip: number;
  props: JSONObject;
}

interface FakeTurnContext {
  turnContext: TurnContext;
  sendActivity: jest.Mock;
}

function buildTurnContext(): FakeTurnContext {
  const sendActivity: jest.Mock = jest.fn(async (): Promise<JSONObject> => {
    return { id: "sent-message-id" };
  });

  const turnContext: TurnContext = {
    activity: {
      recipient: { id: BOT_RECIPIENT_ID },
      serviceUrl: TURN_CONTEXT_SERVICE_URL,
      conversation: { id: "ctx-conversation-id" },
    },
    sendActivity: sendActivity,
  } as unknown as TurnContext;

  return { turnContext: turnContext, sendActivity: sendActivity };
}

function buildProjectAuthRow(data?: {
  projectId?: ObjectID | null | undefined;
  workspaceProjectId?: string | undefined;
  authToken?: string | undefined;
}): WorkspaceProjectAuthToken {
  return {
    id: ObjectID.generate(),
    projectId:
      data && "projectId" in data ? data.projectId : ObjectID.generate(),
    workspaceProjectId: data?.workspaceProjectId || TENANT_ID,
    authToken: data?.authToken || "stored-auth-token",
    miscData: { tenantId: TENANT_ID, teamId: "team-1", botId: "bot-1" },
  } as unknown as WorkspaceProjectAuthToken;
}

function mockFindBy(rows: Array<WorkspaceProjectAuthToken>): jest.SpyInstance {
  return jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockResolvedValue(rows);
}

/*
 * findOneBy is what the vulnerable version used. It is stubbed (never left
 * live) so that a regression cannot reach a real database, and asserted
 * not-called so that a regression is caught rather than silently tolerated.
 */
function spyOnFindOneBy(): jest.SpyInstance {
  return jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockResolvedValue(null);
}

/*
 * The message path backfills captured chats before it resolves the tenant, and
 * that backfill hits WorkspaceProjectAuthTokenService itself. Stub it out so
 * findBy call counts belong to resolveProjectByTenantId alone.
 */
function stubChatCapture(): jest.SpyInstance {
  return jest
    .spyOn(MicrosoftTeamsUtil as any, "captureChatFromBotActivity")
    .mockResolvedValue(undefined as never);
}

/*
 * The readers the message path serves project data with are private statics,
 * so they are spied through the class object. Stubbing them keeps the test off
 * the database while capturing the one argument that matters: the project id
 * the handler decided to scope the read to.
 */
function stubDownstreamReader(
  methodName: string,
  resolvedValue?: unknown,
): jest.SpyInstance {
  return jest
    .spyOn(MicrosoftTeamsUtil as any, methodName)
    .mockResolvedValue(resolvedValue as never);
}

/*
 * Teams' own lists are read by MicrosoftTeamsCommands.handleListCommand, as
 * the member who typed them (WorkspaceOpenRecords). Stubbed to answer the
 * way it would, the project id it is handed is what is captured.
 */
function stubListCommand(reply: string): jest.SpyInstance {
  return jest
    .spyOn(MicrosoftTeamsCommands, "handleListCommand")
    .mockImplementation(async (data: any): Promise<void> => {
      await data.turnContext.sendActivity(reply);
    });
}

function listCommandArgs(spy: jest.SpyInstance): {
  projectId: ObjectID;
  listCommand: MicrosoftTeamsListCommand;
} {
  return spy.mock.calls[0]?.[0] as {
    projectId: ObjectID;
    listCommand: MicrosoftTeamsListCommand;
  };
}

function messageActivity(data?: {
  tenantId?: string | undefined;
  omitTenant?: boolean | undefined;
  text?: string | undefined;
}): JSONObject {
  const channelData: JSONObject = {};

  if (!data?.omitTenant) {
    channelData["tenant"] = { id: data?.tenantId || TENANT_ID };
  }

  return {
    type: "message",
    // "help" is answered from a constant, so the path needs no AI or DB mocks.
    text: data?.text || "help",
    from: { id: "user-1", name: "Alice", aadObjectId: AAD_OBJECT_ID },
    recipient: { id: BOT_RECIPIENT_ID },
    conversation: { conversationType: "personal", id: "19:personal@thread.v2" },
    channelData: channelData,
    serviceUrl: TURN_CONTEXT_SERVICE_URL,
    entities: [],
  };
}

function invokeActivity(data?: {
  tenantId?: string | undefined;
  omitTenant?: boolean | undefined;
  omitAadObjectId?: boolean | undefined;
}): JSONObject {
  const channelData: JSONObject = {};

  if (!data?.omitTenant) {
    channelData["tenant"] = { id: data?.tenantId || TENANT_ID };
  }

  const from: JSONObject = { id: "user-1", name: "Alice" };

  if (!data?.omitAadObjectId) {
    from["aadObjectId"] = AAD_OBJECT_ID;
  }

  return {
    type: "invoke",
    name: "adaptiveCard/action",
    value: { action: "unknown-card-action", actionValue: "some-id" },
    from: from,
    recipient: { id: BOT_RECIPIENT_ID },
    conversation: { conversationType: "personal", id: "19:personal@thread.v2" },
    channelData: channelData,
    serviceUrl: TURN_CONTEXT_SERVICE_URL,
  };
}

/*
 * Where the help's buttons lead, on this installation: its docs, and its
 * sign-up page while it takes sign-ups (read from GlobalConfig, which these
 * tests have no database for).
 */
function stubHelpLinkAddresses(): void {
  jest
    .spyOn(DatabaseConfig, "getHomeUrl")
    .mockResolvedValue(URL.fromString("https://acme.test"));
  jest
    .spyOn(DatabaseConfig, "getAccountsUrl")
    .mockResolvedValue(URL.fromString("https://acme.test/accounts"));
  jest.spyOn(DatabaseConfig, "shouldDisableSignup").mockResolvedValue(false);
}

function sentTexts(sendActivity: jest.Mock): Array<string> {
  return sendActivity.mock.calls.map((call: Array<unknown>) => {
    return typeof call[0] === "string" ? call[0] : JSON.stringify(call[0]);
  });
}

function joinedSentText(sendActivity: jest.Mock): string {
  return sentTexts(sendActivity).join("\n");
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The botbuilder module mock's jest.fn()s are shared across tests — jest.spyOn
 * on an existing mock returns the same function, so call history and
 * mockResolvedValueOnce queues leak between tests unless reset here.
 */
beforeEach(() => {
  (MessageFactory.text as jest.Mock).mockReset();
  (MessageFactory.attachment as jest.Mock).mockReset();
  (CardFactory.heroCard as jest.Mock).mockReset();
  (TeamsInfo.getMembers as jest.Mock).mockReset();
  (TeamsInfo.getPagedMembers as jest.Mock).mockReset();

  /*
   * A tenant connected to several projects is told apart by the activity's
   * own clues (WorkspaceProjectResolution): the sender's Microsoft Teams
   * account, connected here in none of them unless a test says otherwise,
   * so the activity stays ambiguous.
   */
  jest.spyOn(WorkspaceUserAuthTokenService, "findBy").mockResolvedValue([]);
});

describe("MicrosoftTeamsUtil.resolveProjectByTenantId - row counting", () => {
  test("zero matching rows resolves to no project and is NOT ambiguous", async () => {
    mockFindBy([]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBeNull();
    expect(resolution.isAmbiguous).toBe(false);
    expect(resolution.candidateProjectIds).toEqual([]);
  });

  test("exactly one matching row resolves to that row", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const row: WorkspaceProjectAuthToken = buildProjectAuthRow({
      projectId: projectId,
    });
    mockFindBy([row]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBe(row);
    expect(resolution.isAmbiguous).toBe(false);
    expect(resolution.candidateProjectIds).toHaveLength(1);
    expect(resolution.candidateProjectIds[0]?.toString()).toBe(
      projectId.toString(),
    );
  });

  test("two rows for one tenant are ambiguous and resolve to NO project (the disclosure bug)", async () => {
    const projectIdOne: ObjectID = ObjectID.generate();
    const projectIdTwo: ObjectID = ObjectID.generate();
    mockFindBy([
      buildProjectAuthRow({ projectId: projectIdOne }),
      buildProjectAuthRow({ projectId: projectIdTwo }),
    ]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    // The old findOneBy returned the first row here — that is the regression.
    expect(resolution.projectAuth).toBeNull();
    expect(resolution.isAmbiguous).toBe(true);
    expect(resolution.candidateProjectIds).toHaveLength(2);
  });

  test("three rows are ambiguous and list all three candidates", async () => {
    const projectIds: Array<ObjectID> = [
      ObjectID.generate(),
      ObjectID.generate(),
      ObjectID.generate(),
    ];
    mockFindBy(
      projectIds.map((projectId: ObjectID) => {
        return buildProjectAuthRow({ projectId: projectId });
      }),
    );

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBeNull();
    expect(resolution.isAmbiguous).toBe(true);
    expect(resolution.candidateProjectIds).toHaveLength(3);
  });

  test("candidateProjectIds are the project ids, in the order the rows came back", async () => {
    const projectIdOne: ObjectID = ObjectID.generate();
    const projectIdTwo: ObjectID = ObjectID.generate();
    mockFindBy([
      buildProjectAuthRow({ projectId: projectIdOne }),
      buildProjectAuthRow({ projectId: projectIdTwo }),
    ]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(
      resolution.candidateProjectIds.map((projectId: ObjectID) => {
        return projectId.toString();
      }),
    ).toEqual([projectIdOne.toString(), projectIdTwo.toString()]);
  });
});

/*
 * Ambiguity is a question about distinct PROJECTS, not about rows. Duplicate
 * rows for the same project are a data-integrity wart (a re-install can leave
 * one behind) and must not lock that tenant's bot out forever, so resolution
 * de-duplicates by projectId BEFORE it counts.
 */
describe("MicrosoftTeamsUtil.resolveProjectByTenantId - de-duplication by projectId", () => {
  test("two rows pointing at the SAME project resolve cleanly and are NOT ambiguous", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const firstRow: WorkspaceProjectAuthToken = buildProjectAuthRow({
      projectId: projectId,
    });
    mockFindBy([
      firstRow,
      /*
       * A separate ObjectID instance carrying the same value - de-duplication
       * has to compare ids by value, not by object identity.
       */
      buildProjectAuthRow({ projectId: new ObjectID(projectId.toString()) }),
    ]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBe(firstRow);
    expect(resolution.isAmbiguous).toBe(false);
    expect(
      resolution.candidateProjectIds.map((candidate: ObjectID) => {
        return candidate.toString();
      }),
    ).toEqual([projectId.toString()]);
  });

  test("two otherwise-identical rows with DIFFERENT projects stay ambiguous - projectId is the only key", async () => {
    const projectIdOne: ObjectID = ObjectID.generate();
    const projectIdTwo: ObjectID = ObjectID.generate();
    /*
     * Everything except projectId matches, so a de-duplication keyed on the
     * tenant or the auth token would collapse these into one and hand the user
     * whichever project happened to sort first - the original disclosure bug.
     */
    mockFindBy([
      buildProjectAuthRow({
        projectId: projectIdOne,
        workspaceProjectId: TENANT_ID,
        authToken: "identical-auth-token",
      }),
      buildProjectAuthRow({
        projectId: projectIdTwo,
        workspaceProjectId: TENANT_ID,
        authToken: "identical-auth-token",
      }),
    ]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBeNull();
    expect(resolution.isAmbiguous).toBe(true);
    expect(
      resolution.candidateProjectIds.map((candidate: ObjectID) => {
        return candidate.toString();
      }),
    ).toEqual([projectIdOne.toString(), projectIdTwo.toString()]);
  });

  test("three rows collapsing to two distinct projects are still ambiguous with two candidates", async () => {
    const projectIdOne: ObjectID = ObjectID.generate();
    const projectIdTwo: ObjectID = ObjectID.generate();
    mockFindBy([
      buildProjectAuthRow({ projectId: projectIdOne }),
      buildProjectAuthRow({ projectId: projectIdTwo }),
      buildProjectAuthRow({ projectId: new ObjectID(projectIdOne.toString()) }),
    ]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBeNull();
    expect(resolution.isAmbiguous).toBe(true);
    // Three rows, two projects: the duplicate collapses, the conflict does not.
    expect(
      resolution.candidateProjectIds.map((candidate: ObjectID) => {
        return candidate.toString();
      }),
    ).toEqual([projectIdOne.toString(), projectIdTwo.toString()]);
  });

  test("a duplicated project is served by the message path instead of refused", async () => {
    const projectId: ObjectID = ObjectID.generate();
    stubChatCapture();
    mockFindBy([
      buildProjectAuthRow({ projectId: projectId }),
      buildProjectAuthRow({ projectId: new ObjectID(projectId.toString()) }),
    ]);
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity(),
      turnContext: context.turnContext,
    });

    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(HELP_FRAGMENT);
    expect(sent).not.toContain(AMBIGUOUS_FRAGMENT);
    expect(sent).not.toContain(NOT_FOUND_FRAGMENT);
  });
});

describe("MicrosoftTeamsUtil.resolveProjectByTenantId - unusable rows", () => {
  test("a single row with an undefined projectId counts as not found, not ambiguous", async () => {
    mockFindBy([buildProjectAuthRow({ projectId: undefined })]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBeNull();
    expect(resolution.isAmbiguous).toBe(false);
    expect(resolution.candidateProjectIds).toEqual([]);
  });

  test("a single row with a null projectId counts as not found", async () => {
    mockFindBy([buildProjectAuthRow({ projectId: null })]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBeNull();
    expect(resolution.isAmbiguous).toBe(false);
    expect(resolution.candidateProjectIds).toEqual([]);
  });

  test("one usable row plus one projectId-less row resolves cleanly and is NOT ambiguous", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const usableRow: WorkspaceProjectAuthToken = buildProjectAuthRow({
      projectId: projectId,
    });
    mockFindBy([buildProjectAuthRow({ projectId: undefined }), usableRow]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    // Filtering must happen BEFORE the count, otherwise this would be ambiguous.
    expect(resolution.projectAuth).toBe(usableRow);
    expect(resolution.isAmbiguous).toBe(false);
    expect(
      resolution.candidateProjectIds.map((candidate: ObjectID) => {
        return candidate.toString();
      }),
    ).toEqual([projectId.toString()]);
  });

  test("the usable row wins regardless of which position it is in", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const usableRow: WorkspaceProjectAuthToken = buildProjectAuthRow({
      projectId: projectId,
    });
    mockFindBy([
      usableRow,
      buildProjectAuthRow({ projectId: null }),
      buildProjectAuthRow({ projectId: undefined }),
    ]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBe(usableRow);
    expect(resolution.isAmbiguous).toBe(false);
  });

  test("only projectId-less rows count as not found even when there are several", async () => {
    mockFindBy([
      buildProjectAuthRow({ projectId: undefined }),
      buildProjectAuthRow({ projectId: null }),
    ]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBeNull();
    expect(resolution.isAmbiguous).toBe(false);
    expect(resolution.candidateProjectIds).toEqual([]);
  });

  test("two usable rows plus an unusable one are still ambiguous with two candidates", async () => {
    const projectIdOne: ObjectID = ObjectID.generate();
    const projectIdTwo: ObjectID = ObjectID.generate();
    mockFindBy([
      buildProjectAuthRow({ projectId: projectIdOne }),
      buildProjectAuthRow({ projectId: undefined }),
      buildProjectAuthRow({ projectId: projectIdTwo }),
    ]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBeNull();
    expect(resolution.isAmbiguous).toBe(true);
    expect(
      resolution.candidateProjectIds.map((candidate: ObjectID) => {
        return candidate.toString();
      }),
    ).toEqual([projectIdOne.toString(), projectIdTwo.toString()]);
  });
});

describe("MicrosoftTeamsUtil.resolveProjectByTenantId - the query it issues", () => {
  test("queries MicrosoftTeams rows whose workspaceProjectId is the tenant id, as root", async () => {
    const findBySpy: jest.SpyInstance = mockFindBy([]);

    await MicrosoftTeamsUtil.resolveProjectByTenantId({
      tenantId: "tenant-under-test",
    });

    expect(findBySpy).toHaveBeenCalledTimes(1);
    const call: CapturedFindByCall = findBySpy.mock
      .calls[0]?.[0] as CapturedFindByCall;
    expect(call.query).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceProjectId: "tenant-under-test",
    });
    expect(call.props).toEqual({ isRoot: true });
  });

  test("reads with LIMIT_MAX from offset 0 so a second connected project cannot hide behind the page size", async () => {
    const findBySpy: jest.SpyInstance = mockFindBy([]);

    await MicrosoftTeamsUtil.resolveProjectByTenantId({
      tenantId: TENANT_ID,
    });

    const call: CapturedFindByCall = findBySpy.mock
      .calls[0]?.[0] as CapturedFindByCall;
    expect(call.limit).toBe(LIMIT_MAX);
    expect(call.skip).toBe(0);
  });

  test("selects projectId so the caller can scope every downstream read", async () => {
    const findBySpy: jest.SpyInstance = mockFindBy([]);

    await MicrosoftTeamsUtil.resolveProjectByTenantId({
      tenantId: TENANT_ID,
    });

    const call: CapturedFindByCall = findBySpy.mock
      .calls[0]?.[0] as CapturedFindByCall;
    expect(call.select["projectId"]).toBe(true);
  });

  test("uses findBy and NEVER findOneBy (findOneBy silently picked one of several projects)", async () => {
    const findBySpy: jest.SpyInstance = mockFindBy([
      buildProjectAuthRow(),
      buildProjectAuthRow(),
    ]);
    const findOneBySpy: jest.SpyInstance = spyOnFindOneBy();

    await MicrosoftTeamsUtil.resolveProjectByTenantId({
      tenantId: TENANT_ID,
    });

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(findOneBySpy).not.toHaveBeenCalled();
  });

  test("an empty tenant id is still queried literally (no accidental match-all)", async () => {
    const findBySpy: jest.SpyInstance = mockFindBy([]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: "",
      });

    const call: CapturedFindByCall = findBySpy.mock
      .calls[0]?.[0] as CapturedFindByCall;
    expect(call.query["workspaceProjectId"]).toBe("");
    expect(resolution.projectAuth).toBeNull();
  });

  test("a rejected findBy propagates instead of resolving to some project", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockRejectedValue(new Error("db is down") as never);

    await expect(
      MicrosoftTeamsUtil.resolveProjectByTenantId({ tenantId: TENANT_ID }),
    ).rejects.toThrow("db is down");
  });
});

describe("MicrosoftTeamsUtil.getTenantResolutionFailureMessage", () => {
  function ambiguousResolution(): MicrosoftTeamsTenantResolution {
    return {
      projectAuth: null,
      isAmbiguous: true,
      candidateProjectIds: [ObjectID.generate(), ObjectID.generate()],
    };
  }

  function notFoundResolution(): MicrosoftTeamsTenantResolution {
    return {
      projectAuth: null,
      isAmbiguous: false,
      candidateProjectIds: [],
    };
  }

  test("the ambiguous and not-found cases produce different messages", () => {
    const ambiguousMessage: string =
      MicrosoftTeamsUtil.getTenantResolutionFailureMessage(
        ambiguousResolution(),
      );
    const notFoundMessage: string =
      MicrosoftTeamsUtil.getTenantResolutionFailureMessage(
        notFoundResolution(),
      );

    expect(ambiguousMessage).not.toBe(notFoundMessage);
  });

  test("the ambiguous message says the organization is connected to more than one project", () => {
    const message: string =
      MicrosoftTeamsUtil.getTenantResolutionFailureMessage(
        ambiguousResolution(),
      );

    expect(message).toContain(AMBIGUOUS_FRAGMENT);
  });

  test("the not-found message does not claim ambiguity", () => {
    const message: string =
      MicrosoftTeamsUtil.getTenantResolutionFailureMessage(
        notFoundResolution(),
      );

    expect(message).toContain(NOT_FOUND_FRAGMENT);
    expect(message).not.toContain(AMBIGUOUS_FRAGMENT);
  });

  test("neither message leaks project ids to the Teams user", () => {
    const candidateProjectId: ObjectID = ObjectID.generate();
    const message: string =
      MicrosoftTeamsUtil.getTenantResolutionFailureMessage({
        projectAuth: null,
        isAmbiguous: true,
        candidateProjectIds: [candidateProjectId],
      });

    expect(message).not.toContain(candidateProjectId.toString());
  });
});

describe("MicrosoftTeamsUtil.handleBotMessageActivity - tenant resolution", () => {
  beforeEach(() => {
    stubChatCapture();
  });

  test("a tenant that maps to exactly one project proceeds and sends no failure message", async () => {
    mockFindBy([buildProjectAuthRow()]);
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity(),
      turnContext: context.turnContext,
    });

    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(HELP_FRAGMENT);
    expect(sent).not.toContain(AMBIGUOUS_FRAGMENT);
    expect(sent).not.toContain(NOT_FOUND_FRAGMENT);
  });

  test("a tenant with no rows replies with the not-found message and does not answer the command", async () => {
    mockFindBy([]);
    const onCallSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsCommands, "handleOnCallCommand")
      .mockResolvedValue(undefined);
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "oncall" }),
      turnContext: context.turnContext,
    });

    expect(context.sendActivity).toHaveBeenCalledTimes(1);
    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(NOT_FOUND_FRAGMENT);
    expect(sent).not.toContain(HELP_FRAGMENT);
    expect(onCallSpy).not.toHaveBeenCalled();
  });

  test("the not-found message leads somewhere: to the help, which says how to get started", () => {
    expect(
      MicrosoftTeamsUtil.getTenantResolutionFailureMessage({
        projectAuth: null,
        isAmbiguous: false,
        candidateProjectIds: [],
      }),
    ).toMatch(/Type help to see what I can do and how to get started\.$/);
  });

  /*
   * Microsoft's store refused the app (policy 1140.4.3.4) while "help", sent
   * from an organization not connected to OneUptime yet, was answered with
   * the not-found refusal: the help must say what the app does, list its
   * commands and lead somewhere, connected or not. It reads nothing in any
   * project, so it is answered - with how to get started.
   */
  test("help, in a tenant connected to no project: the help, with how to get started - not the not-found refusal", async () => {
    mockFindBy([]);
    stubHelpLinkAddresses();
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "help" }),
      turnContext: context.turnContext,
    });

    expect(context.sendActivity).toHaveBeenCalledTimes(1);
    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(HELP_FRAGMENT);
    expect(sent).toContain(
      "is an observability and incident management platform",
    );
    expect(sent).toContain(
      "**To get started,** a project admin connects your organization",
    );
    expect(sent).not.toContain(NOT_FOUND_FRAGMENT);
    expect(sent).not.toContain(AMBIGUOUS_FRAGMENT);

    const card: JSONObject = (
      (context.sendActivity.mock.calls[0]![0] as JSONObject)[
        "attachments"
      ] as Array<JSONObject>
    )[0]!["content"] as JSONObject;

    expect(card["actions"]).toEqual([
      {
        type: "Action.OpenUrl",
        title: "Get started",
        url: "https://acme.test/docs/workspace-connections/microsoft-teams#connect-microsoft-teams",
      },
      {
        type: "Action.OpenUrl",
        title: "Sign up",
        url: "https://acme.test/accounts/register",
      },
    ]);
  });

  test("a misspelt command, in a tenant connected to no project: answered with the command it looks like, not refused", async () => {
    mockFindBy([]);
    const answerSpy: jest.SpyInstance = stubDownstreamReader(
      "answerObservabilityQuestion",
    );
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "incidnet Checkout is down" }),
      turnContext: context.turnContext,
    });

    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain("is not a command. Did you mean");
    expect(sent).not.toContain(NOT_FOUND_FRAGMENT);
    expect(answerSpy).not.toHaveBeenCalled();
  });

  test("a tenant connected to two projects replies with the AMBIGUOUS message and serves nothing", async () => {
    mockFindBy([buildProjectAuthRow(), buildProjectAuthRow()]);
    const findOneBySpy: jest.SpyInstance = spyOnFindOneBy();
    const listSpy: jest.SpyInstance = stubListCommand("a list");
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "show active incidents" }),
      turnContext: context.turnContext,
    });

    expect(context.sendActivity).toHaveBeenCalledTimes(1);
    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(AMBIGUOUS_FRAGMENT);
    // Refusing must not look like "not connected" - the remedies differ.
    expect(sent).not.toContain(NOT_FOUND_FRAGMENT);
    // ...and the user must not get either project's answer.
    expect(listSpy).not.toHaveBeenCalled();
    expect(findOneBySpy).not.toHaveBeenCalled();
  });

  test("help, in a tenant connected to two projects with nothing to tell which: answered - it reads nothing in either, as Slack answers /oneuptime help", async () => {
    mockFindBy([buildProjectAuthRow(), buildProjectAuthRow()]);
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "help" }),
      turnContext: context.turnContext,
    });

    expect(context.sendActivity).toHaveBeenCalledTimes(1);
    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(HELP_FRAGMENT);
    expect(sent).not.toContain(AMBIGUOUS_FRAGMENT);
  });

  test("a misspelt command, in a tenant connected to two projects: answered with the command it looks like, not refused", async () => {
    mockFindBy([buildProjectAuthRow(), buildProjectAuthRow()]);
    const misspellingSpy: jest.SpyInstance = jest.spyOn(
      MicrosoftTeamsCommands,
      "replyMisspelling",
    );
    const answerSpy: jest.SpyInstance = stubDownstreamReader(
      "answerObservabilityQuestion",
    );
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "incidnet Checkout is down" }),
      turnContext: context.turnContext,
    });

    expect(misspellingSpy).toHaveBeenCalledTimes(1);
    expect(joinedSentText(context.sendActivity)).not.toContain(
      AMBIGUOUS_FRAGMENT,
    );
    expect(answerSpy).not.toHaveBeenCalled();
  });

  test("a tenant whose only row has no projectId replies with the not-found message", async () => {
    mockFindBy([buildProjectAuthRow({ projectId: undefined })]);
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "oncall" }),
      turnContext: context.turnContext,
    });

    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(NOT_FOUND_FRAGMENT);
    expect(sent).not.toContain(HELP_FRAGMENT);
  });

  test("the tenant id from channelData is the one resolved", async () => {
    const resolveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue({
        projectAuth: buildProjectAuthRow(),
        isAmbiguous: false,
        candidateProjectIds: [ObjectID.generate()],
      });
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ tenantId: "tenant-from-activity" }),
      turnContext: context.turnContext,
    });

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    // With the clues the message carries: who sent it, and where.
    expect(resolveSpy).toHaveBeenCalledWith({
      tenantId: "tenant-from-activity",
      clues: {
        recordIds: [],
        channelId: undefined,
        workspaceUserId: AAD_OBJECT_ID,
      },
    });
  });

  test("a missing channelData.tenant.id replies about the organization and never resolves a tenant", async () => {
    const resolveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue({
        projectAuth: buildProjectAuthRow(),
        isAmbiguous: false,
        candidateProjectIds: [ObjectID.generate()],
      });
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ omitTenant: true }),
      turnContext: context.turnContext,
    });

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(context.sendActivity).toHaveBeenCalledTimes(1);
    expect(joinedSentText(context.sendActivity)).toContain(NO_TENANT_FRAGMENT);
  });
});

/*
 * This is the disclosure vector itself.
 *
 * handleBotMessageActivity serves incidents, alerts, scheduled maintenance and
 * AI assistant answers for the project the handler picked. The lists and the
 * assistant read as the member the sender's account is connected to in THAT
 * project (MicrosoftTeamsCommands.handleListCommand, WorkspaceOpenRecords),
 * so the project id the handler hands them decides whose records anybody
 * sees, and it must be exactly the projectId of the row
 * resolveProjectByTenantId returned.
 *
 * Resolving the right tenant and then reading a different project's data would
 * satisfy every other test in this file, which is why each reader is asserted
 * on its own argument here.
 */
describe("MicrosoftTeamsUtil.handleBotMessageActivity - the resolved project scopes every downstream read", () => {
  beforeEach(() => {
    stubChatCapture();
  });

  test('"show active incidents" reads incidents for the RESOLVED project', async () => {
    const projectAuth: WorkspaceProjectAuthToken = buildProjectAuthRow({
      projectId: ObjectID.generate(),
    });
    mockFindBy([projectAuth]);
    const readerSpy: jest.SpyInstance = stubListCommand(
      "incidents-of-the-resolved-project",
    );
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "show active incidents" }),
      turnContext: context.turnContext,
    });

    expect(readerSpy).toHaveBeenCalledTimes(1);
    expect(listCommandArgs(readerSpy).projectId.toString()).toBe(
      projectAuth.projectId?.toString(),
    );
    expect(listCommandArgs(readerSpy).listCommand).toBe(
      MicrosoftTeamsListCommand.ActiveIncidents,
    );
    // ...and the answer that came back is what the user was actually served.
    expect(joinedSentText(context.sendActivity)).toContain(
      "incidents-of-the-resolved-project",
    );
  });

  test('"show active alerts" reads alerts for the RESOLVED project', async () => {
    const projectAuth: WorkspaceProjectAuthToken = buildProjectAuthRow({
      projectId: ObjectID.generate(),
    });
    mockFindBy([projectAuth]);
    const readerSpy: jest.SpyInstance = stubListCommand(
      "alerts-of-the-resolved-project",
    );
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "show active alerts" }),
      turnContext: context.turnContext,
    });

    expect(readerSpy).toHaveBeenCalledTimes(1);
    expect(listCommandArgs(readerSpy).projectId.toString()).toBe(
      projectAuth.projectId?.toString(),
    );
    expect(listCommandArgs(readerSpy).listCommand).toBe(
      MicrosoftTeamsListCommand.ActiveAlerts,
    );
    expect(joinedSentText(context.sendActivity)).toContain(
      "alerts-of-the-resolved-project",
    );
  });

  test('"show scheduled maintenance" reads maintenance for the RESOLVED project', async () => {
    const projectAuth: WorkspaceProjectAuthToken = buildProjectAuthRow({
      projectId: ObjectID.generate(),
    });
    mockFindBy([projectAuth]);
    const readerSpy: jest.SpyInstance = stubListCommand(
      "maintenance-of-the-resolved-project",
    );
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "show scheduled maintenance" }),
      turnContext: context.turnContext,
    });

    expect(readerSpy).toHaveBeenCalledTimes(1);
    expect(listCommandArgs(readerSpy).projectId.toString()).toBe(
      projectAuth.projectId?.toString(),
    );
    expect(listCommandArgs(readerSpy).listCommand).toBe(
      MicrosoftTeamsListCommand.ScheduledMaintenance,
    );
    expect(joinedSentText(context.sendActivity)).toContain(
      "maintenance-of-the-resolved-project",
    );
  });

  test("a free-form question asks the AI assistant about the RESOLVED project", async () => {
    const question: string = "why did checkout latency spike last night";
    const projectAuth: WorkspaceProjectAuthToken = buildProjectAuthRow({
      projectId: ObjectID.generate(),
    });
    mockFindBy([projectAuth]);
    const answerSpy: jest.SpyInstance = stubDownstreamReader(
      "answerObservabilityQuestion",
    );
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: question }),
      turnContext: context.turnContext,
    });

    expect(answerSpy).toHaveBeenCalledTimes(1);
    const answerArgs: { projectId: ObjectID; question: string } = answerSpy.mock
      .calls[0]?.[0] as { projectId: ObjectID; question: string };
    expect(answerArgs.projectId.toString()).toBe(
      projectAuth.projectId?.toString(),
    );
    expect(answerArgs.question).toBe(question);
  });

  test("an AMBIGUOUS tenant reaches NONE of the readers", async () => {
    mockFindBy([buildProjectAuthRow(), buildProjectAuthRow()]);
    const listSpy: jest.SpyInstance = stubListCommand("a list");
    const answerSpy: jest.SpyInstance = stubDownstreamReader(
      "answerObservabilityQuestion",
    );

    const commands: Array<string> = [
      "show active incidents",
      "show active alerts",
      "show scheduled maintenance",
      "why did checkout latency spike last night",
    ];

    for (const text of commands) {
      const context: FakeTurnContext = buildTurnContext();

      await MicrosoftTeamsUtil.handleBotMessageActivity({
        activity: messageActivity({ text: text }),
        turnContext: context.turnContext,
      });

      expect(joinedSentText(context.sendActivity)).toContain(
        AMBIGUOUS_FRAGMENT,
      );
    }

    // Refusing has to stop the read, not just change the reply.
    expect(listSpy).not.toHaveBeenCalled();
    expect(answerSpy).not.toHaveBeenCalled();
  });
});

describe("MicrosoftTeamsUtil.handleBotInvokeActivity - tenant resolution", () => {
  test("the resolved project id is what the card click is authorized against", async () => {
    const projectId: ObjectID = ObjectID.generate();
    mockFindBy([buildProjectAuthRow({ projectId: projectId })]);
    const userLookupSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(ObjectID.generate());
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: invokeActivity(),
      turnContext: context.turnContext,
    });

    expect(userLookupSpy).toHaveBeenCalledTimes(1);
    const lookupArgs: { teamsUserId: string; projectId: ObjectID } =
      userLookupSpy.mock.calls[0]?.[0] as {
        teamsUserId: string;
        projectId: ObjectID;
      };
    expect(lookupArgs.teamsUserId).toBe(AAD_OBJECT_ID);
    expect(lookupArgs.projectId.toString()).toBe(projectId.toString());
  });

  test("a tenant with no rows replies with the not-found message and never looks the user up", async () => {
    mockFindBy([]);
    const userLookupSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(ObjectID.generate());
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: invokeActivity(),
      turnContext: context.turnContext,
    });

    expect(context.sendActivity).toHaveBeenCalledTimes(1);
    expect(joinedSentText(context.sendActivity)).toContain(NOT_FOUND_FRAGMENT);
    expect(userLookupSpy).not.toHaveBeenCalled();
  });

  test("a tenant connected to two projects replies with the AMBIGUOUS message and never resolves a project", async () => {
    mockFindBy([buildProjectAuthRow(), buildProjectAuthRow()]);
    const findOneBySpy: jest.SpyInstance = spyOnFindOneBy();
    const userLookupSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(ObjectID.generate());
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: invokeActivity(),
      turnContext: context.turnContext,
    });

    expect(context.sendActivity).toHaveBeenCalledTimes(1);
    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(AMBIGUOUS_FRAGMENT);
    expect(sent).not.toContain(NOT_FOUND_FRAGMENT);
    expect(userLookupSpy).not.toHaveBeenCalled();
    expect(findOneBySpy).not.toHaveBeenCalled();
  });

  test("a tenant whose only row has no projectId replies with the not-found message", async () => {
    mockFindBy([buildProjectAuthRow({ projectId: null })]);
    const userLookupSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(ObjectID.generate());
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: invokeActivity(),
      turnContext: context.turnContext,
    });

    expect(joinedSentText(context.sendActivity)).toContain(NOT_FOUND_FRAGMENT);
    expect(userLookupSpy).not.toHaveBeenCalled();
  });

  test("the tenant id from channelData is the one resolved", async () => {
    const resolveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue({
        projectAuth: buildProjectAuthRow(),
        isAmbiguous: false,
        candidateProjectIds: [ObjectID.generate()],
      });
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(ObjectID.generate());
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: invokeActivity({ tenantId: "tenant-from-invoke" }),
      turnContext: context.turnContext,
    });

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    // With the clues the card carries: its record, who pressed, and where.
    expect(resolveSpy).toHaveBeenCalledWith({
      tenantId: "tenant-from-invoke",
      clues: {
        recordIds: ["some-id"],
        channelId: undefined,
        workspaceUserId: AAD_OBJECT_ID,
      },
    });
  });

  test("a missing channelData.tenant.id replies about the organization and never resolves a tenant", async () => {
    const resolveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue({
        projectAuth: buildProjectAuthRow(),
        isAmbiguous: false,
        candidateProjectIds: [ObjectID.generate()],
      });
    const userLookupSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(ObjectID.generate());
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: invokeActivity({ omitTenant: true }),
      turnContext: context.turnContext,
    });

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(userLookupSpy).not.toHaveBeenCalled();
    expect(context.sendActivity).toHaveBeenCalledTimes(1);
    expect(joinedSentText(context.sendActivity)).toContain(NO_TENANT_FRAGMENT);
  });

  test("an empty channelData.tenant object is treated as a missing tenant id", async () => {
    const resolveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue({
        projectAuth: buildProjectAuthRow(),
        isAmbiguous: false,
        candidateProjectIds: [ObjectID.generate()],
      });
    const activity: JSONObject = invokeActivity();
    (activity["channelData"] as JSONObject)["tenant"] = {};
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: activity,
      turnContext: context.turnContext,
    });

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(joinedSentText(context.sendActivity)).toContain(NO_TENANT_FRAGMENT);
  });
});

/*
 * ONE ORGANIZATION, SEVERAL PROJECTS - TOLD APART BY WHAT THE ACTIVITY CARRIES.
 *
 * A Slack customer's incident buttons were read in the wrong one of two
 * projects; the same organization on Microsoft Teams was refused outright.
 * Every Teams activity now acts as the member the sender's account is
 * connected to, with their own permissions, so a tenant connected to
 * several projects is told apart by the activity itself - the record a
 * card's button is about, the channel it was sent in, the one project the
 * sender is in - and refused only when none of those tells.
 */
describe("MicrosoftTeamsUtil - a tenant connected to several projects, told apart by the activity", () => {
  const PRODUCTION: ObjectID = new ObjectID(
    "f1000000-0000-4000-8000-000000000001",
  );
  const STAGING: ObjectID = new ObjectID(
    "f1000000-0000-4000-8000-000000000002",
  );
  const MEMBER: ObjectID = new ObjectID("f1000000-0000-4000-8000-0000000000a1");
  const INCIDENT: ObjectID = new ObjectID(
    "f1000000-0000-4000-8000-0000000000b1",
  );

  function linkSender(projectIds: Array<ObjectID>): void {
    jest.spyOn(WorkspaceUserAuthTokenService, "findBy").mockResolvedValue(
      projectIds.map((projectId: ObjectID): WorkspaceUserAuthToken => {
        const link: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        link.projectId = projectId;
        link.userId = MEMBER;
        return link;
      }),
    );
    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockResolvedValue(true);
  }

  test("resolveProjectByTenantId without clues still refuses two projects", async () => {
    mockFindBy([
      buildProjectAuthRow({ projectId: PRODUCTION }),
      buildProjectAuthRow({ projectId: STAGING }),
    ]);

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
      });

    expect(resolution.projectAuth).toBeNull();
    expect(resolution.isAmbiguous).toBe(true);
    expect(resolution.resolution).toBeUndefined();
  });

  test("the sender, a member of one of the two: that project, and the message is answered there", async () => {
    mockFindBy([
      buildProjectAuthRow({ projectId: PRODUCTION }),
      buildProjectAuthRow({ projectId: STAGING }),
    ]);
    linkSender([STAGING]);
    const listSpy: jest.SpyInstance = stubListCommand("a list");
    stubChatCapture();

    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "show active incidents" }),
      turnContext: context.turnContext,
    });

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listCommandArgs(listSpy).projectId.toString()).toBe(
      STAGING.toString(),
    );
    expect(joinedSentText(context.sendActivity)).not.toContain(
      AMBIGUOUS_FRAGMENT,
    );
  });

  test("a card's button acts in its record's project, whatever the sender is in", async () => {
    mockFindBy([
      buildProjectAuthRow({ projectId: PRODUCTION }),
      buildProjectAuthRow({ projectId: STAGING }),
    ]);
    // Records of the other kinds a button can name: none with that id.
    for (const service of [
      AlertService,
      AlertEpisodeService,
      IncidentEpisodeService,
      MonitorService,
      OnCallDutyPolicyService,
      ScheduledMaintenanceService,
    ] as unknown as Array<{ findOneBy: () => Promise<unknown> }>) {
      jest.spyOn(service, "findOneBy").mockResolvedValue(null as never);
    }

    // The incident is the production project's.
    jest.spyOn(IncidentService, "findOneBy").mockImplementation((async () => {
      const incident: Incident = new Incident();
      incident.id = INCIDENT;
      incident.projectId = PRODUCTION;
      return incident;
    }) as never);
    const userLookupSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(MEMBER);

    const activity: JSONObject = invokeActivity();
    activity["value"] = {
      action: "AcknowledgeIncident",
      actionValue: INCIDENT.toString(),
    };

    const resolution: MicrosoftTeamsTenantResolution =
      await MicrosoftTeamsUtil.resolveProjectByTenantId({
        tenantId: TENANT_ID,
        clues: MicrosoftTeamsUtil.getProjectClues({
          activity: activity,
          actionValue: INCIDENT.toString(),
        }),
      });

    expect(resolution.projectAuth?.projectId?.toString()).toBe(
      PRODUCTION.toString(),
    );
    expect(resolution.isAmbiguous).toBe(false);
    expect(resolution.resolution?.decidedBy).toBe(
      WorkspaceProjectEvidence.Record,
    );

    // Through the entry point: the press is authorized in that project.
    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: activity,
      turnContext: buildTurnContext().turnContext,
    });

    expect(
      (
        userLookupSpy.mock.calls[0]?.[0] as { projectId: ObjectID }
      ).projectId.toString(),
    ).toBe(PRODUCTION.toString());
  });

  /*
   * Somebody in both is asked which, with a button for each (below); when
   * that cannot be asked - here, the cache that keeps the request is down -
   * they are answered as before.
   */
  test("a member of both, in a personal chat, when the question cannot be asked: told so, the projects named, and nothing is read in either", async () => {
    mockFindBy([
      buildProjectAuthRow({ projectId: PRODUCTION }),
      buildProjectAuthRow({ projectId: STAGING }),
    ]);
    linkSender([PRODUCTION, STAGING]);
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("connection refused"));
    jest.spyOn(ProjectService, "findBy").mockImplementation((async () => {
      return [
        [PRODUCTION, "Production"],
        [STAGING, "Staging"],
      ].map((entry: Array<ObjectID | string>): Project => {
        const project: Project = new Project();
        project.id = entry[0] as ObjectID;
        project.name = entry[1] as string;
        return project;
      });
    }) as never);
    const listSpy: jest.SpyInstance = stubListCommand("a list");
    stubChatCapture();

    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "show active incidents" }),
      turnContext: context.turnContext,
    });

    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(AMBIGUOUS_FRAGMENT);
    expect(sent).toContain("Production");
    expect(sent).toContain("Staging");
    expect(sent).toContain(
      "try it again in a channel of the project you mean, such as one of its incident channels.",
    );
    expect(listSpy).not.toHaveBeenCalled();
  });

  test("a member of both asks a question in a personal chat, when the question cannot be asked: told to ask again in a channel of the project they mean - AI is not asked", async () => {
    mockFindBy([
      buildProjectAuthRow({ projectId: PRODUCTION }),
      buildProjectAuthRow({ projectId: STAGING }),
    ]);
    linkSender([PRODUCTION, STAGING]);
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("connection refused"));
    jest.spyOn(ProjectService, "findBy").mockImplementation((async () => {
      return [
        [PRODUCTION, "Production"],
        [STAGING, "Staging"],
      ].map((entry: Array<ObjectID | string>): Project => {
        const project: Project = new Project();
        project.id = entry[0] as ObjectID;
        project.name = entry[1] as string;
        return project;
      });
    }) as never);
    const answerSpy: jest.SpyInstance = stubDownstreamReader(
      "answerObservabilityQuestion",
    );
    stubChatCapture();

    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "which monitors are down?" }),
      turnContext: context.turnContext,
    });

    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(AMBIGUOUS_FRAGMENT);
    expect(sent).toContain(
      "ask again in a channel of the project you mean, such as one of its incident channels.",
    );
    expect(sent).not.toContain("try it again");
    expect(answerSpy).not.toHaveBeenCalled();
  });

  test("getTenantResolutionFailureMessage says what to do, not to disconnect a project", () => {
    const message: string =
      MicrosoftTeamsUtil.getTenantResolutionFailureMessage({
        projectAuth: null,
        isAmbiguous: true,
        candidateProjectIds: [PRODUCTION, STAGING],
      });

    expect(message).toContain(AMBIGUOUS_FRAGMENT);
    expect(message).toContain(
      "Try it again in a channel of the project you mean",
    );
    expect(message).not.toContain("disconnect");
  });

  test("it starts with the lead the clued answer starts with, word for word", () => {
    const message: string =
      MicrosoftTeamsUtil.getTenantResolutionFailureMessage({
        projectAuth: null,
        isAmbiguous: true,
        candidateProjectIds: [PRODUCTION, STAGING],
      });

    expect(
      message.startsWith(`${WorkspaceProjectResolver.TEAMS_AMBIGUOUS_LEAD}, `),
    ).toBe(true);
  });
});

/*
 * ASKED WHICH PROJECT, WITH A BUTTON FOR EACH, AND MADE AGAIN IN THE ONE
 * CHOSEN.
 *
 * Somebody in two of an organization's projects, in their chat with the
 * bot - where no channel tells which - was told to try again from a channel
 * of the project they meant. Now they are asked which: a card that mentions
 * them, with a button for each project they are in, and the request is made
 * again in the one they press, as their member there, read in full again.
 * These drive the bot's own entry point with Teams' shapes - a typed
 * message, then the card's Action.Submit, which Teams sends as a message
 * with a value - and pin what each reader is handed, every press that must
 * make nothing, and the text answer that stays when the card cannot be
 * offered. MicrosoftTeamsProjectChoiceEndToEnd.test.ts sends the same
 * through the real botbuilder stack.
 */
describe("MicrosoftTeamsUtil - asked which project, with a button for each, and made again in the one chosen", () => {
  const PRODUCTION: ObjectID = new ObjectID(
    "f2000000-0000-4000-8000-000000000001",
  );
  const STAGING: ObjectID = new ObjectID("f2000000-0000-4000-8000-000000000002");
  const SANDBOX: ObjectID = new ObjectID("f2000000-0000-4000-8000-000000000003");
  const MEMBER: ObjectID = new ObjectID("f2000000-0000-4000-8000-0000000000a1");
  const NITIN_AAD_OBJECT_ID: string = "aad-object-id-nitin";
  const PERSONAL_CHAT_ID: string = "a:personal-chat-with-the-bot";
  const CHANNEL_THREAD_ID: string = "19:general@thread.tacv2;messageid=1001";

  const NAMES: Record<string, string> = {
    [PRODUCTION.toString()]: "Production",
    [STAGING.toString()]: "Staging",
    [SANDBOX.toString()]: "Sandbox",
  };

  const QUESTION_FRAGMENT: string = "**Which project is this for?**";
  const GONE: string =
    "This choice has expired, or was already made. Please try again.";
  const NOT_THEIRS: string =
    "Only the person who asked can choose which project this is for.";

  let connected: Array<ObjectID>;
  let linkedIn: Array<ObjectID>;
  let memberOf: Array<ObjectID>;
  let kept: Map<string, string>;
  let activityNumber: number = 0;

  interface Turn {
    turnContext: TurnContext;
    sent: Array<JSONObject>;
    updated: Array<JSONObject>;
  }

  function isSame(a: ObjectID | string, b: ObjectID | string): boolean {
    return a.toString().toLowerCase() === b.toString().toLowerCase();
  }

  function nextId(label: string): string {
    activityNumber++;
    return `choice-${label}-${activityNumber}-${ObjectID.generate().toString().substring(0, 8)}`;
  }

  // Something Deane types: in his chat with the bot, or in a channel post.
  function typed(
    text: string,
    where: "personal" | "channel" = "personal",
  ): JSONObject {
    const inChannel: boolean = where === "channel";

    return {
      type: "message",
      id: nextId("typed"),
      text: inChannel ? `<at>OneUptime</at> ${text}` : text,
      from: { id: "29:deane", name: "Deane", aadObjectId: AAD_OBJECT_ID },
      recipient: { id: BOT_RECIPIENT_ID, name: "OneUptime" },
      conversation: inChannel
        ? {
            conversationType: "channel",
            id: CHANNEL_THREAD_ID,
            tenantId: TENANT_ID,
          }
        : {
            conversationType: "personal",
            id: PERSONAL_CHAT_ID,
            tenantId: TENANT_ID,
          },
      channelData: inChannel
        ? {
            tenant: { id: TENANT_ID },
            team: { id: "19:team@thread.tacv2" },
            channel: { id: "19:general@thread.tacv2" },
          }
        : { tenant: { id: TENANT_ID } },
      serviceUrl: TURN_CONTEXT_SERVICE_URL,
      entities: inChannel
        ? [
            {
              type: "mention",
              text: "<at>OneUptime</at>",
              mentioned: { id: BOT_RECIPIENT_ID, name: "OneUptime" },
            },
          ]
        : [],
    };
  }

  // A press of a card's button, as Teams sends it: a message with a value.
  function pressed(
    value: JSONObject,
    options?: {
      from?: JSONObject | undefined;
      replyToId?: string | undefined;
      conversationId?: string | undefined;
    },
  ): JSONObject {
    return {
      type: "message",
      id: nextId("press"),
      replyToId: options?.replyToId || "the-question-card",
      value: value,
      from: options?.from || {
        id: "29:deane",
        name: "Deane",
        aadObjectId: AAD_OBJECT_ID,
      },
      recipient: { id: BOT_RECIPIENT_ID, name: "OneUptime" },
      conversation: {
        conversationType: "personal",
        id: options?.conversationId || PERSONAL_CHAT_ID,
        tenantId: TENANT_ID,
      },
      channelData: { tenant: { id: TENANT_ID } },
      serviceUrl: TURN_CONTEXT_SERVICE_URL,
      entities: [],
    };
  }

  function turnFor(activity: JSONObject): Turn {
    const sent: Array<JSONObject> = [];
    const updated: Array<JSONObject> = [];

    const turnContext: TurnContext = {
      activity: activity,
      sendActivity: jest.fn(async (reply: unknown): Promise<JSONObject> => {
        sent.push(
          typeof reply === "string" ? { text: reply } : (reply as JSONObject),
        );
        return { id: `sent-${sent.length}` };
      }),
      updateActivity: jest.fn(async (reply: unknown): Promise<void> => {
        updated.push(reply as JSONObject);
      }),
    } as unknown as TurnContext;

    return { turnContext, sent, updated };
  }

  async function deliver(activity: JSONObject): Promise<Turn> {
    const turn: Turn = turnFor(activity);

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: activity,
      turnContext: turn.turnContext,
    });

    return turn;
  }

  function cardOf(reply: JSONObject | undefined): JSONObject | null {
    const attachments: Array<JSONObject> | undefined = reply?.[
      "attachments"
    ] as Array<JSONObject> | undefined;

    return (attachments?.[0]?.["content"] as JSONObject | undefined) || null;
  }

  function textOf(reply: JSONObject | undefined): string {
    const card: JSONObject | null = cardOf(reply);

    if (!card) {
      return String(reply?.["text"] || "");
    }

    return (card["body"] as Array<JSONObject>)
      .filter((element: JSONObject): boolean => {
        return element["type"] === "TextBlock";
      })
      .map((element: JSONObject): string => {
        return String(element["text"]);
      })
      .join("\n");
  }

  // The buttons of the question Deane was asked, with what each carries.
  function choicesOf(
    reply: JSONObject | undefined,
  ): Array<{ title: string; value: JSONObject }> {
    const card: JSONObject | null = cardOf(reply);

    expect(card).not.toBeNull();
    expect(textOf(reply)).toContain(QUESTION_FRAGMENT);

    return (card!["body"] as Array<JSONObject>)
      .filter((element: JSONObject): boolean => {
        return element["type"] === "ActionSet";
      })
      .map((set: JSONObject): { title: string; value: JSONObject } => {
        const button: JSONObject = (set["actions"] as Array<JSONObject>)[0]!;

        expect(button["type"]).toBe("Action.Submit");

        return {
          title: String(button["title"]),
          value: button["data"] as JSONObject,
        };
      });
  }

  function buttonFor(
    reply: JSONObject | undefined,
    name: string,
  ): JSONObject {
    const choice: { title: string; value: JSONObject } | undefined =
      choicesOf(reply).find((candidate: { title: string }): boolean => {
        return candidate.title === name;
      });

    expect(choice).toBeDefined();

    return choice!.value;
  }

  beforeEach(() => {
    connected = [PRODUCTION, STAGING];
    linkedIn = [PRODUCTION, STAGING];
    memberOf = [PRODUCTION, STAGING];
    kept = new Map<string, string>();

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockImplementation((async () => {
        return connected.map(
          (projectId: ObjectID): WorkspaceProjectAuthToken => {
            return buildProjectAuthRow({ projectId: projectId });
          },
        );
      }) as never);

    // Deane's Microsoft Teams account is connected; Nitin's in none.
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockImplementation((async (args: { query: JSONObject }) => {
        if (args.query["workspaceUserId"] !== AAD_OBJECT_ID) {
          return [];
        }

        return linkedIn.map((projectId: ObjectID): WorkspaceUserAuthToken => {
          const link: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
          link.projectId = projectId;
          link.userId = MEMBER;
          return link;
        });
      }) as never);
    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockImplementation((async (data: { projectId: ObjectID }) => {
        return memberOf.some((projectId: ObjectID): boolean => {
          return isSame(projectId, data.projectId);
        });
      }) as never);
    jest.spyOn(ProjectService, "findBy").mockImplementation((async () => {
      return Object.entries(NAMES).map((entry: [string, string]): Project => {
        const project: Project = new Project();
        project.id = new ObjectID(entry[0]);
        project.name = entry[1];
        return project;
      });
    }) as never);

    // Where the bot keeps what a question is for: Redis, here a map.
    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation((async (
        namespace: string,
        key: string,
        value: string,
      ) => {
        kept.set(`${namespace}-${key}`, value);
      }) as never);
    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation((async (namespace: string, key: string) => {
        return kept.get(`${namespace}-${key}`) ?? null;
      }) as never);
    jest
      .spyOn(GlobalCache, "getAndDeleteString")
      .mockImplementation((async (namespace: string, key: string) => {
        const value: string | null = kept.get(`${namespace}-${key}`) ?? null;
        kept.delete(`${namespace}-${key}`);
        return value;
      }) as never);

    // The channel: one no project owns or posts to - it tells nothing.
    jest
      .spyOn(WorkspaceProjectResolver, "findProjectsOfChannel")
      .mockResolvedValue([]);

    // A press that reads a project does it as Deane's member there.
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(MEMBER);
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation((async (data: { projectId: ObjectID }) => {
        return { userId: MEMBER, tenantId: data.projectId };
      }) as never);

    stubChatCapture();
  });

  test("a command nothing ties to one project: one card that mentions Deane, a button for each project he is in, in the order they were connected - nothing read in either", async () => {
    const listSpy: jest.SpyInstance = stubListCommand("a list");

    const turn: Turn = await deliver(typed("show active incidents"));

    expect(turn.sent).toHaveLength(1);
    expect(
      choicesOf(turn.sent[0]).map((choice: { title: string }): string => {
        return choice.title;
      }),
    ).toEqual(["Production", "Staging"]);
    expect(textOf(turn.sent[0])).toBe(
      "<at>Deane</at> **Which project is this for?** This Microsoft 365 organization is connected to more than one OneUptime project, and I can't tell which one you mean here.",
    );
    expect(turn.sent[0]!["summary"]).toBe(
      "Which project is this for: Production or Staging?",
    );
    // The question, not the text answer: no names to type, no channel to find.
    expect(textOf(turn.sent[0])).not.toContain("try it again");
    expect(listSpy).not.toHaveBeenCalled();
  });

  test("Deane presses Staging: the question becomes what he chose, and the list is read there, as he typed it", async () => {
    const listSpy: jest.SpyInstance = stubListCommand("staging's incidents");
    const command: JSONObject = typed("show active incidents");
    const asked: Turn = await deliver(command);

    const chosen: Turn = await deliver(
      pressed(buttonFor(asked.sent[0], "Staging"), {
        replyToId: "the-question-card",
      }),
    );

    // The card he pressed, edited in place.
    expect(chosen.updated).toHaveLength(1);
    expect(chosen.updated[0]!["id"]).toBe("the-question-card");
    expect(textOf(chosen.updated[0])).toBe(
      "<at>Deane</at> Going ahead in **Staging**.",
    );

    // The command, made again in the project he chose.
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listCommandArgs(listSpy).projectId.toString()).toBe(
      STAGING.toString(),
    );
    expect(listCommandArgs(listSpy).listCommand).toBe(
      MicrosoftTeamsListCommand.ActiveIncidents,
    );
    expect(
      (listSpy.mock.calls[0]?.[0] as { activity: JSONObject }).activity[
        "text"
      ],
    ).toBe("show active incidents");
    expect(joinedSentText(chosen.turnContext.sendActivity as jest.Mock)).toContain(
      "staging's incidents",
    );
  });

  test("pressing Production instead: read there", async () => {
    const listSpy: jest.SpyInstance = stubListCommand("a list");
    const asked: Turn = await deliver(typed("show active incidents"));

    await deliver(pressed(buttonFor(asked.sent[0], "Production")));

    expect(listCommandArgs(listSpy).projectId.toString()).toBe(
      PRODUCTION.toString(),
    );
  });

  test("a second press - the other button, or the same again - makes nothing again: told the choice is gone", async () => {
    const listSpy: jest.SpyInstance = stubListCommand("a list");
    const asked: Turn = await deliver(typed("show active incidents"));

    await deliver(pressed(buttonFor(asked.sent[0], "Staging")));

    for (const name of ["Staging", "Production"]) {
      const again: Turn = await deliver(
        pressed(buttonFor(asked.sent[0], name)),
      );

      expect(again.updated).toEqual([]);
      expect(again.sent).toHaveLength(1);
      expect(textOf(again.sent[0])).toBe(`<at>Deane</at> ${GONE}`);
    }

    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  test("somebody else pressing Deane's button makes nothing, and is told only Deane can choose - Deane still can", async () => {
    const listSpy: jest.SpyInstance = stubListCommand("a list");
    const asked: Turn = await deliver(typed("show active incidents", "channel"));
    const staging: JSONObject = buttonFor(asked.sent[0], "Staging");

    const nitins: Turn = await deliver(
      pressed(staging, {
        from: { id: "29:nitin", name: "Nitin", aadObjectId: NITIN_AAD_OBJECT_ID },
        conversationId: CHANNEL_THREAD_ID,
      }),
    );

    expect(nitins.updated).toEqual([]);
    expect(nitins.sent).toHaveLength(1);
    expect(textOf(nitins.sent[0])).toBe(`<at>Nitin</at> ${NOT_THEIRS}`);
    expect(listSpy).not.toHaveBeenCalled();

    await deliver(pressed(staging, { conversationId: CHANNEL_THREAD_ID }));

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listCommandArgs(listSpy).projectId.toString()).toBe(
      STAGING.toString(),
    );
  });

  test("a press edited to name a project the card did not offer makes nothing - and Deane can still choose", async () => {
    const listSpy: jest.SpyInstance = stubListCommand("a list");
    connected = [PRODUCTION, STAGING, SANDBOX];
    const asked: Turn = await deliver(typed("show active incidents"));
    const staging: JSONObject = buttonFor(asked.sent[0], "Staging");
    const token: string = WorkspaceProjectChoiceStore.readChoice(
      staging["actionValue"],
    )!.token;

    const edited: Turn = await deliver(
      pressed({
        ...staging,
        actionValue: WorkspaceProjectChoiceStore.getChoiceValue({
          projectId: SANDBOX,
          token: token,
        }),
      }),
    );

    expect(textOf(edited.sent[0])).toBe(`<at>Deane</at> ${GONE}`);
    expect(edited.updated).toEqual([]);
    expect(listSpy).not.toHaveBeenCalled();

    await deliver(pressed(staging));

    expect(listCommandArgs(listSpy).projectId.toString()).toBe(
      STAGING.toString(),
    );
  });

  test("a press after the half hour the question is kept, or of a question never asked, makes nothing", async () => {
    const listSpy: jest.SpyInstance = stubListCommand("a list");
    const asked: Turn = await deliver(typed("show active incidents"));
    const staging: JSONObject = buttonFor(asked.sent[0], "Staging");

    // Thirty minutes on: Redis has let it go.
    kept.clear();

    const late: Turn = await deliver(pressed(staging));
    const forged: Turn = await deliver(
      pressed({
        action: "choose-project",
        actionValue: `${STAGING.toString()}:${"A".repeat(43)}`,
      }),
    );

    for (const turn of [late, forged]) {
      expect(textOf(turn.sent[0])).toBe(`<at>Deane</at> ${GONE}`);
      expect(turn.updated).toEqual([]);
    }

    expect(listSpy).not.toHaveBeenCalled();
  });

  test("a question for OneUptime AI: answered in the project Deane chooses - and its follow-ups in the chat there too, without asking again", async () => {
    const answerSpy: jest.SpyInstance = stubDownstreamReader(
      "answerObservabilityQuestion",
    );
    const asked: Turn = await deliver(typed("which monitors are down?"));

    expect(answerSpy).not.toHaveBeenCalled();

    await deliver(pressed(buttonFor(asked.sent[0], "Staging")));

    expect(answerSpy).toHaveBeenCalledTimes(1);
    expect(
      (answerSpy.mock.calls[0]?.[0] as { projectId: ObjectID }).projectId.toString(),
    ).toBe(STAGING.toString());
    expect(
      (answerSpy.mock.calls[0]?.[0] as { question: string }).question,
    ).toBe("which monitors are down?");

    const followUp: Turn = await deliver(typed("and why is checkout slow?"));

    expect(followUp.sent).toEqual([]);
    expect(answerSpy).toHaveBeenCalledTimes(2);
    expect(
      (answerSpy.mock.calls[1]?.[0] as { projectId: ObjectID }).projectId.toString(),
    ).toBe(STAGING.toString());
  });

  test("the choice is the conversation's: a question in another conversation is asked again, and so is a command in this one", async () => {
    const answerSpy: jest.SpyInstance = stubDownstreamReader(
      "answerObservabilityQuestion",
    );
    const listSpy: jest.SpyInstance = stubListCommand("a list");
    const asked: Turn = await deliver(typed("which monitors are down?"));

    await deliver(pressed(buttonFor(asked.sent[0], "Staging")));

    const elsewhere: Turn = await deliver(
      typed("and why is checkout slow?", "channel"),
    );

    expect(choicesOf(elsewhere.sent[0])).toHaveLength(2);

    const command: Turn = await deliver(typed("show active incidents"));

    expect(choicesOf(command.sent[0])).toHaveLength(2);
    expect(answerSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).not.toHaveBeenCalled();
  });

  test("a follow-up after Deane was removed from the project he chose is asked again - never answered there", async () => {
    const answerSpy: jest.SpyInstance = stubDownstreamReader(
      "answerObservabilityQuestion",
    );
    connected = [PRODUCTION, STAGING, SANDBOX];
    linkedIn = [PRODUCTION, STAGING, SANDBOX];
    memberOf = [PRODUCTION, STAGING];
    const asked: Turn = await deliver(typed("which monitors are down?"));

    await deliver(pressed(buttonFor(asked.sent[0], "Staging")));

    // Removed from Staging, a member of Sandbox since.
    memberOf = [PRODUCTION, SANDBOX];

    const followUp: Turn = await deliver(typed("and why?"));

    expect(
      choicesOf(followUp.sent[0]).map((choice: { title: string }): string => {
        return choice.title;
      }),
    ).toEqual(["Production", "Sandbox"]);
    expect(answerSpy).toHaveBeenCalledTimes(1);
  });

  test("a Home button that names no project - a Home sent before cards carried theirs - asks which, and declares the incident in the one chosen", async () => {
    const declareSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsCreateCommands, "handleCreateIncidentCommand")
      .mockResolvedValue(undefined);

    const asked: Turn = await deliver(
      pressed(
        {
          action: MicrosoftTeamsHomeActionType.DeclareIncident,
          actionValue: "",
        },
        { replyToId: "deanes-home-card" },
      ),
    );

    expect(declareSpy).not.toHaveBeenCalled();

    await deliver(pressed(buttonFor(asked.sent[0], "Production")));

    expect(declareSpy).toHaveBeenCalledTimes(1);

    const declared: { projectId: ObjectID; activity: JSONObject } = declareSpy
      .mock.calls[0]?.[0] as { projectId: ObjectID; activity: JSONObject };

    expect(declared.projectId.toString()).toBe(PRODUCTION.toString());
    // The Home press itself, made again: its card and its button.
    expect(declared.activity["replyToId"]).toBe("deanes-home-card");
    expect(declared.activity["value"]).toEqual({
      action: MicrosoftTeamsHomeActionType.DeclareIncident,
      actionValue: "",
    });
  });

  test("a form's submission that names no project is not made again - its fields were filled in for one project: answered as before", async () => {
    const incidentSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsIncidentActions, "handleBotIncidentAction")
      .mockResolvedValue(undefined);

    const turn: Turn = await deliver(
      pressed({ action: "SubmitNewIncident", incidentTitle: "Checkout" }),
    );

    expect(turn.sent).toHaveLength(1);
    expect(textOf(turn.sent[0])).not.toContain(QUESTION_FRAGMENT);
    expect(textOf(turn.sent[0])).toContain(AMBIGUOUS_FRAGMENT);
    expect(kept.size).toBe(0);
    expect(incidentSpy).not.toHaveBeenCalled();
  });

  test("a form sent for a project carries it: its submission is read there, without asking", async () => {
    const incidentSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsIncidentActions, "handleBotIncidentAction")
      .mockResolvedValue(undefined);

    const turn: Turn = await deliver(
      pressed({
        action: "SubmitNewIncident",
        incidentTitle: "Checkout",
        [DRAWN_FOR_PROJECT_ID_FIELD]: STAGING.toString(),
      }),
    );

    expect(turn.sent).toEqual([]);
    expect(incidentSpy).toHaveBeenCalledTimes(1);
    expect(
      (incidentSpy.mock.calls[0]?.[0] as { projectId: ObjectID }).projectId.toString(),
    ).toBe(STAGING.toString());
  });

  test("a card sent for a project the organization is no longer connected to tells nothing: asked again", async () => {
    const incidentSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsIncidentActions, "handleBotIncidentAction")
      .mockResolvedValue(undefined);

    const turn: Turn = await deliver(
      pressed({
        action: "SubmitNewIncident",
        [DRAWN_FOR_PROJECT_ID_FIELD]: SANDBOX.toString(),
      }),
    );

    expect(textOf(turn.sent[0])).toContain(AMBIGUOUS_FRAGMENT);
    expect(incidentSpy).not.toHaveBeenCalled();
  });

  test("the project Deane chose, disconnected from the organization before he pressed: nothing is made, in it or in another", async () => {
    const listSpy: jest.SpyInstance = stubListCommand("a list");
    connected = [PRODUCTION, STAGING, SANDBOX];
    linkedIn = [PRODUCTION, STAGING, SANDBOX];
    memberOf = [PRODUCTION, STAGING, SANDBOX];
    const asked: Turn = await deliver(typed("show active incidents"));

    connected = [PRODUCTION, SANDBOX];

    const chosen: Turn = await deliver(
      pressed(buttonFor(asked.sent[0], "Staging")),
    );

    expect(textOf(chosen.sent[chosen.sent.length - 1])).toBe(
      `<at>Deane</at> ${GONE}`,
    );
    expect(listSpy).not.toHaveBeenCalled();
  });

  test("removed from the project he chose between the question and his press: told so, as any request is - nothing is read", async () => {
    const listSpy: jest.SpyInstance = jest.spyOn(
      MicrosoftTeamsCommands,
      "handleListCommand",
    );
    const readAs: jest.SpyInstance = jest.spyOn(
      WorkspaceOpenRecords,
      "getListAnswer",
    );
    const asked: Turn = await deliver(typed("show active incidents"));

    // Removed from Staging since: his membership is read again, there.
    memberOf = [PRODUCTION];
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation((async (data: { projectId: ObjectID }) => {
        if (isSame(data.projectId, STAGING)) {
          throw new NotAuthorizedException(
            "You are not a member of this project.",
          );
        }

        return { userId: MEMBER, tenantId: data.projectId };
      }) as never);

    const chosen: Turn = await deliver(
      pressed(buttonFor(asked.sent[0], "Staging")),
    );

    // Made again there, as Deane: refused by his membership, read again.
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listCommandArgs(listSpy).projectId.toString()).toBe(
      STAGING.toString(),
    );
    expect(textOf(chosen.sent[chosen.sent.length - 1])).toContain(
      "You are not a member of this project.",
    );
    expect(readAs).not.toHaveBeenCalled();
  });

  describe("when the card cannot be offered, the answer that names the projects stays", () => {
    test("the projects cannot be named: no buttons without names", async () => {
      jest
        .spyOn(ProjectService, "findBy")
        .mockRejectedValue(new Error("db is down") as never);
      const listSpy: jest.SpyInstance = stubListCommand("a list");

      const turn: Turn = await deliver(typed("show active incidents"));

      expect(turn.sent).toHaveLength(1);
      expect(textOf(turn.sent[0])).not.toContain(QUESTION_FRAGMENT);
      expect(textOf(turn.sent[0])).toContain(
        `${WorkspaceProjectResolver.TEAMS_AMBIGUOUS_LEAD}, so I can't tell which one you mean here.`,
      );
      expect(listSpy).not.toHaveBeenCalled();
    });

    test("the request cannot be kept - the cache is down: the projects named, and where to try again", async () => {
      jest
        .spyOn(GlobalCache, "setString")
        .mockRejectedValue(new Error("connection refused") as never);

      const turn: Turn = await deliver(typed("show active incidents"));

      expect(turn.sent).toHaveLength(1);
      expect(textOf(turn.sent[0])).toBe(
        `<at>Deane</at> ${WorkspaceProjectResolver.TEAMS_AMBIGUOUS_LEAD}, so I can't tell which one you mean here. You're in **Production** and **Staging**: try it again in a channel of the project you mean, such as one of its incident channels.`,
      );
    });

    test("more projects than a card lists", async () => {
      const many: Array<ObjectID> = Array.from(
        { length: WorkspaceProjectChoiceStore.MAX_CHOICES + 1 },
        (): ObjectID => {
          return ObjectID.generate();
        },
      );
      connected = many;
      linkedIn = many;
      memberOf = many;
      jest.spyOn(ProjectService, "findBy").mockImplementation((async () => {
        return many.map((projectId: ObjectID, index: number): Project => {
          const project: Project = new Project();
          project.id = projectId;
          project.name = `Project ${index + 1}`;
          return project;
        });
      }) as never);

      const turn: Turn = await deliver(typed("show active incidents"));

      expect(textOf(turn.sent[0])).not.toContain(QUESTION_FRAGMENT);
      expect(textOf(turn.sent[0])).toContain(AMBIGUOUS_FRAGMENT);
      expect(kept.size).toBe(0);
    });

    test("somebody connected in none of the projects is told where to connect - not which project", async () => {
      linkedIn = [];

      const turn: Turn = await deliver(typed("show active incidents"));

      expect(textOf(turn.sent[0])).not.toContain(QUESTION_FRAGMENT);
      expect(textOf(turn.sent[0])).toContain(
        "your Microsoft Teams account isn't connected in any of them yet",
      );
      expect(kept.size).toBe(0);
    });

    test("somebody in only one of the projects is never asked: answered there", async () => {
      const listSpy: jest.SpyInstance = stubListCommand("a list");
      memberOf = [PRODUCTION];

      const turn: Turn = await deliver(typed("show active incidents"));

      expect(textOf(turn.sent[0])).not.toContain(QUESTION_FRAGMENT);
      expect(listCommandArgs(listSpy).projectId.toString()).toBe(
        PRODUCTION.toString(),
      );
      expect(kept.size).toBe(0);
    });

    test("an organization connected to one project never asks", async () => {
      const listSpy: jest.SpyInstance = stubListCommand("a list");
      connected = [STAGING];

      const turn: Turn = await deliver(typed("show active incidents"));

      expect(textOf(turn.sent[0])).not.toContain(QUESTION_FRAGMENT);
      expect(listCommandArgs(listSpy).projectId.toString()).toBe(
        STAGING.toString(),
      );
    });

    test("the help is answered at once, as before: it reads nothing in either project", async () => {
      const turn: Turn = await deliver(typed("help"));

      expect(turn.sent).toHaveLength(1);
      expect(textOf(turn.sent[0])).toContain(HELP_FRAGMENT);
      expect(textOf(turn.sent[0])).not.toContain(QUESTION_FRAGMENT);
      expect(kept.size).toBe(0);
    });
  });

  test("what is kept behind the buttons names no token, and lasts half an hour", async () => {
    const asked: Turn = await deliver(typed("show active incidents"));
    const press: WorkspaceProjectChoicePress =
      WorkspaceProjectChoiceStore.readChoice(
        buttonFor(asked.sent[0], "Staging")["actionValue"],
      )!;

    expect(Array.from(kept.keys())).toEqual([
      `microsoft-teams-project-choice-${WorkspaceProjectChoiceStore.hash(press.token)}`,
    ]);
    expect(Array.from(kept.values())[0]).not.toContain(press.token);
    expect(
      (GlobalCache.setString as unknown as jest.Mock).mock.calls.find(
        (call: Array<unknown>): boolean => {
          return call[0] === "microsoft-teams-project-choice";
        },
      )?.[3],
    ).toEqual({ expiresInSeconds: 30 * 60 });
  });

  test("the question's own answers are the project choice's", () => {
    expect(GONE).toBe(MicrosoftTeamsProjectChoice.GONE_TEXT);
    expect(NOT_THEIRS).toBe(MicrosoftTeamsProjectChoice.NOT_THEIRS_TEXT);
  });
});

describe("MicrosoftTeamsUtil bot entry points - both go through resolveProjectByTenantId", () => {
  test("the message path and the invoke path give the SAME ambiguous refusal", async () => {
    mockFindBy([buildProjectAuthRow(), buildProjectAuthRow()]);
    stubChatCapture();
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(ObjectID.generate());

    // A command, not the help: the help reads nothing, and is answered.
    stubListCommand("a list");
    const messageContext: FakeTurnContext = buildTurnContext();
    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "show active incidents" }),
      turnContext: messageContext.turnContext,
    });

    const invokeContext: FakeTurnContext = buildTurnContext();
    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: invokeActivity(),
      turnContext: invokeContext.turnContext,
    });

    expect(joinedSentText(messageContext.sendActivity)).toBe(
      joinedSentText(invokeContext.sendActivity),
    );
    expect(joinedSentText(invokeContext.sendActivity)).toContain(
      AMBIGUOUS_FRAGMENT,
    );
  });

  test("the message path and the invoke path give the SAME not-found refusal", async () => {
    mockFindBy([]);
    stubChatCapture();

    // A command, not the help: the help is answered before any project.
    const messageContext: FakeTurnContext = buildTurnContext();
    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "oncall" }),
      turnContext: messageContext.turnContext,
    });

    const invokeContext: FakeTurnContext = buildTurnContext();
    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: invokeActivity(),
      turnContext: invokeContext.turnContext,
    });

    expect(joinedSentText(messageContext.sendActivity)).toBe(
      joinedSentText(invokeContext.sendActivity),
    );
    expect(joinedSentText(invokeContext.sendActivity)).toContain(
      NOT_FOUND_FRAGMENT,
    );
  });
});
