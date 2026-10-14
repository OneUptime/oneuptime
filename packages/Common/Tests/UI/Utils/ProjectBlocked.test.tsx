import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import ProjectPickerMenuItem from "../../../UI/Components/Header/ProjectPicker/ProjectPickerMenuItem";
import BaseAPI from "../../../UI/Utils/API/API";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import Navigation from "../../../UI/Utils/Navigation";
import BlockedProject from "../../../UI/Utils/BlockedProject";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import ProjectBlockedException from "../../../Types/Exception/ProjectBlockedException";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A project a master admin blocked, as the Dashboard sees it: the project
 * list marks it, a request for it answers a 403 that says so, and the
 * Dashboard then shows the project as blocked - not the Forbidden page,
 * which the browser's memory of the project would send the person back to
 * on every visit.
 */

const BLOCKED_ID: string = "b7000000-0000-4000-8000-0000000000b1";
const LIVE_ID: string = "b7000000-0000-4000-8000-0000000000a1";

const projectOf: (id: string, isBlocked?: boolean) => Project = (
  id: string,
  isBlocked?: boolean,
): Project => {
  const project: Project = new Project();
  project._id = id;
  project.name = id === BLOCKED_ID ? "Spam Films" : "Acme";

  if (isBlocked !== undefined) {
    project.isBlocked = isBlocked;
  }

  return project;
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("BlockedProject.isSelectedProjectBlocked", () => {
  test("nothing selected is nothing blocked", () => {
    expect(
      BlockedProject.isSelectedProjectBlocked({
        selectedProject: null,
        projects: [projectOf(BLOCKED_ID, true)],
        blockedProjectIds: [BLOCKED_ID],
      }),
    ).toBe(false);
  });

  test("the project list's word wins over the stored copy, either way", () => {
    // Stored before the block: the list knows better.
    expect(
      BlockedProject.isSelectedProjectBlocked({
        selectedProject: projectOf(BLOCKED_ID, false),
        projects: [projectOf(BLOCKED_ID, true)],
        blockedProjectIds: [],
      }),
    ).toBe(true);

    // Stored before the unblock: the list knows better.
    expect(
      BlockedProject.isSelectedProjectBlocked({
        selectedProject: projectOf(BLOCKED_ID, true),
        projects: [projectOf(BLOCKED_ID, false)],
        blockedProjectIds: [],
      }),
    ).toBe(false);
  });

  test("before the list loads, the stored copy says", () => {
    expect(
      BlockedProject.isSelectedProjectBlocked({
        selectedProject: projectOf(BLOCKED_ID, true),
        projects: [],
        blockedProjectIds: [],
      }),
    ).toBe(true);
  });

  test("a request refused as blocked this visit is enough", () => {
    expect(
      BlockedProject.isSelectedProjectBlocked({
        selectedProject: projectOf(BLOCKED_ID),
        projects: [projectOf(BLOCKED_ID, false)],
        blockedProjectIds: [BLOCKED_ID],
      }),
    ).toBe(true);
  });

  test("another project being blocked is not this one's", () => {
    expect(
      BlockedProject.isSelectedProjectBlocked({
        selectedProject: projectOf(LIVE_ID),
        projects: [projectOf(LIVE_ID, false), projectOf(BLOCKED_ID, true)],
        blockedProjectIds: [BLOCKED_ID],
      }),
    ).toBe(false);
  });
});

describe("the API client's answer to a 403", () => {
  let dispatchEvent: jest.SpyInstance;
  let navigate: jest.SpyInstance;

  beforeEach(() => {
    dispatchEvent = jest
      .spyOn(GlobalEvents, "dispatchEvent")
      .mockImplementation(() => {
        return undefined;
      });
    navigate = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
      return undefined;
    });
    jest
      .spyOn(Navigation, "getCurrentRoute")
      .mockReturnValue(new Route(`/dashboard/${BLOCKED_ID}/home`));
  });

  test("a blocked project's is told to the app, not sent to the Forbidden page", () => {
    const error: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { message: ExceptionMessages.ProjectBlocked },
      {},
    );

    expect(BaseAPI.handleError(error)).toBe(error);

    expect(dispatchEvent).toHaveBeenCalledWith(BlockedProject.REFUSED_EVENT);
    expect(navigate).not.toHaveBeenCalled();
  });

  test("any other 403 still goes to the Forbidden page", () => {
    BaseAPI.handleError(
      new HTTPErrorResponse(403, { message: "IP address not allowed." }, {}),
    );

    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe("/accounts/forbidden");
  });

  test("the server and the client agree on the words", () => {
    expect(
      ProjectBlockedException.isException(
        new ProjectBlockedException().message,
      ),
    ).toBe(true);
    expect(ProjectBlockedException.isException("Forbidden")).toBe(false);
  });
});

describe("the project picker", () => {
  test("marks a blocked project, and lists it", () => {
    render(
      <ProjectPickerMenuItem
        icon={IconProp.Folder}
        project={projectOf(BLOCKED_ID, true)}
        onProjectSelected={() => {}}
      />,
    );

    expect(screen.getByText("Spam Films")).toBeInTheDocument();
    expect(screen.getByTestId("project-picker-blocked")).toHaveTextContent(
      "Blocked",
    );
  });

  test("marks nothing on a project that is not blocked", () => {
    render(
      <ProjectPickerMenuItem
        icon={IconProp.Folder}
        project={projectOf(LIVE_ID, false)}
        onProjectSelected={() => {}}
      />,
    );

    expect(screen.queryByTestId("project-picker-blocked")).toBeNull();
  });
});
