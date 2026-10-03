import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import ChoiceRows, {
  ChoiceRowOption,
  ComponentProps,
} from "../../../UI/Components/ChoiceRows/ChoiceRows";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * One setting that is a choice of a few (UI/Components/ChoiceRows): a radio
 * button per choice, in ruled rows. The checked one is the choice in force;
 * picking another tells the page, which asks and saves and hands the new
 * choice back. A choice the plan does not include shows the plan and cannot
 * be picked; someone who may not change the setting sees every choice
 * locked, with why. Lines under a choice sit outside its label, and "Saved"
 * lands in a live region that is always on the page.
 */

type Who = "anyone" | "sign-in" | "password";

const OPTIONS: Array<ChoiceRowOption<Who>> = [
  {
    value: "anyone",
    title: "Anyone with the link",
    description: "The page is public.",
    dataTestId: "choice-anyone",
  },
  {
    value: "sign-in",
    title: "Only people who sign in",
    description: "Visitors sign in first.",
    dataTestId: "choice-sign-in",
  },
  {
    value: "password",
    title: "Anyone with the password",
    dataTestId: "choice-password",
  },
];

afterEach(() => {
  cleanup();
});

function renderRows(props: Partial<ComponentProps<Who>> = {}): {
  onPick: MockFunction;
  rerender: (element: ReactElement) => void;
} {
  const onPick: MockFunction = getJestMockFunction();

  const element: ReactElement = (
    <ChoiceRows<Who>
      value="anyone"
      options={OPTIONS}
      onPick={onPick}
      ariaLabel="Who can see this status page"
      dataTestId="choices"
      {...props}
    />
  );

  const view: ReturnType<typeof render> = render(element);

  return {
    onPick,
    rerender: (next: ReactElement): void => {
      view.rerender(next);
    },
  };
}

function radio(name: string): HTMLInputElement {
  return screen.getByRole("radio", { name }) as HTMLInputElement;
}

describe("ChoiceRows", () => {
  test("is one radio group, named by the question", () => {
    renderRows();

    const group: HTMLElement = screen.getByRole("radiogroup", {
      name: "Who can see this status page",
    });

    expect(within(group).getAllByRole("radio")).toHaveLength(3);
  });

  test("each radio is named by its title and described by its sentence", () => {
    renderRows();

    expect(radio("Anyone with the link")).toHaveAccessibleDescription(
      "The page is public.",
    );
    expect(radio("Only people who sign in")).toHaveAccessibleDescription(
      "Visitors sign in first.",
    );
    // A choice without a sentence has no description.
    expect(radio("Anyone with the password")).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  test("the choice in force is checked, and only it", () => {
    renderRows({ value: "sign-in" });

    expect(radio("Anyone with the link")).not.toBeChecked();
    expect(radio("Only people who sign in")).toBeChecked();
    expect(radio("Anyone with the password")).not.toBeChecked();
    expect(screen.getByTestId("choice-sign-in-row")).toHaveAttribute(
      "data-checked",
      "true",
    );
    expect(screen.getByTestId("choice-anyone-row")).toHaveAttribute(
      "data-checked",
      "false",
    );
  });

  test("with nothing in force, nothing is checked", () => {
    renderRows({ value: null });

    for (const option of OPTIONS) {
      expect(radio(option.title)).not.toBeChecked();
    }
  });

  test("picking another choice tells the page, and does not check it by itself", () => {
    const { onPick } = renderRows({ value: "anyone" });

    fireEvent.click(radio("Anyone with the password"));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("password");

    // Still the choice in force until the page hands back a new one.
    expect(radio("Anyone with the link")).toBeChecked();
    expect(radio("Anyone with the password")).not.toBeChecked();
  });

  test("pressing a choice's title picks it too", () => {
    const { onPick } = renderRows({ value: "anyone" });

    fireEvent.click(screen.getByText("Only people who sign in"));

    expect(onPick).toHaveBeenCalledWith("sign-in");
  });

  test("pressing the choice already in force picks nothing", () => {
    const { onPick } = renderRows({ value: "anyone" });

    fireEvent.click(radio("Anyone with the link"));
    fireEvent.click(screen.getByText("Anyone with the link"));

    expect(onPick).not.toHaveBeenCalled();
  });

  test("a new choice handed back is checked", () => {
    const onPick: MockFunction = getJestMockFunction();
    const { rerender } = renderRows({ value: "anyone", onPick });

    rerender(
      <ChoiceRows<Who>
        value="password"
        options={OPTIONS}
        onPick={onPick}
        ariaLabel="Who can see this status page"
      />,
    );

    expect(radio("Anyone with the password")).toBeChecked();
    expect(radio("Anyone with the link")).not.toBeChecked();
  });

  describe("a choice the plan does not include", () => {
    const withPlan: Array<ChoiceRowOption<Who>> = OPTIONS.map(
      (option: ChoiceRowOption<Who>): ChoiceRowOption<Who> => {
        return option.value === "anyone"
          ? option
          : { ...option, planNeeded: PlanType.Growth };
      },
    );

    test("names the plan beside it, and cannot be picked", () => {
      const { onPick } = renderRows({ value: "anyone", options: withPlan });

      expect(
        within(screen.getByTestId("choice-sign-in-row")).getByText(
          "Growth Plan",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("choice-password-row")).getByText(
          "Growth Plan",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("choice-anyone-row")).queryByText(
          "Growth Plan",
        ),
      ).not.toBeInTheDocument();

      expect(radio("Only people who sign in")).toBeDisabled();
      expect(radio("Anyone with the password")).toBeDisabled();
      expect(radio("Anyone with the link")).toBeEnabled();

      fireEvent.click(radio("Only people who sign in"));
      fireEvent.click(screen.getByText("Anyone with the password"));

      expect(onPick).not.toHaveBeenCalled();
    });

    test("a screen reader hears the plan with the locked choice", () => {
      renderRows({ value: "anyone", options: withPlan });

      expect(radio("Only people who sign in")).toHaveAccessibleDescription(
        "Visitors sign in first. Growth Plan",
      );
      // A choice without a sentence is described by its plan alone.
      expect(radio("Anyone with the password")).toHaveAccessibleDescription(
        "Growth Plan",
      );
      // A choice that can be picked has no plan to hear.
      expect(radio("Anyone with the link")).toHaveAccessibleDescription(
        "The page is public.",
      );
    });
  });

  test("while locked (a choice is being asked about or saved), nothing can be picked", () => {
    const { onPick } = renderRows({ value: "anyone", isLocked: true });

    for (const option of OPTIONS) {
      expect(radio(option.title)).toBeDisabled();
    }

    fireEvent.click(radio("Anyone with the password"));

    expect(onPick).not.toHaveBeenCalled();
    // Locked for a moment, not for a reason worth a sentence.
    expect(
      screen.queryByTestId("choices-locked-reason"),
    ).not.toBeInTheDocument();
  });

  test("someone who may not change it sees every choice locked, with why", () => {
    const { onPick } = renderRows({
      value: "sign-in",
      lockedReason: "You need the Edit Status Page permission.",
    });

    for (const option of OPTIONS) {
      expect(radio(option.title)).toBeDisabled();
    }

    // The choice in force still shows as checked.
    expect(radio("Only people who sign in")).toBeChecked();
    expect(screen.getByTestId("choices-locked-reason")).toHaveTextContent(
      "You need the Edit Status Page permission.",
    );

    fireEvent.click(screen.getByText("Anyone with the link"));
    expect(onPick).not.toHaveBeenCalled();
  });

  test("lines under a choice sit outside its label: pressing a link in them picks nothing", () => {
    const onLink: MockFunction = getJestMockFunction();

    const options: Array<ChoiceRowOption<Who>> = OPTIONS.map(
      (option: ChoiceRowOption<Who>): ChoiceRowOption<Who> => {
        return option.value === "sign-in"
          ? {
              ...option,
              details: (
                <button type="button" onClick={onLink}>
                  3 private users
                </button>
              ),
            }
          : option;
      },
    );

    const { onPick } = renderRows({ value: "anyone", options });

    const row: HTMLElement = screen.getByTestId("choice-sign-in-row");
    const link: HTMLElement = within(row).getByRole("button", {
      name: "3 private users",
    });

    expect(link.closest("label")).toBeNull();

    fireEvent.click(link);

    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
    // And the radio is still named by its title alone.
    expect(radio("Only people who sign in")).toBeInTheDocument();
  });

  test('"Saved" shows beside the choice in force, in a live region every row keeps', () => {
    renderRows({ value: "password", status: <span>Saved</span> });

    for (const option of OPTIONS) {
      expect(screen.getByTestId(`${option.dataTestId}-status`)).toHaveAttribute(
        "role",
        "status",
      );
    }

    expect(screen.getByTestId("choice-password-status")).toHaveTextContent(
      "Saved",
    );
    expect(screen.getByTestId("choice-anyone-status")).toBeEmptyDOMElement();
    expect(screen.getByTestId("choice-sign-in-status")).toBeEmptyDOMElement();
  });

  test("the radios share one group, so the browser moves between them as one", () => {
    renderRows();

    const names: Array<string | null> = OPTIONS.map(
      (option: ChoiceRowOption<Who>): string | null => {
        return radio(option.title).getAttribute("name");
      },
    );

    expect(names[0]).toBeTruthy();
    expect(new Set(names).size).toBe(1);
  });

  test("two groups on one page do not share a name", () => {
    render(
      <>
        <ChoiceRows<Who>
          value="anyone"
          options={OPTIONS.slice(0, 1)}
          onPick={getJestMockFunction()}
          ariaLabel="First"
        />
        <ChoiceRows<Who>
          value="anyone"
          options={OPTIONS.slice(0, 1)}
          onPick={getJestMockFunction()}
          ariaLabel="Second"
        />
      </>,
    );

    const radios: Array<HTMLElement> = screen.getAllByRole("radio", {
      name: "Anyone with the link",
    });

    expect(radios).toHaveLength(2);
    expect(radios[0]!.getAttribute("name")).not.toBe(
      radios[1]!.getAttribute("name"),
    );
  });
});
