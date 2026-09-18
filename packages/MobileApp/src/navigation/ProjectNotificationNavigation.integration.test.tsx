import React, { useCallback, useMemo, useState } from "react";
import {
  type NavigationContainerRefWithCurrent,
  type NavigationState,
} from "@react-navigation/native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { afterEach, beforeEach, expect, test } from "@jest/globals";
import type { NotificationResponse } from "expo-notifications";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  handleNotificationResponse,
  processPendingNotification,
  setNavigationRef,
  setProjectNavigationGuard,
} from "../notifications/handlers";
import RootNavigator from "./RootNavigator";
import type {
  MainTabParamList,
  IncidentsStackParamList,
  InboxStackParamList,
} from "./types";
import type { ProjectItem } from "../api/types";
import type { useProject } from "../hooks/useProject";
import { makeProject } from "../__tests__/testSupport";

type ProjectContextValue = ReturnType<typeof useProject>;
const mockProjectContext: React.Context<ProjectContextValue | null> =
  React.createContext<ProjectContextValue | null>(null);
const mockListUnmounts: string[] = [];
const mockDetailProjects: Array<{ active: string | undefined; route: string }> =
  [];
const mockSelectProject: { current: ((projectId: string) => void) | null } = {
  current: null,
};
const mockRootRef: {
  current: NavigationContainerRefWithCurrent<MainTabParamList> | null;
} = { current: null };
const projectA: ProjectItem = makeProject({
  _id: "project-a",
  name: "Production",
});
const projectB: ProjectItem = makeProject({
  _id: "project-b",
  name: "Staging",
});

jest.mock("../hooks/useProject", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  return {
    useProject: (): ProjectContextValue => {
      return ReactModule.useContext(mockProjectContext)!;
    },
  };
});

jest.mock("../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return { isAuthenticated: true, isLoading: false, needsServerUrl: false };
    },
  };
});
jest.mock("../hooks/useBiometric", () => {
  return {
    useBiometric: () => {
      return { isEnabled: false };
    },
  };
});
jest.mock("../hooks/usePushNotifications", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const handlers: typeof import("../notifications/handlers") =
    jest.requireActual("../notifications/handlers");
  return {
    usePushNotifications: (
      navigationRef: NavigationContainerRefWithCurrent<MainTabParamList>,
    ): void => {
      ReactModule.useEffect(() => {
        mockRootRef.current = navigationRef;
        handlers.setNavigationRef(navigationRef);
      }, [navigationRef]);
    },
  };
});
jest.mock("./AuthStackNavigator", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});
jest.mock("expo-splash-screen", () => {
  return { hideAsync: jest.fn() };
});
jest.mock("expo-linking", () => {
  return {
    createURL: (): string => {
      return "oneuptime://";
    },
  };
});

// Retain the real root, tab and incident stack navigators, with light leaf screens.
jest.mock("../screens/HomeScreen", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});
jest.mock("./MonitorsStackNavigator", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});
jest.mock("./AlertsStackNavigator", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});
jest.mock("./OnCallStackNavigator", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});
jest.mock("./SettingsStackNavigator", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});
jest.mock("../screens/IncidentEpisodeDetailScreen", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});
jest.mock("../screens/AlertEpisodeDetailScreen", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});
jest.mock("../screens/AlertsScreen", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const Native: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    __esModule: true,
    default: function AlertListLeaf(): React.JSX.Element {
      const project: ProjectItem | null =
        ReactModule.useContext(mockProjectContext)!.activeProject;
      return ReactModule.createElement(
        Native.Text,
        null,
        project?.name + " alert list",
      );
    },
  };
});
jest.mock("../screens/AlertDetailScreen", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const Native: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    __esModule: true,
    default: function AlertDetailLeaf({
      route,
      navigation,
    }: NativeStackScreenProps<
      InboxStackParamList,
      "AlertDetail"
    >): React.JSX.Element {
      return ReactModule.createElement(
        Native.View,
        null,
        ReactModule.createElement(
          Native.Text,
          { testID: "alert-project" },
          route.params.projectId,
        ),
        ReactModule.createElement(
          Native.Pressable,
          {
            accessibilityRole: "button",
            accessibilityLabel: "Back to alert list",
            onPress: (): void => {
              navigation.goBack();
            },
          },
          ReactModule.createElement(Native.Text, null, "Back"),
        ),
      );
    },
  };
});
jest.mock("../screens/IncidentsScreen", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const Native: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    __esModule: true,
    default: function IncidentListLeaf(): React.JSX.Element {
      const project: ProjectItem | null =
        ReactModule.useContext(mockProjectContext)!.activeProject;
      ReactModule.useEffect(() => {
        return (): void => {
          mockListUnmounts.push(project!._id);
        };
      }, []);
      return ReactModule.createElement(
        Native.Text,
        null,
        project?.name + " incident list",
      );
    },
  };
});
jest.mock("../screens/IncidentDetailScreen", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const Native: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    __esModule: true,
    default: function IncidentDetailLeaf({
      route,
      navigation,
    }: NativeStackScreenProps<
      IncidentsStackParamList,
      "IncidentDetail"
    >): React.JSX.Element {
      const project: ProjectItem | null =
        ReactModule.useContext(mockProjectContext)!.activeProject;
      mockDetailProjects.push({
        active: project?._id,
        route: route.params.projectId,
      });
      return ReactModule.createElement(
        Native.View,
        null,
        ReactModule.createElement(
          Native.Text,
          { testID: "detail-project" },
          route.params.projectId,
        ),
        ReactModule.createElement(
          Native.Text,
          { testID: "active-project" },
          project?._id,
        ),
        ReactModule.createElement(
          Native.Pressable,
          {
            accessibilityRole: "button",
            accessibilityLabel: "Back to incident list",
            onPress: (): void => {
              navigation.goBack();
            },
          },
          ReactModule.createElement(Native.Text, null, "Back"),
        ),
      );
    },
  };
});

function ProjectHarness({
  isLoadingProjects = false,
}: {
  isLoadingProjects?: boolean;
}): React.JSX.Element {
  const [activeProject, setActiveProject] = useState<ProjectItem>(projectA);
  const selectProject: (projectId: string) => void = useCallback(
    (projectId: string): void => {
      setActiveProject(projectId === projectB._id ? projectB : projectA);
    },
    [],
  );
  const value: ProjectContextValue = useMemo((): ProjectContextValue => {
    return {
      activeProject: isLoadingProjects ? null : activeProject,
      projectList: isLoadingProjects ? [] : [projectA, projectB],
      selectProject,
      isLoadingProjects,
      projectLoadError: null,
      refreshProjects: async (): Promise<void> => {
        return undefined;
      },
    };
  }, [activeProject, selectProject, isLoadingProjects]);
  mockSelectProject.current = selectProject;
  return (
    <mockProjectContext.Provider value={value}>
      <SafeAreaInsetsContext.Provider
        value={{ top: 44, bottom: 34, left: 0, right: 0 }}
      >
        <RootNavigator />
      </SafeAreaInsetsContext.Provider>
    </mockProjectContext.Provider>
  );
}

beforeEach(() => {
  mockListUnmounts.length = 0;
  mockDetailProjects.length = 0;
  mockRootRef.current = null;
  mockSelectProject.current = null;
});
afterEach(() => {
  setNavigationRef(null);
  setProjectNavigationGuard(null);
});

test("a cross-project page survives the real keyed navigator remount and Back returns to the new project's list", async () => {
  await render(<ProjectHarness />);
  const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
    mockRootRef.current!;
  await fireEvent.press(screen.getByLabelText("Inbox"));
  expect(screen.getByText("Production incident list")).toBeTruthy();
  const originalNavigatorKey: string = navigationRef.getRootState()!.key;

  await act(() => {
    handleNotificationResponse({
      actionIdentifier: "VIEW",
      notification: {
        request: {
          content: {
            data: {
              entityType: "incident",
              entityId: "incident-b",
              projectId: "project-b",
            },
          },
        },
      },
    } as unknown as NotificationResponse);
  });
  expect(navigationRef.getRootState()!.key).not.toBe(originalNavigatorKey);
  expect(mockListUnmounts).toContain("project-a");
  await waitFor(() => {
    expect(navigationRef.getCurrentRoute()?.name).toBe("IncidentDetail");
    expect(screen.getByTestId("detail-project").props.children).toBe(
      "project-b",
    );
    expect(screen.getByTestId("active-project").props.children).toBe(
      "project-b",
    );
  });
  await act(() => {
    processPendingNotification();
  });
  expect(navigationRef.getCurrentRoute()?.name).toBe("IncidentDetail");

  await fireEvent.press(
    screen.getByRole("button", { name: "Back to incident list" }),
  );
  await waitFor(() => {
    expect(navigationRef.getCurrentRoute()?.name).toBe("InboxList");
  });
  expect(screen.getByText("Staging incident list")).toBeTruthy();
  expect(screen.queryByText("Production incident list")).toBeNull();
});

test("a manual project switch clears old detail routes and returns to Home before the new project is explored", async () => {
  await render(<ProjectHarness />);
  const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
    mockRootRef.current!;
  await act(() => {
    navigationRef.navigate("Inbox", {
      screen: "IncidentDetail",
      initial: false,
      params: { projectId: "project-a", incidentId: "incident-a" },
    });
  });
  await waitFor(() => {
    expect(navigationRef.getCurrentRoute()?.name).toBe("IncidentDetail");
  });
  expect(screen.getByTestId("detail-project").props.children).toBe("project-a");
  await act(() => {
    mockSelectProject.current!("project-b");
  });
  expect(navigationRef.getCurrentRoute()?.name).toBe("Home");
  expect(screen.queryByTestId("detail-project")).toBeNull();
  await fireEvent.press(screen.getByLabelText("Inbox"));
  expect(navigationRef.getCurrentRoute()?.name).toBe("InboxList");
  expect(screen.getByText("Staging incident list")).toBeTruthy();
  expect(screen.queryByText("Production incident list")).toBeNull();
  await act(() => {
    mockSelectProject.current!("project-a");
  });
  expect(navigationRef.getCurrentRoute()?.name).toBe("Home");
  await fireEvent.press(screen.getByLabelText("Inbox"));
  expect(navigationRef.getCurrentRoute()?.name).toBe("InboxList");
  expect(screen.queryByTestId("detail-project")).toBeNull();
});

test("a cold-start page waits for project hydration without rendering its detail under the default project", async () => {
  handleNotificationResponse({
    actionIdentifier: "VIEW",
    notification: {
      request: {
        content: {
          data: {
            entityType: "incident",
            entityId: "incident-b",
            projectId: "project-b",
          },
        },
      },
    },
  } as unknown as NotificationResponse);
  const view: Awaited<ReturnType<typeof render>> = await render(
    <ProjectHarness isLoadingProjects />,
  );
  const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
    mockRootRef.current!;
  expect(navigationRef.getCurrentRoute()?.name).toBe("Home");
  expect(mockDetailProjects).toEqual([]);

  await view.rerender(<ProjectHarness />);
  await waitFor(() => {
    expect(navigationRef.getCurrentRoute()?.name).toBe("IncidentDetail");
    expect(screen.getByTestId("detail-project").props.children).toBe(
      "project-b",
    );
  });
  expect(mockDetailProjects.length).toBeGreaterThan(0);
  expect(mockDetailProjects).toEqual(
    mockDetailProjects.map(() => {
      return { active: "project-b", route: "project-b" };
    }),
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Back to incident list" }),
  );
  expect(navigationRef.getCurrentRoute()?.name).toBe("InboxList");
  expect(screen.getByText("Staging incident list")).toBeTruthy();
  expect(screen.queryByText("Production incident list")).toBeNull();
});

test("Inbox switches categories without adding a Back entry and keeps its choice when revisited", async () => {
  await render(<ProjectHarness />);
  const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
    mockRootRef.current!;
  await fireEvent.press(screen.getByLabelText("Inbox"));
  expect(screen.getByText("Production incident list")).toBeTruthy();
  expect(
    screen.getByTestId("inbox-category-incidents").props.accessibilityState
      .selected,
  ).toBe(true);
  await fireEvent.press(screen.getByTestId("inbox-category-alerts"));
  expect(screen.getByText("Production alert list")).toBeTruthy();
  expect(
    screen.getByTestId("inbox-category-alerts").props.accessibilityState
      .selected,
  ).toBe(true);
  expect(navigationRef.getCurrentRoute()?.name).toBe("InboxList");
  const inboxState: NavigationState["routes"][number]["state"] = navigationRef
    .getRootState()!
    .routes.find((route: NavigationState["routes"][number]) => {
      return route.name === "Inbox";
    })?.state;
  expect(inboxState?.routes).toHaveLength(1);
  await fireEvent.press(screen.getByLabelText("Home"));
  await fireEvent.press(screen.getByLabelText("Inbox"));
  expect(screen.getByText("Production alert list")).toBeTruthy();
});

test.each([false, true])(
  "an alert page returns to Alerts when Inbox was %s already open",
  async (openInbox: boolean) => {
    await render(<ProjectHarness />);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      mockRootRef.current!;
    if (openInbox) {
      await fireEvent.press(screen.getByLabelText("Inbox"));
      expect(screen.getByText("Production incident list")).toBeTruthy();
    }
    await act(() => {
      handleNotificationResponse({
        actionIdentifier: "VIEW",
        notification: {
          request: {
            content: {
              data: {
                entityType: "alert",
                entityId: "alert-a",
                projectId: "project-a",
              },
            },
          },
        },
      } as unknown as NotificationResponse);
    });
    await waitFor(() => {
      expect(navigationRef.getCurrentRoute()?.name).toBe("AlertDetail");
    });
    expect(screen.getByTestId("alert-project").props.children).toBe(
      "project-a",
    );
    await fireEvent.press(screen.getByLabelText("Back to alert list"));
    expect(navigationRef.getCurrentRoute()?.name).toBe("InboxList");
    expect(screen.getByText("Production alert list")).toBeTruthy();
    expect(
      screen.getByTestId("inbox-category-alerts").props.accessibilityState
        .selected,
    ).toBe(true);
  },
);

test.each<{
  entityType: string;
  detailRoute: string;
  initialView: "incidents" | "alerts";
  initialSegment: "incidents" | "alerts" | "episodes";
  oppositeView: "incidents" | "alerts";
}>([
  {
    entityType: "incident",
    detailRoute: "IncidentDetail",
    initialView: "incidents",
    initialSegment: "incidents",
    oppositeView: "alerts",
  },
  {
    entityType: "incident-episode",
    detailRoute: "IncidentEpisodeDetail",
    initialView: "incidents",
    initialSegment: "episodes",
    oppositeView: "alerts",
  },
  {
    entityType: "alert",
    detailRoute: "AlertDetail",
    initialView: "alerts",
    initialSegment: "alerts",
    oppositeView: "incidents",
  },
  {
    entityType: "alert-episode",
    detailRoute: "AlertEpisodeDetail",
    initialView: "alerts",
    initialSegment: "episodes",
    oppositeView: "incidents",
  },
])(
  "a warm $oppositeView Inbox returns from $detailRoute to the correct list",
  async ({
    entityType,
    detailRoute,
    initialView,
    initialSegment,
    oppositeView,
  }: {
    entityType: string;
    detailRoute: string;
    initialView: "incidents" | "alerts";
    initialSegment: "incidents" | "alerts" | "episodes";
    oppositeView: "incidents" | "alerts";
  }) => {
    await render(<ProjectHarness />);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      mockRootRef.current!;
    await fireEvent.press(screen.getByLabelText("Inbox"));
    if (oppositeView === "alerts") {
      await fireEvent.press(screen.getByTestId("inbox-category-alerts"));
    }
    expect(
      screen.getByText(
        `Production ${oppositeView === "alerts" ? "alert" : "incident"} list`,
      ),
    ).toBeTruthy();

    await act(() => {
      handleNotificationResponse({
        actionIdentifier: "VIEW",
        notification: {
          request: {
            content: {
              data: {
                entityType,
                entityId: "entity-a",
                projectId: "project-a",
              },
            },
          },
        },
      } as unknown as NotificationResponse);
    });
    await waitFor(() => {
      expect(navigationRef.getCurrentRoute()?.name).toBe(detailRoute);
    });

    await act(() => {
      navigationRef.goBack();
    });
    expect(navigationRef.getCurrentRoute()?.name).toBe("InboxList");
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      initialView,
      initialSegment,
      initialFilter: "all",
    });
    expect(
      screen.getByText(
        `Production ${initialView === "alerts" ? "alert" : "incident"} list`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`inbox-category-${initialView}`).props
        .accessibilityState.selected,
    ).toBe(true);
  },
);

test("a cross-project alert page changes project and returns to that project's Alerts view", async () => {
  await render(<ProjectHarness />);
  const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
    mockRootRef.current!;
  await act(() => {
    handleNotificationResponse({
      actionIdentifier: "VIEW",
      notification: {
        request: {
          content: {
            data: {
              entityType: "alert",
              entityId: "alert-b",
              projectId: "project-b",
            },
          },
        },
      },
    } as unknown as NotificationResponse);
  });
  await waitFor(() => {
    expect(navigationRef.getCurrentRoute()?.name).toBe("AlertDetail");
  });
  expect(screen.getByTestId("alert-project").props.children).toBe("project-b");
  await fireEvent.press(screen.getByLabelText("Back to alert list"));
  expect(screen.getByText("Staging alert list")).toBeTruthy();
  expect(screen.queryByText("Production incident list")).toBeNull();
});

test("Home shortcuts select the requested Inbox category and filter without adding a list route", async () => {
  await render(<ProjectHarness />);
  const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
    mockRootRef.current!;
  await act(() => {
    navigationRef.navigate("Inbox", {
      screen: "InboxList",
      params: {
        initialView: "alerts",
        initialSegment: "episodes",
        initialFilter: "active",
      },
    });
  });
  expect(screen.getByText("Production alert list")).toBeTruthy();
  expect(navigationRef.getCurrentRoute()?.params).toEqual({
    initialView: "alerts",
    initialSegment: "episodes",
    initialFilter: "active",
  });
  await fireEvent.press(screen.getByTestId("inbox-category-incidents"));
  expect(navigationRef.getCurrentRoute()?.params).toEqual({
    initialView: "incidents",
    initialSegment: "incidents",
    initialFilter: "all",
  });
});

test.each([
  {
    entityType: "incident-episode",
    detail: "IncidentEpisodeDetail",
    category: "incidents",
  },
  {
    entityType: "alert-episode",
    detail: "AlertEpisodeDetail",
    category: "alerts",
  },
])(
  "a first-open $entityType page returns to its grouped Inbox view",
  async ({
    entityType,
    detail,
    category,
  }: {
    entityType: string;
    detail: string;
    category: string;
  }) => {
    await render(<ProjectHarness />);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      mockRootRef.current!;
    await act(() => {
      handleNotificationResponse({
        actionIdentifier: "VIEW",
        notification: {
          request: {
            content: {
              data: {
                entityType,
                entityId: "episode-a",
                projectId: "project-a",
              },
            },
          },
        },
      } as unknown as NotificationResponse);
    });
    await waitFor(() => {
      expect(navigationRef.getCurrentRoute()?.name).toBe(detail);
    });
    await act(() => {
      navigationRef.goBack();
    });
    expect(navigationRef.getCurrentRoute()?.name).toBe("InboxList");
    expect(navigationRef.getCurrentRoute()?.params).toEqual({
      initialView: category,
      initialSegment: "episodes",
      initialFilter: "all",
    });
    expect(
      screen.getByTestId(`inbox-category-${category}`).props.accessibilityState
        .selected,
    ).toBe(true);
  },
);

test.each<NonNullable<InboxStackParamList["InboxList"]>>([
  {
    initialView: "incidents",
    initialSegment: "incidents",
    initialFilter: "active",
  },
  { initialView: "alerts", initialSegment: "alerts", initialFilter: "active" },
  {
    initialView: "incidents",
    initialSegment: "episodes",
    initialFilter: "active",
  },
  {
    initialView: "alerts",
    initialSegment: "episodes",
    initialFilter: "active",
  },
])(
  "a Home $initialView/$initialSegment shortcut replaces the previous resolved view",
  async (request: NonNullable<InboxStackParamList["InboxList"]>) => {
    await render(<ProjectHarness />);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      mockRootRef.current!;
    await act(() => {
      navigationRef.navigate("Inbox", {
        screen: "InboxList",
        params: {
          initialView: "alerts",
          initialSegment: "episodes",
          initialFilter: "resolved",
        },
      });
    });
    await fireEvent.press(screen.getByLabelText("Home"));
    await act(() => {
      navigationRef.navigate("Inbox", { screen: "InboxList", params: request });
    });
    expect(navigationRef.getCurrentRoute()?.name).toBe("InboxList");
    expect(navigationRef.getCurrentRoute()?.params).toEqual(request);
    expect(
      screen.getByTestId(`inbox-category-${request.initialView}`).props
        .accessibilityState.selected,
    ).toBe(true);
    const inboxState: NavigationState["routes"][number]["state"] = navigationRef
      .getRootState()!
      .routes.find((route: NavigationState["routes"][number]) => {
        return route.name === "Inbox";
      })?.state;
    expect(inboxState?.routes).toHaveLength(1);
  },
);
