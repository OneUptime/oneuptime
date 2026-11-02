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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * readOnly: the picks shown to be read, not changed - a workflow step opened
 * by someone who may not change the workflow (Workflow/RecordList).
 *
 * The chips alone, as a read-only list of people is drawn (PeopleList): no
 * Add button and no remove on a chip, so nothing in the row offers to
 * change it. With nothing picked, "None" stands where the chips would be,
 * as PeopleList says it. Disabled is another thing: it keeps the Add
 * button, locked, for a form that is only waiting.
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
import IconProp from "../../../../Types/Icon/IconProp";
import Name from "../../../../Types/Name";
import PeoplePicker, {
  PEOPLE_PICKER_NONE_TEXT,
} from "../../../../UI/Components/PeoplePicker/PeoplePicker";
import {
  PeoplePickerKind,
  PeoplePickerNobodyPicked,
  PeoplePickerValue,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const GRACE: string = "0000000e-0000-4000-8000-000000000002";

function makeMember(id: string, name: string, email: string): TeamMember {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);

  const member: TeamMember = new TeamMember();
  member.user = user;
  return member;
}

interface PickerOptions {
  value?: PeoplePickerValue | undefined;
  readOnly?: boolean | undefined;
  disabled?: boolean | undefined;
  extraChips?: Array<ReactElement> | undefined;
  whenNobodyPicked?: PeoplePickerNobodyPicked | undefined;
  isSinglePick?: boolean | undefined;
}

function renderPicker(options: PickerOptions): MockFunction {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <div>
      <label id="who-label">Who to page</label>
      <PeoplePicker
        kinds={[PeoplePickerKind.User]}
        value={options.value || {}}
        onChange={onChange as (value: PeoplePickerValue) => void}
        addButtonText="Add user"
        ariaLabelledby="who-label"
        readOnly={options.readOnly}
        disabled={options.disabled}
        extraChips={options.extraChips}
        whenNobodyPicked={options.whenNobodyPicked}
        isSinglePick={options.isSinglePick}
      />
    </div>,
  );

  return onChange;
}

function group(): HTMLElement {
  return screen.getByRole("group", { name: "Who to page" });
}

describe("PeoplePicker readOnly", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/workflows`);
    getListMock.mockImplementation(async (request: any): Promise<any> => {
      const rows: Array<unknown> =
        request.modelType === TeamMember
          ? [
              makeMember(ADA, "Ada Lovelace", "ada@example.com"),
              makeMember(GRACE, "Grace Hopper", "grace@example.com"),
            ]
          : [];

      return { data: rows, count: rows.length, skip: 0, limit: rows.length };
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("the picks are chips to read, by name: no Add button and no remove on a chip", async () => {
    renderPicker({
      value: { [PeoplePickerKind.User]: [ADA, GRACE] },
      readOnly: true,
    });

    await waitFor(() => {
      expect(
        within(group())
          .getAllByTestId("people-chip")
          .map((chip: HTMLElement): string | null => {
            return chip.textContent;
          }),
      ).toEqual([
        expect.stringContaining("Ada Lovelace"),
        expect.stringContaining("Grace Hopper"),
      ]);
    });

    expect(within(group()).queryAllByRole("button")).toEqual([]);
    expect(screen.queryByTestId("people-picker-add-button")).toBeNull();

    // A chip with no remove button keeps its end padding even.
    for (const chip of within(group()).getAllByTestId("people-chip")) {
      expect(chip.className).toContain("pr-2.5");
    }
  });

  test("a single pick is read the same way: no Change", async () => {
    renderPicker({
      value: { [PeoplePickerKind.User]: [ADA] },
      readOnly: true,
      isSinglePick: true,
    });

    await waitFor(() => {
      expect(within(group()).getByTestId("people-chip")).toHaveTextContent(
        "Ada Lovelace",
      );
    });

    expect(within(group()).queryAllByRole("button")).toEqual([]);
  });

  test("nothing picked: None, as a read-only list of people says it", () => {
    renderPicker({ readOnly: true });

    expect(PEOPLE_PICKER_NONE_TEXT).toBe("None");
    expect(within(group()).getByTestId("people-picker-none")).toHaveTextContent(
      "None",
    );
    expect(within(group()).queryAllByRole("button")).toEqual([]);
  });

  test("what nothing picked means is said instead of None, where a picker says it", () => {
    renderPicker({
      readOnly: true,
      whenNobodyPicked: {
        text: "Next person in the rotation",
        icon: IconProp.Refresh,
      },
    });

    expect(
      within(group()).getByTestId("people-picker-nobody-picked"),
    ).toHaveTextContent("Next person in the rotation");
    expect(within(group()).queryByTestId("people-picker-none")).toBeNull();
  });

  test("a caller's own chips count as something there: no None beside them", () => {
    renderPicker({
      readOnly: true,
      extraChips: [
        <span key="owners" data-testid="extra-chip">
          Owners
        </span>,
      ],
    });

    expect(within(group()).getByTestId("extra-chip")).toBeInTheDocument();
    expect(within(group()).queryByTestId("people-picker-none")).toBeNull();
  });

  test("disabled is not read only: the Add button stays, locked", () => {
    renderPicker({ disabled: true });

    expect(screen.getByTestId("people-picker-add-button")).toBeDisabled();
    expect(within(group()).queryByTestId("people-picker-none")).toBeNull();
  });

  test("neither: the picker it always was, Add and remove buttons and all", async () => {
    renderPicker({ value: { [PeoplePickerKind.User]: [ADA] } });

    expect(screen.getByTestId("people-picker-add-button")).toBeEnabled();

    await waitFor(() => {
      expect(
        within(group()).getByRole("button", { name: "Remove Ada Lovelace" }),
      ).toBeEnabled();
    });
  });
});
