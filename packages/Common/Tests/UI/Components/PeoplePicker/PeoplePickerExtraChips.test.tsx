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

/*
 * extraChips and trailing: what a caller draws in the picker's own row.
 *
 * A workflow step's "who to page" holds people picked by name and, beside
 * them, values from earlier steps. The picks are the picker's; the values
 * are the step's own chips, and its { } button belongs at the end of the
 * row - so the picker takes both and keeps one row, in one order:
 *
 *   [Add]  pick  pick  extra  extra  [trailing]
 *
 * A field that holds an extra chip is not empty: whatever whenNobodyPicked
 * says of an empty picker is not said beside one. A picker handed neither
 * is the picker it always was.
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
const GRACE: string = "0000000e-0000-4000-8000-000000000002";

const NOBODY: PeoplePickerNobodyPicked = {
  text: "Next person in the rotation",
  icon: IconProp.Refresh,
};

function makeMember(id: string, name: string, email: string): TeamMember {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);

  const member: TeamMember = new TeamMember();
  member.user = user;
  return member;
}

function valueChip(text: string): ReactElement {
  return (
    <span key={text} data-testid="extra-chip">
      {text}
    </span>
  );
}

const TRAILING: ReactElement = (
  <button type="button" data-testid="trailing">
    {"{ }"}
  </button>
);

interface HarnessProps {
  initial?: PeoplePickerValue | undefined;
  extraChips?: Array<ReactElement> | undefined;
  trailing?: ReactElement | undefined;
  whenNobodyPicked?: PeoplePickerNobodyPicked | undefined;
  isSinglePick?: boolean | undefined;
  onChange?: MockFunction | undefined;
}

function Harness(props: HarnessProps): ReactElement {
  const [value, setValue] = useState<PeoplePickerValue>(props.initial || {});

  return (
    <div>
      <label id="who-label">Who to page</label>
      <PeoplePicker
        kinds={[PeoplePickerKind.User]}
        value={value}
        onChange={(next: PeoplePickerValue) => {
          props.onChange?.(next);
          setValue(next);
        }}
        addButtonText="Add user"
        ariaLabelledby="who-label"
        whenNobodyPicked={props.whenNobodyPicked}
        isSinglePick={props.isSinglePick}
        extraChips={props.extraChips}
        trailing={props.trailing}
      />
    </div>
  );
}

function group(): HTMLElement {
  return screen.getByRole("group", { name: "Who to page" });
}

// What the row holds, left to right, each child by what it is.
function row(): Array<string> {
  return Array.from(group().children).map((child: Element): string => {
    const testId: string | null = child.getAttribute("data-testid");

    if (testId === "people-chip") {
      return `pick:${child.getAttribute("data-id")}`;
    }

    if (testId === "extra-chip") {
      return `extra:${child.textContent}`;
    }

    if (testId === "trailing") {
      return "trailing";
    }

    if (testId === "people-picker-nobody-picked") {
      return "nobody";
    }

    return child.querySelector("[data-testid='people-picker-add-button']")
      ? "add"
      : `other:${testId}`;
  });
}

describe("PeoplePicker extraChips and trailing", () => {
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

  test("the row is the button, the picks, the extra chips, then the trailing control", async () => {
    render(
      <Harness
        initial={{ [PeoplePickerKind.User]: [ADA, GRACE] }}
        extraChips={[valueChip("Owners"), valueChip("On duty")]}
        trailing={TRAILING}
      />,
    );

    await waitFor(() => {
      expect(
        within(group()).getByRole("button", { name: "Remove Ada Lovelace" }),
      ).toBeInTheDocument();
    });

    expect(row()).toEqual([
      "add",
      `pick:${ADA}`,
      `pick:${GRACE}`,
      "extra:Owners",
      "extra:On duty",
      "trailing",
    ]);
  });

  test("with nothing picked, the extra chips follow the button and the trailing control is still last", () => {
    render(<Harness extraChips={[valueChip("Owners")]} trailing={TRAILING} />);

    expect(row()).toEqual(["add", "extra:Owners", "trailing"]);
  });

  test("a new pick lands before the extra chips, not after them", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Harness
        extraChips={[valueChip("Owners")]}
        trailing={TRAILING}
        onChange={onChange}
      />,
    );

    fireEvent.click(within(group()).getByRole("button", { name: "Add user" }));
    fireEvent.click(await screen.findByText("Ada Lovelace"));

    expect(onChange).toHaveBeenCalledWith({ [PeoplePickerKind.User]: [ADA] });
    await waitFor(() => {
      expect(row()).toEqual(["add", `pick:${ADA}`, "extra:Owners", "trailing"]);
    });
  });

  test("the extra chips are the caller's: the picker's value never holds them", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Harness
        initial={{ [PeoplePickerKind.User]: [ADA] }}
        extraChips={[valueChip("Owners")]}
        onChange={onChange}
      />,
    );

    fireEvent.click(
      await within(group()).findByRole("button", {
        name: "Remove Ada Lovelace",
      }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ [PeoplePickerKind.User]: [] });
    // The pick is gone; the caller's chip is where it was.
    expect(row()).toEqual(["add", "extra:Owners"]);
  });

  test("an extra chip is something in the field: what an empty picker says is not said beside it", () => {
    render(
      <Harness whenNobodyPicked={NOBODY} extraChips={[valueChip("Owners")]} />,
    );

    expect(
      within(group()).queryByTestId("people-picker-nobody-picked"),
    ).toBeNull();
    expect(row()).toEqual(["add", "extra:Owners"]);
  });

  test("with no extra chips, an empty picker still says what empty means", () => {
    render(
      <Harness whenNobodyPicked={NOBODY} extraChips={[]} trailing={TRAILING} />,
    );

    expect(
      within(group()).getByTestId("people-picker-nobody-picked"),
    ).toHaveTextContent("Next person in the rotation");
    // And the trailing control is after it.
    expect(row()).toEqual(["add", "nobody", "trailing"]);
  });

  test("a trailing control alone does not count as something picked", () => {
    render(<Harness whenNobodyPicked={NOBODY} trailing={TRAILING} />);

    expect(row()).toEqual(["add", "nobody", "trailing"]);
  });

  test("a picker that picks one keeps its order - the pick, then the button - with the extras between", async () => {
    render(
      <Harness
        isSinglePick={true}
        initial={{ [PeoplePickerKind.User]: [ADA] }}
        extraChips={[valueChip("Owners")]}
        trailing={TRAILING}
      />,
    );

    await waitFor(() => {
      expect(within(group()).getByText("Ada Lovelace")).toBeInTheDocument();
    });

    const order: Array<string> = row();

    expect(order[0]).toBe(`pick:${ADA}`);
    expect(order[1]).toBe("extra:Owners");
    expect(order[order.length - 1]).toBe("trailing");
    expect(order).toContain("add");
  });

  test("handed neither, the row is the button and the picks, as it always was", async () => {
    render(<Harness initial={{ [PeoplePickerKind.User]: [ADA] }} />);

    await waitFor(() => {
      expect(within(group()).getByText("Ada Lovelace")).toBeInTheDocument();
    });

    expect(row()).toEqual(["add", `pick:${ADA}`]);
  });

  test("the trailing control is the caller's own button: pressing it opens no search list", () => {
    render(<Harness trailing={TRAILING} />);

    fireEvent.click(screen.getByTestId("trailing"));

    expect(
      within(group()).getByRole("button", { name: "Add user" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(getListMock).not.toHaveBeenCalled();
  });
});
