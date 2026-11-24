import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/GlobalConfig", () => {
  return {
    __esModule: true,
    default: {
      fetchVars: async (): Promise<{ disableUserProjectCreation: boolean }> => {
        return { disableUserProjectCreation: false };
      },
    },
  };
});

import DashboardProjectPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Header/ProjectPicker";
import Project from "../../../Models/DatabaseModels/Project";
import { PROJECT_PICKER_OPEN_PROJECT_MARK_TEST_ID } from "../../../UI/Components/Header/ProjectPicker/ProjectPickerMenuItem";

/*
 * THE DASHBOARD'S PROJECT LIST MARKS THE PROJECT THE PERSON IS IN (#8050).
 *
 * The shared picker marks the open project by its id; this holds the
 * Dashboard's header to handing it that id, from the project it opened -
 * so of two projects called "Test Project", the one the person is in is the
 * one marked.
 */

const FIRST_ID: string = "c8000000-0000-4000-8000-0000000000e1";
const SECOND_ID: string = "c8000000-0000-4000-8000-0000000000e2";
const OTHER_ID: string = "c8000000-0000-4000-8000-0000000000e3";

function project(id: string, name: string): Project {
  const item: Project = new Project();
  item._id = id;
  item.name = name;
  return item;
}

const PROJECTS: Array<Project> = [
  project(FIRST_ID, "Test Project"),
  project(SECOND_ID, "Test Project"),
  project(OTHER_ID, "Acme Production"),
];

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

function markedRows(): Array<HTMLElement> {
  return within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .filter((option: HTMLElement): boolean => {
      return option.getAttribute("aria-current") === "true";
    });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the Dashboard's header marks the open project in its list", () => {
  test.each([
    [FIRST_ID, SECOND_ID],
    [SECOND_ID, FIRST_ID],
  ])(
    "of two projects called Test Project, the open one (%s) is marked, never its twin",
    async (openId: string, twinId: string) => {
      const open: Project = PROJECTS.find((item: Project): boolean => {
        return item.id?.toString() === openId;
      })!;

      render(
        <DashboardProjectPicker
          projects={PROJECTS}
          selectedProject={open}
          onProjectSelected={() => {}}
          showProjectModal={false}
          onProjectModalClose={() => {}}
        />,
      );
      await settle();

      fireEvent.click(screen.getByRole("button", { name: /Test Project/ }), {
        detail: 1,
      });

      const marked: Array<HTMLElement> = markedRows();

      expect(marked).toHaveLength(1);
      expect(marked[0]!.id).toContain(openId);
      expect(marked[0]!.id).not.toContain(twinId);
      expect(
        within(marked[0]!).getByTestId(
          PROJECT_PICKER_OPEN_PROJECT_MARK_TEST_ID,
        ),
      ).toBeInTheDocument();
    },
  );

  test("before a project is open, no row is marked", async () => {
    render(
      <DashboardProjectPicker
        projects={PROJECTS}
        selectedProject={null}
        onProjectSelected={() => {}}
        showProjectModal={false}
        onProjectModalClose={() => {}}
      />,
    );
    await settle();

    fireEvent.click(screen.getByRole("button", { expanded: false }), {
      detail: 1,
    });

    expect(markedRows()).toEqual([]);
  });
});
