// Components
import BasicRadioButtons, {
  BasicRadioButtonOption,
} from "../../../UI/Components/RadioButtons/BasicRadioButtons";
import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

/*
 * A regression suite for a bug that shipped and was visible on every desktop.
 *
 * The option title and its description were two inline spans inside one label,
 * separated by `ml-1 sm:ml-0`. The `sm:` variant cancels the margin at every
 * breakpoint from 640px up -- i.e. on every desktop -- so the only gap between
 * the two strings disappeared and the pair rendered as one run-on sentence:
 * "Create an alertNotifies the team and runs the on-call policy." The narrow
 * phone layout, the one place the 4px margin survived, was the only place it
 * looked right, which is why it went unnoticed.
 *
 * So the assertions below are about the two strings being separate, stacked
 * block elements with no horizontal-margin hack between them. The rest of the
 * suite pins the selection behaviour that these options exist to drive.
 */

const ALERT_TITLE: string = "Create an alert";
const ALERT_DESCRIPTION: string =
  "Notifies the team and runs the on-call policy.";
const SILENT_TITLE: string = "Do nothing";
const SILENT_DESCRIPTION: string = "Leaves the monitor silent.";

const options: Array<BasicRadioButtonOption> = [
  {
    title: ALERT_TITLE,
    description: ALERT_DESCRIPTION,
    value: "alert",
  },
  {
    title: SILENT_TITLE,
    description: SILENT_DESCRIPTION,
    value: "silent",
  },
];

type RadioAtFunction = (index: number) => HTMLInputElement;

/*
 * Addressed by position because the suite also asserts things about the pair
 * of elements at each index. Where the point of a test is the ASSOCIATION
 * between a radio and its label, it queries by accessible name instead --
 * see the "each radio is named by its own title" group.
 */
const radioAt: RadioAtFunction = (index: number): HTMLInputElement => {
  const radio: HTMLElement | undefined = screen.getAllByRole("radio")[index];

  if (!radio) {
    throw new Error(`No radio button rendered at index ${index}.`);
  }

  return radio as HTMLInputElement;
};

describe("BasicRadioButtons", () => {
  /*
   * The label used to be a bare sibling of its input, with no htmlFor and
   * without wrapping it, so nothing tied the two together. Two things followed
   * from that, and neither was visible to a sighted mouse user: the radio had
   * no accessible name at all -- a screen reader announced "radio button, not
   * checked" and never read "Create an alert" -- and the only hit target was
   * the 16px dot, so clicking the words did nothing.
   */
  describe("each radio is named by its own title", () => {
    test("the radio can be found by its title", () => {
      render(
        <BasicRadioButtons
          options={options}
          onChange={getJestMockFunction()}
        />,
      );

      expect(
        screen.getByRole("radio", { name: new RegExp(ALERT_TITLE) }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: new RegExp(SILENT_TITLE) }),
      ).toBeInTheDocument();
    });

    test("no two radios share a name", () => {
      render(
        <BasicRadioButtons
          options={options}
          onChange={getJestMockFunction()}
        />,
      );

      const first: HTMLElement = screen.getByRole("radio", {
        name: new RegExp(ALERT_TITLE),
      });
      const second: HTMLElement = screen.getByRole("radio", {
        name: new RegExp(SILENT_TITLE),
      });

      expect(first).not.toBe(second);
    });

    test("clicking the title text selects that option", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(<BasicRadioButtons options={options} onChange={onChange} />);

      onChange.mockClear();
      fireEvent.click(screen.getByText(SILENT_TITLE));

      expect(onChange).toHaveBeenCalledWith("silent");
    });

    test("clicking the description text selects that option too", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(<BasicRadioButtons options={options} onChange={onChange} />);

      onChange.mockClear();
      fireEvent.click(screen.getByText(SILENT_DESCRIPTION));

      expect(onChange).toHaveBeenCalledWith("silent");
    });
  });

  describe("an option's title and description", () => {
    /*
     * The exact bug. `sm:ml-0` on the description is what glued the two strings
     * together on desktop, and a horizontal margin is meaningless once the
     * description is a block on its own line -- so its reappearance is the
     * regression, whatever else changes around it.
     */
    test("the description is a block under the title, not an inline span nudged sideways", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(<BasicRadioButtons onChange={onChange} options={options} />);

      const title: HTMLElement = screen.getByText(ALERT_TITLE);
      const description: HTMLElement = screen.getByText(ALERT_DESCRIPTION);

      expect(title).toHaveClass("block");
      expect(description).toHaveClass("block");
      expect(description.className).not.toContain("ml-1");
      expect(description.className).not.toContain("sm:ml-0");
    });

    /*
     * That an exact-match query for the title alone finds an element is the
     * proof that the two strings are still two elements: fold them into one
     * text node -- the shape the bug rendered as -- and this query finds
     * nothing, because the node's text would be title + description.
     */
    test("the title is queryable on its own, and the description follows it", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(<BasicRadioButtons onChange={onChange} options={options} />);

      const title: HTMLElement = screen.getByText(ALERT_TITLE);
      const description: HTMLElement = screen.getByText(ALERT_DESCRIPTION);

      expect(title).not.toBe(description);
      expect(title.contains(description)).toBe(false);
      expect(title.nextElementSibling).toBe(description);
      expect(title.closest("label")).toBe(description.closest("label"));
    });

    /*
     * `description` is optional, and an empty <span> still takes its `mt-0.5`
     * with it -- which would leave a ragged extra gap under every title-only
     * option in a list that mixes the two.
     */
    test("an option with no description renders no description element", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(
        <BasicRadioButtons
          onChange={onChange}
          options={[{ title: SILENT_TITLE, value: "silent" }]}
        />,
      );

      const label: HTMLLabelElement | null = screen
        .getByText(SILENT_TITLE)
        .closest("label");

      expect(label).not.toBeNull();
      expect(label?.children).toHaveLength(1);
      expect(screen.getAllByRole("radio")).toHaveLength(1);
    });
  });

  describe("selection", () => {
    /*
     * The whole point of the control: the form above it only learns which
     * branch the user picked through onChange.
     */
    test("picking an option reports its value and checks only that radio", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(<BasicRadioButtons onChange={onChange} options={options} />);

      fireEvent.click(radioAt(0));

      expect(onChange).toHaveBeenLastCalledWith("alert");
      expect(radioAt(0)).toBeChecked();
      expect(radioAt(1)).not.toBeChecked();

      fireEvent.click(radioAt(1));

      expect(onChange).toHaveBeenLastCalledWith("silent");
      expect(radioAt(0)).not.toBeChecked();
      expect(radioAt(1)).toBeChecked();
    });

    /*
     * A form that opens on a saved value has to show that value selected AND
     * hand it back once, so the parent's state matches what is on screen
     * before the user touches anything. Firing more than once here is not
     * harmless: callers wire onChange to setState and to "mark form dirty".
     */
    test("initialValue selects that option on mount and reports it exactly once", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(
        <BasicRadioButtons
          onChange={onChange}
          options={options}
          initialValue="silent"
        />,
      );

      expect(radioAt(1)).toBeChecked();
      expect(radioAt(0)).not.toBeChecked();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("silent");
    });

    /*
     * No initial value means no pre-selected branch. A control that quietly
     * checked the first option would submit a choice the user never made.
     */
    test("with no initialValue nothing is selected and the empty value is reported", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(<BasicRadioButtons onChange={onChange} options={options} />);

      expect(radioAt(0)).not.toBeChecked();
      expect(radioAt(1)).not.toBeChecked();
      expect(onChange).toHaveBeenCalledWith("");
    });

    test("an empty-string initialValue also selects nothing", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(
        <BasicRadioButtons
          onChange={onChange}
          options={options}
          initialValue=""
        />,
      );

      expect(radioAt(0)).not.toBeChecked();
      expect(radioAt(1)).not.toBeChecked();
      expect(onChange).toHaveBeenCalledWith("");
    });
  });

  describe("per-option children", () => {
    /*
     * Options carry their own follow-up fields (pick an on-call policy, choose
     * a status page). Showing them for an unchosen option would put inputs on
     * screen that the form never reads; leaving them behind after the user
     * switches branches is worse -- the stale field looks live and editable.
     */
    test("children appear only while their own option is checked", () => {
      const childText: string = "Choose an on-call policy";
      const onChange: MockFunction = getJestMockFunction();

      render(
        <BasicRadioButtons
          onChange={onChange}
          options={[
            {
              title: ALERT_TITLE,
              description: ALERT_DESCRIPTION,
              value: "alert",
              children: <div>{childText}</div>,
            },
            {
              title: SILENT_TITLE,
              value: "silent",
            },
          ]}
        />,
      );

      expect(screen.queryByText(childText)).not.toBeInTheDocument();

      fireEvent.click(radioAt(0));

      expect(screen.getByText(childText)).toBeInTheDocument();

      fireEvent.click(radioAt(1));

      expect(screen.queryByText(childText)).not.toBeInTheDocument();
    });
  });

  describe("validation message", () => {
    /*
     * The error is the only feedback a user gets when a required choice was
     * skipped; a swallowed message leaves a form that refuses to submit and
     * says nothing about why.
     */
    test("the error prop renders its message", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(
        <BasicRadioButtons
          onChange={onChange}
          options={options}
          error="Pick one of these."
        />,
      );

      expect(screen.getByTestId("error-message")).toHaveTextContent(
        "Pick one of these.",
      );
    });

    test("no error element is rendered when there is no error", () => {
      const onChange: MockFunction = getJestMockFunction();
      render(<BasicRadioButtons onChange={onChange} options={options} />);

      expect(screen.queryByTestId("error-message")).not.toBeInTheDocument();
    });
  });
});
