import RadioButtons, {
  RadioButton,
} from "../../../UI/Components/RadioButtons/GroupRadioButtons";
import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

describe("RadioButtons", () => {
  const options: RadioButton[] = [
    {
      title: "title 1",
      description: "description 1",
      value: "1",
      sideTitle: "side title 1",
      sideDescription: "side description 1",
    },
    {
      title: "title 2",
      description: "description 2",
      value: "2",
      sideTitle: "side title 2",
      sideDescription: "side description 2",
    },
  ];

  test("renders with required props only", () => {
    const { getByRole } = render(
      <RadioButtons onChange={() => {}} options={options} />,
    );
    const radioButtonsGroup: HTMLElement = getByRole("radiogroup");
    expect(radioButtonsGroup).toBeInTheDocument();
  });

  test("renders with all props", () => {
    const { getByRole } = render(
      <RadioButtons
        onChange={() => {}}
        options={options}
        initialValue="1"
        error="error"
      />,
    );
    const radioButtonsGroup: HTMLElement = getByRole("radiogroup");
    expect(radioButtonsGroup).toBeInTheDocument();
  });

  test("sets options", () => {
    const { getAllByRole } = render(
      <RadioButtons onChange={() => {}} options={options} />,
    );

    const radioButtons: HTMLElement[] = getAllByRole("radio");

    expect(radioButtons).toHaveLength(2);
  });

  test("sets initial value", () => {
    const { getByLabelText } = render(
      <RadioButtons onChange={() => {}} options={options} initialValue="1" />,
    );

    const radioButton: HTMLElement = getByLabelText("title 1");
    expect(radioButton).toBeChecked();
  });

  test("displays error", () => {
    const { queryByText, rerender, getByText } = render(
      <RadioButtons onChange={() => {}} options={options} initialValue="1" />,
    );
    expect(queryByText("error")).toBeNull();

    rerender(
      <RadioButtons onChange={() => {}} options={options} error="error" />,
    );
    expect(getByText("error")).toBeInTheDocument();
  });

  test("displays titles and descriptions", () => {
    const { getByText, getByLabelText } = render(
      <RadioButtons
        onChange={() => {}}
        options={[options[0] as RadioButton]}
      />,
    );

    expect(getByLabelText("title 1")).toBeInTheDocument();
    expect(getByText("description 1")).toBeInTheDocument();
    expect(getByText("side title 1")).toBeInTheDocument();
    expect(getByText("side description 1")).toBeInTheDocument();
  });

  test("calls onChange", () => {
    const onChange: MockFunction = getJestMockFunction();
    const { getByLabelText } = render(
      <RadioButtons onChange={onChange} options={options} />,
    );

    const radioButton: HTMLElement = getByLabelText("title 1");
    fireEvent.click(radioButton);

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("1");
  });

  /*
   * Two groups on one page - a form and a dialog over it - had the same
   * element ids ("server-size-0-label"), so a screen reader on the second
   * group's radios read the first group's titles. Each group's ids are its
   * own now.
   */
  describe("two groups on one page", () => {
    const renderTwo: () => {
      first: HTMLElement;
      second: HTMLElement;
    } = (): { first: HTMLElement; second: HTMLElement } => {
      const view: ReturnType<typeof render> = render(
        <div>
          <div data-testid="first">
            <RadioButtons onChange={() => {}} options={options} />
          </div>
          <div data-testid="second">
            <RadioButtons
              onChange={() => {}}
              options={[
                { title: "other 1", description: "other d1", value: "1" },
                { title: "other 2", value: "2" },
              ]}
            />
          </div>
        </div>,
      );

      return {
        first: view.getByTestId("first"),
        second: view.getByTestId("second"),
      };
    };

    test("never share an element id", () => {
      const { first, second } = renderTwo();
      const idsOf: (root: HTMLElement) => Array<string> = (
        root: HTMLElement,
      ): Array<string> => {
        return Array.from(root.querySelectorAll("[id]")).map(
          (element: Element): string => {
            return element.id;
          },
        );
      };

      const firstIds: Array<string> = idsOf(first);
      const secondIds: Array<string> = idsOf(second);

      expect(firstIds.length).toBeGreaterThan(0);
      expect(secondIds.length).toBeGreaterThan(0);
      expect(
        firstIds.filter((id: string): boolean => {
          return secondIds.includes(id);
        }),
      ).toEqual([]);
      expect(new Set([...firstIds, ...secondIds]).size).toBe(
        firstIds.length + secondIds.length,
      );
    });

    test("each radio is named by its own card, in its own group", () => {
      const { first, second } = renderTwo();

      const nameOf: (radio: Element) => string = (radio: Element): string => {
        const labelId: string = radio.getAttribute("aria-labelledby") || "";
        return document.getElementById(labelId)?.textContent || "";
      };

      expect(
        Array.from(first.querySelectorAll("input[type='radio']")).map(nameOf),
      ).toEqual(["title 1", "title 2"]);
      expect(
        Array.from(second.querySelectorAll("input[type='radio']")).map(nameOf),
      ).toEqual(["other 1", "other 2"]);
    });

    test("a group's radios share one name, and only that group's", () => {
      const { first, second } = renderTwo();
      const namesOf: (root: HTMLElement) => Array<string> = (
        root: HTMLElement,
      ): Array<string> => {
        return Array.from(root.querySelectorAll("input[type='radio']")).map(
          (radio: Element): string => {
            return radio.getAttribute("name") || "";
          },
        );
      };

      const firstNames: Array<string> = namesOf(first);
      const secondNames: Array<string> = namesOf(second);

      expect(new Set(firstNames).size).toBe(1);
      expect(new Set(secondNames).size).toBe(1);
      expect(firstNames[0]).not.toBe("");
      expect(firstNames[0]).not.toBe(secondNames[0]);
    });

    test("a radio is described by what its card says, and nothing it does not", () => {
      const { second } = renderTwo();
      const radios: Array<Element> = Array.from(
        second.querySelectorAll("input[type='radio']"),
      );

      const describedBy: (radio: Element) => string = (
        radio: Element,
      ): string => {
        return (radio.getAttribute("aria-describedby") || "")
          .split(" ")
          .filter(Boolean)
          .map((id: string): string => {
            return (document.getElementById(id)?.textContent || "").trim();
          })
          .join(" | ");
      };

      expect(describedBy(radios[0]!)).toBe("other d1");
      // No description and nothing at its side: described by nothing.
      expect(radios[1]!.getAttribute("aria-describedby")).toBeNull();
    });
  });

  test("picking a card checks its radio, unchecks the others, and calls onChange once", () => {
    const onChange: MockFunction = getJestMockFunction();
    const { getByLabelText, getByTestId } = render(
      <RadioButtons onChange={onChange} options={options} initialValue="1" />,
    );

    onChange.mockClear();
    fireEvent.click(getByTestId("card-select-option-2"));

    expect(getByLabelText("title 2")).toBeChecked();
    expect(getByLabelText("title 1")).not.toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2");
  });

  test("the keyboard's place is drawn round the card it is on", () => {
    const { getByTestId } = render(
      <RadioButtons onChange={() => {}} options={options} initialValue="1" />,
    );

    expect(getByTestId("card-select-option-2")).toHaveClass(
      "has-[:focus-visible]:ring-2",
      "has-[:focus-visible]:ring-indigo-500",
    );
  });
});
