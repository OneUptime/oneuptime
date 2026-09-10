import React from "react";
import { Text, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ProjectProvider, useActiveProject } from "../hooks/useProject";
import { fetchProjects } from "../api/projects";
import { makeListResponse, makeProject } from "../__tests__/testSupport";
import ProjectSwitcher from "./ProjectSwitcher";
import type { ProjectItem } from "../api/types";

jest.mock("../api/projects", () => {
  return { fetchProjects: jest.fn() };
});
jest.mock("../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return {
        isAuthenticated: true,
        isLoading: false,
        user: { _id: "responder" },
      };
    },
  };
});

const first: ProjectItem = makeProject({
  _id: "project-a",
  name: "Acme Production",
});
const second: ProjectItem = makeProject({
  _id: "project-b",
  name: "Beta Staging",
});
const mockFetchProjects: jest.MockedFunction<typeof fetchProjects> =
  fetchProjects as jest.MockedFunction<typeof fetchProjects>;

function ProjectConsumer(): React.JSX.Element {
  const { projectList } = useActiveProject();
  return (
    <Text testID="visible-projects">
      {projectList
        .map((project: ProjectItem) => {
          return project._id;
        })
        .join(",")}
    </Text>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockFetchProjects.mockReset();
  mockFetchProjects.mockResolvedValue(makeListResponse([first, second]));
});

async function show(): Promise<void> {
  await render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 59, bottom: 34, left: 0, right: 0 }}
    >
      <ProjectProvider>
        <View>
          <ProjectSwitcher />
          <ProjectConsumer />
        </View>
      </ProjectProvider>
    </SafeAreaInsetsContext.Provider>,
  );
  await screen.findByLabelText(`Switch project, current project ${first.name}`);
}

test("the header names the active project and selection changes the real scoped context", async () => {
  await show();
  expect(screen.getByTestId("visible-projects").props.children).toBe(first._id);
  await fireEvent.press(screen.getByTestId("project-switcher"));
  expect(
    screen.getByRole("radio", { name: first.name }).props.accessibilityState
      .checked,
  ).toBe(true);
  expect(
    screen.getByRole("radio", { name: second.name }).props.accessibilityState
      .checked,
  ).toBe(false);
  expect(screen.queryByText("All projects")).toBeNull();
  await fireEvent.press(screen.getByRole("radio", { name: second.name }));
  expect(
    screen.getByLabelText(`Switch project, current project ${second.name}`),
  ).toBeTruthy();
  expect(screen.getByTestId("visible-projects").props.children).toBe(
    second._id,
  );
  expect(screen.queryByRole("header", { name: "Switch project" })).toBeNull();
});

test("search finds a project by name without changing the active context until selection", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("project-switcher"));
  await fireEvent.changeText(
    screen.getByLabelText("Search projects to switch"),
    "  BETA  ",
  );
  expect(screen.queryByRole("radio", { name: first.name })).toBeNull();
  expect(screen.getByRole("radio", { name: second.name })).toBeTruthy();
  expect(screen.getByTestId("visible-projects").props.children).toBe(first._id);
  await fireEvent.press(screen.getByRole("radio", { name: second.name }));
  expect(screen.getByTestId("visible-projects").props.children).toBe(
    second._id,
  );
});

test("closing a filtered chooser keeps the current project and resets search on reopening", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("project-switcher"));
  await fireEvent.changeText(
    screen.getByLabelText("Search projects to switch"),
    "missing",
  );
  expect(screen.getByText("No matching projects")).toBeTruthy();
  await fireEvent.press(
    screen.getByRole("button", { name: "Close project switcher" }),
  );
  expect(screen.getByTestId("visible-projects").props.children).toBe(first._id);
  await fireEvent.press(screen.getByTestId("project-switcher"));
  expect(screen.getByLabelText("Search projects to switch").props.value).toBe(
    "",
  );
  expect(screen.getAllByRole("radio")).toHaveLength(2);
});

test("the project list allows a keyboard-open selection and leaves space above the home indicator", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("project-switcher"));
  const list: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
    "project-switcher-list",
  );
  expect(list.props.keyboardShouldPersistTaps).toBe("handled");
  expect(list.props.contentContainerStyle.paddingBottom).toBeGreaterThanOrEqual(
    34 + 40,
  );
});

test("a failed initial load offers retry from the global chooser", async () => {
  mockFetchProjects.mockRejectedValueOnce(new Error("Network down"));
  await render(
    <ProjectProvider>
      <ProjectSwitcher />
    </ProjectProvider>,
  );
  await fireEvent.press(screen.getByTestId("project-switcher"));
  const retry: Awaited<ReturnType<typeof screen.findByRole>> =
    await screen.findByRole("button", {
      name: "Retry loading projects",
    });
  await fireEvent.press(retry);
  expect(screen.getByRole("radio", { name: first.name })).toBeTruthy();
  expect(mockFetchProjects).toHaveBeenCalledTimes(2);
});
