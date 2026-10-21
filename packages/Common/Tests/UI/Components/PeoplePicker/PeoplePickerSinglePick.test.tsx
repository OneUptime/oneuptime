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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  describeNestedControls,
  findNestedControls,
} from "../../../Helpers/NestedControls";

/*
 * A people picker that takes one pick - an incoming call rule's "Who to
 * call": one on-call schedule or one person. Driven as a person would, with
 * only the network stubbed: a pick replaces the last one, of either kind,
 * and closes the list; what is picked comes first and the button after it
 * reads "Change"; a picked row is ticked and picking it again keeps it.
 *
 * The same picker taking several picks (owners, an escalation rule's
 * Notify) must not change: its button stays first and its list stays open.
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

import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import PeoplePicker from "../../../../UI/Components/PeoplePicker/PeoplePicker";
import {
  PeoplePickerKind,
  PeoplePickerValue,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const PRIMARY: string = "0000000c-0000-4000-8000-000000000001";
const NIGHTS: string = "0000000c-0000-4000-8000-000000000002";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const BOB: string = "0000000e-0000-4000-8000-000000000002";

const KINDS: Array<PeoplePickerKind> = [
  PeoplePickerKind.OnCallSchedule,
  PeoplePickerKind.User,
];

function makeUser(id: string, name: string, email: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

function makeSchedule(id: string, name: string): OnCallDutyPolicySchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule._id = id;
  schedule.name = name;
  return schedule;
}

const USERS: Array<User> = [
  makeUser(ADA, "Ada Lovelace", "ada@example.com"),
  makeUser(BOB, "Bob Stone", "bob@example.com"),
];

const SCHEDULES: Array<OnCallDutyPolicySchedule> = [
  makeSchedule(NIGHTS, "Nights"),
  makeSchedule(PRIMARY, "Primary rotation"),
];

function wanted(query: unknown, id: string): boolean {
  if (!(query instanceof Includes)) {
    return true;
  }

  return (query.values as Array<unknown>).some((value: unknown): boolean => {
    return String(value) === id;
  });
}

function serveDirectory(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    const query: any = request.query || {};
    let rows: Array<unknown> = [];

    if (request.modelType === TeamMember) {
      rows = USERS.filter((user: User): boolean => {
        return wanted(query.userId, user._id as string);
      }).map((user: User): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.user = user;
        return member;
      });
    }

    if (request.modelType === OnCallDutyPolicySchedule) {
      rows = SCHEDULES.filter((schedule: OnCallDutyPolicySchedule) => {
        return wanted(query._id, schedule._id as string);
      });
    }

    return { data: rows, count: rows.length, skip: 0, limit: rows.length };
  });
}

const onChangeSpy: MockFunction = getJestMockFunction();

interface HarnessProps {
  initial?: PeoplePickerValue;
  isSinglePick?: boolean;
}

function Harness(props: HarnessProps): ReactElement {
  const [value, setValue] = useState<PeoplePickerValue>(props.initial || {});

  return (
    <div>
      <label id="who-to-call-label">Who to call</label>
      <PeoplePicker
        kinds={KINDS}
        value={value}
        onChange={(next: PeoplePickerValue) => {
          onChangeSpy(next);
          setValue(next);
        }}
        addButtonText="Choose who to call"
        ariaLabelledby="who-to-call-label"
        isSinglePick={props.isSinglePick ?? true}
      />
    </div>
  );
}

// What a screen reader reads: an avatar's initials are drawn for the eye only.
function readText(element: HTMLElement): string {
  const copy: HTMLElement = element.cloneNode(true) as HTMLElement;

  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden: Element) => {
    hidden.remove();
  });

  return copy.textContent || "";
}

function pickerButton(): HTMLElement {
  return screen.getByTestId("people-picker-add-button");
}

async function openList(): Promise<HTMLElement> {
  fireEvent.click(pickerButton());

  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: "Choose who to call",
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

// The picker's controls, in the order they are drawn: chips and the button.
function drawnOrder(): Array<string> {
  const group: HTMLElement = screen.getByRole("group", { name: "Who to call" });

  return Array.from(group.children).map((child: Element): string => {
    if (child.querySelector('[data-testid="people-picker-add-button"]')) {
      return "button";
    }

    return child.getAttribute("data-testid") === "people-chip"
      ? "chip"
      : child.querySelector('[data-testid="people-chip"]')
        ? "chip"
        : "other";
  });
}

describe("a people picker that takes one pick", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call`);
    serveDirectory();
  });

  afterEach(() => {
    cleanup();
  });

  test("starts as one button that says what to choose", () => {
    render(<Harness />);

    expect(pickerButton()).toHaveTextContent("Choose who to call");
    expect(pickerButton()).toHaveAttribute("aria-haspopup", "dialog");
    expect(chipNames()).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("lists on-call schedules, then people, as one single choice", async () => {
    render(<Harness />);

    const dialog: HTMLElement = await openList();

    const groups: Array<HTMLElement> = within(dialog).getAllByRole("group");

    expect(
      groups.map((group: HTMLElement): string => {
        return (
          document.getElementById(group.getAttribute("aria-labelledby")!)!
            .textContent || ""
        );
      }),
    ).toEqual(["On-call schedules", "People"]);

    // One choice, not several.
    const listbox: HTMLElement = within(dialog).getByRole("listbox");

    expect(listbox).not.toHaveAttribute("aria-multiselectable");

    for (const option of within(dialog).getAllByRole("option")) {
      expect(option).toHaveAttribute("aria-selected", "false");
    }
  });

  test("a pick is the choice: the list closes and hands focus back", async () => {
    render(<Harness />);

    await openList();
    fireEvent.click(optionNamed("Primary rotation"));

    expect(lastChange()).toEqual({
      [PeoplePickerKind.OnCallSchedule]: [PRIMARY],
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(pickerButton()).toHaveFocus();
    expect(chipNames()).toEqual(["Primary rotationSchedule"]);
  });

  test("once something is picked, shows it first and offers to change it", async () => {
    render(<Harness />);

    expect(drawnOrder()).toEqual(["button"]);

    await openList();
    fireEvent.click(optionNamed("Ada Lovelace"));

    await waitFor(() => {
      expect(chipNames()).toEqual(["Ada Lovelace"]);
    });

    expect(drawnOrder()).toEqual(["chip", "button"]);
    expect(pickerButton()).toHaveTextContent("Change");
    expect(pickerButton()).not.toHaveTextContent("Choose who to call");
  });

  test("a new pick replaces the last one, of the other kind too", async () => {
    render(<Harness />);

    await openList();
    fireEvent.click(optionNamed("Primary rotation"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await openList();

    // The pick so far is ticked.
    expect(optionNamed("Primary rotation")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(optionNamed("Bob Stone"));

    expect(lastChange()).toEqual({ [PeoplePickerKind.User]: [BOB] });

    await waitFor(() => {
      expect(chipNames()).toEqual(["Bob Stone"]);
    });
  });

  test("a new pick of the same kind replaces the last one", async () => {
    render(<Harness initial={{ [PeoplePickerKind.User]: [ADA] }} />);

    await openList();
    fireEvent.click(optionNamed("Bob Stone"));

    expect(lastChange()).toEqual({ [PeoplePickerKind.User]: [BOB] });

    await waitFor(() => {
      expect(chipNames()).toEqual(["Bob Stone"]);
    });
  });

  test("picking what is picked keeps it, and closes the list", async () => {
    render(<Harness initial={{ [PeoplePickerKind.User]: [ADA] }} />);

    await openList();
    fireEvent.click(optionNamed("Ada Lovelace"));

    expect(onChangeSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(chipNames()).toEqual(["Ada Lovelace"]);
  });

  test("opens on the pick it starts with: a saved rule's schedule", async () => {
    render(
      <Harness initial={{ [PeoplePickerKind.OnCallSchedule]: [NIGHTS] }} />,
    );

    await waitFor(() => {
      expect(chipNames()).toEqual(["NightsSchedule"]);
    });

    expect(pickerButton()).toHaveTextContent("Change");
  });

  test("the pick can be taken away, which asks for a choice again", async () => {
    render(<Harness initial={{ [PeoplePickerKind.User]: [ADA] }} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Ada Lovelace" }),
    );

    expect(lastChange()).toEqual({ [PeoplePickerKind.User]: [] });
    expect(chipNames()).toEqual([]);
    expect(pickerButton()).toHaveTextContent("Choose who to call");
  });

  test("is chosen from the keyboard: Enter picks and closes", async () => {
    render(<Harness />);

    fireEvent.keyDown(pickerButton(), { key: "Enter" });

    await screen.findAllByRole("option");

    const search: HTMLElement = screen.getByRole("combobox");

    await waitFor(() => {
      expect(search).toHaveFocus();
    });

    // Nights, Primary rotation, then Ada Lovelace.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });

    expect(search).toHaveAttribute(
      "aria-activedescendant",
      optionNamed("Ada Lovelace").id,
    );

    const notPrevented: boolean = fireEvent.keyDown(search, { key: "Enter" });

    expect(notPrevented).toBe(false);
    expect(lastChange()).toEqual({ [PeoplePickerKind.User]: [ADA] });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

describe("the same picker taking several picks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call`);
    serveDirectory();
  });

  afterEach(() => {
    cleanup();
  });

  test("keeps its button first and its list open, adding picks", async () => {
    render(<Harness isSinglePick={false} />);

    await openList();
    fireEvent.click(optionNamed("Primary rotation"));
    fireEvent.click(optionNamed("Ada Lovelace"));

    expect(lastChange()).toEqual({
      [PeoplePickerKind.OnCallSchedule]: [PRIMARY],
      [PeoplePickerKind.User]: [ADA],
    });
    expect(
      screen.getByRole("dialog", { name: "Choose who to call" }),
    ).toBeVisible();
    expect(
      screen.getByRole("listbox", { name: "Choose who to call" }),
    ).toHaveAttribute("aria-multiselectable", "true");

    expect(drawnOrder()).toEqual(["button", "chip", "chip"]);
    expect(pickerButton()).toHaveTextContent("Choose who to call");
  });

  test("takes a pick away when its row is clicked again", async () => {
    render(<Harness isSinglePick={false} />);

    await openList();
    fireEvent.click(optionNamed("Bob Stone"));
    fireEvent.click(optionNamed("Bob Stone"));

    expect(lastChange()).toEqual({ [PeoplePickerKind.User]: [] });
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});

/*
 * The people picker has the shape the dropdown's Clear button and the filter
 * chips' "x" were taken apart for: chips that each carry a remove button,
 * beside a button that opens a list of options. No control may be drawn
 * inside another (a screen reader reads a button, or an option, as one
 * control and offers nothing inside it).
 */
describe("the people picker draws no control inside another", () => {
  test.each([
    ["one pick", true],
    ["several picks", false],
  ])(
    "taking %s: with picks, and with its list open",
    async (_name: string, isSinglePick: boolean) => {
      const view: ReturnType<typeof render> = render(
        <Harness
          isSinglePick={isSinglePick}
          initial={
            isSinglePick
              ? { [PeoplePickerKind.OnCallSchedule]: [PRIMARY] }
              : {
                  [PeoplePickerKind.OnCallSchedule]: [PRIMARY],
                  [PeoplePickerKind.User]: [ADA],
                }
          }
        />,
      );

      await waitFor(() => {
        expect(chipNames().length).toBeGreaterThan(0);
      });
      expect(
        describeNestedControls(findNestedControls(view.container)),
      ).toEqual([]);

      await openList();
      expect(describeNestedControls(findNestedControls(document.body))).toEqual(
        [],
      );
    },
  );
});
