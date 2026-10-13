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
 * whenNobodyPicked: an empty picker that MEANS something says what.
 *
 * A user override's "Who covers?" left empty skips the person away - each of
 * their turns goes to the next person in the rotation (task
 * oncall-skip-user-until). An empty picker reads as something left to fill
 * in, so the picker says "Next person in the rotation" where the pick would
 * be until somebody is picked, and again once the pick is taken away.
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
import PeoplePicker from "../../../../UI/Components/PeoplePicker/PeoplePicker";
import {
  PeoplePickerKind,
  PeoplePickerNobodyPicked,
  PeoplePickerValue,
} from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ADA: string = "0000000e-0000-4000-8000-000000000001";

const ROTATION: PeoplePickerNobodyPicked = {
  text: "Next person in the rotation",
  icon: IconProp.Refresh,
};

function makeUser(id: string, name: string, email: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

function Harness(props: {
  initial?: PeoplePickerValue;
  whenNobodyPicked?: PeoplePickerNobodyPicked | undefined;
}): ReactElement {
  const [value, setValue] = useState<PeoplePickerValue>(props.initial || {});

  return (
    <div>
      <label id="covers-label">Who covers?</label>
      <PeoplePicker
        kinds={[PeoplePickerKind.User]}
        value={value}
        onChange={(next: PeoplePickerValue) => {
          setValue(next);
        }}
        addButtonText="Choose someone"
        ariaLabelledby="covers-label"
        whenNobodyPicked={props.whenNobodyPicked}
      />
    </div>
  );
}

function group(): HTMLElement {
  return screen.getByRole("group", { name: "Who covers?" });
}

describe("PeoplePicker whenNobodyPicked", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call`);
    getListMock.mockImplementation(async (request: any): Promise<any> => {
      const rows: Array<unknown> =
        request.modelType === TeamMember
          ? [
              (() => {
                const member: TeamMember = new TeamMember();
                member.user = makeUser(ADA, "Ada Lovelace", "ada@example.com");
                return member;
              })(),
            ]
          : [];

      return { data: rows, count: rows.length, skip: 0, limit: rows.length };
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("with nothing picked, says what that means, beside the button to pick", () => {
    render(<Harness whenNobodyPicked={ROTATION} />);

    const pill: HTMLElement = within(group()).getByTestId(
      "people-picker-nobody-picked",
    );

    expect(pill).toHaveTextContent("Next person in the rotation");
    // Words, not a control: nothing to click or remove.
    expect(pill.tagName).toBe("SPAN");
    expect(within(pill).queryByRole("button")).toBeNull();
    // Its icon is drawn before the words.
    expect(pill.querySelector("svg")).not.toBeNull();
    // And the button still says what it does.
    expect(
      within(group()).getByRole("button", { name: "Choose someone" }),
    ).toBeInTheDocument();
  });

  test("gone once somebody is picked, and back once the pick is taken away", async () => {
    render(
      <Harness
        whenNobodyPicked={ROTATION}
        initial={{ [PeoplePickerKind.User]: [ADA] }}
      />,
    );

    await within(group()).findByText("Ada Lovelace");
    expect(
      within(group()).queryByTestId("people-picker-nobody-picked"),
    ).toBeNull();

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Ada Lovelace" }),
    );

    expect(
      within(group()).getByTestId("people-picker-nobody-picked"),
    ).toHaveTextContent("Next person in the rotation");
  });

  test("without an icon, just the words", () => {
    render(
      <Harness whenNobodyPicked={{ text: "Next person in the rotation" }} />,
    );

    const pill: HTMLElement = within(group()).getByTestId(
      "people-picker-nobody-picked",
    );

    expect(pill).toHaveTextContent("Next person in the rotation");
    expect(pill.querySelector("svg")).toBeNull();
  });

  test("left out, an empty picker shows only its button, as before", () => {
    render(<Harness />);

    expect(
      within(group()).queryByTestId("people-picker-nobody-picked"),
    ).toBeNull();
    expect(
      within(group()).getByRole("button", { name: "Choose someone" }),
    ).toBeInTheDocument();
  });
});
