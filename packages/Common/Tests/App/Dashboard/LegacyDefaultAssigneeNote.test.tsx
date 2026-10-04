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
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The line a grouping rule's On-Call & Ownership step shows under Episode
 * Owners while the rule still has a default assignee from the old form
 * (Components/GroupingRule/LegacyDefaultAssigneeNote): it names the user
 * and the team, says nothing shows them, and offers Add as owners and
 * Remove. Only the network is stubbed: a tiny directory answers the lookups
 * the way the API filters them.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

import LegacyDefaultAssigneeNote from "../../../../App/FeatureSet/Dashboard/src/Components/GroupingRule/LegacyDefaultAssigneeNote";
import {
  GROUPING_RULE_COPY,
  LegacyDefaultAssignee,
  LegacyDefaultAssigneeAction,
  LegacyDefaultAssigneeChange,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/GroupingRule/GroupingRuleSetup";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";

const PROJECT_ID: string = "44444444-4444-4444-8444-444444444444";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const GONE_USER: string = "0000000e-0000-4000-8000-0000000000ff";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";
const GONE_TEAM: string = "0000000b-0000-4000-8000-0000000000ff";

function makeUser(id: string, name: string, email: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

function makeTeam(id: string, name: string): Team {
  const team: Team = new Team();
  team._id = id;
  team.name = name;
  return team;
}

const USERS: Array<User> = [makeUser(ADA, "Ada Lovelace", "ada@example.com")];
const TEAMS: Array<Team> = [makeTeam(PLATFORM, "Platform")];

function serveDirectory(request: any): Promise<unknown> {
  const query: any = request.query || {};
  let rows: Array<unknown> = [];

  if (request.modelType === TeamMember) {
    rows = USERS.filter((user: User): boolean => {
      return (
        query.userId instanceof Includes &&
        (query.userId.values as Array<string>).includes(user._id as string)
      );
    }).map((user: User): TeamMember => {
      const member: TeamMember = new TeamMember();
      member.user = user;
      return member;
    });
  }

  if (request.modelType === Team) {
    rows = TEAMS.filter((team: Team): boolean => {
      return (
        query._id instanceof Includes &&
        (query._id.values as Array<string>).includes(team._id as string)
      );
    });
  }

  return Promise.resolve({
    data: rows,
    count: rows.length,
    skip: 0,
    limit: rows.length,
  });
}

const onChange: MockFunction = getJestMockFunction();

function renderNote(assignee: LegacyDefaultAssignee): HTMLElement {
  render(
    <LegacyDefaultAssigneeNote
      assignee={assignee}
      onChange={(change: LegacyDefaultAssigneeChange): void => {
        onChange(change);
      }}
    />,
  );

  return screen.getByTestId("legacy-default-assignee");
}

// The text a screen reader reads: avatar initials are for the eye only.
function readText(element: HTMLElement): string {
  const copy: HTMLElement = element.cloneNode(true) as HTMLElement;

  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden: Element) => {
    hidden.remove();
  });

  return copy.textContent || "";
}

function chipNames(): Array<string> {
  return screen
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string => {
      return readText(chip);
    });
}

function lastChange(): LegacyDefaultAssigneeChange {
  return onChange.mock.calls[onChange.mock.calls.length - 1]![0];
}

describe("LegacyDefaultAssigneeNote", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getListMock.mockImplementation(serveDirectory);
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/incidents/settings/grouping-rules`,
    );
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  test("names the user and the team, says nothing shows them, and how to make them responsible", async () => {
    const note: HTMLElement = renderNote({ userId: ADA, teamId: PLATFORM });

    expect(note).toHaveAccessibleName(GROUPING_RULE_COPY.legacyAssigneeTitle);
    expect(note).toHaveAccessibleName("Default assignee");
    expect(note).toHaveAccessibleDescription(
      GROUPING_RULE_COPY.legacyAssigneeDescription,
    );

    await waitFor(() => {
      expect(chipNames()).toEqual(["Ada Lovelace", "PlatformTeam"]);
    });

    // Each kind looked up once, in the project, by id.
    const requests: Array<any> = getListMock.mock.calls.map(
      (call: Array<any>) => {
        return call[0];
      },
    );

    expect(
      requests.map((request: any) => {
        return request.modelType;
      }),
    ).toEqual([TeamMember, Team]);
    expect(requests[0].query.projectId.toString()).toBe(PROJECT_ID);
    expect(requests[0].query.userId.values).toEqual([ADA]);
    expect(requests[1].query._id.values).toEqual([PLATFORM]);
  });

  test("Add as owners waits for the names, then hands over what to add", async () => {
    let answer: (value: unknown) => void = (): void => {
      // Replaced below.
    };

    getListMock.mockImplementation((request: any): Promise<unknown> => {
      return new Promise((resolve: (value: unknown) => void) => {
        answer = (): void => {
          serveDirectory(request).then(resolve);
        };
      });
    });

    const note: HTMLElement = renderNote({ userId: ADA, teamId: null });

    // Still looking the name up: nothing to add yet.
    expect(
      within(note).getByRole("button", { name: "Add as owners" }),
    ).toBeDisabled();
    expect(within(note).getByRole("button", { name: "Remove" })).toBeEnabled();

    await act(async (): Promise<void> => {
      answer(undefined);
    });

    await waitFor(() => {
      expect(
        within(note).getByRole("button", { name: "Add as owners" }),
      ).toBeEnabled();
    });

    fireEvent.click(
      within(note).getByRole("button", { name: "Add as owners" }),
    );

    expect(lastChange()).toEqual({
      action: LegacyDefaultAssigneeAction.AddAsOwners,
      userId: ADA,
      teamId: null,
    });
  });

  test("Remove lets it go", async () => {
    const note: HTMLElement = renderNote({ userId: null, teamId: PLATFORM });

    await waitFor(() => {
      expect(chipNames()).toEqual(["PlatformTeam"]);
    });

    fireEvent.click(within(note).getByRole("button", { name: "Remove" }));

    expect(lastChange()).toEqual({
      action: LegacyDefaultAssigneeAction.Remove,
    });
  });

  test("hands over only what the project still has: a person who left is not made an owner", async () => {
    const note: HTMLElement = renderNote({
      userId: GONE_USER,
      teamId: PLATFORM,
    });

    await waitFor(() => {
      expect(chipNames()).toEqual(["Unknown user", "PlatformTeam"]);
    });

    fireEvent.click(
      within(note).getByRole("button", { name: "Add as owners" }),
    );

    expect(lastChange()).toEqual({
      action: LegacyDefaultAssigneeAction.AddAsOwners,
      userId: null,
      teamId: PLATFORM,
    });
  });

  test("offers only Remove when nobody it names is in the project any more", async () => {
    const note: HTMLElement = renderNote({
      userId: GONE_USER,
      teamId: GONE_TEAM,
    });

    await waitFor(() => {
      expect(chipNames()).toEqual(["Unknown user", "Deleted teamTeam"]);
    });

    expect(
      within(note).queryByRole("button", { name: "Add as owners" }),
    ).not.toBeInTheDocument();
    expect(within(note).getByRole("button", { name: "Remove" })).toBeEnabled();
  });

  test("its buttons never submit the form it sits in", async () => {
    const submit: MockFunction = getJestMockFunction();

    render(
      <form
        onSubmit={(event: React.FormEvent): void => {
          event.preventDefault();
          submit();
        }}
      >
        <LegacyDefaultAssigneeNote
          assignee={{ userId: null, teamId: PLATFORM }}
          onChange={(): void => {
            // Not asserted on.
          }}
        />
      </form>,
    );

    await waitFor(() => {
      expect(chipNames()).toEqual(["PlatformTeam"]);
    });

    for (const button of within(
      screen.getByTestId("legacy-default-assignee"),
    ).getAllByRole("button")) {
      expect(button).toHaveAttribute("type", "button");
      fireEvent.click(button);
    }

    expect(submit).not.toHaveBeenCalled();
  });
});
