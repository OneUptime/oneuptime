import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Picks shown read-only - a rule's view page, a form's summary step, a
 * monitor's criteria - and the avatar every owners surface draws. A person
 * and a team must never look alike, and the same name must always get the
 * same colour, so a face can be found again at a glance.
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
import IconProp from "../../../../Types/Icon/IconProp";
import Name from "../../../../Types/Name";
import PeopleAvatar, {
  getPeopleAvatarPalette,
  getPeopleInitials,
} from "../../../../UI/Components/PeoplePicker/PeopleAvatar";
import {
  PeopleList,
  PeopleListFromIds,
} from "../../../../UI/Components/PeoplePicker/PeopleList";
import {
  PEOPLE_PICKER_KIND_DEFINITIONS,
  PeoplePickerAvatarStyle,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerKinds";
import { PeoplePickerKind } from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";

describe("getPeopleInitials", () => {
  test("takes the first and last name's first letters", () => {
    expect(getPeopleInitials("Ada Byron Lovelace")).toBe("AL");
    expect(getPeopleInitials("  platform  ")).toBe("P");
    expect(getPeopleInitials("")).toBe("?");
  });
});

describe("getPeopleAvatarPalette", () => {
  test("gives a name the same colour every time", () => {
    expect(getPeopleAvatarPalette(PeoplePickerKind.User, "Ada")).toEqual(
      getPeopleAvatarPalette(PeoplePickerKind.User, "Ada"),
    );
  });

  test("draws people in colour and teams in slate, so they never look alike", () => {
    for (const name of ["Ada", "Bob", "Platform", "Database", "SRE", "x"]) {
      expect(
        getPeopleAvatarPalette(PeoplePickerKind.User, name).bg,
      ).not.toMatch(/slate|gray|stone|zinc|neutral/);
      expect(
        getPeopleAvatarPalette(PeoplePickerKind.Team, name).bg,
      ).toMatch(/from-(slate|gray|stone|zinc|neutral)-700/);
    }
  });
});

describe("PeopleAvatar", () => {
  afterEach(() => {
    cleanup();
  });

  test("draws a person without a picture as their initials", () => {
    const { container } = render(
      <PeopleAvatar item={{ kind: PeoplePickerKind.User, name: "Ada Lovelace" }} />,
    );

    expect(container).toHaveTextContent("AL");
    expect(container.querySelector("img")).toBeNull();
  });

  test("draws a person's profile picture when they have one", () => {
    render(
      <PeopleAvatar
        item={{
          kind: PeoplePickerKind.User,
          name: "Ada Lovelace",
          userId: ADA,
          hasProfilePicture: true,
        }}
      />,
    );

    const image: HTMLElement = screen.getByAltText("Ada Lovelace");

    expect(image.getAttribute("src")).toContain(ADA);
  });

  test("draws a team with a people badge, which a screen reader skips", () => {
    const { container } = render(
      <PeopleAvatar item={{ kind: PeoplePickerKind.Team, name: "Platform" }} />,
    );

    expect(container).toHaveTextContent("P");
    expect(
      container.querySelectorAll('[aria-hidden="true"]').length,
    ).toBeGreaterThanOrEqual(2);
  });

  test("can leave a team's badge out", () => {
    const { container } = render(
      <PeopleAvatar
        item={{ kind: PeoplePickerKind.Team, name: "Platform" }}
        showGroupBadge={false}
      />,
    );

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });

  test("draws a kind that is not a person or a group as its icon", () => {
    const original: PeoplePickerAvatarStyle =
      PEOPLE_PICKER_KIND_DEFINITIONS[PeoplePickerKind.Team].avatar;

    // A kind like an on-call schedule would be defined this way.
    PEOPLE_PICKER_KIND_DEFINITIONS[PeoplePickerKind.Team].avatar = {
      type: "icon",
      icon: IconProp.Calendar,
    };

    try {
      const { container } = render(
        <PeopleAvatar item={{ kind: PeoplePickerKind.Team, name: "Primary" }} />,
      );

      expect(container).not.toHaveTextContent("P");
      expect(container.querySelector("svg")).not.toBeNull();
    } finally {
      PEOPLE_PICKER_KIND_DEFINITIONS[PeoplePickerKind.Team].avatar = original;
    }
  });
});

describe("PeopleList", () => {
  afterEach(() => {
    cleanup();
  });

  test("shows each pick as a chip with its name, a team tagged as one, and nothing to remove", () => {
    render(
      <PeopleList
        options={[
          { kind: PeoplePickerKind.User, id: ADA, name: "Ada Lovelace" },
          { kind: PeoplePickerKind.Team, id: PLATFORM, name: "Platform" },
        ]}
      />,
    );

    const chips: Array<HTMLElement> = screen.getAllByTestId("people-chip");

    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("Ada Lovelace");
    expect(chips[0]).toHaveAttribute("data-kind", PeoplePickerKind.User);
    expect(chips[1]).toHaveTextContent("Platform");
    expect(chips[1]).toHaveTextContent("Team");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("says None when there are none, or what it is told to say", () => {
    const { rerender } = render(<PeopleList options={[]} />);

    expect(screen.getByTestId("people-list")).toHaveTextContent("None");

    rerender(<PeopleList options={[]} noneText="No owners assigned" />);

    expect(screen.getByTestId("people-list")).toHaveTextContent(
      "No owners assigned",
    );
  });

  test("names a pick that is gone for what it was", () => {
    render(
      <PeopleList
        options={[
          {
            kind: PeoplePickerKind.Team,
            id: PLATFORM,
            name: "Deleted team",
            isUnknown: true,
          },
        ]}
      />,
    );

    expect(screen.getByTestId("people-chip")).toHaveTextContent(
      "Deleted team",
    );
  });
});

describe("PeopleListFromIds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);

    getListMock.mockImplementation(async (request: any): Promise<any> => {
      if (request.modelType === TeamMember) {
        const user: User = new User();
        user._id = ADA;
        user.name = new Name("Ada Lovelace");
        user.email = new Email("ada@example.com");

        const member: TeamMember = new TeamMember();
        member.user = user;

        return { data: [member], count: 1, skip: 0, limit: 1 };
      }

      const team: Team = new Team();
      team._id = PLATFORM;
      team.name = "Platform";

      return { data: [team], count: 1, skip: 0, limit: 1 };
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("looks picks known only by id up, and lists them in the kinds' order", async () => {
    render(
      <PeopleListFromIds
        kinds={[PeoplePickerKind.User, PeoplePickerKind.Team]}
        value={{
          [PeoplePickerKind.Team]: [PLATFORM],
          [PeoplePickerKind.User]: [ADA],
        }}
      />,
    );

    // Each pick has its place at once, and its name once it is looked up.
    expect(
      screen.getAllByTestId("people-chip").map((chip: HTMLElement) => {
        return chip.getAttribute("data-id");
      }),
    ).toEqual([ADA, PLATFORM]);
    expect(screen.getAllByTestId("people-chip")[0]).toHaveTextContent(
      "Loading...",
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("people-chip")[0]).toHaveTextContent(
        "Ada Lovelace",
      );
    });

    expect(screen.getAllByTestId("people-chip")[1]).toHaveTextContent(
      "Platform",
    );
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("asks nothing and says None for no picks", () => {
    render(
      <PeopleListFromIds
        kinds={[PeoplePickerKind.User, PeoplePickerKind.Team]}
        value={{}}
      />,
    );

    expect(screen.getByTestId("people-list")).toHaveTextContent("None");
    expect(getListMock).not.toHaveBeenCalled();
  });
});
