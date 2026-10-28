import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Test buttons of LLM providers, on the three pages that offer one:
 * Project Settings > AI > LLM Providers (a row's Test), a provider's own page
 * (the card's Test) and the Admin Dashboard's Global LLM Providers.
 *
 * Who may press it is who the server lets test (LlmProviderTestAccess):
 * whoever may change the provider. Everyone else who may see the provider -
 * a Viewer, a Settings Viewer, Read LLM - finds Test locked, and its tooltip
 * is the server's refusal word for word: the sentence, then who may. An
 * unlocked Test has no tooltip: the dialog it opens says what it does, and
 * a tooltip on it popped up again each time that dialog closed and handed
 * the button its focus back. Before the permission snapshot has landed
 * nothing is said, and nothing offered. Pressed, it opens the one Test
 * dialog (TestLlmProviderModal), which tests the provider with the page's
 * headers: the project's, or none from the Admin Dashboard.
 *
 * The tables and the detail card are captured instead of drawn: their
 * buttons are what is under test.
 */

const mockTables: Array<Record<string, unknown>> = [];
const mockDetails: Array<Record<string, unknown>> = [];

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

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode | undefined }): ReactElement => {
      return <main>{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import LlmProvidersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviders";
import LlmProviderViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/LlmProviderView";
import AdminLlmProvidersPage from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/LlmProviders/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import API from "../../../UI/Utils/API/API";
import {
  LLM_PROVIDER_TEST_CHECKS,
  LLM_PROVIDER_TEST_SENDING,
} from "../../../UI/Utils/LlmProviderTestCopy";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { dashboardTestBody } from "../../Helpers/LlmProviderTestRequest";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const PROVIDER_ID: string = "33333333-3333-4333-8333-333333333333";

const PROJECT_HEADERS: Record<string, string> = { tenantid: PROJECT_ID };

// The server's refusal (LlmProviderTestAccess.getRefusalMessage), word for word.
const REFUSAL: string =
  "You do not have permission to test this LLM provider. You need this permission: Edit LLM.";

const TESTERS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a project member", [Permission.ProjectMember]],
  ["a settings admin", [Permission.SettingsAdmin]],
  ["a settings member", [Permission.SettingsMember]],
  [
    "someone holding Edit LLM",
    [Permission.ReadProjectLlm, Permission.EditProjectLlm],
  ],
];

const NOT_TESTERS: Array<[string, Array<Permission>]> = [
  ["a viewer", [Permission.Viewer]],
  ["a settings viewer", [Permission.SettingsViewer]],
  ["someone holding Read LLM", [Permission.ReadProjectLlm]],
];

let fetchMock: MockFunction;

function row(
  permission: Permission,
  isBlockPermission: boolean,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: isBlockPermission,
  } as UserPermission;
}

// The permission snapshot the Dashboard holds for the signed-in member.
function signedInAs(
  permissions: Array<Permission>,
  blocks: Array<Permission> = [],
): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(permissions as never);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: [
      ...permissions.map((permission: Permission): UserPermission => {
        return row(permission, false);
      }),
      ...blocks.map((permission: Permission): UserPermission => {
        return row(permission, true);
      }),
    ],
  } as unknown as UserTenantAccessPermission);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
}

function rowTest(): ActionButtonSchema<LlmProvider> {
  const table: Record<string, unknown> | undefined = mockTables.find(
    (props: Record<string, unknown>) => {
      return props["id"] === "project-llms-table";
    },
  );

  const button: ActionButtonSchema<LlmProvider> | undefined = (
    (table?.["actionButtons"] || []) as Array<ActionButtonSchema<LlmProvider>>
  ).find((action: ActionButtonSchema<LlmProvider>) => {
    return action.title === "Test";
  });

  if (!button) {
    throw new Error("The providers table has no Test action.");
  }

  return button;
}

function cardTest(): CardButtonSchema | undefined {
  const detail: Record<string, unknown> | undefined =
    mockDetails[mockDetails.length - 1];

  return (
    ((detail?.["cardProps"] as JSONObject | undefined)?.["buttons"] ||
      []) as unknown as Array<CardButtonSchema>
  ).find((button: CardButtonSchema) => {
    return button.title === "Test";
  });
}

function provider(): LlmProvider {
  return new LlmProvider(new ObjectID(PROVIDER_ID));
}

beforeEach(() => {
  mockTables.length = 0;
  mockDetails.length = 0;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(PROVIDER_ID));
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue(PROJECT_HEADERS);

  fetchMock = getJestMockFunction();
  fetchMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        success: true,
        supportsToolCalling: true,
        message:
          "Connection successful. The LLM provider responded to a test prompt and used tool calling.",
      },
      {},
    ) as never,
  );
  jest
    .spyOn(API, "fetch")
    .mockImplementation(fetchMock as unknown as typeof API.fetch);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Project Settings > AI > LLM Providers: a row's Test", () => {
  test.each(TESTERS)(
    "%s may press it, and it has no tooltip to pop up",
    (_who: string, permissions: Array<Permission>) => {
      signedInAs(permissions);
      render(<LlmProvidersPage {...({} as unknown as PageComponentProps)} />);

      expect(rowTest().disabled).toBe(false);
      expect(rowTest().tooltip).toBeUndefined();
      expect(rowTest().isVisible?.(provider())).toBe(true);
    },
  );

  test.each(NOT_TESTERS)(
    "%s finds it locked, with the server's refusal as its reason",
    (_who: string, permissions: Array<Permission>) => {
      signedInAs(permissions);
      render(<LlmProvidersPage {...({} as unknown as PageComponentProps)} />);

      expect(rowTest().disabled).toBe(true);
      expect(rowTest().tooltip).toBe(REFUSAL);
      expect(rowTest().isVisible?.(provider())).toBe(true);
    },
  );

  test("a member whose team blocks their role finds it locked, told which block", () => {
    signedInAs([Permission.ProjectMember], [Permission.ProjectMember]);
    render(<LlmProvidersPage {...({} as unknown as PageComponentProps)} />);

    expect(rowTest().disabled).toBe(true);
    expect(rowTest().tooltip).toBe(
      "You do not have permission to test this LLM provider. A team you are on blocks Project Member.",
    );
  });

  test("before the permission snapshot has landed, it is not offered at all", () => {
    signedInAs([]);
    render(<LlmProvidersPage {...({} as unknown as PageComponentProps)} />);

    expect(rowTest().isVisible?.(provider())).toBe(false);
  });

  test("a server administrator may always press it", () => {
    signedInAs([]);
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    render(<LlmProvidersPage {...({} as unknown as PageComponentProps)} />);

    expect(rowTest().disabled).toBe(false);
  });

  test("pressed, it opens the Test dialog, which tests that provider with the project's headers", async () => {
    signedInAs([Permission.ProjectMember]);
    render(<LlmProvidersPage {...({} as unknown as PageComponentProps)} />);

    const onComplete: MockFunction = getJestMockFunction();

    await act(async () => {
      rowTest().onClick(
        provider(),
        onComplete as unknown as () => void,
        getJestMockFunction() as unknown as (error: Error) => void,
      );
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(
      within(screen.getByTestId("modal")).getByText("Test LLM Provider"),
    ).toBeInTheDocument();

    const request: { data: JSONObject; headers: Record<string, string> } =
      fetchMock.mock.calls[0]![0] as never;
    expect(request.data).toEqual(dashboardTestBody(PROVIDER_ID));
    expect(request.headers).toEqual(PROJECT_HEADERS);
  });
});

describe("a provider's own page: the card's Test", () => {
  test.each(TESTERS)(
    "%s may press it, and it has no tooltip to pop up when the dialog closes",
    (_who: string, permissions: Array<Permission>) => {
      signedInAs(permissions);
      render(
        <LlmProviderViewPage {...({} as unknown as PageComponentProps)} />,
      );

      expect(cardTest()?.disabled).toBe(false);
      expect(cardTest()?.tooltip).toBeUndefined();
    },
  );

  test.each(NOT_TESTERS)(
    "%s finds it locked, with the server's refusal as its reason, and pressing it opens nothing",
    async (_who: string, permissions: Array<Permission>) => {
      signedInAs(permissions);
      render(
        <LlmProviderViewPage {...({} as unknown as PageComponentProps)} />,
      );

      expect(cardTest()?.disabled).toBe(true);
      expect(cardTest()?.tooltip).toBe(REFUSAL);

      await act(async () => {
        cardTest()!.onClick();
      });

      expect(screen.queryByTestId("modal")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("before the permission snapshot has landed, the card has no Test", () => {
    signedInAs([]);
    render(<LlmProviderViewPage {...({} as unknown as PageComponentProps)} />);

    expect(cardTest()).toBeUndefined();
  });

  test("pressed, it tests this provider with the project's headers", async () => {
    signedInAs([Permission.SettingsMember]);
    render(<LlmProviderViewPage {...({} as unknown as PageComponentProps)} />);

    await act(async () => {
      cardTest()!.onClick();
    });

    const request: { data: JSONObject; headers: Record<string, string> } =
      fetchMock.mock.calls[0]![0] as never;
    expect(request.data).toEqual(dashboardTestBody(PROVIDER_ID));
    expect(request.headers).toEqual(PROJECT_HEADERS);
  });
});

describe("Admin Dashboard > Settings > Global LLM Providers: a row's Test", () => {
  test("pressed, it tests the global provider with no project, saying what it does as the Dashboard says it", async () => {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    // Held open, so the dialog says what it is doing.
    fetchMock.mockImplementation((): Promise<unknown> => {
      return new Promise(() => {});
    });

    render(<AdminLlmProvidersPage />);

    const table: Record<string, unknown> | undefined = mockTables.find(
      (props: Record<string, unknown>) => {
        return props["id"] === "llms-table";
      },
    );
    const test: ActionButtonSchema<LlmProvider> = (
      table!["actionButtons"] as Array<ActionButtonSchema<LlmProvider>>
    ).find((action: ActionButtonSchema<LlmProvider>) => {
      return action.title === "Test";
    })!;

    await act(async () => {
      test.onClick(
        provider(),
        getJestMockFunction() as unknown as () => void,
        getJestMockFunction() as unknown as (error: Error) => void,
      );
    });

    expect(
      within(screen.getByTestId("modal")).getByText(LLM_PROVIDER_TEST_SENDING),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("modal")).getByText(LLM_PROVIDER_TEST_CHECKS),
    ).toBeInTheDocument();

    const request: { data: JSONObject; headers?: Record<string, string> } =
      fetchMock.mock.calls[0]![0] as never;
    expect(request.data).toEqual(dashboardTestBody(PROVIDER_ID));
    expect(request.headers?.["tenantid"]).toBeUndefined();
  });
});
