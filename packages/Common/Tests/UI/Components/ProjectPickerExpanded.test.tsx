import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import IconProp from "../../../Types/Icon/IconProp";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectPicker from "../../../UI/Components/Header/ProjectPicker/ProjectPicker";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The header's project picker said its list was open whatever it did: its
 * button was written aria-expanded="true", so a screen reader announced the
 * shut picker as expanded (found by issue #5364's sweep of controls that
 * show more). It follows the list now.
 */

function project(id: string, name: string): Project {
  const item: Project = new Project();
  item._id = id;
  item.name = name;
  return item;
}

const PROJECTS: Array<Project> = [
  project("b7000000-0000-4000-8000-0000000000a1", "Acme Production"),
  project("b7000000-0000-4000-8000-0000000000a2", "Acme Staging"),
];

function renderPicker(onProjectSelected: MockFunction): HTMLElement {
  render(
    <div>
      <ProjectPicker
        projects={PROJECTS}
        selectedProjectIcon={IconProp.Folder}
        selectedProjectName="Acme Production"
        onCreateProjectButtonClicked={getJestMockFunction()}
        onProjectSelected={onProjectSelected}
      />
      <p>Elsewhere on the page</p>
    </div>,
  );

  return screen.getByRole("button", { name: /Acme Production/ });
}

afterEach(() => {
  cleanup();
});

describe("the header's project picker", () => {
  test("says its list is shut while it is", () => {
    const picker: HTMLElement = renderPicker(getJestMockFunction());

    expect(picker).toHaveAttribute("aria-haspopup", "listbox");
    expect(picker).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Acme Staging")).not.toBeInTheDocument();
  });

  test("says it is open once pressed, with the projects listed", () => {
    const picker: HTMLElement = renderPicker(getJestMockFunction());

    fireEvent.click(picker);

    expect(screen.getByText("Acme Staging")).toBeInTheDocument();
    expect(picker).toHaveAttribute("aria-expanded", "true");
  });

  test("says it is shut again once a project is picked", () => {
    const onProjectSelected: MockFunction = getJestMockFunction();
    const picker: HTMLElement = renderPicker(onProjectSelected);

    fireEvent.click(picker);
    fireEvent.click(screen.getByText("Acme Staging"));

    expect(onProjectSelected).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Acme Staging")).not.toBeInTheDocument();
    expect(picker).toHaveAttribute("aria-expanded", "false");
  });

  test("says it is shut again after a click elsewhere on the page", () => {
    const picker: HTMLElement = renderPicker(getJestMockFunction());

    fireEvent.click(picker);
    expect(picker).toHaveAttribute("aria-expanded", "true");

    act(() => {
      fireEvent.mouseDown(screen.getByText("Elsewhere on the page"));
      fireEvent.click(screen.getByText("Elsewhere on the page"));
    });

    expect(screen.queryByText("Acme Staging")).not.toBeInTheDocument();
    expect(picker).toHaveAttribute("aria-expanded", "false");
  });
});
