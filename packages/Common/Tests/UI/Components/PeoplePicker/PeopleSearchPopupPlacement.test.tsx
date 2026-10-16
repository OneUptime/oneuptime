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
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * THE PEOPLE SEARCH LIST OPENS WHERE ITS BUTTON IS, AND SCROLLS NOTHING.
 *
 * Opened from a button low on a page - Add people on a record's channel card
 * - the list jumped the whole page down and opened off the screen: for its
 * first frame it was left in the page's flow, past the page's end (the
 * Dashboard's Tailwind writes the rule for "fixed" only once it sees the
 * class), and focusing its search box there, or scrolling its first row
 * into view, scrolled the page to it. The list is fixed from its first
 * frame, its search box takes focus without scrolling, and no row is
 * scrolled into view before the list is placed.
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
import PeoplePicker from "../../../../UI/Components/PeoplePicker/PeoplePicker";
import {
  PeoplePickerKind,
  PeoplePickerValue,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

function makeUser(id: string, name: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(`${name.split(" ")[0]!.toLowerCase()}@example.com`);
  return user;
}

function Harness(): ReactElement {
  const [value, setValue] = useState<PeoplePickerValue>({});

  return (
    <PeoplePicker
      kinds={[PeoplePickerKind.User]}
      value={value}
      onChange={setValue}
      addButtonText="Add people"
    />
  );
}

interface FocusCall {
  testId: string | null;
  options: FocusOptions | undefined;
}

interface ScrollCall {
  dialogVisibility: string | null;
}

let focusCalls: Array<FocusCall> = [];
let scrollCalls: Array<ScrollCall> = [];

beforeEach(() => {
  focusCalls = [];
  scrollCalls = [];
  // The people are the project's: the list reads the project off the page.
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

  const originalFocus: (options?: FocusOptions) => void =
    HTMLElement.prototype.focus;

  jest.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ): void {
    focusCalls.push({
      testId: this.getAttribute("data-testid"),
      options: options,
    });
    originalFocus.call(this, options);
  });

  // jsdom has no scrollIntoView: record when the list asks for one.
  (
    Element.prototype as unknown as { scrollIntoView: () => void }
  ).scrollIntoView = function (this: Element): void {
    const dialog: HTMLElement | null = this.closest("[role=dialog]");
    scrollCalls.push({
      dialogVisibility: dialog ? dialog.style.visibility : null,
    });
  };
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  getListMock.mockReset();
});

async function openList(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: /Add people/ }));

  const dialog: HTMLElement = await screen.findByRole("dialog");
  await within(dialog).findAllByRole("option");

  return dialog;
}

describe("the people search list's placement", () => {
  test("is fixed from its first frame, by its own style, not only by a class", async () => {
    render(<Harness />);

    const dialog: HTMLElement = await openList();

    expect(dialog.style.position).toBe("fixed");
    expect(dialog).toHaveClass("fixed");
  });

  test("its search box takes focus without scrolling the page", async () => {
    render(<Harness />);

    await openList();

    const searchFocus: Array<FocusCall> = focusCalls.filter(
      (call: FocusCall) => {
        return call.testId === "people-search-input";
      },
    );

    expect(searchFocus.length).toBeGreaterThan(0);

    for (const call of searchFocus) {
      expect(call.options).toEqual({ preventScroll: true });
    }

    expect(screen.getByTestId("people-search-input")).toHaveFocus();
  });

  test("its first row is kept in view once the list is placed", async () => {
    render(<Harness />);

    await openList();

    expect(scrollCalls.length).toBeGreaterThan(0);

    for (const call of scrollCalls) {
      expect(call.dialogVisibility).toBe("visible");
    }
  });
});
