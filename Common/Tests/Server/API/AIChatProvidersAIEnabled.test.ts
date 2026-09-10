import { mockRouter } from "./Helpers";
import "../../../Server/API/AIChatAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
  };
});

/*
 * Ask AI used to look perfectly ready on a project with AI switched off. The
 * header button opened a composer, the suggested prompts were clickable, and
 * the only thing that ever mentioned the switch was the red banner that
 * appeared AFTER the user had written a question and pressed send — telling
 * them, at that point, to go and find a settings page.
 *
 * The client cannot know the answer on its own: Project.enableAi is a server
 * row, and the chat surfaces deliberately hold no project model. So the
 * verdict rides along on POST /ai-chat/providers, which every chat surface
 * already calls as it opens. That is what this suite pins:
 *
 *   - the field is reported, and reported honestly (the toggle's three states
 *     are true / undefined-because-unselected / false, not two);
 *   - it fails CLOSED on a project row we cannot read, matching the
 *     server-side gate in AIService rather than contradicting it; and
 *   - it does not cost a request of its own, because a second round trip is
 *     exactly how this ends up back where it started.
 *
 * The refusal itself still lives in AIService.executeWithLogging and in the
 * send-message route (Common/Tests/Server/API/AIKillSwitchBackstop). Nothing
 * here is a security boundary — it is what the user is TOLD, before typing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const PROVIDER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const PROVIDERS_ROUTE: string = "/ai-chat/providers";

function memberProps(): DatabaseCommonInteractionProps {
  const permissions: Array<UserPermission> = [
    Permission.ProjectMember,
    Permission.ReadProjectLlm,
  ].map((permission: Permission) => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
    } as UserPermission;
  });

  const dictionary: Dictionary<UserTenantAccessPermission> = {};
  dictionary[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions,
    isBlockPermission: false,
  } as UserTenantAccessPermission;

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: dictionary,
  };
}

function provider(): LlmProvider {
  const llmProvider: LlmProvider = new LlmProvider(PROVIDER_ID);
  llmProvider.name = "project-gpt";
  llmProvider.llmType = LlmType.OpenAI;
  llmProvider.modelName = "gpt-4o";
  llmProvider.isDefault = true;
  llmProvider.projectId = PROJECT_ID;
  return llmProvider;
}

/*
 * `enableAi` is deliberately typed as optional on the model: the column is NOT
 * NULL DEFAULT true, so a row selected without that column arrives undefined,
 * and undefined has always meant "not selected", never "off".
 */
function projectRow(enableAi: boolean | undefined): Project {
  const project: Project = new Project(PROJECT_ID);

  // Left unset, not set to undefined — that is what an unselected column is.
  if (enableAi !== undefined) {
    project.enableAi = enableAi;
  }

  return project;
}

async function callProviders(): Promise<void> {
  const next: ReturnType<typeof jest.fn> = jest.fn();

  await mockRouter.match("post", PROVIDERS_ROUTE).handlerFunction(
    {
      body: {},
      headers: {},
      params: {},
      query: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const thrown: unknown = next.mock.calls[0]?.[0];

  if (thrown) {
    throw thrown;
  }
}

function sentPayload(): JSONObject {
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  return send.mock.calls[0]![2] as JSONObject;
}

function stubProject(project: Project | null): void {
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(memberProps());
  jest
    .spyOn(LlmProviderService, "getSelectableProvidersForProject")
    .mockResolvedValue([provider()]);
  jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockResolvedValue(provider());
  stubProject(projectRow(true));
});

describe("POST /ai-chat/providers reports the project's AI kill switch", () => {
  test("a project with AI on is reported as enabled", async () => {
    stubProject(projectRow(true));

    await callProviders();

    expect(sentPayload()["isAIEnabledForProject"]).toBe(true);
  });

  test("a project with AI explicitly off is reported as disabled", async () => {
    stubProject(projectRow(false));

    await callProviders();

    expect(sentPayload()["isAIEnabledForProject"]).toBe(false);
  });

  test("undefined means 'not selected', not 'off' — the column defaults to true", async () => {
    stubProject(projectRow(undefined));

    await callProviders();

    expect(sentPayload()["isAIEnabledForProject"]).toBe(true);
  });

  test("a project row that cannot be read answers 'disabled' — the same way the server-side gate fails closed", async () => {
    stubProject(null);

    await callProviders();

    expect(sentPayload()["isAIEnabledForProject"]).toBe(false);
  });

  test("the verdict is read for the caller's own project", async () => {
    await callProviders();

    expect(ProjectService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({ id: PROJECT_ID }),
    );
  });

  test("only the toggle column is selected — no other project data is pulled to answer this", async () => {
    await callProviders();

    const call: JSONObject = (
      ProjectService.findOneById as unknown as jest.Mock
    ).mock.calls[0]![0] as JSONObject;

    expect(call["select"]).toEqual({ enableAi: true });
  });

  test("the switch costs no extra round trip — it rides on the request the picker already makes", async () => {
    await callProviders();

    const payload: JSONObject = sentPayload();

    // One response, carrying the providers AND the verdict.
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(payload).toHaveProperty("isAIEnabledForProject");
    expect(payload).toHaveProperty("providers");
    expect(payload).toHaveProperty("defaultProviderId");
  });

  test("a disabled project still gets its provider list — the notice explains, it does not hide the setup", async () => {
    stubProject(projectRow(false));

    await callProviders();

    const payload: JSONObject = sentPayload();

    expect(payload["isAIEnabledForProject"]).toBe(false);
    expect((payload["providers"] as Array<JSONObject>).length).toBe(1);
  });

  test("the toggle read never carries the caller's props — it is a root read of one boolean", async () => {
    await callProviders();

    const call: JSONObject = (
      ProjectService.findOneById as unknown as jest.Mock
    ).mock.calls[0]![0] as JSONObject;

    expect(call["props"]).toEqual({ isRoot: true });
  });
});
