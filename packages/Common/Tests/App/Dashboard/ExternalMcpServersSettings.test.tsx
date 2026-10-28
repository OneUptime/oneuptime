import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * SETTINGS → AI → EXTERNAL MCP SERVERS, as people use it.
 *
 * The maintainer: "have a way where OneUptime AI can integrate with MCP
 * tools or MCP servers ... in project settings ... We make it as simple as
 * possible for users to understand and use."
 *
 *   - Adding one asks where it is (a name and its address, what it is for
 *     folded under More fields), then how OneUptime signs in - one card per
 *     way - and only what that way needs; OAuth gets a step of its own.
 *     The address and the headers are checked with the server's own
 *     sentences before anything is sent.
 *   - Test connection says what OneUptime found: the server, how it talks,
 *     and each tool with whether it only reads - or why it could not
 *     connect and what to check. It is for whoever may change the server;
 *     everyone else finds it locked, saying who may.
 *   - The list says how each server is doing; a server's page has its
 *     details, the switch that lets OneUptime AI use it, and its tools.
 *
 * Tables, detail cards and switch cards are captured instead of drawn:
 * their props are what is under test.
 */

const mockTables: Array<Record<string, unknown>> = [];
const mockDetails: Array<Record<string, unknown>> = [];
const mockSwitches: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockTables.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockDetails.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelSwitch/ModelSwitchCard", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockSwitches.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiNotice",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import ExternalMcpServersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ExternalMcpServers";
import ExternalMcpServerViewPage, {
  getTurnOffExternalMcpServerConfirmation,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ExternalMcpServerView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  EXTERNAL_MCP_SERVER_AUTH_OPTIONS,
  EXTERNAL_MCP_SERVER_FAILURE_HINTS,
  EXTERNAL_MCP_SERVER_TOOLS_SHOWN,
  ExternalMcpServerStatusKind,
  getExternalMcpServerAuthTitle,
  getExternalMcpServerFailureHint,
  getExternalMcpServerStatus,
  getInvestigationRuleMoreFieldsSummary,
  INVESTIGATION_RULE_MORE_FIELDS_SUMMARIES,
  hasRuleMcpServers,
  readStoredExternalMcpServerTools,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerCopy";
import {
  getExternalMcpServerFormFields,
  getExternalMcpServerFormSteps,
  getFormHeadersProblem,
  getFormUrlProblem,
  readFormHeaders,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerFormFields";
import { readExternalMcpServerCheck } from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerTestApi";
import TestExternalMcpServerModal from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/TestExternalMcpServerModal";
import RuleMcpServersFieldHint from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/RuleMcpServersFieldHint";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpServerAuthType from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import {
  ExternalMcpServerConnectionCheck,
  ExternalMcpServerFailureKind,
} from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import ExternalMcpServerTransport from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import Field, {
  CustomElementProps,
} from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../UI/Components/Types/FieldType";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";

const PROJECT_ID: string = "ca1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01";
const SERVER_ID: string = "ca1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02";

const PROJECT_HEADERS: Record<string, string> = { tenantid: PROJECT_ID };

const REFUSAL: string =
  "You do not have permission to test this MCP server. You need one of these roles: Project Owner, Project Admin.";

const CONNECTED: JSONObject = {
  isConnected: true,
  message:
    'Connected to "aws-mcp" over Streamable HTTP. It offers 2 tools, 1 of them only reads.',
  transport: ExternalMcpServerTransport.StreamableHttp,
  serverName: "aws-mcp",
  serverVersion: "1.4.0",
  tools: [
    {
      name: "describe_instances",
      description: "Lists the EC2 instances.",
      readsOnly: true,
    },
    { name: "reboot_instance", readsOnly: false },
  ],
  toolsLeftOut: 0,
  durationInMs: 120,
};

const REFUSED: JSONObject = {
  isConnected: false,
  message: "The server refused the sign-in (HTTP 401).",
  failureKind: ExternalMcpServerFailureKind.SignInRefused,
  tools: [],
  toolsLeftOut: 0,
  durationInMs: 30,
};

let fetchMock: MockFunction;

type ServerFormValues = FormValues<ExternalMcpServer>;

function values(fields: Record<string, unknown>): ServerFormValues {
  return fields as unknown as ServerFormValues;
}

function signedInAs(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(permissions as never);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    }),
  } as unknown as UserTenantAccessPermission);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
}

function answerTestWith(answer: JSONObject | HTTPErrorResponse): void {
  fetchMock.mockResolvedValue(
    (answer instanceof HTTPErrorResponse
      ? answer
      : new HTTPResponse<JSONObject>(200, answer, {})) as never,
  );
}

function fields(): Array<Field<ExternalMcpServer>> {
  return getExternalMcpServerFormFields();
}

function fieldNamed(key: string): Field<ExternalMcpServer> {
  const field: Field<ExternalMcpServer> | undefined = fields().find(
    (candidate: Field<ExternalMcpServer>): boolean => {
      return Object.keys(candidate.field || {})[0] === key;
    },
  );

  if (!field) {
    throw new Error(`The form has no ${key}.`);
  }

  return field;
}

// A form's steps, by id and title.
function stepIds(steps: unknown): Array<[string, string]> {
  return ((steps || []) as Array<FormStep<ExternalMcpServer>>).map(
    (step: FormStep<ExternalMcpServer>): [string, string] => {
      return [step.id, step.title];
    },
  );
}

function isRequired(
  field: Field<ExternalMcpServer>,
  formValues: ServerFormValues,
): boolean {
  return typeof field.required === "function"
    ? field.required(formValues)
    : Boolean(field.required);
}

function serverTable(): Record<string, unknown> {
  const table: Record<string, unknown> | undefined = mockTables.find(
    (props: Record<string, unknown>) => {
      return props["id"] === "external-mcp-servers-table";
    },
  );

  if (!table) {
    throw new Error("The page drew no servers table.");
  }

  return table;
}

function rowTest(): ActionButtonSchema<ExternalMcpServer> {
  const button: ActionButtonSchema<ExternalMcpServer> | undefined = (
    (serverTable()["actionButtons"] || []) as Array<
      ActionButtonSchema<ExternalMcpServer>
    >
  ).find((action: ActionButtonSchema<ExternalMcpServer>) => {
    return action.title === "Test";
  });

  if (!button) {
    throw new Error("The servers table has no Test action.");
  }

  return button;
}

beforeEach(() => {
  mockTables.length = 0;
  mockDetails.length = 0;
  mockSwitches.length = 0;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(SERVER_ID));
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue(PROJECT_HEADERS);

  fetchMock = getJestMockFunction();
  answerTestWith(CONNECTED);
  jest
    .spyOn(API, "fetch")
    .mockImplementation(fetchMock as unknown as typeof API.fetch);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the add / edit form", () => {
  test("asks where the server is, then how to sign in; OAuth gets a step of its own", () => {
    const steps: Array<FormStep<ExternalMcpServer>> =
      getExternalMcpServerFormSteps();

    expect(
      steps.map((step: FormStep<ExternalMcpServer>) => {
        return [step.id, step.title];
      }),
    ).toEqual([
      ["server", "Server"],
      ["authentication", "Authentication"],
      ["oauth", "OAuth"],
    ]);

    const oauth: FormStep<ExternalMcpServer> = steps[2]!;
    expect(oauth.showIf!(values({}))).toBe(false);
    expect(
      oauth.showIf!(
        values({ authType: ExternalMcpServerAuthType.BearerToken }),
      ),
    ).toBe(false);
    expect(
      oauth.showIf!(
        values({ authType: ExternalMcpServerAuthType.OAuthClientCredentials }),
      ),
    ).toBe(true);
  });

  test("each field on its step; what most people never change is folded", () => {
    expect(
      fields().map((field: Field<ExternalMcpServer>) => {
        return [
          Object.keys(field.field || {})[0],
          field.stepId,
          field.collapsibleSection?.title || "",
        ];
      }),
    ).toEqual([
      ["name", "server", ""],
      ["url", "server", ""],
      ["description", "server", MORE_FIELDS_SECTION_TITLE],
      ["authType", "authentication", ""],
      ["bearerToken", "authentication", ""],
      ["headers", "authentication", ""],
      ["oauthTokenUrl", "oauth", ""],
      ["oauthClientId", "oauth", ""],
      ["oauthClientSecret", "oauth", ""],
      ["oauthScope", "oauth", MORE_FIELDS_SECTION_TITLE],
      ["oauthAudience", "oauth", MORE_FIELDS_SECTION_TITLE],
    ]);

    // Two folds, one per step: the OAuth one is its own.
    expect(fieldNamed("description").collapsibleSection?.id).not.toBe(
      fieldNamed("oauthScope").collapsibleSection?.id,
    );
  });

  test("Authentication is one card per way of signing in, starting from none", () => {
    const authType: Field<ExternalMcpServer> = fieldNamed("authType");

    expect(authType.fieldType).toBe(FormFieldSchemaType.CardSelect);
    expect(
      // The cards are plain options, in no group (EXTERNAL_MCP_SERVER_AUTH_OPTIONS).
      ((authType.cardSelectOptions || []) as Array<CardSelectOption>).map(
        (option: CardSelectOption) => {
          return [option.value, option.title];
        },
      ),
    ).toEqual([
      [ExternalMcpServerAuthType.None, "No sign-in"],
      [ExternalMcpServerAuthType.BearerToken, "Bearer token"],
      [ExternalMcpServerAuthType.Headers, "Custom headers"],
      [
        ExternalMcpServerAuthType.OAuthClientCredentials,
        "OAuth client credentials",
      ],
    ]);
    expect(EXTERNAL_MCP_SERVER_AUTH_OPTIONS).toHaveLength(4);
  });

  test("the four cards read top to bottom, each said in one short line", () => {
    const authType: Field<ExternalMcpServer> = fieldNamed("authType");

    /*
     * One a row, as the rule dialogs' Approval cards: two columns squeezed
     * each description into four or five lines, and German titles into two.
     */
    expect(authType.cardSelectSingleColumn).toBe(true);
    expect(authType.cardSelectMaxColumns).toBeUndefined();

    expect(
      ((authType.cardSelectOptions || []) as Array<CardSelectOption>).map(
        (option: CardSelectOption) => {
          return option.description;
        },
      ),
    ).toEqual([
      "For a server that needs no sign-in.",
      "An API token or key from the server.",
      "Headers the server asks for, such as X-API-Key.",
      "A token from your identity provider, such as Microsoft Entra ID or Amazon Cognito.",
    ]);
  });

  test.each([
    [ExternalMcpServerAuthType.None, []],
    [ExternalMcpServerAuthType.BearerToken, ["bearerToken"]],
    [ExternalMcpServerAuthType.Headers, ["headers"]],
    [
      ExternalMcpServerAuthType.OAuthClientCredentials,
      [
        "oauthTokenUrl",
        "oauthClientId",
        "oauthClientSecret",
        "oauthScope",
        "oauthAudience",
      ],
    ],
  ])(
    "%s shows only what it needs",
    (authType: ExternalMcpServerAuthType, shown: Array<string>) => {
      const formValues: ServerFormValues = values({ authType });
      const signInFields: Array<string> = [
        "bearerToken",
        "headers",
        "oauthTokenUrl",
        "oauthClientId",
        "oauthClientSecret",
        "oauthScope",
        "oauthAudience",
      ];

      expect(
        signInFields.filter((key: string): boolean => {
          return fieldNamed(key).showIf!(formValues);
        }),
      ).toEqual(shown);
    },
  );

  test("the secrets are required of a new server only, and are never shown", () => {
    expect(
      isRequired(
        fieldNamed("bearerToken"),
        values({ authType: ExternalMcpServerAuthType.BearerToken }),
      ),
    ).toBe(true);
    expect(
      isRequired(
        fieldNamed("headers"),
        values({ authType: ExternalMcpServerAuthType.Headers }),
      ),
    ).toBe(true);
    expect(
      isRequired(
        fieldNamed("oauthClientSecret"),
        values({ authType: ExternalMcpServerAuthType.OAuthClientCredentials }),
      ),
    ).toBe(true);

    for (const key of ["bearerToken", "headers", "oauthClientSecret"]) {
      expect(fieldNamed(key).doNotRequireWhenEditing).toBe(true);
    }

    expect(fieldNamed("bearerToken").fieldType).toBe(
      FormFieldSchemaType.Password,
    );
    expect(fieldNamed("oauthClientSecret").fieldType).toBe(
      FormFieldSchemaType.Password,
    );
    expect(
      isRequired(
        fieldNamed("oauthScope"),
        values({ authType: ExternalMcpServerAuthType.OAuthClientCredentials }),
      ),
    ).toBe(false);
  });

  test("the address is checked in the server's own words", () => {
    expect(getFormUrlProblem(values({}))).toBeNull();
    expect(
      getFormUrlProblem(values({ url: "https://mcp.example.com/mcp" })),
    ).toBeNull();
    expect(getFormUrlProblem(values({ url: "ftp://mcp.example.com" }))).toBe(
      "The URL must start with https:// or http://.",
    );
    expect(
      getFormUrlProblem(values({ url: "https://user:secret@mcp.example.com" })),
    ).toContain("cannot hold a user name or password");
    expect(
      fieldNamed("url").customValidation!(
        values({ url: "ftp://mcp.example.com" }),
      ),
    ).toBe("The URL must start with https:// or http://.");
  });

  test("headers: nothing entered is nothing (kept on an edit); entered ones are checked", () => {
    expect(readFormHeaders(undefined)).toBeUndefined();
    expect(readFormHeaders({})).toBeUndefined();
    expect(readFormHeaders({ "X-API-Key": "abc" })).toEqual({
      "X-API-Key": "abc",
    });

    const headers: (value: unknown) => ServerFormValues = (
      value: unknown,
    ): ServerFormValues => {
      return values({
        authType: ExternalMcpServerAuthType.Headers,
        headers: value,
      });
    };

    expect(getFormHeadersProblem(headers(undefined))).toBeNull();
    expect(getFormHeadersProblem(headers({ "X-API-Key": "abc" }))).toBeNull();
    expect(getFormHeadersProblem(headers({ "User-Agent": "abc" }))).toBe(
      "OneUptime sets the User-Agent header itself. Remove it from the headers.",
    );
    expect(getFormHeadersProblem(headers({ "X-API-Key": "" }))).toBe(
      "The X-API-Key header needs a value.",
    );
    // Another sign-in: the headers are not asked about.
    expect(
      getFormHeadersProblem(
        values({
          authType: ExternalMcpServerAuthType.BearerToken,
          headers: { "User-Agent": "abc" },
        }),
      ),
    ).toBeNull();
  });

  test("headers are entered a row each, a name and a text value", () => {
    const onChange: MockFunction = getJestMockFunction();
    const element: ReactElement | undefined = fieldNamed("headers")
      .getCustomElement!(values({}), {
      onChange: onChange as unknown as CustomElementProps["onChange"],
    });

    render(element!);

    const headers: HTMLElement = screen.getByTestId(
      "external-mcp-server-headers",
    );
    // One empty row from the start, ready to type into; nothing sent yet.
    const names: Array<HTMLElement> = within(headers).getAllByRole("combobox");
    expect(names).toHaveLength(1);
    expect(names[0]).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
    // The value: typed masked, like the Token and the Client Secret.
    const value: HTMLElement = within(headers).getByTestId(
      "external-mcp-server-header-value-0",
    );
    expect(value).toHaveAttribute("type", "password");
    expect(value).toHaveAttribute("placeholder", "Value");

    fireEvent.change(names[0]!, { target: { value: "X-API-Key" } });
    fireEvent.change(value, { target: { value: "abc" } });

    expect(onChange).toHaveBeenLastCalledWith({ "X-API-Key": "abc" });

    // Add Header adds a second row.
    fireEvent.click(screen.getByText("Add Header"));
    expect(within(headers).getAllByRole("combobox")).toHaveLength(2);
    // A header's value is text: no choice of type.
    expect(screen.queryByText("Number")).not.toBeInTheDocument();
  });
});

describe("how a server is doing", () => {
  test("off, then can't connect, then connected, then not checked yet", () => {
    expect(
      getExternalMcpServerStatus({
        isEnabled: false,
        lastError: "x",
        lastConnectedAt: new Date(),
      }),
    ).toBe(ExternalMcpServerStatusKind.Off);
    expect(
      getExternalMcpServerStatus({
        isEnabled: true,
        lastError: "refused",
        lastConnectedAt: new Date(),
      }),
    ).toBe(ExternalMcpServerStatusKind.CannotConnect);
    expect(getExternalMcpServerStatus({ lastConnectedAt: new Date() })).toBe(
      ExternalMcpServerStatusKind.Connected,
    );
    expect(getExternalMcpServerStatus({})).toBe(
      ExternalMcpServerStatusKind.NotChecked,
    );
  });

  test("its tools as last read, and whether they were read at all", () => {
    expect(readStoredExternalMcpServerTools(undefined)).toEqual({
      tools: [],
      changingTools: 0,
      isRead: false,
    });
    expect(
      readStoredExternalMcpServerTools([
        { name: "a", readsOnly: true },
        { name: "b", readsOnly: false },
      ]),
    ).toMatchObject({ changingTools: 1, isRead: true });
  });

  test("names each way of signing in", () => {
    expect(
      getExternalMcpServerAuthTitle(ExternalMcpServerAuthType.Headers),
    ).toBe("Custom headers");
    expect(getExternalMcpServerAuthTitle(undefined)).toBe("No sign-in");
  });

  test("says what to check for every kind of failure", () => {
    for (const kind of Object.values(ExternalMcpServerFailureKind)) {
      expect(EXTERNAL_MCP_SERVER_FAILURE_HINTS[kind]).toBeTruthy();
    }

    expect(getExternalMcpServerFailureHint(undefined)).toBe(
      EXTERNAL_MCP_SERVER_FAILURE_HINTS[ExternalMcpServerFailureKind.Other],
    );
  });

  test("a rule's MCP servers: none picked is all of them, and its folded line says so", () => {
    expect(hasRuleMcpServers({})).toBe(false);
    expect(hasRuleMcpServers({ externalMcpServers: [] })).toBe(false);
    expect(hasRuleMcpServers({ externalMcpServers: [{ _id: "a" }] })).toBe(
      true,
    );
    // A new rule keeps both defaults: one sentence says so.
    expect(getInvestigationRuleMoreFieldsSummary({})).toEqual([
      "OneUptime AI may use any of your MCP servers and connected repositories.",
    ]);
    expect(INVESTIGATION_RULE_MORE_FIELDS_SUMMARIES.everything).toBe(
      "OneUptime AI may use any of your MCP servers and connected repositories.",
    );
    // Once one is set, each default is said only while it is left as it is.
    expect(
      getInvestigationRuleMoreFieldsSummary({
        externalMcpServers: [{ _id: "a" }],
      }),
    ).toEqual(["OneUptime AI may read all connected repositories."]);
    expect(
      getInvestigationRuleMoreFieldsSummary({
        codeRepositories: [{ _id: "c1111111-1111-4111-8111-111111111111" }],
      }),
    ).toEqual(["OneUptime AI may use all of your MCP servers."]);
    expect(
      getInvestigationRuleMoreFieldsSummary({
        externalMcpServers: [{ _id: "a" }],
        codeRepositories: ["c1111111-1111-4111-8111-111111111111"],
      }),
    ).toBeUndefined();
  });
});

describe("Test connection", () => {
  async function openTest(
    onTested?: (check: ExternalMcpServerConnectionCheck) => void,
  ): Promise<MockFunction> {
    const onClose: MockFunction = getJestMockFunction();

    await act(async () => {
      render(
        <TestExternalMcpServerModal
          externalMcpServerId={SERVER_ID}
          onClose={onClose as unknown as () => void}
          onTested={onTested}
        />,
      );
    });

    return onClose;
  }

  test("tests the server with the project's headers, and lists its tools with whether each only reads", async () => {
    const onTested: MockFunction = getJestMockFunction();
    await openTest(onTested as never);

    const request: {
      url: { toString: () => string };
      data: JSONObject;
      headers: Record<string, string>;
    } = fetchMock.mock.calls[0]![0] as never;
    expect(
      new URL(request.url.toString()).pathname.split("/").slice(-2),
    ).toEqual(["external-mcp-server", "test"]);
    expect(request.data).toEqual({ externalMcpServerId: SERVER_ID });
    expect(request.headers).toEqual(PROJECT_HEADERS);

    await waitFor(() => {
      expect(
        screen.getByTestId("external-mcp-server-test-result"),
      ).toHaveTextContent("aws-mcp 1.4.0 answered over Streamable HTTP.");
    });

    // "Connected" is the headline, said once: the line under it names who.
    const result: HTMLElement = screen.getByTestId(
      "external-mcp-server-test-result",
    );
    expect(within(result).getByText("Connected")).toBeVisible();
    expect(result).not.toHaveTextContent("Connected to");

    // What it found, counted, above the list.
    expect(
      screen.getByTestId("external-mcp-server-test-tool-count"),
    ).toHaveTextContent("2 tools");

    const tools: Array<HTMLElement> = screen.getAllByTestId(
      "external-mcp-server-tool",
    );
    expect(tools).toHaveLength(2);
    expect(tools[0]).toHaveTextContent("describe_instances");
    expect(tools[0]).toHaveTextContent("Reads only");
    expect(tools[0]).toHaveAttribute("data-reads-only", "true");
    expect(tools[1]).toHaveTextContent("May change things");

    expect(onTested).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("external-mcp-server-test-again")).toBeVisible();
  });

  test("a server that does not name itself is the server; one tool is one tool", async () => {
    answerTestWith({
      ...CONNECTED,
      serverName: undefined,
      serverVersion: undefined,
      transport: ExternalMcpServerTransport.Sse,
      tools: [{ name: "describe_instances", readsOnly: true }],
    } as JSONObject);
    await openTest();

    await waitFor(() => {
      expect(
        screen.getByTestId("external-mcp-server-test-result"),
      ).toHaveTextContent("The server answered over SSE.");
    });
    expect(
      screen.getByTestId("external-mcp-server-test-tool-count"),
    ).toHaveTextContent(/^1 tool$/);
  });

  test("a server that cannot be reached says why, and what to check", async () => {
    answerTestWith(REFUSED);
    await openTest();

    await waitFor(() => {
      expect(screen.getByTestId("external-mcp-server-test")).toHaveAttribute(
        "data-outcome",
        "failed",
      );
    });

    const result: HTMLElement = screen.getByTestId(
      "external-mcp-server-test-result",
    );
    expect(result).toHaveTextContent("Could not connect");
    expect(result).toHaveTextContent(
      "The server refused the sign-in (HTTP 401).",
    );
    expect(result).toHaveTextContent(
      "Check the token or headers under Authentication.",
    );
  });

  test("a refused request is answered as a failed test, in the server's words", async () => {
    answerTestWith(
      new HTTPErrorResponse(400, { message: REFUSAL } as JSONObject, {}),
    );
    await openTest();

    await waitFor(() => {
      expect(
        screen.getByTestId("external-mcp-server-test-result"),
      ).toHaveTextContent(REFUSAL);
    });
  });

  test("Test again tests it again", async () => {
    await openTest();

    await waitFor(() => {
      expect(
        screen.getByTestId("external-mcp-server-test-again"),
      ).toBeVisible();
    });

    answerTestWith(REFUSED);

    await act(async () => {
      fireEvent.click(screen.getByTestId("external-mcp-server-test-again"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("external-mcp-server-test")).toHaveAttribute(
        "data-outcome",
        "failed",
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("the answer is read defensively", () => {
    expect(readExternalMcpServerCheck(undefined).isConnected).toBe(false);
    expect(
      readExternalMcpServerCheck({
        isConnected: true,
        transport: "Carrier pigeon",
      }).transport,
    ).toBeUndefined();
    expect(
      readExternalMcpServerCheck({
        isConnected: false,
        failureKind: "Nonsense",
        message: "x",
      }).failureKind,
    ).toBeUndefined();
  });
});

describe("the list", () => {
  test("names the page, links OneUptime's own MCP server, and lists name, address and status", () => {
    signedInAs([Permission.ProjectOwner]);
    render(
      <ExternalMcpServersPage {...({} as unknown as PageComponentProps)} />,
    );

    const table: Record<string, unknown> = serverTable();
    expect(table["modelType"]).toBe(ExternalMcpServer);
    expect((table["cardProps"] as JSONObject)["title"]).toBe(
      "External MCP Servers",
    );
    expect(table["noItemsMessage"]).toBe(
      "No MCP servers yet. Add one to let OneUptime AI use its tools.",
    );
    expect(String(table["documentationLink"])).toBe(
      "/docs/ai/external-mcp-servers",
    );
    expect(
      (table["columns"] as Array<{ title: string }>).map(
        (column: { title: string }) => {
          return column.title;
        },
      ),
    ).toEqual(["Name", "URL", "Status"]);
    expect(stepIds(table["formSteps"])).toEqual(
      stepIds(getExternalMcpServerFormSteps()),
    );
    expect(table["selectMoreFields"]).toEqual({
      isEnabled: true,
      lastError: true,
      tools: true,
    });

    /*
     * Beside the real side menu (a 938px card at 1280px), "View External
     * MCP Server" took 200px of every row and a long address pushed Status
     * out of sight under the row's buttons: the row says View, and the
     * address takes less room than a name - capped through the table's
     * wrapping cap, never contentClassName (TableWrapContentInvariants).
     */
    expect(table["viewButtonText"]).toBe("View");
    const urlColumn: {
      contentClassName?: string;
      wrapContent?: boolean;
      wrapMaxWidthClassName?: string;
      getElement: (item: ExternalMcpServer) => ReactElement;
    } = (
      table["columns"] as Array<{
        title: string;
        contentClassName?: string;
        wrapContent?: boolean;
        wrapMaxWidthClassName?: string;
        getElement: (item: ExternalMcpServer) => ReactElement;
      }>
    ).find((column: { title: string }) => {
      return column.title === "URL";
    })!;
    expect(urlColumn.contentClassName).toBeUndefined();
    expect(urlColumn.wrapContent).toBe(true);
    expect(urlColumn.wrapMaxWidthClassName).toBe(
      "max-w-[16rem] 2xl:max-w-[24rem]",
    );

    // The address itself stays one line, cut short, and whole on hover.
    const longUrl: string =
      "https://mcp.platform-tools.eu-central-1.internal-enterprise-example.com/v1/mcp";
    render(
      urlColumn.getElement(
        Object.assign(new ExternalMcpServer(new ObjectID(SERVER_ID)), {
          url: longUrl,
        }),
      ),
    );
    const urlCell: HTMLElement = screen.getByTestId(
      "external-mcp-server-url-cell",
    );
    expect(urlCell).toHaveTextContent(longUrl);
    expect(urlCell).toHaveAttribute("title", longUrl);
    expect(urlCell).toHaveClass("block", "truncate", "leading-6");

    // The card says what the page is not: OneUptime's own server.
    render((table["cardProps"] as { description: ReactElement }).description);
    expect(
      screen.getByTestId("external-mcp-servers-own-server-link"),
    ).toHaveTextContent("MCP Server");
  });

  test("a row's status is one line: the pill, and beside it how many tools", () => {
    signedInAs([Permission.ProjectOwner]);
    render(
      <ExternalMcpServersPage {...({} as unknown as PageComponentProps)} />,
    );

    const statusColumn: {
      getElement: (item: ExternalMcpServer) => ReactElement;
    } = (
      serverTable()["columns"] as Array<{
        title: string;
        getElement: (item: ExternalMcpServer) => ReactElement;
      }>
    ).find((column: { title: string }) => {
      return column.title === "Status";
    })!;

    render(
      statusColumn.getElement(
        Object.assign(new ExternalMcpServer(new ObjectID(SERVER_ID)), {
          isEnabled: true,
          lastConnectedAt: new Date(),
          tools: [
            { name: "describe_instances", readsOnly: true },
            { name: "reboot_instance", readsOnly: false },
            { name: "get_alarms", readsOnly: true },
          ],
        }),
      ),
    );

    const cell: HTMLElement = screen.getByTestId("external-mcp-server-status");
    expect(cell).toHaveAttribute(
      "data-status",
      ExternalMcpServerStatusKind.Connected,
    );
    // Beside the pill, never under it: every row keeps one line.
    expect(cell).toHaveClass("flex", "items-center", "whitespace-nowrap");
    expect(cell).not.toHaveClass("flex-col");
    expect(cell).not.toHaveClass("flex-wrap");
    expect(
      within(cell).getByTestId("external-mcp-server-tool-count"),
    ).toHaveTextContent("3 tools");
  });

  test("Test is for whoever may change a server; others find it locked, saying who may", () => {
    signedInAs([Permission.ProjectAdmin]);
    render(
      <ExternalMcpServersPage {...({} as unknown as PageComponentProps)} />,
    );
    expect(rowTest().disabled).toBe(false);
    expect(rowTest().tooltip).toBeUndefined();

    cleanup();
    mockTables.length = 0;

    signedInAs([Permission.ProjectMember]);
    render(
      <ExternalMcpServersPage {...({} as unknown as PageComponentProps)} />,
    );
    expect(rowTest().disabled).toBe(true);
    expect(rowTest().tooltip).toBe(REFUSAL);
  });

  test("a server just added is tested at once", async () => {
    signedInAs([Permission.ProjectOwner]);
    render(
      <ExternalMcpServersPage {...({} as unknown as PageComponentProps)} />,
    );

    const onCreateSuccess: (
      item: ExternalMcpServer,
      modalType?: ModalType,
    ) => Promise<ExternalMcpServer> = serverTable()["onCreateSuccess"] as never;

    // An edit does not open it.
    await act(async () => {
      await onCreateSuccess(
        new ExternalMcpServer(new ObjectID(SERVER_ID)),
        ModalType.Edit,
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await onCreateSuccess(
        new ExternalMcpServer(new ObjectID(SERVER_ID)),
        ModalType.Create,
      );
    });

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Test connection",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("a server's page", () => {
  beforeEach(() => {
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(
      Object.assign(new ExternalMcpServer(new ObjectID(SERVER_ID)), {
        isEnabled: true,
        lastError: "The server refused the sign-in (HTTP 401).",
        lastConnectedAt: new Date(),
        lastCheckedAt: new Date(),
        transport: ExternalMcpServerTransport.Sse,
        serverName: "aws-mcp",
        serverVersion: "1.4.0",
        tools: [
          { name: "describe_instances", readsOnly: true },
          { name: "reboot_instance", readsOnly: false },
        ],
      }) as never,
    );
  });

  test("its details, edited with the form it was added with", async () => {
    signedInAs([Permission.ProjectOwner]);

    await act(async () => {
      render(
        <ExternalMcpServerViewPage
          {...({} as unknown as PageComponentProps)}
        />,
      );
    });

    const detail: Record<string, unknown> =
      mockDetails[mockDetails.length - 1]!;
    expect(detail["isEditable"]).toBe(true);
    expect(stepIds(detail["formSteps"])).toEqual(
      stepIds(getExternalMcpServerFormSteps()),
    );
    expect(
      (detail["formFields"] as Array<Field<ExternalMcpServer>>).map(
        (field: Field<ExternalMcpServer>) => {
          return Object.keys(field.field || {})[0];
        },
      ),
    ).toEqual(
      fields().map((field: Field<ExternalMcpServer>) => {
        return Object.keys(field.field || {})[0];
      }),
    );

    // Its ID, on the card's ID line (Detail), for the API and Terraform.
    const detailFields: Array<{
      field?: Record<string, unknown>;
      fieldType?: FieldType;
    }> = (
      detail["modelDetailProps"] as {
        fields: Array<{
          field?: Record<string, unknown>;
          fieldType?: FieldType;
        }>;
      }
    ).fields;
    expect(
      detailFields.find(
        (field: { field?: Record<string, unknown> }): boolean => {
          return Object.keys(field.field || {})[0] === "_id";
        },
      )?.fieldType,
    ).toBe(FieldType.ObjectID);
  });

  test("a switch lets OneUptime AI use it; turning it off asks first", async () => {
    signedInAs([Permission.ProjectOwner]);

    await act(async () => {
      render(
        <ExternalMcpServerViewPage
          {...({} as unknown as PageComponentProps)}
        />,
      );
    });

    const toggle: Record<string, unknown> =
      mockSwitches[mockSwitches.length - 1]!;
    expect(toggle["column"]).toBe("isEnabled");
    expect(toggle["title"]).toBe("Let OneUptime AI use this server");
    expect(getTurnOffExternalMcpServerConfirmation(true)).toBeUndefined();
    expect(getTurnOffExternalMcpServerConfirmation(false)?.title).toBe(
      "Turn this server off?",
    );
  });

  test("its tools as last read, how it is doing, and Test connection", async () => {
    signedInAs([Permission.ProjectOwner]);

    await act(async () => {
      render(
        <ExternalMcpServerViewPage
          {...({} as unknown as PageComponentProps)}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("external-mcp-server-tool")).toHaveLength(2);
    });

    expect(screen.getByTestId("external-mcp-server-status")).toHaveAttribute(
      "data-status",
      ExternalMcpServerStatusKind.CannotConnect,
    );
    expect(
      screen.getByTestId("external-mcp-server-last-error"),
    ).toHaveTextContent("The server refused the sign-in (HTTP 401).");
    expect(
      screen.getByTestId("external-mcp-server-tools-card"),
    ).toHaveTextContent("SSE");

    await act(async () => {
      fireEvent.click(screen.getByText("Test connection"));
    });

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Test connection",
    );
  });
});

describe("a server with many tools", () => {
  const MANY_TOOLS: Array<{ name: string; readsOnly: boolean }> = Array.from(
    { length: 14 },
    (_value: unknown, index: number) => {
      return { name: `tool_${index + 1}`, readsOnly: index % 3 !== 0 };
    },
  );

  beforeEach(() => {
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(
      Object.assign(new ExternalMcpServer(new ObjectID(SERVER_ID)), {
        isEnabled: true,
        lastConnectedAt: new Date(),
        lastCheckedAt: new Date(),
        transport: ExternalMcpServerTransport.StreamableHttp,
        tools: MANY_TOOLS,
      }) as never,
    );
  });

  test("its page lists the first ten, and Show all opens the rest", async () => {
    signedInAs([Permission.ProjectOwner]);

    await act(async () => {
      render(
        <ExternalMcpServerViewPage
          {...({} as unknown as PageComponentProps)}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("external-mcp-server-tool")).toHaveLength(
        EXTERNAL_MCP_SERVER_TOOLS_SHOWN,
      );
    });
    expect(EXTERNAL_MCP_SERVER_TOOLS_SHOWN).toBe(10);

    const toggle: HTMLElement = screen.getByTestId(
      "external-mcp-server-tools-show-all",
    );
    expect(toggle).toHaveTextContent("Show all 14 tools");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The count is the whole list's, in the card's facts line too.
    expect(
      screen.getByTestId("external-mcp-server-tools-card"),
    ).toHaveTextContent("14 tools");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(screen.getAllByTestId("external-mcp-server-tool")).toHaveLength(14);
    expect(toggle).toHaveTextContent("Show fewer");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(screen.getAllByTestId("external-mcp-server-tool")).toHaveLength(10);
  });

  test("the Test dialog lists every tool, in a box of its own that scrolls", async () => {
    answerTestWith({ ...CONNECTED, tools: MANY_TOOLS } as JSONObject);

    await act(async () => {
      render(
        <TestExternalMcpServerModal
          externalMcpServerId={SERVER_ID}
          onClose={() => {}}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("external-mcp-server-tool")).toHaveLength(
        14,
      );
    });
    expect(
      screen.queryByTestId("external-mcp-server-tools-show-all"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("external-mcp-server-test-tool-count"),
    ).toHaveTextContent("14 tools");
  });
});

describe("where it is", () => {
  test("Settings → AI → External MCP Servers, and a server's own page under it", () => {
    expect(RouteMap[PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVERS]?.toString()).toBe(
      "/dashboard/:projectId/settings/external-mcp-servers",
    );
    expect(
      RouteMap[PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVER_VIEW]?.toString(),
    ).toBe("/dashboard/:projectId/settings/external-mcp-servers/:id");
  });

  /*
   * Under a rule's MCP Servers field: where the servers are added. In a new
   * tab, as the Runner field's link to Runbooks › Runners: the rule being
   * edited in its dialog stays, and the picker searches the servers again
   * when it next opens.
   */
  test("a rule's MCP Servers field links to the page, in a new tab", () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));

    render(<RuleMcpServersFieldHint />);

    const hint: HTMLElement = screen.getByTestId("rule-mcp-servers-hint");
    expect(hint).toHaveTextContent(
      "Add and manage MCP servers on the External MCP Servers page.",
    );

    const link: HTMLElement = within(hint).getByTestId("rule-mcp-servers-link");
    expect(link).toHaveTextContent("External MCP Servers");
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/external-mcp-servers`,
    );
    expect(link).toHaveAttribute("target", "_blank");
  });
});
