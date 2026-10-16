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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * WHAT A PICK CAME TO, UNDER THE LIST.
 *
 * A people search whose picks act at once - Add people on a record's channel
 * card invites somebody the moment they are picked - answers each pick with
 * what it came to, and the list says it under itself until the next pick:
 * what was done in green, what was left as it was in grey, what went wrong
 * in red, a sentence a line. A pick answered with nothing says nothing, as
 * every other caller's does.
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

import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import {
  PeopleSearchNotice,
  PeopleSearchNoticeTone,
} from "../../../../UI/Components/PeoplePicker/PeopleSearchNotice";
import PeopleSearchPopup, {
  ComponentProps as PeopleSearchPopupProps,
} from "../../../../UI/Components/PeoplePicker/PeopleSearchPopup";
import {
  PeoplePickerKind,
  PeoplePickerOption,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import { AnchoredFieldPopup } from "../../../../UI/Types/UseAnchoredFieldPopup";

function makeUser(id: string, name: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(`${name.split(" ")[0]!.toLowerCase()}@example.com`);
  return user;
}

// An open list, placed at its button.
function popupOf(isOpen: boolean): AnchoredFieldPopup {
  return {
    isPopupOpen: isOpen,
    popupPosition: isOpen
      ? { top: 120, bottom: undefined, left: 40, maxHeight: 380, width: 320 }
      : null,
    popupRef: { current: null },
    popupId: "people-search-notices",
    portalTarget: document.body,
  } as unknown as AnchoredFieldPopup;
}

function renderList(
  onPick: PeopleSearchPopupProps["onPick"],
): (isOpen: boolean) => void {
  const props: Omit<PeopleSearchPopupProps, "popup"> = {
    kinds: [PeoplePickerKind.User],
    selectedKeys: new Set<string>(),
    selectionMode: "add",
    onPick: onPick,
    ariaLabel: "Add people",
  };

  const { rerender } = render(
    <PeopleSearchPopup popup={popupOf(true)} {...props} />,
  );

  return (isOpen: boolean): void => {
    rerender(<PeopleSearchPopup popup={popupOf(isOpen)} {...props} />);
  };
}

async function list(): Promise<HTMLElement> {
  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: "Add people",
  });
  await within(dialog).findAllByRole("option");

  return dialog;
}

function pickRow(dialog: HTMLElement, name: string): void {
  fireEvent.click(
    within(dialog).getByRole("option", { name: new RegExp(name) }),
  );
}

function linesOf(band: HTMLElement): Array<string | null> {
  return Array.from(band.querySelectorAll("p")).map((line: Element) => {
    return line.textContent;
  });
}

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    "/dashboard/11111111-1111-4111-8111-111111111111/incidents",
  );

  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType !== TeamMember) {
      return { data: [], count: 0, skip: 0, limit: 0 };
    }

    const members: Array<TeamMember> = [
      makeUser("0000000e-0000-4000-8000-000000000001", "Ada Lovelace"),
      makeUser("0000000e-0000-4000-8000-000000000002", "Bob Stone"),
    ].map((user: User): TeamMember => {
      const member: TeamMember = new TeamMember();
      member.user = user;
      return member;
    });

    return { data: members, count: members.length, skip: 0, limit: 2 };
  });

  // jsdom has no scrollIntoView.
  (
    Element.prototype as unknown as { scrollIntoView: () => void }
  ).scrollIntoView = (): void => {};
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  getListMock.mockReset();
});

describe("what a pick came to, under the people search list", () => {
  test("done in green, left as it was in grey, problems in red - a band each, in that order, a sentence a line", async () => {
    renderList(async (): Promise<Array<PeopleSearchNotice>> => {
      // Handed over in any order: drawn in the bands' own.
      return [
        {
          tone: PeopleSearchNoticeTone.Problem,
          text: "OneUptime can't find Bob Stone in Slack.",
        },
        {
          tone: PeopleSearchNoticeTone.Unchanged,
          text: "Cy is already in this channel.",
        },
        { tone: PeopleSearchNoticeTone.Done, text: "Added Ada Lovelace." },
        {
          tone: PeopleSearchNoticeTone.Problem,
          text: "Slack didn't answer for Dee. Try again in a minute.",
        },
      ];
    });

    const dialog: HTMLElement = await list();

    pickRow(dialog, "Ada Lovelace");

    const notices: HTMLElement = await within(dialog).findByTestId(
      "people-search-notices",
    );

    expect(
      Array.from(notices.children).map((band: Element) => {
        return band.getAttribute("data-testid");
      }),
    ).toEqual([
      "people-search-notice-done",
      "people-search-notice-unchanged",
      "people-search-notice-problem",
    ]);

    const done: HTMLElement = within(notices).getByTestId(
      "people-search-notice-done",
    );
    const unchanged: HTMLElement = within(notices).getByTestId(
      "people-search-notice-unchanged",
    );
    const problem: HTMLElement = within(notices).getByTestId(
      "people-search-notice-problem",
    );

    expect(done).toHaveAttribute("role", "status");
    expect(done).toHaveClass("bg-green-50", "text-green-700");
    expect(linesOf(done)).toEqual(["Added Ada Lovelace."]);

    expect(unchanged).toHaveAttribute("role", "status");
    expect(unchanged).toHaveClass("bg-gray-50", "text-gray-600");
    expect(linesOf(unchanged)).toEqual(["Cy is already in this channel."]);

    expect(problem).toHaveAttribute("role", "alert");
    expect(problem).toHaveClass("bg-red-50", "text-red-600");
    expect(linesOf(problem)).toEqual([
      "OneUptime can't find Bob Stone in Slack.",
      "Slack didn't answer for Dee. Try again in a minute.",
    ]);
  });

  test("past a few lines the notices scroll on their own, so they never squeeze the people out", async () => {
    renderList(async (): Promise<Array<PeopleSearchNotice>> => {
      return [{ tone: PeopleSearchNoticeTone.Done, text: "Added Ada." }];
    });

    const dialog: HTMLElement = await list();

    pickRow(dialog, "Ada Lovelace");

    const notices: HTMLElement = await within(dialog).findByTestId(
      "people-search-notices",
    );

    expect(notices).toHaveClass("max-h-40", "overflow-y-auto", "flex-shrink-0");
  });

  test("a pick answered with nothing says nothing under the list", async () => {
    const onPick: MockFunction = getJestMockFunction();
    onPick.mockImplementation(async (): Promise<void> => {});

    renderList(onPick as unknown as PeopleSearchPopupProps["onPick"]);

    const dialog: HTMLElement = await list();

    pickRow(dialog, "Bob Stone");

    await waitFor(() => {
      expect(onPick).toHaveBeenCalledTimes(1);
    });
    // The row is busy, then done: nothing is said.
    await waitFor(() => {
      expect(
        within(dialog).queryAllByRole("option", { name: /Bob Stone/ })[0],
      ).not.toHaveAttribute("aria-disabled");
    });
    expect(within(dialog).queryByTestId("people-search-notices")).toBeNull();
  });

  test("a pick that fails still says its error in red", async () => {
    renderList(async (): Promise<Array<PeopleSearchNotice>> => {
      throw new Error("Could not add people to the channel.");
    });

    const dialog: HTMLElement = await list();

    pickRow(dialog, "Ada Lovelace");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Could not add people to the channel.",
    );
  });

  test("the next pick says its own, not the last one's", async () => {
    let picks: number = 0;

    renderList(
      async (
        option: PeoplePickerOption,
      ): Promise<Array<PeopleSearchNotice>> => {
        picks++;

        return picks === 1
          ? [
              {
                tone: PeopleSearchNoticeTone.Problem,
                text: `OneUptime can't find ${option.name} in Slack.`,
              },
            ]
          : [
              {
                tone: PeopleSearchNoticeTone.Done,
                text: `Added ${option.name}.`,
              },
            ];
      },
    );

    const dialog: HTMLElement = await list();

    pickRow(dialog, "Bob Stone");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "OneUptime can't find Bob Stone in Slack.",
    );

    pickRow(dialog, "Ada Lovelace");

    expect(
      await within(dialog).findByTestId("people-search-notice-done"),
    ).toHaveTextContent("Added Ada Lovelace.");
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  test("the list opened again starts with nothing said", async () => {
    const setOpen: (isOpen: boolean) => void = renderList(
      async (): Promise<Array<PeopleSearchNotice>> => {
        return [{ tone: PeopleSearchNoticeTone.Done, text: "Added Ada." }];
      },
    );

    const dialog: HTMLElement = await list();

    pickRow(dialog, "Ada Lovelace");
    expect(
      await within(dialog).findByTestId("people-search-notice-done"),
    ).toBeInTheDocument();

    setOpen(false);
    expect(screen.queryByRole("dialog")).toBeNull();

    setOpen(true);

    const reopened: HTMLElement = await list();

    expect(within(reopened).queryByTestId("people-search-notices")).toBeNull();
  });
});
