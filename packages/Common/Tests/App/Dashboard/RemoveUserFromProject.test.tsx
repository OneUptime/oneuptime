import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Users > View User > Remove from Project.
 *
 * Two things were wrong with this page, and the bug report walked into both.
 *
 * It removed one team, not the user. It read the user's memberships with
 * limit: 1 and deleted that one, so someone on three teams lost one of them,
 * stayed in the project, and the page navigated away as though it had worked.
 *
 * And it never checked whether there was anyone left to remove. After the
 * admin had taken the user off their last team on the Teams tab, the user was
 * already gone from the project - but this page, reached through the same
 * still-mounted layout, showed a live Remove button that did nothing visible.
 * "I am not sure if the user is removed or not."
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

import RemoveUserFromProject from "../../../../App/FeatureSet/Dashboard/src/Components/User/RemoveUserFromProject";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUsersModelAPI from "../../../UI/Utils/ModelAPI/ProjectUsersModelAPI";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-0000000000aa");

type MembershipSpec = {
  id: string;
  teamName: string;
  accepted?: boolean | undefined;
};

const buildMembership: (spec: MembershipSpec) => TeamMember = (
  spec: MembershipSpec,
): TeamMember => {
  const membership: TeamMember = new TeamMember();
  membership._id = spec.id;
  membership.userId = USER_ID;
  membership.projectId = PROJECT_ID;
  membership.hasAcceptedInvitation = spec.accepted ?? true;

  const user: User = new User();
  user._id = USER_ID.toString();
  user.name = new Name("Jane Doe");
  user.email = new Email("jane@example.com");
  membership.user = user;

  const team: Team = new Team();
  team._id = `team-${spec.id}`;
  team.name = spec.teamName;
  membership.team = team;

  return membership;
};

const asList: (memberships: Array<TeamMember>) => ListResult<TeamMember> = (
  memberships: Array<TeamMember>,
): ListResult<TeamMember> => {
  return {
    data: memberships,
    count: memberships.length,
    skip: 0,
    limit: LIMIT_PER_PROJECT,
  };
};

interface Spy {
  mockResolvedValue: (value: unknown) => Spy;
  mockImplementation: (fn: (...args: Array<unknown>) => unknown) => Spy;
  mock: { calls: Array<Array<unknown>> };
}

let getListSpy: Spy;
let deleteItemSpy: Spy;
let removeUserSpy: Spy;
let onActionComplete: MockFunction;
let onError: MockFunction;

const THREE_TEAMS: Array<MembershipSpec> = [
  { id: "m1", teamName: "Owners" },
  { id: "m2", teamName: "SRE" },
  { id: "m3", teamName: "Backend" },
];

const renderComponent: () => void = (): void => {
  render(
    <RemoveUserFromProject
      projectId={PROJECT_ID}
      userId={USER_ID}
      onActionComplete={onActionComplete}
      onError={onError}
    />,
  );
};

type FindButtonsFunction = (label: string) => Array<HTMLButtonElement>;

const findButtons: FindButtonsFunction = (
  label: string,
): Array<HTMLButtonElement> => {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).filter((button: HTMLButtonElement) => {
    return (button.textContent || "").trim() === label;
  });
};

const openDialog: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    await waitFor(() => {
      expect(findButtons("Remove from Project")).toHaveLength(1);
    });

    fireEvent.click(findButtons("Remove from Project")[0]!);

    return await waitFor(() => {
      return screen.getByTestId("confirm-modal-description");
    });
  };

type ConfirmFunction = () => void;

// The dialog's submit button, not the card's (both say Remove from Project).
const confirm: ConfirmFunction = (): void => {
  const buttons: Array<HTMLButtonElement> = findButtons("Remove from Project");
  fireEvent.click(buttons[buttons.length - 1]!);
};

beforeEach(() => {
  getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as Spy;
  deleteItemSpy = jest.spyOn(ModelAPI, "deleteItem") as unknown as Spy;
  deleteItemSpy.mockResolvedValue(undefined);
  removeUserSpy = jest.spyOn(
    ProjectUsersModelAPI,
    "removeUserFromProject",
  ) as unknown as Spy;
  removeUserSpy.mockResolvedValue(undefined);
  onActionComplete = getJestMockFunction();
  onError = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("RemoveUserFromProject", () => {
  describe("when the user is a member", () => {
    beforeEach(() => {
      getListSpy.mockResolvedValue(asList(THREE_TEAMS.map(buildMembership)));
    });

    test("reads all of the user's memberships in this project, not just the first", async () => {
      renderComponent();

      await waitFor(() => {
        expect(getListSpy.mock.calls.length).toBeGreaterThan(0);
      });

      const args: {
        query: Record<string, unknown>;
        limit: number;
      } = getListSpy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        limit: number;
      };

      expect(args.query["userId"]).toBe(USER_ID);
      expect(args.query["projectId"]).toBe(PROJECT_ID);
      expect(args.limit).toBe(LIMIT_PER_PROJECT);
    });

    test("names the user and every team on the card", async () => {
      renderComponent();

      await waitFor(() => {
        expect(
          screen.getByText(
            "Remove Jane Doe (jane@example.com) from this project, and from every team they belong to in it: Backend, Owners and SRE. They will lose access to the project immediately.",
          ),
        ).toBeInTheDocument();
      });
    });

    test("confirms with the user, the teams and the impact", async () => {
      renderComponent();

      const description: HTMLElement = await openDialog();

      expect(description).toHaveTextContent(
        "Remove Jane Doe (jane@example.com) from this project?",
      );
      expect(description).toHaveTextContent(
        "They will be removed from all 3 of their teams (Backend, Owners and SRE).",
      );
      expect(description).toHaveTextContent(
        "taken off every on-call schedule and escalation policy",
      );
      expect(description).toHaveTextContent(
        "Their OneUptime account is not deleted",
      );
    });

    /*
     * The heart of the fix. The old code deleted exactly one membership - the
     * first the list returned - and called it done.
     */
    test("removes the user from every team in one request", async () => {
      renderComponent();

      await openDialog();
      confirm();

      await waitFor(() => {
        expect(removeUserSpy.mock.calls).toHaveLength(1);
      });

      const args: { userId: ObjectID } = removeUserSpy.mock.calls[0]![0] as {
        userId: ObjectID;
      };
      expect(args.userId).toBe(USER_ID);

      // Never a DELETE per membership - let alone for only one of them.
      expect(deleteItemSpy.mock.calls).toHaveLength(0);
    });

    test("reports completion once the removal has succeeded", async () => {
      renderComponent();

      await openDialog();
      confirm();

      await waitFor(() => {
        expect(onActionComplete).toHaveBeenCalledTimes(1);
      });
      expect(onError).not.toHaveBeenCalled();
    });

    test("does nothing when the dialog is cancelled", async () => {
      renderComponent();

      await openDialog();
      fireEvent.click(findButtons("Cancel")[0]!);

      await waitFor(() => {
        expect(
          screen.queryByTestId("confirm-modal-description"),
        ).not.toBeInTheDocument();
      });

      expect(removeUserSpy.mock.calls).toHaveLength(0);
      expect(onActionComplete).not.toHaveBeenCalled();
    });

    test("shows the server's refusal and does not pretend it worked", async () => {
      const refusal: HTTPErrorResponse = new HTTPErrorResponse(
        400,
        {
          message:
            "This team should have at least 1 member who has accepted the invitation.",
        },
        {},
      );
      removeUserSpy.mockImplementation(async () => {
        throw refusal;
      });

      renderComponent();

      await openDialog();
      confirm();

      await waitFor(() => {
        expect(
          screen.getByText(
            "This team should have at least 1 member who has accepted the invitation.",
          ),
        ).toBeInTheDocument();
      });

      expect(screen.getByText("Remove User Error")).toBeInTheDocument();
      expect(onActionComplete).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(
        "This team should have at least 1 member who has accepted the invitation.",
      );
    });
  });

  describe("when the user has only a pending invitation", () => {
    test("says their invitation will be cancelled", async () => {
      getListSpy.mockResolvedValue(
        asList([
          buildMembership({ id: "m1", teamName: "Owners", accepted: false }),
        ]),
      );

      renderComponent();

      const description: HTMLElement = await openDialog();

      expect(description).toHaveTextContent(
        "They have not accepted an invitation to this project yet. Removing them cancels their invitation to the Owners team",
      );
    });
  });

  // The bug report's dead end.
  describe("when the user is no longer in the project", () => {
    beforeEach(() => {
      getListSpy.mockResolvedValue(asList([]));
    });

    test("says so", async () => {
      renderComponent();

      await waitFor(() => {
        expect(
          screen.getByText(
            "This user is no longer a member of this project - they are not on any of its teams - so there is nothing left to remove.",
          ),
        ).toBeInTheDocument();
      });
    });

    test("offers no Remove button to press", async () => {
      renderComponent();

      await waitFor(() => {
        expect(
          screen.getByText(/no longer a member of this project/),
        ).toBeInTheDocument();
      });

      expect(findButtons("Remove from Project")).toHaveLength(0);
      expect(findButtons("Remove")).toHaveLength(0);
      expect(removeUserSpy.mock.calls).toHaveLength(0);
    });
  });

  describe("while loading", () => {
    test("offers no Remove button until it knows whether there is anyone to remove", async () => {
      let resolveList: (value: ListResult<TeamMember>) => void = () => {};
      getListSpy.mockImplementation(() => {
        return new Promise<ListResult<TeamMember>>(
          (resolve: (value: ListResult<TeamMember>) => void) => {
            resolveList = resolve;
          },
        );
      });

      renderComponent();

      expect(screen.getByText("Remove User from Project")).toBeInTheDocument();
      expect(findButtons("Remove from Project")).toHaveLength(0);

      resolveList(asList(THREE_TEAMS.map(buildMembership)));

      await waitFor(() => {
        expect(findButtons("Remove from Project")).toHaveLength(1);
      });
    });
  });

  describe("when the memberships cannot be read", () => {
    test("shows the error instead of a button", async () => {
      getListSpy.mockImplementation(async () => {
        throw new HTTPErrorResponse(
          500,
          { message: "Could not read team members." },
          {},
        );
      });

      renderComponent();

      await waitFor(() => {
        expect(
          screen.getByText("Could not read team members."),
        ).toBeInTheDocument();
      });

      expect(findButtons("Remove from Project")).toHaveLength(0);
    });
  });
});
