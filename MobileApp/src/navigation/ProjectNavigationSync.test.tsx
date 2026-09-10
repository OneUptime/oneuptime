import React from "react";
import { Alert } from "react-native";
import type { NotificationResponse } from "expo-notifications";
import { render, act } from "@testing-library/react-native";
import ProjectNavigationSync from "./ProjectNavigationSync";
import type { ProjectItem } from "../api/types";
import {
  handleNotificationResponse,
  processPendingNotification,
  setNavigationRef,
  setProjectNavigationGuard,
} from "../notifications/handlers";

interface MockProjectState {
  activeProject: ProjectItem;
  projectList: ProjectItem[];
  isLoadingProjects: boolean;
  projectLoadError: Error | null;
  selectProject: jest.Mock;
}

const mockSelectProject: jest.Mock = jest.fn();
const mockProjectState: MockProjectState = {
  activeProject: { _id: "a", name: "Aurora", slug: "aurora" },
  projectList: [
    { _id: "a", name: "Aurora", slug: "aurora" },
    { _id: "b", name: "Atlas", slug: "atlas" },
  ],
  isLoadingProjects: false,
  projectLoadError: null,
  selectProject: mockSelectProject,
};
jest.mock("../hooks/useProject", () => {
  return {
    useProject: () => {
      return mockProjectState;
    },
  };
});

function pageFor(projectId: string): NotificationResponse {
  return {
    actionIdentifier: "VIEW",
    notification: {
      request: {
        content: {
          data: { entityType: "incident", entityId: "incident-1", projectId },
        },
      },
    },
  } as unknown as NotificationResponse;
}

beforeEach(() => {
  mockProjectState.activeProject = { _id: "a", name: "Aurora", slug: "aurora" };
  mockProjectState.isLoadingProjects = false;
  mockProjectState.projectLoadError = null;
  mockSelectProject.mockClear();
});
afterEach(() => {
  setProjectNavigationGuard(null);
  setNavigationRef(null);
});

test("a notification switches project before opening the destination exactly once", async () => {
  const navigate: jest.Mock = jest.fn();
  setNavigationRef({
    isReady: () => {
      return true;
    },
    getRootState: () => {
      return { routeNames: ["Inbox"] };
    },
    navigate,
  });
  const view: Awaited<ReturnType<typeof render>> = await render(
    <ProjectNavigationSync />,
  );
  await act(() => {
    handleNotificationResponse(pageFor("b"));
  });
  expect(mockSelectProject).toHaveBeenCalledWith("b");
  expect(navigate).not.toHaveBeenCalled();
  mockProjectState.activeProject = { _id: "b", name: "Atlas", slug: "atlas" };
  await view.rerender(<ProjectNavigationSync />);
  expect(navigate).toHaveBeenCalledWith("Inbox", {
    screen: "IncidentDetail",
    initial: false,
    params: { incidentId: "incident-1", projectId: "b" },
  });
  processPendingNotification();
  expect(navigate).toHaveBeenCalledTimes(1);
});

test("revoked project access gives feedback and does not navigate into another workspace", async () => {
  const navigate: jest.Mock = jest.fn();
  const alert: jest.SpyInstance = jest
    .spyOn(Alert, "alert")
    .mockImplementation(() => {
      return undefined;
    });
  setNavigationRef({
    isReady: () => {
      return true;
    },
    getRootState: () => {
      return { routeNames: ["Inbox"] };
    },
    navigate,
  });
  await render(<ProjectNavigationSync />);
  await act(() => {
    handleNotificationResponse(pageFor("revoked"));
  });
  expect(alert).toHaveBeenCalledWith("Project unavailable", expect.any(String));
  expect(navigate).not.toHaveBeenCalled();
  expect(mockSelectProject).not.toHaveBeenCalled();
  processPendingNotification();
  expect(alert).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});

test("cold-start notifications wait for project preference hydration", async () => {
  const navigate: jest.Mock = jest.fn();
  mockProjectState.isLoadingProjects = true;
  setNavigationRef({
    isReady: () => {
      return true;
    },
    getRootState: () => {
      return { routeNames: ["Inbox"] };
    },
    navigate,
  });
  const view: Awaited<ReturnType<typeof render>> = await render(
    <ProjectNavigationSync />,
  );
  await act(() => {
    handleNotificationResponse(pageFor("a"));
  });
  expect(navigate).not.toHaveBeenCalled();
  mockProjectState.isLoadingProjects = false;
  await view.rerender(<ProjectNavigationSync />);
  expect(navigate).toHaveBeenCalledTimes(1);
});

test("a transient membership failure keeps the page pending until retry succeeds", async () => {
  const navigate: jest.Mock = jest.fn();
  const alert: jest.SpyInstance = jest
    .spyOn(Alert, "alert")
    .mockImplementation(() => {
      return undefined;
    });
  const memberships: ProjectItem[] = mockProjectState.projectList;
  mockProjectState.projectList = [];
  mockProjectState.projectLoadError = new Error("Network unavailable");
  setNavigationRef({
    isReady: () => {
      return true;
    },
    getRootState: () => {
      return { routeNames: ["Inbox"] };
    },
    navigate,
  });
  const view: Awaited<ReturnType<typeof render>> = await render(
    <ProjectNavigationSync />,
  );
  await act(() => {
    handleNotificationResponse(pageFor("a"));
  });
  expect(navigate).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  mockProjectState.projectList = memberships;
  mockProjectState.projectLoadError = null;
  await view.rerender(<ProjectNavigationSync />);
  expect(navigate).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});
