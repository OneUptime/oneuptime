import WorkflowVariableService, {
  OAUTH2_COLUMNS,
  OAUTH2_EDITABLE_SETTINGS_COLUMNS,
} from "../../../Server/Services/WorkflowVariableService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WorkflowVariableService's rules for the two kinds of variable.
 *
 * A Static variable is content somebody typed. An OAuth 2.0 variable is the
 * settings an OAuth token exchange needs, and its value is the access token
 * OneUptime fetches. The rules below keep those apart - a Static variable never
 * carries OAuth columns, an OAuth variable never carries typed content - make
 * sure an OAuth variable can actually fetch a token before it is saved, and
 * throw a cached token away when the settings that produced it change.
 *
 * The hooks are protected, and ordinary prototype methods at runtime, so they
 * are reached through a structural cast - going through create()/updateBy()
 * would drag in the entire ORM to prove each rule.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "dddd1111-1111-4111-8111-111111111111",
);
const VARIABLE_ID: ObjectID = new ObjectID(
  "dddd2222-2222-4222-8222-222222222222",
);
const OTHER_VARIABLE_ID: ObjectID = new ObjectID(
  "dddd3333-3333-4333-8333-333333333333",
);

interface ServiceInternals {
  onBeforeCreate: (
    createBy: CreateBy<WorkflowVariable>,
  ) => Promise<OnCreate<WorkflowVariable>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<WorkflowVariable>,
  ) => Promise<OnUpdate<WorkflowVariable>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<WorkflowVariable>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<WorkflowVariable>>;
}

function internals(): ServiceInternals {
  const service: ServiceInternals =
    WorkflowVariableService as unknown as ServiceInternals;

  return {
    onBeforeCreate: service.onBeforeCreate.bind(WorkflowVariableService),
    onBeforeUpdate: service.onBeforeUpdate.bind(WorkflowVariableService),
    onUpdateSuccess: service.onUpdateSuccess.bind(WorkflowVariableService),
  };
}

function model(values: Record<string, unknown>): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();

  for (const [key, value] of Object.entries(values)) {
    (variable as unknown as Record<string, unknown>)[key] = value;
  }

  return variable;
}

async function create(
  values: Record<string, unknown>,
): Promise<WorkflowVariable> {
  const result: OnCreate<WorkflowVariable> = await internals().onBeforeCreate({
    data: model({ name: "API_TOKEN", projectId: PROJECT_ID, ...values }),
    props: { isRoot: true },
  });

  return result.createBy.data;
}

function oauthCreateValues(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    variableType: WorkflowVariableType.OAuth2,
    oauthGrantType: OAuth2GrantType.ClientCredentials,
    oauthTokenUrl: "https://login.example.com/oauth2/token",
    oauthClientId: "client-123",
    oauthClientSecret: "client-secret",
    ...overrides,
  };
}

function storedOAuthRow(overrides?: Record<string, unknown>): WorkflowVariable {
  return model({
    _id: VARIABLE_ID.toString(),
    name: "API_TOKEN",
    projectId: PROJECT_ID,
    isSecret: true,
    variableType: WorkflowVariableType.OAuth2,
    oauthGrantType: OAuth2GrantType.ClientCredentials,
    oauthTokenUrl: "https://login.example.com/oauth2/token",
    oauthClientId: "client-123",
    oauthClientSecret: "client-secret",
    oauthScope: "api.read",
    oauthAdditionalParameters: { audience: "https://api.example.com" },
    oauthClientAuthenticationMethod:
      OAuth2ClientAuthenticationMethod.BasicAuthHeader,
    ...overrides,
  });
}

function storedStaticRow(
  overrides?: Record<string, unknown>,
): WorkflowVariable {
  return model({
    _id: VARIABLE_ID.toString(),
    name: "PLAIN",
    projectId: PROJECT_ID,
    isSecret: false,
    variableType: WorkflowVariableType.Static,
    ...overrides,
  });
}

function updateBy(
  data: Record<string, unknown>,
  props?: Record<string, unknown>,
): UpdateBy<WorkflowVariable> {
  return {
    query: { _id: VARIABLE_ID.toString() },
    data,
    limit: 1,
    skip: 0,
    props: props || { isRoot: true },
  } as unknown as UpdateBy<WorkflowVariable>;
}

let findByCalls: Array<Record<string, unknown>>;

function rowsBeingUpdated(rows: Array<WorkflowVariable>): void {
  jest
    .spyOn(WorkflowVariableService, "findBy")
    .mockImplementation(async (findBy: unknown) => {
      findByCalls.push(findBy as Record<string, unknown>);
      return rows;
    });
}

async function update(
  data: Record<string, unknown>,
): Promise<{ data: Record<string, unknown>; carryForward: unknown }> {
  const result: OnUpdate<WorkflowVariable> = await internals().onBeforeUpdate(
    updateBy(data),
  );

  return {
    data: result.updateBy.data as unknown as Record<string, unknown>,
    carryForward: result.carryForward,
  };
}

describe("WorkflowVariableService and OAuth 2.0 variables", () => {
  beforeEach(() => {
    findByCalls = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("creating a Static variable", () => {
    test("is the default when no type is given", async () => {
      const created: WorkflowVariable = await create({ content: "value" });

      expect(created.variableType).toBe(WorkflowVariableType.Static);
      expect(created.content).toBe("value");
    });

    /*
     * TableColumn no longer marks content required - an OAuth variable has
     * none - so the service is what keeps a Static variable from being saved
     * empty. The message is the one checkRequiredFields used to give.
     */
    test("still needs content", async () => {
      await expect(
        create({ variableType: WorkflowVariableType.Static }),
      ).rejects.toThrow("content is required");

      await expect(create({ content: "" })).rejects.toThrow(
        "content is required",
      );
    });

    /*
     * The dashboard's create form posts every field it has, the hidden OAuth
     * ones and their defaults included. A Static variable never uses them, so
     * they are dropped rather than refused.
     */
    test("drops every OAuth column the form sent along", async () => {
      const created: WorkflowVariable = await create({
        content: "value",
        oauthGrantType: OAuth2GrantType.ClientCredentials,
        oauthClientAuthenticationMethod:
          OAuth2ClientAuthenticationMethod.BasicAuthHeader,
        oauthTokenUrl: "https://login.example.com/token",
        oauthClientSecret: "should-not-be-stored",
        oauthAccessToken: "forged",
      });

      for (const column of OAUTH2_COLUMNS) {
        expect(
          (created as unknown as Record<string, unknown>)[column as string],
        ).toBeUndefined();
      }
    });

    test("keeps the secret flag it was given", async () => {
      const created: WorkflowVariable = await create({
        content: "value",
        isSecret: false,
      });

      expect(created.isSecret).toBe(false);
    });

    test("refuses a type that does not exist", async () => {
      await expect(
        create({ variableType: "Magic", content: "value" }),
      ).rejects.toThrow("Variable type must be one of: Static, OAuth 2.0.");
    });
  });

  describe("creating an OAuth 2.0 variable", () => {
    test("with client credentials", async () => {
      const created: WorkflowVariable = await create(oauthCreateValues());

      expect(created.variableType).toBe(WorkflowVariableType.OAuth2);
      expect(created.oauthGrantType).toBe(OAuth2GrantType.ClientCredentials);
      expect(created.oauthClientSecret).toBe("client-secret");
    });

    /*
     * Its value is a bearer credential, so it is always redacted from run logs
     * - whatever the form or an API caller said.
     */
    test("is always secret", async () => {
      const created: WorkflowVariable = await create(
        oauthCreateValues({ isSecret: false }),
      );

      expect(created.isSecret).toBe(true);
    });

    /*
     * content is NOT NULL in the database, and an OAuth variable has nothing
     * to put there - its value is the access token, which lives in its own
     * encrypted column. Whatever was typed is not kept.
     */
    test("stores empty content whatever was sent", async () => {
      const created: WorkflowVariable = await create(
        oauthCreateValues({ content: "a pasted token" }),
      );

      expect(created.content).toBe("");
    });

    test("defaults client authentication to the HTTP Basic header", async () => {
      const created: WorkflowVariable = await create(oauthCreateValues());

      expect(created.oauthClientAuthenticationMethod).toBe(
        OAuth2ClientAuthenticationMethod.BasicAuthHeader,
      );
    });

    test("keeps an explicit client authentication method", async () => {
      const created: WorkflowVariable = await create(
        oauthCreateValues({
          oauthClientAuthenticationMethod:
            OAuth2ClientAuthenticationMethod.RequestBody,
        }),
      );

      expect(created.oauthClientAuthenticationMethod).toBe(
        OAuth2ClientAuthenticationMethod.RequestBody,
      );
    });

    test("trims the token URL, the client ID and the scope", async () => {
      const created: WorkflowVariable = await create(
        oauthCreateValues({
          oauthTokenUrl: "  https://login.example.com/oauth2/token  ",
          oauthClientId: "  client-123  ",
          oauthScope: "  api.read  ",
        }),
      );

      expect(created.oauthTokenUrl).toBe(
        "https://login.example.com/oauth2/token",
      );
      expect(created.oauthClientId).toBe("client-123");
      expect(created.oauthScope).toBe("api.read");
    });

    test("stores an empty scope as nothing", async () => {
      const created: WorkflowVariable = await create(
        oauthCreateValues({ oauthScope: "   " }),
      );

      expect(created.oauthScope).toBeNull();
    });

    test("normalises additional parameters to text", async () => {
      const created: WorkflowVariable = await create(
        oauthCreateValues({
          oauthAdditionalParameters: {
            audience: "https://api.example.com",
            max_age: 300,
          },
        }),
      );

      expect(created.oauthAdditionalParameters).toEqual({
        audience: "https://api.example.com",
        max_age: "300",
      });
    });

    test("stores empty additional parameters as nothing", async () => {
      const created: WorkflowVariable = await create(
        oauthCreateValues({ oauthAdditionalParameters: {} }),
      );

      expect(created.oauthAdditionalParameters).toBeNull();
    });

    /*
     * The client credentials grant never uses a refresh token. The form hides
     * the field for it; an API caller can still send one, and it is not kept.
     */
    test("drops a refresh token sent with the client credentials grant", async () => {
      const created: WorkflowVariable = await create(
        oauthCreateValues({ oauthRefreshToken: "unused" }),
      );

      expect(created.oauthRefreshToken).toBeUndefined();
    });

    test("with a refresh token", async () => {
      const created: WorkflowVariable = await create(
        oauthCreateValues({
          oauthGrantType: OAuth2GrantType.RefreshToken,
          oauthRefreshToken: "refresh-1",
        }),
      );

      expect(created.oauthRefreshToken).toBe("refresh-1");
      expect(created.oauthClientSecret).toBe("client-secret");
    });

    // A public client: a refresh token and a client id, no secret.
    test("with a refresh token and no client secret", async () => {
      const created: WorkflowVariable = await create(
        oauthCreateValues({
          oauthGrantType: OAuth2GrantType.RefreshToken,
          oauthRefreshToken: "refresh-1",
          oauthClientSecret: "",
        }),
      );

      expect(created.oauthClientSecret).toBeUndefined();
      expect(created.oauthRefreshToken).toBe("refresh-1");
    });

    test.each([
      [
        "no grant type",
        { oauthGrantType: undefined },
        "OAuth grant type must be one of: Client Credentials, Refresh Token.",
      ],
      [
        "an unsupported grant type",
        { oauthGrantType: "Password" },
        "OAuth grant type must be one of",
      ],
      [
        "no token URL",
        { oauthTokenUrl: "" },
        "Token URL is required for an OAuth 2.0 variable.",
      ],
      [
        "a token URL that is not a URL",
        { oauthTokenUrl: "login.example.com/token" },
        '"login.example.com/token" is not a valid token URL.',
      ],
      [
        "a token URL that is not http or https",
        { oauthTokenUrl: "ftp://login.example.com/token" },
        "The token URL must start with https://",
      ],
      [
        "a token URL that is a script",
        { oauthTokenUrl: "javascript:alert(1)" },
        "The token URL must start with https://",
      ],
      [
        "no client ID",
        { oauthClientId: "   " },
        "Client ID is required for an OAuth 2.0 variable.",
      ],
      [
        "a client ID that is not text",
        { oauthClientId: 12345 },
        "Client ID is required for an OAuth 2.0 variable.",
      ],
      [
        "client credentials without a client secret",
        { oauthClientSecret: "" },
        "Client secret is required for the Client Credentials grant.",
      ],
      [
        "a refresh token grant without a refresh token",
        {
          oauthGrantType: OAuth2GrantType.RefreshToken,
          oauthRefreshToken: " ",
        },
        "Refresh token is required for the Refresh Token grant.",
      ],
      [
        "a client secret that is not text",
        { oauthClientSecret: { value: "x" } },
        "Client secret must be text.",
      ],
      [
        "a reserved additional parameter",
        { oauthAdditionalParameters: { client_secret: "sneaky" } },
        '"client_secret" cannot be set as an additional parameter',
      ],
      [
        "an additional parameter that is an object",
        { oauthAdditionalParameters: { audience: { nested: true } } },
        'The additional parameter "audience" must be text',
      ],
      [
        "an unknown client authentication method",
        { oauthClientAuthenticationMethod: "private_key_jwt" },
        "Client authentication must be HTTP Basic Header or Request Body.",
      ],
    ])(
      "refuses %s",
      async (
        _label: string,
        overrides: Record<string, unknown>,
        message: string,
      ) => {
        const attempt: Promise<WorkflowVariable> = create(
          oauthCreateValues(overrides),
        );

        await expect(attempt).rejects.toThrow(BadDataException);
        await expect(create(oauthCreateValues(overrides))).rejects.toThrow(
          message,
        );
      },
    );

    // Self-hosted identity providers often live on the internal network.
    test("accepts an http token URL", async () => {
      const created: WorkflowVariable = await create(
        oauthCreateValues({
          oauthTokenUrl:
            "http://keycloak.internal:8080/realms/ops/protocol/openid-connect/token",
        }),
      );

      expect(created.oauthTokenUrl).toContain("http://keycloak.internal:8080");
    });
  });

  describe("updating an OAuth 2.0 variable", () => {
    /*
     * A value typed over the token would never be used - the variable's value
     * is the token OneUptime fetches - so it is refused rather than silently
     * ignored.
     */
    test("refuses typed content", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      await expect(update({ content: "a pasted token" })).rejects.toThrow(
        '"API_TOKEN" is an OAuth 2.0 variable. Its value is the access token OneUptime fetches',
      );
    });

    test("drops empty content instead of writing it", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      const result: { data: Record<string, unknown> } = await update({
        content: "",
        description: "note",
      });

      expect(result.data).not.toHaveProperty("content");
      expect(result.data["description"]).toBe("note");
    });

    test("reads the row it updates, with the columns the rules need", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      await update({ oauthScope: "api.write" });

      expect(findByCalls).toHaveLength(1);
      expect(findByCalls[0]!["select"]).toEqual(
        expect.objectContaining({
          variableType: true,
          oauthGrantType: true,
          oauthTokenUrl: true,
          oauthClientSecret: true,
          oauthRefreshToken: true,
          oauthScope: true,
        }),
      );
      expect(findByCalls[0]!["props"]).toEqual({ isRoot: true });
    });

    test("validates and trims a new token URL", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      await expect(update({ oauthTokenUrl: "not a url" })).rejects.toThrow(
        '"not a url" is not a valid token URL.',
      );

      const result: { data: Record<string, unknown> } = await update({
        oauthTokenUrl: " https://login.example.com/v2/token ",
      });

      expect(result.data["oauthTokenUrl"]).toBe(
        "https://login.example.com/v2/token",
      );
    });

    test("refuses to blank the client ID", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      await expect(update({ oauthClientId: "" })).rejects.toThrow(
        "Client ID is required for an OAuth 2.0 variable.",
      );
    });

    test("refuses to remove the secret of a client credentials variable", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      await expect(update({ oauthClientSecret: "" })).rejects.toThrow(
        'The client secret of "API_TOKEN" cannot be removed',
      );
    });

    // A Refresh Token variable may become a public client.
    test("lets a refresh token variable drop its client secret", async () => {
      rowsBeingUpdated([
        storedOAuthRow({
          oauthGrantType: OAuth2GrantType.RefreshToken,
          oauthRefreshToken: "refresh-1",
        }),
      ]);

      const result: { data: Record<string, unknown> } = await update({
        oauthClientSecret: "",
      });

      expect(result.data["oauthClientSecret"]).toBeNull();
    });

    test("refuses to remove a refresh token variable's refresh token", async () => {
      rowsBeingUpdated([
        storedOAuthRow({
          oauthGrantType: OAuth2GrantType.RefreshToken,
          oauthRefreshToken: "refresh-1",
        }),
      ]);

      await expect(update({ oauthRefreshToken: "" })).rejects.toThrow(
        'The refresh token of "API_TOKEN" cannot be removed',
      );
    });

    test("refuses a refresh token on a client credentials variable", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      await expect(update({ oauthRefreshToken: "refresh-1" })).rejects.toThrow(
        '"API_TOKEN" uses the Client Credentials grant, which does not use a refresh token.',
      );
    });

    test("normalises new additional parameters and refuses reserved ones", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      await expect(
        update({ oauthAdditionalParameters: { GRANT_TYPE: "password" } }),
      ).rejects.toThrow("cannot be set as an additional parameter");

      const result: { data: Record<string, unknown> } = await update({
        oauthAdditionalParameters: { resource: "https://graph.windows.net" },
      });

      expect(result.data["oauthAdditionalParameters"]).toEqual({
        resource: "https://graph.windows.net",
      });
    });

    test("falls back to the default client authentication when it is blanked", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      const result: { data: Record<string, unknown> } = await update({
        oauthClientAuthenticationMethod: "",
      });

      expect(result.data["oauthClientAuthenticationMethod"]).toBe(
        OAuth2ClientAuthenticationMethod.BasicAuthHeader,
      );

      await expect(
        update({ oauthClientAuthenticationMethod: "tls_client_auth" }),
      ).rejects.toThrow("Client authentication must be");
    });

    /*
     * The secret flag is already a ratchet (see WorkflowVariableRenameUniqueness)
     * and an OAuth variable is created secret, so it can never be un-marked.
     */
    test("cannot be made non-secret", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      await expect(update({ isSecret: false })).rejects.toThrow(
        "a secret variable cannot be un-marked",
      );
    });
  });

  describe("which updates throw the cached token away", () => {
    function idsToInvalidate(carryForward: unknown): Array<string> {
      return (
        (carryForward as { invalidateOAuthTokenForIds?: Array<string> })
          ?.invalidateOAuthTokenForIds || []
      );
    }

    test.each([
      [
        "the token URL",
        { oauthTokenUrl: "https://login.example.com/v2/token" },
      ],
      ["the client ID", { oauthClientId: "client-456" }],
      ["the client secret", { oauthClientSecret: "rotated-secret" }],
      ["the scope", { oauthScope: "api.write" }],
      ["the scope, cleared", { oauthScope: "" }],
      [
        "the additional parameters",
        {
          oauthAdditionalParameters: { audience: "https://other.example.com" },
        },
      ],
      [
        "the client authentication",
        {
          oauthClientAuthenticationMethod:
            OAuth2ClientAuthenticationMethod.RequestBody,
        },
      ],
    ])(
      "a change to %s",
      async (_label: string, data: Record<string, unknown>) => {
        rowsBeingUpdated([storedOAuthRow()]);

        const result: { carryForward: unknown } = await update(data);

        expect(idsToInvalidate(result.carryForward)).toEqual([
          VARIABLE_ID.toString(),
        ]);
      },
    );

    test("a new refresh token", async () => {
      rowsBeingUpdated([
        storedOAuthRow({
          oauthGrantType: OAuth2GrantType.RefreshToken,
          oauthRefreshToken: "refresh-1",
        }),
      ]);

      const result: { carryForward: unknown } = await update({
        oauthRefreshToken: "refresh-2",
      });

      expect(idsToInvalidate(result.carryForward)).toEqual([
        VARIABLE_ID.toString(),
      ]);
    });

    /*
     * The edit form posts every setting it shows, changed or not. Reading that
     * as a change would throw a good token away every time somebody fixed a
     * typo in the description.
     */
    test("not an edit that sends the same settings back", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      const result: { carryForward: unknown } = await update({
        name: "API_TOKEN",
        description: "fixed a typo",
        oauthTokenUrl: "https://login.example.com/oauth2/token ",
        oauthClientId: "client-123",
        oauthScope: " api.read",
        oauthAdditionalParameters: { audience: "https://api.example.com" },
        oauthClientAuthenticationMethod:
          OAuth2ClientAuthenticationMethod.BasicAuthHeader,
      });

      expect(idsToInvalidate(result.carryForward)).toEqual([]);
    });

    test("not a client secret that is the one already saved", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      const result: { carryForward: unknown } = await update({
        oauthClientSecret: "client-secret",
      });

      expect(idsToInvalidate(result.carryForward)).toEqual([]);
    });

    test("not additional parameters in a different order", async () => {
      rowsBeingUpdated([
        storedOAuthRow({
          oauthAdditionalParameters: { audience: "a", resource: "b" },
        }),
      ]);

      const result: { carryForward: unknown } = await update({
        oauthAdditionalParameters: { resource: "b", audience: "a" },
      });

      expect(idsToInvalidate(result.carryForward)).toEqual([]);
    });

    test("not a rename or a description change", async () => {
      rowsBeingUpdated([storedOAuthRow()]);
      jest.spyOn(WorkflowVariableService, "countBy").mockResolvedValue({
        toNumber: () => {
          return 0;
        },
      } as never);

      const result: OnUpdate<WorkflowVariable> =
        await internals().onBeforeUpdate(
          updateBy({ name: "RENAMED_TOKEN", description: "x" }),
        );

      expect(idsToInvalidate(result.carryForward)).toEqual([]);
    });
  });

  describe("updating a Static variable", () => {
    /*
     * The edit form for a Static variable still posts the OAuth fields it hid
     * (with null values, or their defaults). Refusing them would make every
     * Static variable uneditable; they are dropped instead.
     */
    test("drops the OAuth fields the edit form posts", async () => {
      rowsBeingUpdated([storedStaticRow()]);

      const result: { data: Record<string, unknown>; carryForward: unknown } =
        await update({
          description: "new description",
          oauthTokenUrl: null,
          oauthClientId: null,
          oauthScope: null,
          oauthAdditionalParameters: {},
          oauthClientAuthenticationMethod:
            OAuth2ClientAuthenticationMethod.BasicAuthHeader,
        });

      expect(result.data).toEqual({ description: "new description" });
    });

    test("drops OAuth settings with values too, so nothing is stored", async () => {
      rowsBeingUpdated([storedStaticRow()]);

      const result: { data: Record<string, unknown> } = await update({
        oauthTokenUrl: "https://login.example.com/token",
        oauthClientSecret: "not-for-a-static-variable",
      });

      expect(result.data).toEqual({});
    });

    test("still takes new content", async () => {
      rowsBeingUpdated([storedStaticRow()]);

      const result: { data: Record<string, unknown> } = await update({
        content: "rotated-token",
      });

      expect(result.data["content"]).toBe("rotated-token");
    });
  });

  describe("an update matching both kinds", () => {
    test("refuses OAuth settings", async () => {
      rowsBeingUpdated([
        storedOAuthRow(),
        storedStaticRow({ _id: OTHER_VARIABLE_ID.toString() }),
      ]);

      await expect(update({ oauthScope: "api.write" })).rejects.toThrow(
        "OAuth settings can only be changed on OAuth 2.0 variables",
      );
    });

    test("refuses typed content", async () => {
      rowsBeingUpdated([
        storedOAuthRow(),
        storedStaticRow({ _id: OTHER_VARIABLE_ID.toString() }),
      ]);

      await expect(update({ content: "value" })).rejects.toThrow(
        "is an OAuth 2.0 variable",
      );
    });
  });

  describe("updates that do not touch type-dependent columns", () => {
    test("read nothing", async () => {
      rowsBeingUpdated([storedOAuthRow()]);

      await update({ description: "just a note" });

      expect(findByCalls).toHaveLength(0);
    });
  });

  describe("after the update is written", () => {
    let writes: Array<{
      id: string;
      data: Record<string, unknown>;
      props: unknown;
    }>;

    beforeEach(() => {
      writes = [];

      jest
        .spyOn(WorkflowVariableService, "updateOneById")
        .mockImplementation(async (input: unknown) => {
          const typed: {
            id: ObjectID;
            data: Record<string, unknown>;
            props: unknown;
          } = input as {
            id: ObjectID;
            data: Record<string, unknown>;
            props: unknown;
          };

          writes.push({
            id: typed.id.toString(),
            data: typed.data,
            props: typed.props,
          });

          return 1 as never;
        });
    });

    function onUpdate(carryForward: unknown): OnUpdate<WorkflowVariable> {
      return {
        updateBy: updateBy({}),
        carryForward,
      };
    }

    test("clears the cached token of each variable whose settings changed", async () => {
      await internals().onUpdateSuccess(
        onUpdate({ invalidateOAuthTokenForIds: [VARIABLE_ID.toString()] }),
        [VARIABLE_ID],
      );

      expect(writes).toEqual([
        {
          id: VARIABLE_ID.toString(),
          data: {
            oauthAccessToken: null,
            oauthAccessTokenExpiresAt: null,
            oauthLastRefreshedAt: null,
            oauthLastRefreshError: null,
            oauthLastRefreshErrorAt: null,
          },
          props: { isRoot: true, ignoreHooks: true },
        },
      ]);
    });

    /*
     * Only rows the write actually touched. A row the permission layer filtered
     * out after onBeforeUpdate ran, or one deleted mid-update, must keep its
     * token - its settings did not change.
     */
    test("leaves a variable the write did not touch alone", async () => {
      await internals().onUpdateSuccess(
        onUpdate({
          invalidateOAuthTokenForIds: [
            VARIABLE_ID.toString(),
            OTHER_VARIABLE_ID.toString(),
          ],
        }),
        [OTHER_VARIABLE_ID],
      );

      expect(
        writes.map((write: { id: string }) => {
          return write.id;
        }),
      ).toEqual([OTHER_VARIABLE_ID.toString()]);
    });

    test("does nothing when no settings changed", async () => {
      await internals().onUpdateSuccess(onUpdate(null), [VARIABLE_ID]);
      await internals().onUpdateSuccess(
        onUpdate({ invalidateOAuthTokenForIds: [] }),
        [VARIABLE_ID],
      );

      expect(writes).toHaveLength(0);
    });

    /*
     * The settings are already saved; failing now would report an error for a
     * save that happened. The old token is used until it expires or somebody
     * presses Refresh now - so the miss is logged, not thrown.
     */
    test("logs rather than throws when the clear fails", async () => {
      (
        WorkflowVariableService.updateOneById as unknown as {
          mockImplementation: (fn: () => Promise<void>) => void;
        }
      ).mockImplementation(async () => {
        throw new Error("database is down");
      });

      const logged: unknown = jest
        .spyOn(logger, "error")
        .mockImplementation((): void => {
          return undefined;
        });

      await expect(
        internals().onUpdateSuccess(
          onUpdate({ invalidateOAuthTokenForIds: [VARIABLE_ID.toString()] }),
          [VARIABLE_ID],
        ),
      ).resolves.toBeDefined();

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("Could not clear the cached OAuth token"),
      );
    });
  });

  describe("the column lists the rules are built on", () => {
    test("every editable OAuth setting is an OAuth column", () => {
      for (const column of OAUTH2_EDITABLE_SETTINGS_COLUMNS) {
        expect(OAUTH2_COLUMNS).toContain(column);
      }
    });

    test("every OAuth column exists on the model", () => {
      const variable: WorkflowVariable = new WorkflowVariable();

      for (const column of OAUTH2_COLUMNS) {
        expect(variable.isTableColumn(column as string)).toBe(true);
      }
    });

    /*
     * A new oauth* column that nobody added to OAUTH2_COLUMNS would be kept on
     * a Static variable, and would not count as a type-dependent write.
     */
    test("every oauth* column on the model is in the list", () => {
      const variable: WorkflowVariable = new WorkflowVariable();

      const oauthColumns: Array<string> = variable
        .getTableColumns()
        .columns.filter((column: string) => {
          return column.startsWith("oauth");
        });

      expect([...oauthColumns].sort()).toEqual(
        [...OAUTH2_COLUMNS].map(String).sort(),
      );
    });
  });
});
