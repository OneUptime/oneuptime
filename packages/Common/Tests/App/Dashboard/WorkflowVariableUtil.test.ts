import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The pure half of the workflow variables pages: where the list and a
 * variable's own page live, how a workflow refers to a variable, the two create
 * forms (the Create button's static-only form and the More menu's OAuth 2.0
 * form), the OAuth settings the variable page edits in place, and the token
 * refresh call with the words its result is shown in.
 *
 * Nothing here renders. The project id is pinned through ProjectUtil, the
 * refresh endpoint through API.post and the tenant header through
 * ModelAPI.getCommonHeaders; API.getFriendlyMessage stays real so an identity
 * provider's error reads exactly the way the dashboard would show it.
 */

const PROJECT_ID_STRING: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return PROJECT_ID;
      },
    },
  };
});

const COMMON_HEADERS: Record<string, string> = {
  tenantid: PROJECT_ID_STRING,
  "x-test-header": "common",
};

const getCommonHeaders: ReturnType<
  typeof jest.fn<() => Record<string, string>>
> = jest.fn<() => Record<string, string>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return getCommonHeaders();
      },
    },
  };
});

const apiPost: ReturnType<
  typeof jest.fn<(options: unknown) => Promise<unknown>>
> = jest.fn<(options: unknown) => Promise<unknown>>();

jest.mock("../../../UI/Utils/API/API", () => {
  const actual: { default: { getFriendlyMessage: (err: unknown) => string } } =
    jest.requireActual("../../../UI/Utils/API/API") as {
      default: { getFriendlyMessage: (err: unknown) => string };
    };

  return {
    __esModule: true,
    default: {
      post: (options: unknown): Promise<unknown> => {
        return apiPost(options);
      },
      getFriendlyMessage: (err: unknown): string => {
        return actual.default.getFriendlyMessage(err);
      },
    },
  };
});

import {
  CLIENT_AUTHENTICATION_DROPDOWN_OPTIONS,
  GRANT_TYPE_DROPDOWN_OPTIONS,
  OAUTH_VARIABLE_FORM_STEPS,
  OAuthTokenRefreshResult,
  SECRET_TOGGLE_DESCRIPTION,
  TokenRefreshOutcome,
  fetchTokenRefreshOutcome,
  getClientAuthenticationLabel,
  getOAuthSettingsFormFields,
  getOAuthVariableCreateFormFields,
  getStaticVariableCreateFormFields,
  getTokenRefreshDescription,
  getTokenRefreshTitle,
  getVariableTypeLabel,
  getWorkflowVariableReference,
  getWorkflowVariableViewRoute,
  getWorkflowVariablesListRoute,
  refreshWorkflowVariableOAuthToken,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workflow/WorkflowVariableUtil";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { APP_API_URL } from "../../../UI/Config";

const PROJECT_ID: ObjectID = new ObjectID(PROJECT_ID_STRING);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
);
const VARIABLE_ID: ObjectID = new ObjectID(
  "9c4a2b1e-7d3f-4e8a-9b6c-1f2e3d4c5b6a",
);
const EXPIRES_AT_ISO: string = "2026-10-01T10:30:00.000Z";

type CapturedPost = {
  url: URL;
  headers?: Record<string, string> | undefined;
  data?: unknown;
};

type FieldList = Array<ModelField<WorkflowVariable>>;

// The one column a form field writes, e.g. "oauthClientSecret".
function keyOf(field: ModelField<WorkflowVariable>): string {
  return Object.keys(field.field || {})[0] || "";
}

function keysOf(fields: FieldList): Array<string> {
  return fields.map((field: ModelField<WorkflowVariable>): string => {
    return keyOf(field);
  });
}

function fieldFor(
  fields: FieldList,
  key: string,
): ModelField<WorkflowVariable> {
  const found: ModelField<WorkflowVariable> | undefined = fields.find(
    (field: ModelField<WorkflowVariable>): boolean => {
      return keyOf(field) === key;
    },
  );

  if (!found) {
    throw new Error(
      `No form field writes "${key}". Fields: ${keysOf(fields).join(", ")}`,
    );
  }

  return found;
}

function formValues(values: JSONObject): FormValues<WorkflowVariable> {
  return values as unknown as FormValues<WorkflowVariable>;
}

function isRequired(
  field: ModelField<WorkflowVariable>,
  values: JSONObject,
): boolean {
  if (typeof field.required === "function") {
    return field.required(formValues(values));
  }

  return Boolean(field.required);
}

function makeVariable(data: {
  id?: ObjectID | undefined;
  name?: string | undefined;
  variableType?: WorkflowVariableType | undefined;
}): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();

  if (data.id) {
    variable.id = data.id;
  }

  if (data.name !== undefined) {
    variable.name = data.name;
  }

  if (data.variableType) {
    variable.variableType = data.variableType;
  }

  return variable;
}

function lastPost(): CapturedPost {
  const call: Array<unknown> | undefined =
    apiPost.mock.calls[apiPost.mock.calls.length - 1];

  if (!call) {
    throw new Error("API.post was not called.");
  }

  return call[0] as CapturedPost;
}

function expectedRefreshUrl(variableId: ObjectID): string {
  return URL.fromURL(APP_API_URL)
    .addRoute(`/workflow-variable/${variableId.toString()}/refresh-oauth-token`)
    .toString();
}

function succeedWith(data: JSONObject): void {
  apiPost.mockResolvedValue(new HTTPResponse<JSONObject>(200, data, {}));
}

function failWith(statusCode: number, data: JSONObject): void {
  apiPost.mockResolvedValue(new HTTPErrorResponse(statusCode, data, {}));
}

beforeEach(() => {
  apiPost.mockReset();
  getCommonHeaders.mockReset();
  getCommonHeaders.mockReturnValue(COMMON_HEADERS);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("getWorkflowVariableReference", () => {
  test("refers to a global variable under `global`", () => {
    expect(
      getWorkflowVariableReference({ name: "API_KEY", isGlobal: true }),
    ).toBe("{{global.variables.API_KEY}}");
  });

  test("refers to a workflow's own variable under `local`", () => {
    expect(
      getWorkflowVariableReference({ name: "API_KEY", isGlobal: false }),
    ).toBe("{{local.variables.API_KEY}}");
  });

  test("keeps the name exactly as typed", () => {
    expect(
      getWorkflowVariableReference({ name: "Api_Key_2", isGlobal: true }),
    ).toBe("{{global.variables.Api_Key_2}}");
  });
});

describe("getVariableTypeLabel", () => {
  test("labels an OAuth 2.0 variable", () => {
    expect(
      getVariableTypeLabel(
        makeVariable({ variableType: WorkflowVariableType.OAuth2 }),
      ),
    ).toBe("OAuth 2.0");
  });

  test("labels a static variable", () => {
    expect(
      getVariableTypeLabel(
        makeVariable({ variableType: WorkflowVariableType.Static }),
      ),
    ).toBe("Static");
  });

  // Rows saved before OAuth 2.0 variables existed carry no type at all.
  test("treats a variable without a type as static", () => {
    expect(getVariableTypeLabel(makeVariable({}))).toBe("Static");
  });
});

describe("getWorkflowVariablesListRoute", () => {
  test("a global variable belongs on Workflows > Global Variables", () => {
    expect(getWorkflowVariablesListRoute().toString()).toBe(
      `/dashboard/${PROJECT_ID_STRING}/workflows/variables`,
    );
  });

  test("an undefined workflow id also means the global list", () => {
    expect(getWorkflowVariablesListRoute(undefined).toString()).toBe(
      `/dashboard/${PROJECT_ID_STRING}/workflows/variables`,
    );
  });

  test("a local variable belongs on its workflow's Variables page", () => {
    expect(getWorkflowVariablesListRoute(WORKFLOW_ID).toString()).toBe(
      `/dashboard/${PROJECT_ID_STRING}/workflows/${WORKFLOW_ID.toString()}/variables`,
    );
  });

  // populateRouteParams must copy the pattern, not fill it in place.
  test("leaves the shared route patterns untouched", () => {
    getWorkflowVariablesListRoute(WORKFLOW_ID);
    getWorkflowVariablesListRoute();

    expect(RouteMap[PageMap.WORKFLOW_VARIABLES]?.toString()).toBe(
      "/dashboard/:projectId/workflows/:id/variables",
    );
    expect(RouteMap[PageMap.WORKFLOWS_VARIABLES]?.toString()).toBe(
      "/dashboard/:projectId/workflows/variables",
    );
  });
});

describe("getWorkflowVariableViewRoute", () => {
  test("a global variable's page sits under Workflows > Global Variables", () => {
    const route: Route = getWorkflowVariableViewRoute({
      variableId: VARIABLE_ID,
    });

    expect(route.toString()).toBe(
      `/dashboard/${PROJECT_ID_STRING}/workflows/variables/${VARIABLE_ID.toString()}`,
    );
  });

  test("a local variable's page sits under the workflow it belongs to", () => {
    const route: Route = getWorkflowVariableViewRoute({
      variableId: VARIABLE_ID,
      workflowId: WORKFLOW_ID,
    });

    expect(route.toString()).toBe(
      `/dashboard/${PROJECT_ID_STRING}/workflows/${WORKFLOW_ID.toString()}/variables/${VARIABLE_ID.toString()}`,
    );
  });

  /*
   * The local route has two ids. Swapping them would open a workflow that does
   * not exist and a variable that is not on it.
   */
  test("puts the workflow id before the variable id on a local page", () => {
    const segments: Array<string> = getWorkflowVariableViewRoute({
      variableId: VARIABLE_ID,
      workflowId: WORKFLOW_ID,
    })
      .toString()
      .split("/");

    expect(segments.indexOf(WORKFLOW_ID.toString())).toBe(4);
    expect(segments.indexOf(VARIABLE_ID.toString())).toBe(6);
    expect(segments[5]).toBe("variables");
  });

  test("never leaves a route placeholder behind", () => {
    const routes: Array<string> = [
      getWorkflowVariableViewRoute({ variableId: VARIABLE_ID }).toString(),
      getWorkflowVariableViewRoute({
        variableId: VARIABLE_ID,
        workflowId: WORKFLOW_ID,
      }).toString(),
      getWorkflowVariablesListRoute().toString(),
      getWorkflowVariablesListRoute(WORKFLOW_ID).toString(),
    ];

    routes.forEach((route: string) => {
      expect(route).not.toContain(":");
    });
  });

  test("leaves the shared route patterns untouched", () => {
    getWorkflowVariableViewRoute({ variableId: VARIABLE_ID });
    getWorkflowVariableViewRoute({
      variableId: VARIABLE_ID,
      workflowId: WORKFLOW_ID,
    });

    expect(RouteMap[PageMap.WORKFLOWS_VARIABLE_VIEW]?.toString()).toBe(
      "/dashboard/:projectId/workflows/variables/:id",
    );
    expect(RouteMap[PageMap.WORKFLOW_VARIABLE_VIEW]?.toString()).toBe(
      "/dashboard/:projectId/workflows/:id/variables/:subModelId",
    );
  });
});

describe("getTokenRefreshTitle", () => {
  test("says the token was fetched when there is no error", () => {
    expect(
      getTokenRefreshTitle({
        variableName: "API_TOKEN",
        expiresAt: new Date(EXPIRES_AT_ISO),
      }),
    ).toBe("Access Token Fetched");
  });

  test("says it could not fetch one when the provider refused", () => {
    expect(
      getTokenRefreshTitle({
        variableName: "API_TOKEN",
        error: "invalid_client",
      }),
    ).toBe("Could Not Fetch an Access Token");
  });

  // A pending outcome for a save that also failed still leads with the failure.
  test("leads with the failure even after a save", () => {
    expect(
      getTokenRefreshTitle({
        variableName: "API_TOKEN",
        savedWhat: "Client secret",
        error: "invalid_client",
      }),
    ).toBe("Could Not Fetch an Access Token");
  });

  /*
   * Whoever turned the request down - OneUptime or the identity provider - no
   * token was fetched, so the title is the same.
   */
  test("says it could not fetch one when OneUptime refused", () => {
    expect(
      getTokenRefreshTitle({
        variableName: "API_TOKEN",
        error: "You do not have permission to update this variable.",
      }),
    ).toBe("Could Not Fetch an Access Token");
    expect(
      getTokenRefreshTitle({
        variableName: "API_TOKEN",
        savedWhat: "Client secret",
        error: "You do not have permission to update this variable.",
      }),
    ).toBe("Could Not Fetch an Access Token");
  });
});

describe("getTokenRefreshDescription", () => {
  test("says until when a fetched token is valid", () => {
    const expiresAt: Date = new Date(EXPIRES_AT_ISO);

    expect(
      getTokenRefreshDescription({ variableName: "API_TOKEN", expiresAt }),
    ).toBe(
      `OneUptime fetched a new access token for "API_TOKEN" from your identity provider. It is valid until ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        expiresAt,
      )}, and a new one is fetched automatically whenever a workflow is about to use it after that.`,
    );
  });

  test("explains what happens when the provider gave no expiry", () => {
    const expected: string =
      'OneUptime fetched a new access token for "API_TOKEN" from your identity provider. The provider did not say when it expires, so every workflow run fetches a new one.';

    expect(
      getTokenRefreshDescription({
        variableName: "API_TOKEN",
        expiresAt: null,
      }),
    ).toBe(expected);
    expect(getTokenRefreshDescription({ variableName: "API_TOKEN" })).toBe(
      expected,
    );
  });

  test("passes on why the fetch failed", () => {
    expect(
      getTokenRefreshDescription({
        variableName: "API_TOKEN",
        error: "invalid_client: The client secret is wrong.",
      }),
    ).toBe(
      'OneUptime could not fetch an access token for "API_TOKEN": invalid_client: The client secret is wrong.',
    );
  });

  test("says what was saved before a successful refresh", () => {
    const description: string = getTokenRefreshDescription({
      variableName: "API_TOKEN",
      savedWhat: "Client secret",
      expiresAt: null,
    });

    expect(
      description.startsWith("Client secret saved. OneUptime fetched"),
    ).toBe(true);
  });

  // The save went through even though the token did not: say both.
  test("says what was saved before a failed refresh", () => {
    expect(
      getTokenRefreshDescription({
        variableName: "API_TOKEN",
        savedWhat: "Refresh token",
        error: "invalid_grant",
      }),
    ).toBe(
      'Refresh token saved. OneUptime could not fetch an access token for "API_TOKEN": invalid_grant',
    );
  });

  test("adds no prefix when nothing was saved", () => {
    const description: string = getTokenRefreshDescription({
      variableName: "API_TOKEN",
      error: "invalid_grant",
    });

    expect(description).not.toContain("saved.");
    expect(description.startsWith("OneUptime could not fetch")).toBe(true);
  });

  /*
   * Many failures never reach the identity provider (no permission, a deleted
   * variable, a network error), and the ones that do already name the token
   * endpoint in their reason. So a failure is worded the same way whoever
   * turned the request down, and never as the provider saying no.
   */
  describe("whoever turned the request down", () => {
    test("words OneUptime's own refusal like any other failure", () => {
      expect(
        getTokenRefreshDescription({
          variableName: "API_TOKEN",
          error: "You do not have permission to update this variable.",
        }),
      ).toBe(
        'OneUptime could not fetch an access token for "API_TOKEN": You do not have permission to update this variable.',
      );
    });

    // The save still went through; only the follow-up refresh was refused.
    test("says what was saved first", () => {
      expect(
        getTokenRefreshDescription({
          variableName: "API_TOKEN",
          savedWhat: "Client secret",
          error: "You do not have permission to update this variable.",
        }),
      ).toBe(
        'Client secret saved. OneUptime could not fetch an access token for "API_TOKEN": You do not have permission to update this variable.',
      );
    });

    // The token endpoint's refusal already says who refused; nothing is added.
    test("passes on a token endpoint's refusal as it is", () => {
      expect(
        getTokenRefreshDescription({
          variableName: "API_TOKEN",
          error:
            "The token endpoint refused the request (HTTP 400): invalid_grant - The refresh token has expired.",
        }),
      ).toBe(
        'OneUptime could not fetch an access token for "API_TOKEN": The token endpoint refused the request (HTTP 400): invalid_grant - The refresh token has expired.',
      );
    });

    test("never says the provider was asked or said no", () => {
      const descriptions: Array<string> = [
        getTokenRefreshDescription({
          variableName: "API_TOKEN",
          error: "Not authorized.",
        }),
        getTokenRefreshDescription({
          variableName: "API_TOKEN",
          savedWhat: "Refresh token",
          error: "Not authorized.",
        }),
        getTokenRefreshDescription({
          variableName: "API_TOKEN",
          error: "invalid_client",
        }),
        getTokenRefreshDescription({
          variableName: "API_TOKEN",
          savedWhat: "Client secret",
          error: "invalid_client",
        }),
      ];

      descriptions.forEach((description: string) => {
        expect(description).not.toContain("said no");
        expect(description).not.toContain("asked your identity provider");
        expect(description).not.toContain("did not ask");
      });
    });

    // An error never borrows the success wording, nor a success the failure's.
    test("keeps the success wording for a fetched token", () => {
      const description: string = getTokenRefreshDescription({
        variableName: "API_TOKEN",
        expiresAt: null,
      });

      expect(
        description.startsWith("OneUptime fetched a new access token"),
      ).toBe(true);
      expect(description).not.toContain("could not fetch");
    });
  });
});

describe("refreshWorkflowVariableOAuthToken", () => {
  test("posts to the variable's refresh-oauth-token route", async () => {
    succeedWith({ oauthAccessTokenExpiresAt: EXPIRES_AT_ISO });

    await refreshWorkflowVariableOAuthToken(VARIABLE_ID);

    expect(apiPost).toHaveBeenCalledTimes(1);
    const post: CapturedPost = lastPost();
    expect(post.url.toString()).toBe(expectedRefreshUrl(VARIABLE_ID));
    expect(post.url.toString()).toMatch(
      new RegExp(
        `/workflow-variable/${VARIABLE_ID.toString()}/refresh-oauth-token$`,
      ),
    );
    expect(post.data).toEqual({});
  });

  /*
   * A raw API.post carries no tenant header of its own; the route scopes the
   * request by it, so without ModelAPI's common headers every refresh is
   * refused as belonging to no project.
   */
  test("sends ModelAPI's common headers, including the tenant id", async () => {
    succeedWith({ oauthAccessTokenExpiresAt: EXPIRES_AT_ISO });

    await refreshWorkflowVariableOAuthToken(VARIABLE_ID);

    expect(getCommonHeaders).toHaveBeenCalled();
    expect(lastPost().headers).toEqual(COMMON_HEADERS);
    expect(lastPost().headers?.["tenantid"]).toBe(PROJECT_ID_STRING);
  });

  test("returns when the new token expires", async () => {
    succeedWith({ oauthAccessTokenExpiresAt: EXPIRES_AT_ISO });

    const result: OAuthTokenRefreshResult =
      await refreshWorkflowVariableOAuthToken(VARIABLE_ID);

    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt?.toISOString()).toBe(EXPIRES_AT_ISO);
  });

  test("returns a null expiry when the provider gave none", async () => {
    succeedWith({ oauthAccessTokenExpiresAt: null });

    const result: OAuthTokenRefreshResult =
      await refreshWorkflowVariableOAuthToken(VARIABLE_ID);

    expect(result.expiresAt).toBeNull();
  });

  test("returns a null expiry for a value that is not a date", async () => {
    succeedWith({ oauthAccessTokenExpiresAt: "not-a-date" });

    const result: OAuthTokenRefreshResult =
      await refreshWorkflowVariableOAuthToken(VARIABLE_ID);

    expect(result.expiresAt).toBeNull();
  });

  // The answer never carries the token, and the dashboard never keeps one.
  test("hands back only the expiry, whatever else the response holds", async () => {
    succeedWith({
      oauthAccessTokenExpiresAt: EXPIRES_AT_ISO,
      oauthLastRefreshedAt: "2026-10-01T09:30:00.000Z",
      oauthAccessToken: "should-never-be-read",
    });

    const result: OAuthTokenRefreshResult =
      await refreshWorkflowVariableOAuthToken(VARIABLE_ID);

    expect(Object.keys(result)).toEqual(["expiresAt"]);
  });

  test("throws the error response when the refresh is refused", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "invalid_client" },
      {},
    );
    apiPost.mockResolvedValue(refusal);

    await expect(refreshWorkflowVariableOAuthToken(VARIABLE_ID)).rejects.toBe(
      refusal,
    );
  });

  /*
   * URL.addRoute mutates. Building the request URL on APP_API_URL itself would
   * append the route again on every refresh.
   */
  test("does not grow the shared API URL across refreshes", async () => {
    const apiUrlBefore: string = APP_API_URL.toString();
    succeedWith({ oauthAccessTokenExpiresAt: EXPIRES_AT_ISO });

    await refreshWorkflowVariableOAuthToken(VARIABLE_ID);
    const firstUrl: string = lastPost().url.toString();
    await refreshWorkflowVariableOAuthToken(VARIABLE_ID);
    const secondUrl: string = lastPost().url.toString();

    expect(secondUrl).toBe(firstUrl);
    expect(APP_API_URL.toString()).toBe(apiUrlBefore);
  });

  test("addresses each variable by its own id", async () => {
    const otherId: ObjectID = new ObjectID(
      "0f1e2d3c-4b5a-4968-8776-655443322110",
    );
    succeedWith({ oauthAccessTokenExpiresAt: EXPIRES_AT_ISO });

    await refreshWorkflowVariableOAuthToken(otherId);

    expect(lastPost().url.toString()).toBe(expectedRefreshUrl(otherId));
  });
});

describe("fetchTokenRefreshOutcome", () => {
  test("describes a successful refresh with its expiry", async () => {
    succeedWith({ oauthAccessTokenExpiresAt: EXPIRES_AT_ISO });

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable: makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" }),
    });

    expect(outcome.variableName).toBe("API_TOKEN");
    expect(outcome.expiresAt?.toISOString()).toBe(EXPIRES_AT_ISO);
    expect(outcome.error).toBeUndefined();
    expect(outcome.savedWhat).toBeUndefined();
    expect(getTokenRefreshTitle(outcome)).toBe("Access Token Fetched");
    expect(lastPost().url.toString()).toBe(expectedRefreshUrl(VARIABLE_ID));
  });

  test("carries what was saved through to the outcome", async () => {
    succeedWith({ oauthAccessTokenExpiresAt: null });

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable: makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" }),
      savedWhat: "Client secret",
    });

    expect(outcome.savedWhat).toBe("Client secret");
    expect(outcome.expiresAt).toBeNull();
    expect(getTokenRefreshDescription(outcome)).toContain(
      "Client secret saved. OneUptime fetched a new access token",
    );
  });

  test("reports a refused refresh with its reason instead of throwing", async () => {
    failWith(400, {
      message: "invalid_client: The client secret supplied is incorrect.",
    });

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable: makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" }),
      savedWhat: "Client secret",
    });

    expect(outcome.error).toBe(
      "invalid_client: The client secret supplied is incorrect.",
    );
    expect(outcome.expiresAt).toBeUndefined();
    expect(outcome.savedWhat).toBe("Client secret");
    expect(getTokenRefreshTitle(outcome)).toBe(
      "Could Not Fetch an Access Token",
    );
    expect(getTokenRefreshDescription(outcome)).toBe(
      'Client secret saved. OneUptime could not fetch an access token for "API_TOKEN": invalid_client: The client secret supplied is incorrect.',
    );
  });

  /*
   * NotAuthorizedException answers 422. The request never left OneUptime, so
   * the outcome must not be worded as the identity provider saying no - it is
   * worded like every other failure, with OneUptime's own reason.
   */
  test("words a 422 like any other failure, not as the provider saying no", async () => {
    failWith(422, {
      message: "You do not have permission to update this variable.",
    });

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable: makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" }),
    });

    expect(outcome.error).toBe(
      "You do not have permission to update this variable.",
    );
    expect(outcome.expiresAt).toBeUndefined();
    expect(getTokenRefreshTitle(outcome)).toBe(
      "Could Not Fetch an Access Token",
    );
    expect(getTokenRefreshDescription(outcome)).toBe(
      'OneUptime could not fetch an access token for "API_TOKEN": You do not have permission to update this variable.',
    );
  });

  test("words a 422 after a save as saved, then not fetched", async () => {
    failWith(422, {
      message: "You do not have permission to update this variable.",
    });

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable: makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" }),
      savedWhat: "Client secret",
    });

    expect(outcome.savedWhat).toBe("Client secret");
    expect(getTokenRefreshDescription(outcome)).toBe(
      'Client secret saved. OneUptime could not fetch an access token for "API_TOKEN": You do not have permission to update this variable.',
    );
  });

  test.each([401, 403])(
    "words an HTTP %s the same way",
    async (statusCode: number) => {
      failWith(statusCode, { message: "Not authorized." });

      const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
        variable: makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" }),
      });

      expect(getTokenRefreshDescription(outcome)).toBe(
        'OneUptime could not fetch an access token for "API_TOKEN": Not authorized.',
      );
    },
  );

  /*
   * Every way a fetch can fail, before and after a save. Some never reach the
   * identity provider and the one that does already names the token endpoint
   * in its reason, so none may be worded as the provider being asked, or
   * saying no.
   */
  describe("never words a failure as the identity provider saying no", () => {
    type FailureCase = {
      label: string;
      // Sets up API.post; a variable with no id sends no request at all.
      arrange: () => void;
      variable: () => WorkflowVariable;
      // What API.getFriendlyMessage makes of the failure.
      reason: string;
    };

    const FAILURES: Array<FailureCase> = [
      {
        label: "a token endpoint's refusal (400)",
        arrange: (): void => {
          failWith(400, {
            message:
              "The token endpoint refused the request (HTTP 400): invalid_grant - The refresh token has expired.",
          });
        },
        variable: (): WorkflowVariable => {
          return makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" });
        },
        reason:
          "The token endpoint refused the request (HTTP 400): invalid_grant - The refresh token has expired.",
      },
      {
        label: "OneUptime's permission refusal (422)",
        arrange: (): void => {
          failWith(422, {
            message: "You do not have permission to update this variable.",
          });
        },
        variable: (): WorkflowVariable => {
          return makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" });
        },
        reason: "You do not have permission to update this variable.",
      },
      {
        label: "a variable that no longer exists (400)",
        arrange: (): void => {
          failWith(400, {
            message:
              "Workflow variable not found, or you do not have access to it.",
          });
        },
        variable: (): WorkflowVariable => {
          return makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" });
        },
        reason: "Workflow variable not found, or you do not have access to it.",
      },
      {
        label: "a server error (500)",
        arrange: (): void => {
          failWith(500, { message: "Internal server error." });
        },
        variable: (): WorkflowVariable => {
          return makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" });
        },
        reason: "Internal server error.",
      },
      {
        label: "a network error",
        arrange: (): void => {
          apiPost.mockRejectedValue(new Error("Network request failed."));
        },
        variable: (): WorkflowVariable => {
          return makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" });
        },
        reason: "Network request failed.",
      },
      {
        label: "a variable with no id",
        arrange: (): void => {
          // Nothing to arrange: no request goes out.
        },
        variable: (): WorkflowVariable => {
          return makeVariable({ name: "API_TOKEN" });
        },
        reason: "This variable has no id. Refresh the page and try again.",
      },
    ];

    type FailureAfterSave = FailureCase & {
      savedWhat: string | undefined;
      saved: string;
    };

    const FAILURES_WITH_AND_WITHOUT_A_SAVE: Array<FailureAfterSave> =
      FAILURES.flatMap((failure: FailureCase): Array<FailureAfterSave> => {
        return [
          { ...failure, savedWhat: undefined, saved: "nothing saved" },
          {
            ...failure,
            savedWhat: "Client secret",
            saved: "client secret saved",
          },
        ];
      });

    test.each(FAILURES_WITH_AND_WITHOUT_A_SAVE)(
      "$label, $saved",
      async (entry: FailureAfterSave) => {
        entry.arrange();

        const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
          variable: entry.variable(),
          savedWhat: entry.savedWhat,
        });
        const description: string = getTokenRefreshDescription(outcome);
        const prefix: string = entry.savedWhat
          ? `${entry.savedWhat} saved. `
          : "";

        expect(outcome.error).toBe(entry.reason);
        expect(getTokenRefreshTitle(outcome)).toBe(
          "Could Not Fetch an Access Token",
        );
        expect(description).toBe(
          `${prefix}OneUptime could not fetch an access token for "API_TOKEN": ${entry.reason}`,
        );
        expect(description).not.toContain("said no");
        expect(description).not.toContain("asked your identity provider");
        expect(description).not.toContain("did not ask");
      },
    );
  });

  test("reads the error from the response's `data` field too", async () => {
    failWith(400, { data: "invalid_grant: The refresh token has expired." });

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable: makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" }),
    });

    expect(outcome.error).toBe("invalid_grant: The refresh token has expired.");
  });

  // getFriendlyMessage turns a gateway timeout into something actionable.
  test("words a gateway failure the way the rest of the dashboard does", async () => {
    failWith(502, { message: "Bad Gateway" });

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable: makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" }),
    });

    expect(outcome.error).toBe(
      "Error connecting to server. Please try again in few minutes.",
    );
  });

  test("reports a request that threw instead of rejecting", async () => {
    apiPost.mockRejectedValue(new Error("Network request failed."));

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable: makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" }),
    });

    expect(outcome.error).toBe("Network request failed.");
    expect(outcome.variableName).toBe("API_TOKEN");
  });

  test("reports a failure that threw a plain string", async () => {
    apiPost.mockRejectedValue("Token endpoint unreachable.");

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable: makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" }),
    });

    expect(outcome.error).toBe("Token endpoint unreachable.");
  });

  test("sends no request for a variable without an id", async () => {
    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable: makeVariable({ name: "API_TOKEN" }),
      savedWhat: "Refresh token",
    });

    expect(apiPost).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      variableName: "API_TOKEN",
      savedWhat: "Refresh token",
      error: "This variable has no id. Refresh the page and try again.",
    });
  });

  test("names an unnamed variable 'this variable'", async () => {
    failWith(400, { message: "invalid_client" });

    const outcome: TokenRefreshOutcome = await fetchTokenRefreshOutcome({
      variable: makeVariable({ id: VARIABLE_ID }),
    });

    expect(outcome.variableName).toBe("this variable");
    expect(getTokenRefreshDescription(outcome)).toContain(
      'an access token for "this variable"',
    );
  });

  test("never throws, whatever the request does", async () => {
    apiPost.mockImplementation(() => {
      throw new Error("Synchronous failure.");
    });

    await expect(
      fetchTokenRefreshOutcome({
        variable: makeVariable({ id: VARIABLE_ID, name: "API_TOKEN" }),
      }),
    ).resolves.toEqual({
      variableName: "API_TOKEN",
      savedWhat: undefined,
      error: "Synchronous failure.",
    });
  });
});

describe("getClientAuthenticationLabel", () => {
  test("labels HTTP Basic header authentication", () => {
    expect(
      getClientAuthenticationLabel(
        OAuth2ClientAuthenticationMethod.BasicAuthHeader,
      ),
    ).toBe("HTTP Basic header (client_secret_basic)");
  });

  test("labels request body authentication", () => {
    expect(
      getClientAuthenticationLabel(
        OAuth2ClientAuthenticationMethod.RequestBody,
      ),
    ).toBe("Request body (client_secret_post)");
  });

  // An unset method is what the server uses by default: the Basic header.
  test("shows the default method when none is saved", () => {
    expect(getClientAuthenticationLabel(undefined)).toBe(
      "HTTP Basic header (client_secret_basic)",
    );
    expect(getClientAuthenticationLabel("")).toBe(
      "HTTP Basic header (client_secret_basic)",
    );
  });

  test("shows an unknown saved value as it is", () => {
    expect(getClientAuthenticationLabel("Private Key JWT")).toBe(
      "Private Key JWT",
    );
  });

  test("has a label for every client authentication method", () => {
    Object.values(OAuth2ClientAuthenticationMethod).forEach(
      (method: OAuth2ClientAuthenticationMethod) => {
        expect(getClientAuthenticationLabel(method)).not.toBe(method);
      },
    );
  });
});

describe("dropdown options", () => {
  test("offer both grant types, client credentials first", () => {
    expect(
      GRANT_TYPE_DROPDOWN_OPTIONS.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual([
      OAuth2GrantType.ClientCredentials,
      OAuth2GrantType.RefreshToken,
    ]);
  });

  test("offer every client authentication method", () => {
    expect(
      CLIENT_AUTHENTICATION_DROPDOWN_OPTIONS.map(
        (option: DropdownOption): unknown => {
          return option.value;
        },
      ).sort(),
    ).toEqual(Object.values(OAuth2ClientAuthenticationMethod).sort());
  });
});

describe("getStaticVariableCreateFormFields", () => {
  /*
   * The user's ask: the Create button makes a static variable and nothing
   * else. No type picker, no OAuth settings.
   */
  test.each([true, false])(
    "asks for exactly name, description, content and secret (isGlobal: %s)",
    (isGlobal: boolean) => {
      expect(keysOf(getStaticVariableCreateFormFields({ isGlobal }))).toEqual([
        "name",
        "description",
        "content",
        "isSecret",
      ]);
    },
  );

  test.each([true, false])(
    "never asks for a variable type or an OAuth setting (isGlobal: %s)",
    (isGlobal: boolean) => {
      const keys: Array<string> = keysOf(
        getStaticVariableCreateFormFields({ isGlobal }),
      );

      expect(keys).not.toContain("variableType");
      keys.forEach((key: string) => {
        expect(key.startsWith("oauth")).toBe(false);
      });
    },
  );

  test("has no field that picks between static and OAuth 2.0", () => {
    getStaticVariableCreateFormFields({ isGlobal: true }).forEach(
      (field: ModelField<WorkflowVariable>) => {
        expect(field.fieldType).not.toBe(FormFieldSchemaType.CardSelect);
        expect(field.fieldType).not.toBe(FormFieldSchemaType.RadioButton);
        expect(JSON.stringify(field.dropdownOptions || [])).not.toContain(
          WorkflowVariableType.OAuth2,
        );
      },
    );
  });

  // A single-page form: a stepId here would hide the field behind a step that does not exist.
  test("puts no field on a step", () => {
    getStaticVariableCreateFormFields({ isGlobal: false }).forEach(
      (field: ModelField<WorkflowVariable>) => {
        expect(field.stepId).toBeUndefined();
      },
    );
  });

  test("requires a name that works inside a template reference", () => {
    const name: ModelField<WorkflowVariable> = fieldFor(
      getStaticVariableCreateFormFields({ isGlobal: true }),
      "name",
    );

    expect(name.required).toBe(true);
    expect(name.fieldType).toBe(FormFieldSchemaType.Text);
    expect(name.validation).toEqual({
      minLength: 2,
      noSpaces: true,
      noSpecialCharacters: true,
    });
  });

  test("shows a global variable's reference syntax on the global list", () => {
    const name: ModelField<WorkflowVariable> = fieldFor(
      getStaticVariableCreateFormFields({ isGlobal: true }),
      "name",
    );

    expect(name.description).toContain("{{global.variables.THIS_NAME}}");
    expect(name.description).not.toContain("{{local.");
  });

  test("shows a local variable's reference syntax on a workflow's list", () => {
    const name: ModelField<WorkflowVariable> = fieldFor(
      getStaticVariableCreateFormFields({ isGlobal: false }),
      "name",
    );

    expect(name.description).toContain("{{local.variables.THIS_NAME}}");
    expect(name.description).not.toContain("{{global.");
  });

  test("warns that renaming does not update existing workflows", () => {
    expect(
      fieldFor(getStaticVariableCreateFormFields({ isGlobal: true }), "name")
        .description,
    ).toContain("Renaming it does not update workflows");
  });

  test("keeps the description optional", () => {
    const description: ModelField<WorkflowVariable> = fieldFor(
      getStaticVariableCreateFormFields({ isGlobal: true }),
      "description",
    );

    expect(description.required).toBe(false);
    expect(description.fieldType).toBe(FormFieldSchemaType.LongText);
  });

  test("requires the content", () => {
    const content: ModelField<WorkflowVariable> = fieldFor(
      getStaticVariableCreateFormFields({ isGlobal: true }),
      "content",
    );

    expect(content.required).toBe(true);
    expect(content.fieldType).toBe(FormFieldSchemaType.LongText);
    // Once saved it can only be replaced, and that happens on the variable's page.
    expect(content.description).toContain("open the variable to replace it");
  });

  test("offers the secret toggle without claiming encryption", () => {
    const secret: ModelField<WorkflowVariable> = fieldFor(
      getStaticVariableCreateFormFields({ isGlobal: true }),
      "isSecret",
    );

    expect(secret.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(secret.required).toBe(false);
    expect(secret.description).toBe(SECRET_TOGGLE_DESCRIPTION);
    expect(SECRET_TOGGLE_DESCRIPTION.toLowerCase()).not.toContain("encrypt");
    expect(SECRET_TOGGLE_DESCRIPTION).toContain("[REDACTED]");
    expect(SECRET_TOGGLE_DESCRIPTION).toContain("cannot be turned off");
  });
});

describe("OAUTH_VARIABLE_FORM_STEPS", () => {
  test("are the Variable step then the OAuth 2.0 step", () => {
    expect(
      OAUTH_VARIABLE_FORM_STEPS.map(
        (step: FormStep<WorkflowVariable>): { id: string; title: string } => {
          return { id: step.id, title: step.title };
        },
      ),
    ).toEqual([
      { id: "variable", title: "Variable" },
      { id: "oauth", title: "OAuth 2.0" },
    ]);
  });

  // The form only ever creates OAuth 2.0 variables, so no step is conditional.
  test("always shows both steps", () => {
    OAUTH_VARIABLE_FORM_STEPS.forEach((step: FormStep<WorkflowVariable>) => {
      expect(step.showIf).toBeUndefined();
    });
  });
});

describe("getOAuthVariableCreateFormFields", () => {
  const OAUTH_CREATE_ORDER: Array<string> = [
    "name",
    "description",
    "oauthGrantType",
    "oauthTokenUrl",
    "oauthClientId",
    "oauthClientSecret",
    "oauthRefreshToken",
    "oauthScope",
    "oauthAdditionalParameters",
    "oauthClientAuthenticationMethod",
  ];

  test.each([true, false])(
    "reads top to bottom in the order a provider's console lists them (isGlobal: %s)",
    (isGlobal: boolean) => {
      expect(keysOf(getOAuthVariableCreateFormFields({ isGlobal }))).toEqual(
        OAUTH_CREATE_ORDER,
      );
    },
  );

  // The modal stamps the type itself; the form never offers a choice.
  test("does not ask for the variable type", () => {
    expect(
      keysOf(getOAuthVariableCreateFormFields({ isGlobal: true })),
    ).not.toContain("variableType");
  });

  test("puts name and description on the Variable step", () => {
    const fields: FieldList = getOAuthVariableCreateFormFields({
      isGlobal: true,
    });

    expect(fieldFor(fields, "name").stepId).toBe("variable");
    expect(fieldFor(fields, "description").stepId).toBe("variable");
  });

  test("puts every OAuth setting on the OAuth 2.0 step", () => {
    getOAuthVariableCreateFormFields({ isGlobal: false })
      .filter((field: ModelField<WorkflowVariable>): boolean => {
        return keyOf(field).startsWith("oauth");
      })
      .forEach((field: ModelField<WorkflowVariable>) => {
        expect(field.stepId).toBe("oauth");
      });
  });

  // A field on an undeclared step would never be shown, so it could never be filled in.
  test("uses only the declared steps", () => {
    const stepIds: Array<string> = OAUTH_VARIABLE_FORM_STEPS.map(
      (step: FormStep<WorkflowVariable>): string => {
        return step.id;
      },
    );

    getOAuthVariableCreateFormFields({ isGlobal: true }).forEach(
      (field: ModelField<WorkflowVariable>) => {
        expect(stepIds).toContain(field.stepId);
      },
    );
  });

  test("shows the reference syntax for where the variable is created", () => {
    expect(
      fieldFor(getOAuthVariableCreateFormFields({ isGlobal: true }), "name")
        .description,
    ).toContain("{{global.variables.THIS_NAME}}");
    expect(
      fieldFor(getOAuthVariableCreateFormFields({ isGlobal: false }), "name")
        .description,
    ).toContain("{{local.variables.THIS_NAME}}");
  });

  test("defaults the grant type to client credentials", () => {
    const grantType: ModelField<WorkflowVariable> = fieldFor(
      getOAuthVariableCreateFormFields({ isGlobal: true }),
      "oauthGrantType",
    );

    expect(grantType.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(grantType.required).toBe(true);
    expect(grantType.defaultValue).toBe(OAuth2GrantType.ClientCredentials);
    expect(grantType.dropdownOptions).toBe(GRANT_TYPE_DROPDOWN_OPTIONS);
  });

  test("requires the token URL and client ID", () => {
    const fields: FieldList = getOAuthVariableCreateFormFields({
      isGlobal: true,
    });

    expect(fieldFor(fields, "oauthTokenUrl").required).toBe(true);
    expect(fieldFor(fields, "oauthTokenUrl").fieldType).toBe(
      FormFieldSchemaType.URL,
    );
    expect(fieldFor(fields, "oauthClientId").required).toBe(true);
  });

  test("encrypts the client secret and refresh token", () => {
    const fields: FieldList = getOAuthVariableCreateFormFields({
      isGlobal: true,
    });

    expect(fieldFor(fields, "oauthClientSecret").fieldType).toBe(
      FormFieldSchemaType.EncryptedText,
    );
    expect(fieldFor(fields, "oauthRefreshToken").fieldType).toBe(
      FormFieldSchemaType.EncryptedText,
    );
  });

  test("points to Update Credentials on the variable's page to replace the secret", () => {
    expect(
      fieldFor(
        getOAuthVariableCreateFormFields({ isGlobal: true }),
        "oauthClientSecret",
      ).description,
    ).toContain("open the variable and use Update Credentials");
  });

  test("requires the client secret except for a public refresh-token client", () => {
    const secret: ModelField<WorkflowVariable> = fieldFor(
      getOAuthVariableCreateFormFields({ isGlobal: true }),
      "oauthClientSecret",
    );

    expect(
      isRequired(secret, { oauthGrantType: OAuth2GrantType.ClientCredentials }),
    ).toBe(true);
    expect(isRequired(secret, {})).toBe(true);
    expect(
      isRequired(secret, { oauthGrantType: OAuth2GrantType.RefreshToken }),
    ).toBe(false);
  });

  test("asks for a refresh token only for the refresh-token grant", () => {
    const refreshToken: ModelField<WorkflowVariable> = fieldFor(
      getOAuthVariableCreateFormFields({ isGlobal: true }),
      "oauthRefreshToken",
    );

    expect(refreshToken.required).toBe(true);
    expect(
      refreshToken.showIf?.(
        formValues({ oauthGrantType: OAuth2GrantType.RefreshToken }),
      ),
    ).toBe(true);
    expect(
      refreshToken.showIf?.(
        formValues({ oauthGrantType: OAuth2GrantType.ClientCredentials }),
      ),
    ).toBe(false);
    expect(refreshToken.showIf?.(formValues({}))).toBe(false);
  });

  test("keeps scope, additional parameters and authentication optional", () => {
    const fields: FieldList = getOAuthVariableCreateFormFields({
      isGlobal: true,
    });

    expect(fieldFor(fields, "oauthScope").required).toBe(false);
    expect(fieldFor(fields, "oauthAdditionalParameters").required).toBe(false);
    expect(fieldFor(fields, "oauthClientAuthenticationMethod").required).toBe(
      false,
    );
  });

  test("defaults client authentication to the HTTP Basic header", () => {
    const method: ModelField<WorkflowVariable> = fieldFor(
      getOAuthVariableCreateFormFields({ isGlobal: true }),
      "oauthClientAuthenticationMethod",
    );

    expect(method.defaultValue).toBe(
      OAuth2ClientAuthenticationMethod.BasicAuthHeader,
    );
    expect(method.dropdownOptions).toBe(CLIENT_AUTHENTICATION_DROPDOWN_OPTIONS);
  });

  test("refuses an additional parameter that would overwrite a credential", () => {
    const parameters: ModelField<WorkflowVariable> = fieldFor(
      getOAuthVariableCreateFormFields({ isGlobal: true }),
      "oauthAdditionalParameters",
    );

    expect(
      parameters.customValidation?.(
        formValues({ oauthAdditionalParameters: { client_secret: "x" } }),
      ),
    ).toContain('"client_secret" cannot be set as an additional parameter');
    expect(
      parameters.customValidation?.(
        formValues({ oauthAdditionalParameters: { audience: "api" } }),
      ),
    ).toBeNull();
    expect(parameters.customValidation?.(formValues({}))).toBeNull();
  });

  // The create form and the variable page's edit form must describe the same settings the same way.
  test("uses the variable page's settings fields for the shared settings", () => {
    const createFields: FieldList = getOAuthVariableCreateFormFields({
      isGlobal: true,
    });

    getOAuthSettingsFormFields().forEach(
      (setting: ModelField<WorkflowVariable>) => {
        const onCreate: ModelField<WorkflowVariable> = fieldFor(
          createFields,
          keyOf(setting),
        );

        expect(onCreate.title).toBe(setting.title);
        expect(onCreate.fieldType).toBe(setting.fieldType);
        expect(onCreate.required).toBe(setting.required);
        expect(onCreate.description).toBe(setting.description);
      },
    );
  });
});

describe("getOAuthSettingsFormFields", () => {
  test("edits exactly the five readable settings", () => {
    expect(keysOf(getOAuthSettingsFormFields())).toEqual([
      "oauthTokenUrl",
      "oauthClientId",
      "oauthScope",
      "oauthAdditionalParameters",
      "oauthClientAuthenticationMethod",
    ]);
  });

  /*
   * Anyone who can read the variable reads these back into the edit form. The
   * client secret and refresh token are write-only and have their own modal.
   */
  test("never includes a write-only credential", () => {
    const fields: FieldList = getOAuthSettingsFormFields();
    const keys: Array<string> = keysOf(fields);

    expect(keys).not.toContain("oauthClientSecret");
    expect(keys).not.toContain("oauthRefreshToken");
    fields.forEach((field: ModelField<WorkflowVariable>) => {
      expect(field.fieldType).not.toBe(FormFieldSchemaType.EncryptedText);
    });
  });

  // The grant type is fixed once saved, and the type never changes.
  test("does not offer the grant type or the variable type", () => {
    const keys: Array<string> = keysOf(getOAuthSettingsFormFields());

    expect(keys).not.toContain("oauthGrantType");
    expect(keys).not.toContain("variableType");
  });

  test("puts no field on a step by default", () => {
    getOAuthSettingsFormFields().forEach(
      (field: ModelField<WorkflowVariable>) => {
        expect(field.stepId).toBeUndefined();
      },
    );
  });

  test("puts every field on the step it is given", () => {
    getOAuthSettingsFormFields({ stepId: "oauth" }).forEach(
      (field: ModelField<WorkflowVariable>) => {
        expect(field.stepId).toBe("oauth");
      },
    );
  });

  test("warns that additional parameters are readable", () => {
    expect(
      fieldFor(getOAuthSettingsFormFields(), "oauthAdditionalParameters")
        .description,
    ).toContain("do not put secrets here");
  });
});
