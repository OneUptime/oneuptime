import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * "If I click on the owners page inside of the incident, I'm able to add
 * owners just by clicking on things, and it is basically combined." - the
 * maintainer, asking for that in place of two dropdowns.
 *
 * The picker, driven as a person would: one "Add owner" button, one search
 * list of people and teams, one click per pick, chips to take a pick away,
 * and the keyboard all the way through. Only the network is stubbed: a tiny
 * directory of two people and two teams answers the picker's requests the
 * way the API filters them.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import PeoplePicker from "../../../../UI/Components/PeoplePicker/PeoplePicker";
import { PEOPLE_SEARCH_DEBOUNCE_MS } from "../../../../UI/Components/PeoplePicker/PeopleSearchPopup";
import {
  PeoplePickerKind,
  PeoplePickerValue,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const BOB: string = "0000000e-0000-4000-8000-000000000002";
const GONE_USER: string = "0000000e-0000-4000-8000-0000000000ff";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";
const DATABASE: string = "0000000b-0000-4000-8000-000000000002";
const GONE_TEAM: string = "0000000b-0000-4000-8000-0000000000ff";

const KINDS: Array<PeoplePickerKind> = [
  PeoplePickerKind.User,
  PeoplePickerKind.Team,
];

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

const DIRECTORY: { users: Array<User>; teams: Array<Team> } = {
  users: [
    makeUser(ADA, "Ada Lovelace", "ada@example.com"),
    makeUser(BOB, "Bob Stone", "bob@example.com"),
  ],
  teams: [makeTeam(DATABASE, "Database"), makeTeam(PLATFORM, "Platform")],
};

function includes(haystack: unknown, needle: unknown): boolean {
  return String(haystack || "")
    .toLowerCase()
    .includes(String(needle || "").toLowerCase());
}

// Answers the picker's requests the way the API filters them.
function serveDirectory(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    const query: any = request.query || {};
    let rows: Array<unknown> = [];

    if (request.modelType === TeamMember) {
      let users: Array<User> = DIRECTORY.users;

      if (query.userId instanceof Includes) {
        users = users.filter((user: User): boolean => {
          return (query.userId.values as Array<string>).includes(
            user._id as string,
          );
        });
      }

      if (query.user?.name) {
        users = users.filter((user: User): boolean => {
          return includes(user.name, query.user.name.toString());
        });
      }

      if (query.user?.email) {
        users = users.filter((user: User): boolean => {
          return includes(user.email, query.user.email.toString());
        });
      }

      rows = users.map((user: User): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.user = user;
        return member;
      });
    }

    if (request.modelType === Team) {
      let teams: Array<Team> = DIRECTORY.teams;

      if (query._id instanceof Includes) {
        teams = teams.filter((team: Team): boolean => {
          return (query._id.values as Array<string>).includes(
            team._id as string,
          );
        });
      }

      if (query.name) {
        teams = teams.filter((team: Team): boolean => {
          return includes(team.name, query.name.toString());
        });
      }

      rows = teams;
    }

    return { data: rows, count: rows.length, skip: 0, limit: rows.length };
  });
}

const onChangeSpy: MockFunction = getJestMockFunction();
const onBlurSpy: MockFunction = getJestMockFunction();

interface HarnessProps {
  initial?: PeoplePickerValue;
  // Like a form that has not handed the last change back yet.
  ignoreChanges?: boolean;
  disabled?: boolean;
  error?: string;
}

function Harness(props: HarnessProps): ReactElement {
  const [value, setValue] = useState<PeoplePickerValue>(props.initial || {});

  return (
    <div>
      <label id="owners-label">Owners</label>
      <PeoplePicker
        kinds={KINDS}
        value={value}
        onChange={(next: PeoplePickerValue) => {
          onChangeSpy(next);

          if (!props.ignoreChanges) {
            setValue(next);
          }
        }}
        onBlur={() => {
          onBlurSpy();
        }}
        addButtonText="Add owner"
        ariaLabelledby="owners-label"
        disabled={props.disabled}
        error={props.error}
      />
    </div>
  );
}

/*
 * The text a screen reader reads: an avatar's initials are drawn for the
 * eye only (aria-hidden), the name beside them is the text.
 */
function readText(element: HTMLElement): string {
  const copy: HTMLElement = element.cloneNode(true) as HTMLElement;

  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden: Element) => {
    hidden.remove();
  });

  return copy.textContent || "";
}

function addButton(): HTMLElement {
  return screen.getByRole("button", { name: "Add owner" });
}

async function openList(): Promise<HTMLElement> {
  fireEvent.click(addButton());

  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: "Add owner",
  });

  await within(dialog).findAllByRole("option");

  return dialog;
}

function optionNamed(name: string): HTMLElement {
  const option: HTMLElement | undefined = screen
    .getAllByRole("option")
    .find((candidate: HTMLElement): boolean => {
      return readText(candidate).startsWith(name);
    });

  if (!option) {
    throw new Error(`No option named ${name}`);
  }

  return option;
}

function chipNames(): Array<string> {
  return screen
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string => {
      return readText(chip);
    });
}

function lastChange(): PeoplePickerValue {
  return onChangeSpy.mock.calls[onChangeSpy.mock.calls.length - 1]![0];
}

describe("PeoplePicker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
    serveDirectory();
  });

  afterEach(() => {
    cleanup();
  });

  test("starts as one Add owner button in a group named by the field's label", () => {
    render(<Harness />);

    expect(addButton()).toBeInTheDocument();
    expect(addButton()).toHaveAttribute("aria-haspopup", "dialog");
    expect(addButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("group", { name: "Owners" })).toContainElement(
      addButton(),
    );
    expect(chipNames()).toEqual([]);
    // Nothing is asked of the server until the list opens.
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("opens one list of people and teams, people first, each under its heading", async () => {
    render(<Harness />);

    const dialog: HTMLElement = await openList();

    expect(addButton()).toHaveAttribute("aria-expanded", "true");

    const groups: Array<HTMLElement> = within(dialog).getAllByRole("group");

    expect(
      groups.map((group: HTMLElement): string => {
        return group.getAttribute("aria-labelledby")
          ? document.getElementById(group.getAttribute("aria-labelledby")!)!
              .textContent || ""
          : "";
      }),
    ).toEqual(["People", "Teams"]);

    expect(
      within(groups[0]!)
        .getAllByRole("option")
        .map((option: HTMLElement) => {
          return readText(option);
        }),
    ).toEqual(["Ada Lovelaceada@example.com", "Bob Stonebob@example.com"]);
    // A team says it is one, under its name.
    expect(
      within(groups[1]!)
        .getAllByRole("option")
        .map((option: HTMLElement) => {
          return readText(option);
        }),
    ).toEqual(["DatabaseTeam", "PlatformTeam"]);

    // One request per kind, scoped to the project.
    expect(
      getListMock.mock.calls.map((call: Array<any>) => {
        return call[0].modelType;
      }),
    ).toEqual([TeamMember, Team]);
  });

  test("puts the cursor in the search box", async () => {
    render(<Harness />);

    await openList();

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveFocus();
    });
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "placeholder",
      "Search people or teams...",
    );
  });

  test("picks a person with one click, and stays open for the next pick", async () => {
    render(<Harness />);

    await openList();
    fireEvent.click(optionNamed("Ada Lovelace"));

    expect(lastChange()).toEqual({
      [PeoplePickerKind.User]: [ADA],
    });
    expect(chipNames()).toEqual(["Ada Lovelace"]);
    expect(screen.getByRole("dialog", { name: "Add owner" })).toBeVisible();
    expect(optionNamed("Ada Lovelace")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(optionNamed("Bob Stone")).toHaveAttribute("aria-selected", "false");
  });

  test("picks a team from the same list, as a chip that says it is a team", async () => {
    render(<Harness />);

    await openList();
    fireEvent.click(optionNamed("Ada Lovelace"));
    fireEvent.click(optionNamed("Platform"));

    expect(lastChange()).toEqual({
      [PeoplePickerKind.User]: [ADA],
      [PeoplePickerKind.Team]: [PLATFORM],
    });
    // People first, then teams, whatever order they were picked in.
    expect(chipNames()).toEqual(["Ada Lovelace", "PlatformTeam"]);
  });

  test("takes a pick away when its row is clicked again", async () => {
    render(<Harness />);

    await openList();
    fireEvent.click(optionNamed("Bob Stone"));
    fireEvent.click(optionNamed("Bob Stone"));

    expect(lastChange()).toEqual({ [PeoplePickerKind.User]: [] });
    expect(chipNames()).toEqual([]);
    expect(optionNamed("Bob Stone")).toHaveAttribute("aria-selected", "false");
  });

  test("shows the names of the picks it starts with, looking each kind up once", async () => {
    render(
      <Harness
        initial={{
          [PeoplePickerKind.User]: [ADA, BOB],
          [PeoplePickerKind.Team]: [PLATFORM],
        }}
      />,
    );

    await waitFor(() => {
      expect(chipNames()).toEqual([
        "Ada Lovelace",
        "Bob Stone",
        "PlatformTeam",
      ]);
    });

    const requests: Array<any> = getListMock.mock.calls.map(
      (call: Array<any>) => {
        return call[0];
      },
    );

    expect(requests).toHaveLength(2);
    expect(requests[0].modelType).toBe(TeamMember);
    expect(requests[0].query.userId.values).toEqual([ADA, BOB]);
    expect(requests[1].modelType).toBe(Team);
    expect(requests[1].query._id.values).toEqual([PLATFORM]);
  });

  test("removes a pick from its chip", async () => {
    render(<Harness initial={{ [PeoplePickerKind.User]: [ADA, BOB] }} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Ada Lovelace" }),
    );

    expect(lastChange()).toEqual({
      [PeoplePickerKind.User]: [BOB],
    });
    expect(chipNames()).toEqual(["Bob Stone"]);
  });

  test("keeps a pick that is gone - a person who left, a deleted team - so it can be removed", async () => {
    render(
      <Harness
        initial={{
          [PeoplePickerKind.User]: [GONE_USER],
          [PeoplePickerKind.Team]: [GONE_TEAM],
        }}
      />,
    );

    await waitFor(() => {
      expect(chipNames()).toEqual(["Unknown user", "Deleted teamTeam"]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove Deleted team" }));

    expect(lastChange()).toEqual({
      [PeoplePickerKind.User]: [GONE_USER],
      [PeoplePickerKind.Team]: [],
    });
  });

  test("searches people and teams together as you type", async () => {
    render(<Harness />);

    await openList();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "data" },
    });

    await waitFor(
      () => {
        expect(
          screen.getAllByRole("option").map((option: HTMLElement) => {
            return readText(option);
          }),
        ).toEqual(["DatabaseTeam"]);
      },
      { timeout: PEOPLE_SEARCH_DEBOUNCE_MS * 20 },
    );

    const teamSearch: any = getListMock.mock.calls
      .map((call: Array<any>) => {
        return call[0];
      })
      .find((request: any): boolean => {
        return request.modelType === Team && Boolean(request.query.name);
      });

    expect(teamSearch.query.name.toString()).toBe("data");
  });

  test("says so when nothing matches", async () => {
    render(<Harness />);

    await openList();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });

    expect(
      await screen.findByText(
        "No matches found.",
        {},
        { timeout: PEOPLE_SEARCH_DEBOUNCE_MS * 20 },
      ),
    ).toBeInTheDocument();
  });

  test("is driven by the keyboard: open, move, pick", async () => {
    render(<Harness />);

    fireEvent.keyDown(addButton(), { key: "Enter" });

    await screen.findAllByRole("option");

    const search: HTMLElement = screen.getByRole("combobox");

    await waitFor(() => {
      expect(search).toHaveFocus();
    });

    // The first row is where the keyboard starts.
    expect(search).toHaveAttribute(
      "aria-activedescendant",
      optionNamed("Ada Lovelace").id,
    );

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });

    expect(search).toHaveAttribute(
      "aria-activedescendant",
      optionNamed("Database").id,
    );

    fireEvent.keyDown(search, { key: "ArrowUp" });

    expect(search).toHaveAttribute(
      "aria-activedescendant",
      optionNamed("Bob Stone").id,
    );

    // Enter picks; it never reaches the form the picker sits in.
    const notPrevented: boolean = fireEvent.keyDown(search, { key: "Enter" });

    expect(notPrevented).toBe(false);
    expect(lastChange()).toEqual({ [PeoplePickerKind.User]: [BOB] });
  });

  test("stops at the ends of the list", async () => {
    render(<Harness />);

    await openList();

    const search: HTMLElement = screen.getByRole("combobox");

    fireEvent.keyDown(search, { key: "ArrowUp" });

    expect(search).toHaveAttribute(
      "aria-activedescendant",
      optionNamed("Ada Lovelace").id,
    );

    for (let i: number = 0; i < 10; i++) {
      fireEvent.keyDown(search, { key: "ArrowDown" });
    }

    expect(search).toHaveAttribute(
      "aria-activedescendant",
      optionNamed("Platform").id,
    );
  });

  test("closes on Escape and hands focus back to the button", async () => {
    render(<Harness />);

    await openList();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(addButton()).toHaveFocus();
    expect(addButton()).toHaveAttribute("aria-expanded", "false");
    // Closing the list is what visiting the field means.
    expect(onBlurSpy).toHaveBeenCalledTimes(1);
  });

  test("closes when clicked outside", async () => {
    render(<Harness />);

    await openList();

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  test("keeps picks made in a row before the form hands the value back", async () => {
    render(<Harness ignoreChanges={true} />);

    await openList();
    fireEvent.click(optionNamed("Ada Lovelace"));
    fireEvent.click(optionNamed("Database"));

    expect(lastChange()).toEqual({
      [PeoplePickerKind.User]: [ADA],
      [PeoplePickerKind.Team]: [DATABASE],
    });
  });

  test("when switched off, opens nothing and removes nothing", async () => {
    render(
      <Harness disabled={true} initial={{ [PeoplePickerKind.User]: [ADA] }} />,
    );

    await waitFor(() => {
      expect(chipNames()).toEqual(["Ada Lovelace"]);
    });

    expect(addButton()).toBeDisabled();
    fireEvent.click(addButton());

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove Ada Lovelace" }),
    ).not.toBeInTheDocument();
  });

  test("shows the field's error, tied to the group", () => {
    render(<Harness error="Owners is required." />);

    const alert: HTMLElement = screen.getByRole("alert");

    expect(alert).toHaveTextContent("Owners is required.");
    expect(screen.getByRole("group", { name: "Owners" })).toHaveAttribute(
      "aria-describedby",
      alert.id,
    );
  });

  test("says what went wrong when the list cannot be loaded", async () => {
    getListMock.mockRejectedValue(new Error("The server is down."));

    render(<Harness />);

    fireEvent.click(addButton());

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owner",
    });

    expect(
      await within(dialog).findByText("The server is down."),
    ).toBeInTheDocument();
  });

  test("offers nobody outside a project, and asks nothing", async () => {
    window.history.replaceState({}, "", "/dashboard");
    window.localStorage.clear();
    window.sessionStorage.clear();

    render(<Harness />);

    fireEvent.click(addButton());

    expect(
      await screen.findByText("No people or teams available."),
    ).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("names the list and its rows for a screen reader", async () => {
    render(<Harness />);

    await openList();

    const listbox: HTMLElement = screen.getByRole("listbox", {
      name: "Add owner",
    });

    expect(listbox).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-controls",
      listbox.id,
    );

    await act(async () => {
      fireEvent.click(optionNamed("Platform"));
    });

    expect(
      screen.getByRole("button", { name: "Remove Platform" }),
    ).toBeInTheDocument();
  });
});
