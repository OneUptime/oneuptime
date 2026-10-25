import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A KIND THE READER MAY NOT PICK, NAMED LOCKED WITH WHY.
 *
 * The Add owners list offers people and teams. A custom role may add people
 * as an incident's owners but not teams: the list then searches people only
 * and, after them, names Teams under its own heading with a lock and the
 * reason - so the reader learns why the teams are not there instead of
 * wondering - and never asks for the teams at all.
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
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import PeopleSearchPopup, {
  ComponentProps as PeopleSearchPopupProps,
} from "../../../../UI/Components/PeoplePicker/PeopleSearchPopup";
import {
  PeoplePickerKind,
  PeopleSearchLockedKind,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import { AnchoredFieldPopup } from "../../../../UI/Types/UseAnchoredFieldPopup";

const TEAMS_REASON: string =
  "You do not have permission to add teams as owners. You need one of these permissions: Project Owner, Create Incident Team Owner.";
const PEOPLE_REASON: string =
  "You do not have permission to add people as owners. You need one of these permissions: Project Owner.";

function makeUser(id: string, name: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(`${name.split(" ")[0]!.toLowerCase()}@example.com`);
  return user;
}

const OPEN_POPUP: AnchoredFieldPopup = {
  isPopupOpen: true,
  popupPosition: {
    top: 120,
    bottom: undefined,
    left: 40,
    maxHeight: 380,
    width: 320,
  },
  popupRef: { current: null },
  popupId: "people-search-locked",
  portalTarget: document.body,
} as unknown as AnchoredFieldPopup;

function renderList(
  props: Partial<Omit<PeopleSearchPopupProps, "popup">>,
): void {
  render(
    <PeopleSearchPopup
      popup={OPEN_POPUP}
      kinds={[PeoplePickerKind.User]}
      selectedKeys={new Set<string>()}
      selectionMode="add"
      onPick={(): void => {}}
      ariaLabel="Add owners"
      {...props}
    />,
  );
}

function readKinds(): Array<unknown> {
  return getListMock.mock.calls.map((call: Array<any>) => {
    return call[0].modelType;
  });
}

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    "/dashboard/11111111-1111-4111-8111-111111111111/incidents",
  );

  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === TeamMember) {
      const members: Array<TeamMember> = [
        makeUser("0000000e-0000-4000-8000-000000000001", "Ada Lovelace"),
      ].map((user: User): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.user = user;
        return member;
      });
      return { data: members, count: members.length, skip: 0, limit: 1 };
    }

    if (request.modelType === Team) {
      const team: Team = new Team();
      team._id = "0000000b-0000-4000-8000-000000000001";
      team.name = "Platform";
      return { data: [team], count: 1, skip: 0, limit: 1 };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  });

  (
    Element.prototype as unknown as { scrollIntoView: () => void }
  ).scrollIntoView = (): void => {};
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  getListMock.mockReset();
});

describe("a kind the reader may not pick", () => {
  test("is named after the kinds they may, under its heading, with a lock and why", async () => {
    renderList({
      lockedKinds: [{ kind: PeoplePickerKind.Team, reason: TEAMS_REASON }],
    });

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owners",
    });
    await within(dialog).findAllByRole("option");

    const locked: HTMLElement = within(dialog).getByTestId(
      "people-search-locked-kind",
    );

    // A group named by its heading, the kind's own title.
    expect(locked).toHaveAttribute("role", "group");
    expect(locked).toHaveAccessibleName("Teams");
    expect(locked).toHaveAttribute("data-kind", PeoplePickerKind.Team);
    // The lock is drawn beside the heading.
    expect(locked.querySelector("svg")).not.toBeNull();
    expect(
      within(locked).getByTestId("people-search-locked-reason"),
    ).toHaveTextContent(TEAMS_REASON);

    // After the people, outside the list of options.
    const listbox: HTMLElement = within(dialog).getByRole("listbox");
    expect(listbox.contains(locked)).toBe(false);
    expect(
      listbox.compareDocumentPosition(locked) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(dialog)
        .getAllByRole("option")
        .map((option: HTMLElement) => {
          return option.getAttribute("data-kind");
        }),
    ).toEqual([PeoplePickerKind.User]);
  });

  test("is never searched", async () => {
    renderList({
      lockedKinds: [{ kind: PeoplePickerKind.Team, reason: TEAMS_REASON }],
    });

    await screen.findAllByRole("option");

    expect(readKinds()).toContain(TeamMember);
    expect(readKinds()).not.toContain(Team);
  });

  test("a kind offered is not locked, whatever the locks say", async () => {
    renderList({
      kinds: [PeoplePickerKind.User, PeoplePickerKind.Team],
      lockedKinds: [{ kind: PeoplePickerKind.Team, reason: TEAMS_REASON }],
    });

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owners",
    });

    await waitFor(() => {
      expect(within(dialog).getAllByRole("option")).toHaveLength(2);
    });
    expect(
      within(dialog).queryByTestId("people-search-locked-kinds"),
    ).toBeNull();
  });

  test("with every kind locked, the list names them and does not say there is nobody", async () => {
    const locks: Array<PeopleSearchLockedKind> = [
      { kind: PeoplePickerKind.User, reason: PEOPLE_REASON },
      { kind: PeoplePickerKind.Team, reason: TEAMS_REASON },
    ];

    renderList({ kinds: [], lockedKinds: locks });

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owners",
    });

    await waitFor(() => {
      expect(
        within(dialog).getAllByTestId("people-search-locked-kind"),
      ).toHaveLength(2);
    });
    expect(
      within(dialog)
        .getAllByTestId("people-search-locked-kind")
        .map((locked: HTMLElement) => {
          return locked.getAttribute("data-kind");
        }),
    ).toEqual([PeoplePickerKind.User, PeoplePickerKind.Team]);
    expect(within(dialog).queryByText("No people or teams available.")).toBeNull();
    expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
    expect(readKinds()).toEqual([]);
  });

  test("a list with no locks draws none", async () => {
    renderList({});

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owners",
    });
    await within(dialog).findAllByRole("option");

    expect(
      within(dialog).queryByTestId("people-search-locked-kinds"),
    ).toBeNull();
  });
});
