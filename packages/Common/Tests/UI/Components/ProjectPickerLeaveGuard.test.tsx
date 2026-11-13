// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { NavigateFunction } from "react-router-dom";
import IconProp from "../../../Types/Icon/IconProp";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectPicker from "../../../UI/Components/Header/ProjectPicker/ProjectPicker";
import LeaveGuard, { LeavePageFunction } from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * Switching project from the header reloads the app in the other project.
 * While the page shown holds unsaved work (a dashboard being edited, issue
 * #7173), the switch asks first, before anything switches: Keep Editing
 * leaves the open project as it was - a project switched with its page kept
 * would save that page into the wrong project.
 */

const PRODUCTION_ID: string = "b7000000-0000-4000-8000-0000000000a1";
const STAGING_ID: string = "b7000000-0000-4000-8000-0000000000a2";

function project(id: string, name: string): Project {
  const item: Project = new Project();
  item._id = id;
  item.name = name;
  return item;
}

let calls: Array<string>;
let asked: Array<LeavePageFunction>;

const openPickerAndPickStaging: () => void = (): void => {
  render(
    <ProjectPicker
      projects={[
        project(PRODUCTION_ID, "Acme Production"),
        project(STAGING_ID, "Acme Staging"),
      ]}
      selectedProjectIcon={IconProp.Folder}
      selectedProjectName="Acme Production"
      onCreateProjectButtonClicked={() => {}}
      onProjectSelected={(selected: Project) => {
        calls.push(`selected ${selected.name}`);
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Acme Production/ }));
  fireEvent.click(screen.getByText("Acme Staging"));
};

beforeEach(() => {
  LeaveGuard.reset();
  calls = [];
  asked = [];
  window.history.replaceState(
    { usr: null, key: "d1", idx: 0 },
    "",
    `/dashboard/${PRODUCTION_ID}/dashboards/d1`,
  );
  Navigation.setNavigateHook(((to: string) => {
    calls.push(`navigate ${to}`);
  }) as unknown as NavigateFunction);
});

afterEach(() => {
  cleanup();
  LeaveGuard.reset();
  jest.restoreAllMocks();
});

describe("switching project from the header", () => {
  test("with nothing unsaved, switches at once, as always", () => {
    openPickerAndPickStaging();

    expect(asked).toHaveLength(0);
    expect(calls).toEqual([
      "selected Acme Staging",
      `navigate /dashboard/${STAGING_ID}`,
    ]);
  });

  test("with unsaved work, asks before anything switches", () => {
    LeaveGuard.hold((leave: LeavePageFunction) => {
      asked.push(leave);
    });

    openPickerAndPickStaging();

    expect(asked).toHaveLength(1);
    // Keep Editing: the open project stays the open project.
    expect(calls).toEqual([]);
  });

  test("Discard Changes switches, then opens the other project", () => {
    LeaveGuard.hold((leave: LeavePageFunction) => {
      asked.push(leave);
    });

    openPickerAndPickStaging();
    asked[0]!();

    expect(calls).toEqual([
      "selected Acme Staging",
      `navigate /dashboard/${STAGING_ID}`,
    ]);
  });
});
