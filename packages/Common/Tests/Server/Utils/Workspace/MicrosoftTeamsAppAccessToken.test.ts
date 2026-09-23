import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Where the Microsoft Teams Graph app token is read from and written to.
 *
 * The token is an app-only Microsoft Graph credential for the customer's
 * tenant. It used to be cached in WorkspaceProjectAuthToken.miscData, which
 * every project Viewer can read through the CRUD API. It now lives only in the
 * server-only authToken / authTokenExpiresAt columns.
 *
 * These tests fail if getValidAccessToken goes back to trusting a token found
 * in miscData, or if a refresh writes the token (or anything else) into
 * miscData again.
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

// Same botbuilder factory as the other MicrosoftTeams tests.
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

import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

const TENANT_ID: string = "99999999-8888-7777-6666-555555555555";
const STORED_TOKEN: string = "eyJ0eXAiOiJKV1QifQ.stored-token.signature";
const NEW_TOKEN: string = "eyJ0eXAiOiJKV1QifQ.new-token.signature";
const MISC_DATA_TOKEN: string = "eyJ0eXAiOiJKV1QifQ.misc-data-token.signature";

let projectId: ObjectID;
let getProjectAuth: jest.SpyInstance;
let saveRefreshedAuthToken: jest.SpyInstance;
let refreshAuthToken: jest.SpyInstance;
let updateOneById: jest.SpyInstance;
let post: jest.SpyInstance;

function inSeconds(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function projectAuthRow(data: {
  authToken?: string | undefined;
  authTokenExpiresAt?: Date | undefined;
  miscData?: MiscData | undefined;
}): WorkspaceProjectAuthToken {
  const row: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  row.projectId = projectId;
  row.workspaceType = WorkspaceType.MicrosoftTeams;
  row.workspaceProjectId = TENANT_ID;
  if (data.authToken !== undefined) {
    row.authToken = data.authToken;
  }
  if (data.authTokenExpiresAt !== undefined) {
    row.authTokenExpiresAt = data.authTokenExpiresAt;
  }
  row.miscData = data.miscData || {
    tenantId: TENANT_ID,
    teamId: "team-1",
    teamName: "Engineering",
    botId: "bot-1",
    adminConsentGranted: true,
  };
  return row;
}

function mockTokenEndpoint(): void {
  post.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      { access_token: NEW_TOKEN, expires_in: 3599 },
      {},
    ),
  );
}

function getValidAccessToken(): Promise<string> {
  return MicrosoftTeamsUtil.getValidAccessToken({
    authToken: STORED_TOKEN,
    projectId,
  });
}

function expectRefreshWroteOnlyTheTokenColumns(): void {
  expect(saveRefreshedAuthToken).toHaveBeenCalledTimes(1);
  const args: any = saveRefreshedAuthToken.mock.calls[0]![0];

  expect(args.projectId).toBe(projectId);
  expect(args.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
  expect(args.workspaceProjectId).toBe(TENANT_ID);
  expect(args.authToken).toBe(NEW_TOKEN);
  expect(args.authTokenExpiresAt).toBeInstanceOf(Date);
  expect((args.authTokenExpiresAt as Date).getTime()).toBeGreaterThan(
    Date.now(),
  );
  expect(args).not.toHaveProperty("miscData");

  // Nothing else may write the row: no upsert and no miscData rewrite.
  expect(refreshAuthToken).not.toHaveBeenCalled();
  expect(updateOneById).not.toHaveBeenCalled();
}

describe("MicrosoftTeamsUtil.getValidAccessToken", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    projectId = ObjectID.generate();

    getProjectAuth = jest.spyOn(
      WorkspaceProjectAuthTokenService,
      "getProjectAuth",
    );
    saveRefreshedAuthToken = jest
      .spyOn(WorkspaceProjectAuthTokenService, "saveRefreshedAuthToken")
      .mockResolvedValue(undefined);
    refreshAuthToken = jest
      .spyOn(WorkspaceProjectAuthTokenService, "refreshAuthToken")
      .mockResolvedValue(undefined);
    updateOneById = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(1);
    post = jest.spyOn(API, "post").mockImplementation(async () => {
      throw new Error("Unexpected API.post");
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns the stored authToken while it is fresh, without calling Microsoft", async () => {
    getProjectAuth.mockResolvedValue(
      projectAuthRow({
        authToken: STORED_TOKEN,
        authTokenExpiresAt: inSeconds(3600),
      }),
    );

    await expect(getValidAccessToken()).resolves.toBe(STORED_TOKEN);
    expect(post).not.toHaveBeenCalled();
    expect(saveRefreshedAuthToken).not.toHaveBeenCalled();
  });

  test("never uses a token left in miscData", async () => {
    // A legacy row: a fresh-looking token in miscData, none in the columns.
    getProjectAuth.mockResolvedValue(
      projectAuthRow({
        authToken: "not-a-jwt",
        miscData: {
          tenantId: TENANT_ID,
          appAccessToken: MISC_DATA_TOKEN,
          appAccessTokenExpiresAt: inSeconds(3600).toISOString(),
        },
      }),
    );
    mockTokenEndpoint();

    await expect(getValidAccessToken()).resolves.toBe(NEW_TOKEN);
    expectRefreshWroteOnlyTheTokenColumns();
  });

  test("mints a new token when the stored one has no recorded expiry", async () => {
    getProjectAuth.mockResolvedValue(
      projectAuthRow({ authToken: STORED_TOKEN }),
    );
    mockTokenEndpoint();

    await expect(getValidAccessToken()).resolves.toBe(NEW_TOKEN);

    expect(post).toHaveBeenCalledTimes(1);
    const request: any = post.mock.calls[0]![0];
    expect(request.url.toString()).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    );
    expect(request.data["grant_type"]).toBe("client_credentials");
    expectRefreshWroteOnlyTheTokenColumns();
  });

  test("mints a new token when the stored one expires within five minutes", async () => {
    getProjectAuth.mockResolvedValue(
      projectAuthRow({
        authToken: STORED_TOKEN,
        authTokenExpiresAt: inSeconds(120),
      }),
    );
    mockTokenEndpoint();

    await expect(getValidAccessToken()).resolves.toBe(NEW_TOKEN);
    expectRefreshWroteOnlyTheTokenColumns();
  });

  test("falls back to a still-valid stored token when Microsoft refuses the refresh", async () => {
    getProjectAuth.mockResolvedValue(
      projectAuthRow({
        authToken: STORED_TOKEN,
        authTokenExpiresAt: inSeconds(120),
      }),
    );
    post.mockResolvedValue(
      new HTTPErrorResponse(400, { error: "invalid_client" }, {}),
    );

    await expect(getValidAccessToken()).resolves.toBe(STORED_TOKEN);
    expect(saveRefreshedAuthToken).not.toHaveBeenCalled();
  });

  test("does not hand out a token it knows has expired when the refresh fails", async () => {
    getProjectAuth.mockResolvedValue(
      projectAuthRow({
        authToken: STORED_TOKEN,
        authTokenExpiresAt: inSeconds(-60),
      }),
    );
    post.mockResolvedValue(
      new HTTPErrorResponse(400, { error: "invalid_client" }, {}),
    );

    await expect(getValidAccessToken()).rejects.toThrow(
      "Could not obtain valid access token for Microsoft Teams",
    );
    expect(saveRefreshedAuthToken).not.toHaveBeenCalled();
  });
});
