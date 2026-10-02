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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Disconnecting a workspace in Project Settings (Uninstall OneUptime from
 * Slack / Microsoft Teams) asks the shared store again, so every Workspace
 * menu stops listing it without a reload. Unlinking only your own account
 * does not change what the project has connected, and asks nothing.
 */

interface MockAuthState {
  isProjectConnected: boolean;
  isUserConnected: boolean;
}

const mockAuthState: MockAuthState = {
  isProjectConnected: true,
  isUserConnected: false,
};

const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actualConfig,
    SlackAppClientId: "slack-client-id",
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getQueryStringByName: () => {
        return null;
      },
      navigate: () => {},
      getLocation: () => {
        return { pathname: "/" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: () => {
            return "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
          },
        };
      },
      getCurrentProject: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return {
          toString: () => {
            return "user-id";
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: async () => {
        return { data: {} };
      },
      getFriendlyMessage: (error: unknown) => {
        return String(error);
      },
      getFriendlyErrorMessage: (error: unknown) => {
        return String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      deleteItem: (...args: Array<unknown>) => {
        return deleteItemMock(...args);
      },
      getList: async (data: { modelType: { name?: string } }) => {
        const modelName: string = data.modelType?.name || "";

        if (modelName.includes("Project")) {
          return mockAuthState.isProjectConnected
            ? {
                data: [
                  {
                    id: {
                      toString: () => {
                        return "project-auth-token-id";
                      },
                    },
                    miscData: {
                      teamName: "Acme",
                      adminConsentGranted: true,
                    },
                  },
                ],
                count: 1,
                skip: 0,
                limit: 1,
              }
            : { data: [], count: 0, skip: 0, limit: 1 };
        }

        return mockAuthState.isUserConnected
          ? {
              data: [
                {
                  id: {
                    toString: () => {
                      return "user-auth-token-id";
                    },
                  },
                  miscData: {},
                },
              ],
              count: 1,
              skip: 0,
              limit: 1,
            }
          : { data: [], count: 0, skip: 0, limit: 1 };
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slack/SlackChannelsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="slack-channels-card" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChannelsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="teams-channels-card" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChatsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="teams-chats-card" />;
      },
    };
  },
);

import MicrosoftTeamsIntegration from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegration";
import SlackIntegration from "../../../../App/FeatureSet/Dashboard/src/Components/Slack/SlackIntegration";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";

let refresh: MockFunction;

beforeEach(() => {
  mockAuthState.isProjectConnected = true;
  mockAuthState.isUserConnected = false;
  deleteItemMock.mockReset();
  deleteItemMock.mockResolvedValue(undefined as never);
  refresh = jest
    .spyOn(ConnectedWorkspaces, "refresh")
    .mockResolvedValue(undefined) as unknown as MockFunction;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function click(name: string): Promise<void> {
  const button: HTMLElement = await screen.findByRole("button", { name });

  await act(async () => {
    fireEvent.click(button);
  });
}

describe("Project Settings > Slack", () => {
  async function renderSlack(): Promise<void> {
    await act(async () => {
      render(
        <SlackIntegration onConnected={() => {}} onDisconnected={() => {}} />,
      );
    });
  }

  test("uninstalling OneUptime from Slack asks which workspaces are connected again", async () => {
    await renderSlack();

    await click("Uninstall OneUptime from Slack");

    expect(deleteItemMock).toHaveBeenCalledTimes(1);
    expect(
      (deleteItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(WorkspaceProjectAuthToken);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("a failed uninstall asks nothing", async () => {
    deleteItemMock.mockRejectedValue(new Error("Not allowed") as never);
    await renderSlack();

    await click("Uninstall OneUptime from Slack");

    expect(refresh).not.toHaveBeenCalled();
  });

  test("unlinking only your own Slack account asks nothing", async () => {
    mockAuthState.isUserConnected = true;
    await renderSlack();

    await click("Disconnect");

    expect(
      (deleteItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(WorkspaceUserAuthToken);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Project Settings > Microsoft Teams", () => {
  async function renderTeams(): Promise<void> {
    await act(async () => {
      render(
        <MicrosoftTeamsIntegration
          onConnected={() => {}}
          onDisconnected={() => {}}
        />,
      );
    });
  }

  test("uninstalling OneUptime from Microsoft Teams asks which workspaces are connected again", async () => {
    await renderTeams();

    await click("Uninstall OneUptime from Microsoft Teams");

    expect(
      (deleteItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(WorkspaceProjectAuthToken);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("unlinking only your own Microsoft Teams account asks nothing", async () => {
    mockAuthState.isUserConnected = true;
    await renderTeams();

    await click("Disconnect");

    expect(
      (deleteItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(WorkspaceUserAuthToken);
    expect(refresh).not.toHaveBeenCalled();
  });
});
