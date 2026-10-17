import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement, useState } from "react";

/*
 * "All incidents" / "Only incidents that match conditions": the choice every
 * rule's conditions open with (RuleAppliesToChoice), shared by the rule
 * builder, the workspace rules' conditions and metric pipeline filters.
 * The translation hook wraps what it is handed in «», so a string that
 * skipped it shows up bare.
 */

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      const wrap: (value: string | undefined) => string | undefined = (
        value: string | undefined,
      ): string | undefined => {
        return value ? `«${value}»` : value;
      };

      return {
        translateString: wrap,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? wrap(value) : value;
        },
      };
    },
  };
});

import RuleAppliesToChoice from "../../../../UI/Components/RuleCriteria/RuleAppliesToChoice";

interface HarnessProps {
  initiallyMatching?: boolean | undefined;
  disabled?: boolean | undefined;
  isMatchingUnavailable?: boolean | undefined;
  label?: string | undefined;
  ariaLabel?: string | undefined;
  dataTestId?: string | undefined;
  onChooseAll?: (() => void) | undefined;
  onChooseMatching?: (() => void) | undefined;
}

// Keeps what is picked the way a rule keeps its conditions: in the caller.
const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const [isMatching, setIsMatching] = useState<boolean>(
    Boolean(props.initiallyMatching),
  );

  return (
    <RuleAppliesToChoice
      allLabel="All incidents"
      matchingLabel="Only incidents that match conditions"
      isMatching={isMatching}
      onChooseAll={(): void => {
        props.onChooseAll?.();
        setIsMatching(false);
      }}
      onChooseMatching={(): void => {
        props.onChooseMatching?.();
        setIsMatching(true);
      }}
      disabled={props.disabled}
      isMatchingUnavailable={props.isMatchingUnavailable}
      label={props.label}
      ariaLabel={props.ariaLabel}
      dataTestId={props.dataTestId}
    >
      <p data-testid="the-conditions">If Incident Title contains database</p>
    </RuleAppliesToChoice>
  );
};

function allAnswer(): HTMLElement {
  return screen.getByTestId("rule-applies-to-all");
}

function matchingAnswer(): HTMLElement {
  return screen.getByTestId("rule-applies-to-matching");
}

let onChooseAll: ReturnType<typeof jest.fn>;
let onChooseMatching: ReturnType<typeof jest.fn>;

beforeEach(() => {
  onChooseAll = jest.fn();
  onChooseMatching = jest.fn();
});

afterEach(() => {
  cleanup();
});

describe("RuleAppliesToChoice", () => {
  test("two radios, in the reader's language, the first picked for a new rule", () => {
    render(<Harness label="Applies to" />);

    expect(allAnswer()).toBeChecked();
    expect(matchingAnswer()).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "«All incidents»" })).toBe(
      allAnswer(),
    );
    expect(
      screen.getByRole("radio", {
        name: "«Only incidents that match conditions»",
      }),
    ).toBe(matchingAnswer());
    // The conditions wait for the second answer.
    expect(screen.queryByTestId("the-conditions")).toBeNull();
    expect(screen.queryByTestId("rule-applies-to-conditions")).toBeNull();
  });

  test("its label names the group, and never says '(Optional)': the choice is always answered", () => {
    render(<Harness label="Applies to" />);

    const group: HTMLElement = screen.getByRole("radiogroup", {
      name: /«Applies to»/,
    });
    expect(within(group).getAllByRole("radio")).toEqual([
      allAnswer(),
      matchingAnswer(),
    ]);
    expect(screen.getByTestId("rule-applies-to")).not.toHaveTextContent(
      "Optional",
    );
  });

  test("without a label, a heading above names it for a screen reader", () => {
    render(<Harness ariaLabel="Which incidents" />);

    expect(
      screen.getByRole("radiogroup", { name: "«Which incidents»" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("«Applies to»")).toBeNull();
  });

  test("picking the second answer tells the caller, and the conditions appear under it", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    render(
      <Harness onChooseAll={onChooseAll} onChooseMatching={onChooseMatching} />,
    );

    await user.click(matchingAnswer());

    expect(onChooseMatching).toHaveBeenCalledTimes(1);
    expect(onChooseAll).not.toHaveBeenCalled();
    expect(matchingAnswer()).toBeChecked();
    const conditions: HTMLElement = screen.getByTestId(
      "rule-applies-to-conditions",
    );
    expect(within(conditions).getByTestId("the-conditions")).toBeVisible();
    // After the radios, never inside the group: only the answers are radios.
    expect(
      within(screen.getByRole("radiogroup")).queryByTestId("the-conditions"),
    ).toBeNull();
  });

  test("clicking the words picks the answer too", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    render(<Harness onChooseMatching={onChooseMatching} />);

    await user.click(
      screen.getByText("«Only incidents that match conditions»"),
    );

    expect(onChooseMatching).toHaveBeenCalledTimes(1);
    expect(matchingAnswer()).toBeChecked();
  });

  test("picking the first answer back tells the caller, and the conditions go", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    render(
      <Harness
        initiallyMatching={true}
        onChooseAll={onChooseAll}
        onChooseMatching={onChooseMatching}
      />,
    );

    expect(screen.getByTestId("the-conditions")).toBeVisible();

    await user.click(allAnswer());

    expect(onChooseAll).toHaveBeenCalledTimes(1);
    expect(onChooseMatching).not.toHaveBeenCalled();
    expect(allAnswer()).toBeChecked();
    expect(screen.queryByTestId("the-conditions")).toBeNull();
  });

  test("picking the answer already picked tells nobody", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    render(
      <Harness onChooseAll={onChooseAll} onChooseMatching={onChooseMatching} />,
    );

    await user.click(allAnswer());
    await user.click(screen.getByText("«All incidents»"));

    expect(onChooseAll).not.toHaveBeenCalled();
    expect(onChooseMatching).not.toHaveBeenCalled();
  });

  test("a disabled choice can be read but not changed", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    render(
      <Harness
        disabled={true}
        onChooseAll={onChooseAll}
        onChooseMatching={onChooseMatching}
      />,
    );

    expect(allAnswer()).toBeDisabled();
    expect(matchingAnswer()).toBeDisabled();

    await user.click(matchingAnswer());
    expect(onChooseMatching).not.toHaveBeenCalled();
    expect(allAnswer()).toBeChecked();
  });

  test("with nothing to match on, only the second answer is off", () => {
    render(<Harness isMatchingUnavailable={true} />);

    expect(allAnswer()).toBeEnabled();
    expect(matchingAnswer()).toBeDisabled();
  });

  test("its test ids follow the prefix it is given", () => {
    render(<Harness dataTestId="notification-rule-applies-to" />);

    expect(
      screen.getByTestId("notification-rule-applies-to-all"),
    ).toBeChecked();
    expect(
      screen.getByTestId("notification-rule-applies-to-matching"),
    ).not.toBeChecked();
  });

  test("each choice on a page is a radio group of its own", () => {
    render(
      <div>
        <Harness dataTestId="first" />
        <Harness dataTestId="second" />
      </div>,
    );

    const first: string | null = screen
      .getByTestId("first-all")
      .getAttribute("name");
    const second: string | null = screen
      .getByTestId("second-all")
      .getAttribute("name");

    expect(first).toBeTruthy();
    expect(first).toBe(
      screen.getByTestId("first-matching").getAttribute("name"),
    );
    expect(first).not.toBe(second);
  });
});
