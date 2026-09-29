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
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import ObjectID from "../../../../Types/ObjectID";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
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
const HELP_FRAGMENT: string = "Available Commands";

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

function firstArgProjectId(spy: jest.SpyInstance): ObjectID {
  return spy.mock.calls[0]?.[0] as ObjectID;
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
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity(),
      turnContext: context.turnContext,
    });

    expect(context.sendActivity).toHaveBeenCalledTimes(1);
    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(NOT_FOUND_FRAGMENT);
    expect(sent).not.toContain(HELP_FRAGMENT);
  });

  test("a tenant connected to two projects replies with the AMBIGUOUS message and serves nothing", async () => {
    mockFindBy([buildProjectAuthRow(), buildProjectAuthRow()]);
    const findOneBySpy: jest.SpyInstance = spyOnFindOneBy();
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity(),
      turnContext: context.turnContext,
    });

    expect(context.sendActivity).toHaveBeenCalledTimes(1);
    const sent: string = joinedSentText(context.sendActivity);
    expect(sent).toContain(AMBIGUOUS_FRAGMENT);
    // Refusing must not look like "not connected" - the remedies differ.
    expect(sent).not.toContain(NOT_FOUND_FRAGMENT);
    // ...and the user must not get the other project's answer.
    expect(sent).not.toContain(HELP_FRAGMENT);
    expect(findOneBySpy).not.toHaveBeenCalled();
  });

  test("a tenant whose only row has no projectId replies with the not-found message", async () => {
    mockFindBy([buildProjectAuthRow({ projectId: undefined })]);
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity(),
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
    expect(resolveSpy).toHaveBeenCalledWith({
      tenantId: "tenant-from-activity",
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
 * AI assistant answers with NO per-user authorization at all - whoever is in
 * the tenant gets whatever project the handler picked. So the project id it
 * hands the downstream readers IS the entire access-control decision, and it
 * must be exactly the projectId of the row resolveProjectByTenantId returned.
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
    const readerSpy: jest.SpyInstance = stubDownstreamReader(
      "getActiveIncidentsMessage",
      "incidents-of-the-resolved-project",
    );
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "show active incidents" }),
      turnContext: context.turnContext,
    });

    expect(readerSpy).toHaveBeenCalledTimes(1);
    expect(firstArgProjectId(readerSpy).toString()).toBe(
      projectAuth.projectId?.toString(),
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
    const readerSpy: jest.SpyInstance = stubDownstreamReader(
      "getActiveAlertsMessage",
      "alerts-of-the-resolved-project",
    );
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "show active alerts" }),
      turnContext: context.turnContext,
    });

    expect(readerSpy).toHaveBeenCalledTimes(1);
    expect(firstArgProjectId(readerSpy).toString()).toBe(
      projectAuth.projectId?.toString(),
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
    const readerSpy: jest.SpyInstance = stubDownstreamReader(
      "getScheduledMaintenanceMessage",
      "maintenance-of-the-resolved-project",
    );
    const context: FakeTurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ text: "show scheduled maintenance" }),
      turnContext: context.turnContext,
    });

    expect(readerSpy).toHaveBeenCalledTimes(1);
    expect(firstArgProjectId(readerSpy).toString()).toBe(
      projectAuth.projectId?.toString(),
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
    const incidentsSpy: jest.SpyInstance = stubDownstreamReader(
      "getActiveIncidentsMessage",
      "incidents",
    );
    const alertsSpy: jest.SpyInstance = stubDownstreamReader(
      "getActiveAlertsMessage",
      "alerts",
    );
    const maintenanceSpy: jest.SpyInstance = stubDownstreamReader(
      "getScheduledMaintenanceMessage",
      "maintenance",
    );
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
    expect(incidentsSpy).not.toHaveBeenCalled();
    expect(alertsSpy).not.toHaveBeenCalled();
    expect(maintenanceSpy).not.toHaveBeenCalled();
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
    expect(resolveSpy).toHaveBeenCalledWith({ tenantId: "tenant-from-invoke" });
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

describe("MicrosoftTeamsUtil bot entry points - both go through resolveProjectByTenantId", () => {
  test("the message path and the invoke path give the SAME ambiguous refusal", async () => {
    mockFindBy([buildProjectAuthRow(), buildProjectAuthRow()]);
    stubChatCapture();
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(ObjectID.generate());

    const messageContext: FakeTurnContext = buildTurnContext();
    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity(),
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

    const messageContext: FakeTurnContext = buildTurnContext();
    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity(),
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
