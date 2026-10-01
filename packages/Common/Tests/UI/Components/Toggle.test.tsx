import Toggle, {
  getToggleClassNames,
  TOGGLE_CHECK_CLASS,
  TOGGLE_KNOB_OFF_CLASS,
  TOGGLE_KNOB_ON_CLASS,
  TOGGLE_TRACK_DISABLED_CLASS,
  TOGGLE_TRACK_OFF_CLASS,
  TOGGLE_TRACK_OFF_HOVER_CLASS,
  TOGGLE_TRACK_ON_CLASS,
  TOGGLE_TRACK_ON_HOVER_CLASS,
} from "../../../UI/Components/Toggle/Toggle";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import React, { ReactElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

afterEach(() => {
  cleanup();
});

type UserEventController = ReturnType<typeof userEvent.setup>;

const SECRET_DESCRIPTION: string =
  "Keep this variable's content out of workflow run logs - every run replaces it with [REDACTED] before the log is saved.";

function classesOf(element: Element): Array<string> {
  return Array.from(element.classList);
}

function knobOf(toggle: HTMLElement): HTMLElement {
  return toggle.querySelector("[data-ou-toggle-knob]") as HTMLElement;
}

// The <label> a title's text is drawn in.
function labelWithText(text: string): HTMLElement {
  return screen.getByText(text).closest("label") as HTMLElement;
}

function expectAllClasses(element: Element, classList: string): void {
  for (const className of classList.split(" ")) {
    expect({
      className,
      present: element.classList.contains(className),
    }).toEqual({ className, present: true });
  }
}

function expectNoClasses(element: Element, classList: string): void {
  for (const className of classList.split(" ")) {
    expect({
      className,
      present: element.classList.contains(className),
    }).toEqual({ className, present: false });
  }
}

/*
 * A parent that owns the value, as almost every caller does: the switch
 * reports a press, the parent stores it and hands it back as `value`.
 */
const ControlledToggle: (props: {
  initial: boolean;
  onChange?: (value: boolean) => void;
  title?: string;
  description?: string;
  disabled?: boolean;
}) => ReactElement = (props: {
  initial: boolean;
  onChange?: (value: boolean) => void;
  title?: string;
  description?: string;
  disabled?: boolean;
}): ReactElement => {
  const [value, setValue] = useState<boolean>(props.initial);

  return (
    <Toggle
      title={props.title}
      description={props.description}
      disabled={props.disabled}
      value={value}
      onChange={(next: boolean) => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  );
};

describe("Toggle", () => {
  test("renders toggle element with required props only", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} initialValue={false} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toBeInTheDocument();
  });

  test("renders toggle element with all props", () => {
    const { getByRole } = render(
      <Toggle
        onChange={() => {}}
        onFocus={() => {}}
        onBlur={() => {}}
        initialValue={false}
        tabIndex={1}
        title="title"
        description="description"
        error="error"
      />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toBeInTheDocument();
  });

  test("calls onChange", () => {
    const onChange: MockFunction = getJestMockFunction();

    const { getByRole } = render(
      <Toggle onChange={onChange} initialValue={false} />,
    );
    const toggle: HTMLElement = getByRole("switch");
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("calls onChange exactly once per click", () => {
    /*
     * The click handler used to call handleChange (which already calls
     * props.onChange) and then props.onChange again, running every consumer's
     * handler twice per click. Idempotent handlers never noticed; the monitor
     * criteria switches, which seed a blank incident / alert row on the way
     * on, were saved from a second row only by their own "is the array still
     * empty" guard.
     */
    const onChange: MockFunction = getJestMockFunction();

    const { getByRole } = render(
      <Toggle onChange={onChange} initialValue={false} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenNthCalledWith(1, true);

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(2, false);
  });

  test("calls onFocus", () => {
    const onFocus: MockFunction = getJestMockFunction();

    const { getByRole } = render(
      <Toggle onFocus={onFocus} initialValue={false} onChange={() => {}} />,
    );
    const toggle: HTMLElement = getByRole("switch");
    fireEvent.focus(toggle);

    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  test("calls onBlur", () => {
    const onBlur: MockFunction = getJestMockFunction();

    const { getByRole } = render(
      <Toggle onBlur={onBlur} initialValue={false} onChange={() => {}} />,
    );
    const toggle: HTMLElement = getByRole("switch");
    fireEvent.blur(toggle);

    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("displays error", () => {
    const { getByText } = render(
      <Toggle onChange={() => {}} initialValue={false} error="error" />,
    );

    expect(getByText("error")).toBeInTheDocument();
  });

  test("displays title", () => {
    const { getByText } = render(
      <Toggle
        onChange={() => {}}
        initialValue={false}
        title="title"
        description="description"
      />,
    );

    expect(getByText("title")).toBeInTheDocument();
  });

  test("displays description", () => {
    const { getByText } = render(
      <Toggle
        onChange={() => {}}
        initialValue={false}
        description="description"
      />,
    );
    expect(getByText("description")).toBeInTheDocument();
  });

  test("sets tabIndex", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} initialValue={false} tabIndex={1} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("tabindex", "1");
  });

  test("sets initial value", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} initialValue={true} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("sets initial value to false", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} initialValue={false} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("sets initial value to undefined", () => {
    const { getByRole } = render(<Toggle onChange={() => {}} />);
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("sets value", () => {
    const { getByRole } = render(<Toggle onChange={() => {}} value={true} />);
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("sets value to false", () => {
    const { getByRole } = render(<Toggle onChange={() => {}} value={false} />);
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("sets value to undefined", () => {
    const { getByRole } = render(<Toggle onChange={() => {}} />);
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  /*
   * Static markup runs no effects, so it is the first paint exactly. The
   * switch used to take `value` only from an effect: a form field that
   * started on was drawn off for a frame, then slid across.
   */
  test("shows its value from the first paint, without sliding in", () => {
    const onMarkup: string = renderToStaticMarkup(
      <Toggle onChange={() => {}} value={true} title="Enabled" />,
    );
    const offMarkup: string = renderToStaticMarkup(
      <Toggle onChange={() => {}} value={false} initialValue={true} />,
    );

    expect(onMarkup).toContain('aria-checked="true"');
    expect(onMarkup).toContain("translate-x-5");
    expect(onMarkup).toContain("data-ou-toggle-check");
    // `value` is what the switch shows; initialValue is for when there is none.
    expect(offMarkup).toContain('aria-checked="false"');
    expect(
      renderToStaticMarkup(<Toggle onChange={() => {}} initialValue={true} />),
    ).toContain('aria-checked="true"');
  });

  test("follows a value its parent changes", () => {
    const { getByRole, rerender } = render(
      <Toggle onChange={() => {}} value={false} />,
    );

    rerender(<Toggle onChange={() => {}} value={true} />);
    expect(getByRole("switch")).toHaveAttribute("aria-checked", "true");

    rerender(<Toggle onChange={() => {}} value={false} />);
    expect(getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  /*
   * A caller that saves the value the switch shows disables it while the
   * save is in flight. A press it then refuses used to flip the switch's own
   * copy of its value anyway (handleChange runs before onChange), and with
   * `value` unchanged nothing flipped it back: the switch showed ON beside a
   * paused rule. A disabled switch ignores the press before it flips.
   */
  test("a disabled switch ignores presses and keeps showing its value", () => {
    const onChange: MockFunction = getJestMockFunction();

    const { getByRole } = render(
      <Toggle onChange={onChange} value={false} disabled={true} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(onChange).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveClass("cursor-not-allowed");
  });

  test("a disabled switch keeps keyboard focus: it is aria-disabled, not disabled", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} value={true} disabled={true} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    toggle.focus();

    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveFocus();
  });

  test("once enabled again, the switch answers presses from the value it shows", () => {
    const onChange: MockFunction = getJestMockFunction();

    const { getByRole, rerender } = render(
      <Toggle onChange={onChange} value={false} disabled={true} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    fireEvent.click(toggle);

    rerender(<Toggle onChange={onChange} value={false} disabled={false} />);

    expect(toggle).not.toHaveAttribute("aria-disabled");
    expect(toggle).toHaveClass("cursor-pointer");

    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("an enabled switch says nothing about being disabled", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} initialValue={false} />,
    );

    expect(getByRole("switch")).not.toHaveAttribute("aria-disabled");
  });

  test("styles toggle correctly", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} initialValue={false} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expectAllClasses(toggle, TOGGLE_TRACK_OFF_CLASS);
    fireEvent.click(toggle);
    expectAllClasses(toggle, TOGGLE_TRACK_ON_CLASS);
  });
});

/*
 * What the maintainer saw: a pale grey pill, gray-200 with a white knob, that
 * barely showed on a white form and gave no cue which way it was set. Off is
 * now an outline and a dark knob, on is filled indigo with a tick on a white
 * knob, disabled is dimmed.
 */
describe("Toggle - how each state looks", () => {
  test("off is an outlined track with a dark knob on the left and no tick", () => {
    render(<Toggle onChange={() => {}} value={false} title="Secret" />);

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });

    expectAllClasses(toggle, TOGGLE_TRACK_OFF_CLASS);
    expectNoClasses(toggle, TOGGLE_TRACK_ON_CLASS);
    expectAllClasses(knobOf(toggle), TOGGLE_KNOB_OFF_CLASS);
    expectNoClasses(knobOf(toggle), "bg-white translate-x-5");
    expect(toggle.querySelector("[data-ou-toggle-check]")).toBeNull();
  });

  test("on is a filled indigo track with a white knob on the right carrying a tick", () => {
    render(<Toggle onChange={() => {}} value={true} title="Secret" />);

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });
    const check: Element | null = toggle.querySelector(
      "[data-ou-toggle-check]",
    );

    expectAllClasses(toggle, TOGGLE_TRACK_ON_CLASS);
    expectNoClasses(toggle, TOGGLE_TRACK_OFF_CLASS);
    expectAllClasses(knobOf(toggle), TOGGLE_KNOB_ON_CLASS);
    expectNoClasses(knobOf(toggle), "bg-gray-500");
    expect(check).not.toBeNull();
    expectAllClasses(check!, TOGGLE_CHECK_CLASS);
  });

  test("the old pale off state is gone", () => {
    render(<Toggle onChange={() => {}} value={false} />);

    const toggle: HTMLElement = screen.getByRole("switch");

    expect(toggle).not.toHaveClass("bg-gray-200");
    expect(toggle).not.toHaveClass("border-transparent");
  });

  test("the knob and the tick are decoration: hidden from assistive tech", () => {
    render(<Toggle onChange={() => {}} value={true} />);

    const knob: HTMLElement = knobOf(screen.getByRole("switch"));

    expect(knob).toHaveAttribute("aria-hidden", "true");
    expect(knob.querySelector("svg")).not.toBeNull();
  });

  test("pressing it moves between the two looks", () => {
    render(<ControlledToggle initial={false} title="Secret" />);

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });

    fireEvent.click(toggle);
    expectAllClasses(toggle, TOGGLE_TRACK_ON_CLASS);
    expectAllClasses(knobOf(toggle), TOGGLE_KNOB_ON_CLASS);

    fireEvent.click(toggle);
    expectAllClasses(toggle, TOGGLE_TRACK_OFF_CLASS);
    expectAllClasses(knobOf(toggle), TOGGLE_KNOB_OFF_CLASS);
  });

  test.each([false, true])(
    "disabled (%s) is dimmed, shows no hover and says it cannot be pressed",
    (value: boolean) => {
      render(<Toggle onChange={() => {}} value={value} disabled={true} />);

      const toggle: HTMLElement = screen.getByRole("switch");

      expectAllClasses(toggle, TOGGLE_TRACK_DISABLED_CLASS);
      expectNoClasses(toggle, "cursor-pointer");
      expect(
        classesOf(toggle).filter((className: string): boolean => {
          return className.startsWith("hover:");
        }),
      ).toEqual([]);
      // Still the state it holds, only dimmed.
      expectAllClasses(
        toggle,
        value ? TOGGLE_TRACK_ON_CLASS : TOGGLE_TRACK_OFF_CLASS,
      );
    },
  );

  test("an enabled switch darkens on hover, in the state it is in", () => {
    const { rerender } = render(<Toggle onChange={() => {}} value={false} />);

    expectAllClasses(screen.getByRole("switch"), TOGGLE_TRACK_OFF_HOVER_CLASS);
    expectNoClasses(screen.getByRole("switch"), TOGGLE_TRACK_ON_HOVER_CLASS);

    rerender(<Toggle onChange={() => {}} value={true} />);

    expectAllClasses(screen.getByRole("switch"), TOGGLE_TRACK_ON_HOVER_CLASS);
    expectNoClasses(screen.getByRole("switch"), TOGGLE_TRACK_OFF_HOVER_CLASS);
  });

  /*
   * The ring is drawn for keyboard focus only (focus-visible). A focus: ring
   * also painted itself around a switch someone had just clicked.
   */
  test("keyboard focus draws a visible ring; a mouse click does not", () => {
    render(<Toggle onChange={() => {}} value={false} />);

    const toggle: HTMLElement = screen.getByRole("switch");

    expectAllClasses(
      toggle,
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2",
    );
    expect(
      classesOf(toggle).filter((className: string): boolean => {
        return className.startsWith("focus:ring");
      }),
    ).toEqual([]);
  });

  test("it does not animate for anyone who asked for less motion", () => {
    render(<Toggle onChange={() => {}} value={false} />);

    const toggle: HTMLElement = screen.getByRole("switch");

    expect(toggle).toHaveClass("motion-reduce:transition-none");
    expect(knobOf(toggle)).toHaveClass("motion-reduce:transition-none");
  });

  // The hooks the dark theme's rules in Theme.css hang on.
  test("track and knob carry the attributes the dark theme recolours", () => {
    render(<Toggle onChange={() => {}} value={true} />);

    const toggle: HTMLElement = screen.getByRole("switch");

    expect(toggle).toHaveAttribute("data-ou-toggle-track");
    expect(knobOf(toggle)).not.toBeNull();
  });

  test("getToggleClassNames gives the same classes the component renders", () => {
    for (const isChecked of [false, true]) {
      for (const isDisabled of [false, true]) {
        render(
          <Toggle
            onChange={() => {}}
            value={isChecked}
            disabled={isDisabled}
          />,
        );

        const toggle: HTMLElement = screen.getByRole("switch");

        expect(toggle.className).toBe(
          getToggleClassNames({ isChecked, isDisabled }).track,
        );
        expect(knobOf(toggle).className).toBe(
          getToggleClassNames({ isChecked, isDisabled }).knob,
        );

        cleanup();
      }
    }
  });
});

describe("Toggle - keyboard", () => {
  test("Tab reaches the switch and Space flips it", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const user: UserEventController = userEvent.setup({ delay: null });

    render(
      <ControlledToggle initial={false} title="Secret" onChange={onChange} />,
    );

    await user.tab();

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });

    expect(toggle).toHaveFocus();

    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("Enter flips it too", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const user: UserEventController = userEvent.setup({ delay: null });

    render(
      <ControlledToggle initial={true} title="Enabled" onChange={onChange} />,
    );

    await user.tab();
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole("switch", { name: "Enabled" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("a disabled switch stays in the tab order and ignores Space and Enter", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const user: UserEventController = userEvent.setup({ delay: null });

    render(
      <ControlledToggle
        initial={false}
        title="Locked"
        disabled={true}
        onChange={onChange}
      />,
    );

    await user.tab();

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Locked" });

    expect(toggle).toHaveFocus();

    await user.keyboard(" ");
    await user.keyboard("{Enter}");

    expect(onChange).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("it is a button, so a press never submits the form around it", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    const user: UserEventController = userEvent.setup({ delay: null });

    render(
      <form
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <ControlledToggle initial={false} title="Secret" />
      </form>,
    );

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });

    expect(toggle).toHaveAttribute("type", "button");

    await user.tab();
    await user.keyboard("{Enter}");
    await user.click(toggle);

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Toggle - its label", () => {
  test("the title names the switch, and only the title", () => {
    render(
      <Toggle
        onChange={() => {}}
        value={false}
        title="Secret"
        description={SECRET_DESCRIPTION}
      />,
    );

    const toggle: HTMLElement = screen.getByRole("switch");

    expect(toggle).toHaveAccessibleName("Secret");
  });

  test("the description describes the switch", () => {
    render(
      <Toggle
        onChange={() => {}}
        value={false}
        title="Secret"
        description={SECRET_DESCRIPTION}
      />,
    );

    expect(
      screen.getByRole("switch", { name: "Secret" }),
    ).toHaveAccessibleDescription(SECRET_DESCRIPTION);
  });

  test("the title is a real label for the switch", () => {
    render(<Toggle onChange={() => {}} value={false} title="Secret" />);

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });
    const label: HTMLElement = labelWithText("Secret");

    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", toggle.id);
    expect(screen.getByLabelText("Secret")).toBe(toggle);
  });

  test("pressing the title flips the switch, once", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ControlledToggle initial={false} title="Secret" onChange={onChange} />,
    );

    fireEvent.click(screen.getByText("Secret"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("switch", { name: "Secret" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByText("Secret"));

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  test("pressing the title of a disabled switch does nothing", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ControlledToggle
        initial={true}
        title="Locked"
        disabled={true}
        onChange={onChange}
      />,
    );

    const label: HTMLElement = labelWithText("Locked");

    fireEvent.click(label);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "Locked" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(label).toHaveClass("cursor-not-allowed");
    expect(label).not.toHaveClass("cursor-pointer");
  });

  test("the title says it can be pressed", () => {
    render(<Toggle onChange={() => {}} value={false} title="Secret" />);

    expect(labelWithText("Secret")).toHaveClass("cursor-pointer");
  });

  /*
   * Help text stays text: it can hold a link, and someone selecting a
   * sentence to copy it should not flip a setting.
   */
  test("pressing the description does not flip the switch", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ControlledToggle
        initial={false}
        title="Secret"
        description={SECRET_DESCRIPTION}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText(SECRET_DESCRIPTION));

    expect(onChange).not.toHaveBeenCalled();
  });

  test("the title sits beside the switch and the description under the title", () => {
    render(
      <Toggle
        onChange={() => {}}
        value={false}
        title="Secret"
        description={SECRET_DESCRIPTION}
      />,
    );

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });
    const label: HTMLElement = labelWithText("Secret");
    const description: HTMLElement = screen.getByText(SECRET_DESCRIPTION);
    const textColumn: HTMLElement = label.parentElement!.parentElement!;

    // One row: the switch, then the text column.
    expect(toggle.parentElement).toBe(textColumn.parentElement);
    expect(toggle.parentElement).toHaveClass("flex");
    expect(toggle.nextElementSibling).toBe(textColumn);
    // The description is its own block in that column, below the title.
    expect(description.parentElement).toBe(textColumn);
    expect(
      label.compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(label.contains(description)).toBe(false);
  });

  test("a title and description can be elements", () => {
    render(
      <Toggle
        onChange={() => {}}
        value={false}
        title={<span>Use SSL/TLS</span>}
        description={
          <span>
            Turn off only if the database uses a <em>self-signed</em>{" "}
            certificate.
          </span>
        }
      />,
    );

    const toggle: HTMLElement = screen.getByRole("switch", {
      name: "Use SSL/TLS",
    });

    expect(toggle).toHaveAccessibleDescription(
      "Turn off only if the database uses a self-signed certificate.",
    );
  });

  test("ariaLabelledby names the switch instead of the title", () => {
    render(
      <>
        <span id="rule-name">Check members against Verified email</span>
        <Toggle
          onChange={() => {}}
          value={false}
          title="Enabled"
          ariaLabelledby="rule-name"
        />
      </>,
    );

    expect(screen.getByRole("switch")).toHaveAccessibleName(
      "Check members against Verified email",
    );
  });

  test("ariaLabel names a switch that has no title", () => {
    render(<Toggle onChange={() => {}} value={false} ariaLabel="Is root" />);

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Is root" });

    expect(toggle).toHaveAttribute("aria-label", "Is root");
    expect(toggle).not.toHaveAttribute("aria-labelledby");
  });

  test("ariaLabel gives way to a visible title", () => {
    render(
      <Toggle
        onChange={() => {}}
        value={false}
        title="Secret"
        ariaLabel="Something else"
      />,
    );

    const toggle: HTMLElement = screen.getByRole("switch");

    expect(toggle).toHaveAccessibleName("Secret");
    expect(toggle).not.toHaveAttribute("aria-label");
  });

  test("a page can label the switch itself through its id", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <>
        <ControlledToggleWithId onChange={onChange} />
        <label htmlFor="read-only-switch">Read-only</label>
      </>,
    );

    const toggle: HTMLElement = screen.getByRole("switch", {
      name: "Read-only",
    });

    expect(toggle).toHaveAttribute("id", "read-only-switch");

    fireEvent.click(screen.getByText("Read-only"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("two switches on a page label only themselves", () => {
    render(
      <>
        <Toggle onChange={() => {}} value={false} title="First" />
        <Toggle onChange={() => {}} value={true} title="Second" />
      </>,
    );

    const first: HTMLElement = screen.getByRole("switch", { name: "First" });
    const second: HTMLElement = screen.getByRole("switch", { name: "Second" });

    expect(first.id).not.toBe(second.id);

    fireEvent.click(screen.getByText("Second"));

    expect(first).toHaveAttribute("aria-checked", "false");
    expect(second).toHaveAttribute("aria-checked", "false");
  });

  /*
   * A switch with nothing beside it used to render an empty label span with
   * a left margin, a 12px gap in whatever row it was put in.
   */
  test("a switch with no title or description draws no label column", () => {
    const { container } = render(
      <Toggle onChange={() => {}} value={false} ariaLabel="Bare" />,
    );

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Bare" });

    expect(toggle.nextElementSibling).toBeNull();
    expect(container.querySelector("label")).toBeNull();
    expect(container.querySelector(".ml-3")).toBeNull();
  });

  test("the tooltip's text is announced with the switch", () => {
    render(
      <Toggle
        onChange={() => {}}
        value={true}
        title="When filters match, create an alert."
        tooltip="Alerts notify the team but are not shown on the status page."
      />,
    );

    expect(
      screen.getByRole("switch", {
        name: "When filters match, create an alert.",
      }),
    ).toHaveAccessibleDescription(
      "Alerts notify the team but are not shown on the status page.",
    );
  });

  test("an error marks the switch invalid and is read with it", () => {
    render(
      <Toggle
        onChange={() => {}}
        value={false}
        title="Accept"
        description="Required before you continue."
        error="Turn this on to continue."
      />,
    );

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Accept" });

    expect(toggle).toHaveAttribute("aria-invalid", "true");
    expect(toggle).toHaveAccessibleDescription(
      "Required before you continue. Turn this on to continue.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Turn this on to continue.",
    );
  });

  test("the error lines up under the text when there is a title", () => {
    const { rerender } = render(
      <Toggle onChange={() => {}} value={false} title="Accept" error="No" />,
    );

    expect(screen.getByTestId("error-message")).toHaveClass("pl-14");

    rerender(<Toggle onChange={() => {}} value={false} error="No" />);

    expect(screen.getByTestId("error-message")).not.toHaveClass("pl-14");
  });

  test("without an error the switch is neither invalid nor described by one", () => {
    render(<Toggle onChange={() => {}} value={false} title="Accept" />);

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Accept" });

    expect(toggle).not.toHaveAttribute("aria-invalid");
    expect(toggle).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

const ControlledToggleWithId: (props: {
  onChange: (value: boolean) => void;
}) => ReactElement = (props: {
  onChange: (value: boolean) => void;
}): ReactElement => {
  const [value, setValue] = useState<boolean>(false);

  return (
    <Toggle
      id="read-only-switch"
      value={value}
      onChange={(next: boolean) => {
        setValue(next);
        props.onChange(next);
      }}
    />
  );
};

/*
 * Every other Common control looks its strings up in the active locale. The
 * German values are the shipped ones, copied from
 * App/FeatureSet/Dashboard/src/Locales/de.json.
 */
describe("Toggle - in German", () => {
  const GERMAN: Record<string, string> = {
    "Preserve Source": "Quelle beibehalten",
    "Keep the original source attribute after remapping. If off, the source key is removed.":
      "Behalten Sie das ursprüngliche Quellattribut nach der Neuzuordnung. Wenn deaktiviert, wird der Quellschlüssel entfernt.",
  };

  const german: i18n = createInstance();

  beforeAll(async () => {
    await german.init({
      lng: "de",
      resources: { de: { translation: GERMAN } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  test("the title and description are translated, and name and describe the switch", () => {
    render(
      <I18nextProvider i18n={german}>
        <Toggle
          onChange={() => {}}
          value={false}
          title="Preserve Source"
          description="Keep the original source attribute after remapping. If off, the source key is removed."
        />
      </I18nextProvider>,
    );

    const toggle: HTMLElement = screen.getByRole("switch", {
      name: "Quelle beibehalten",
    });

    expect(toggle).toHaveAccessibleDescription(
      GERMAN[
        "Keep the original source attribute after remapping. If off, the source key is removed."
      ]!,
    );
    expect(screen.queryByText("Preserve Source")).toBeNull();
  });

  test("a string with no entry is shown as given", () => {
    render(
      <I18nextProvider i18n={german}>
        <Toggle onChange={() => {}} value={false} title="Not in the locale" />
      </I18nextProvider>,
    );

    expect(
      screen.getByRole("switch", { name: "Not in the locale" }),
    ).toBeInTheDocument();
  });

  test("an already translated title is not changed by a second lookup", () => {
    render(
      <I18nextProvider i18n={german}>
        <Toggle onChange={() => {}} value={false} title="Quelle beibehalten" />
      </I18nextProvider>,
    );

    expect(
      screen.getByRole("switch", { name: "Quelle beibehalten" }),
    ).toBeInTheDocument();
  });
});

describe("Toggle - state stays in step with presses", () => {
  test("many quick presses end where the count says", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ControlledToggle initial={false} title="Secret" onChange={onChange} />,
    );

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });

    await act(async () => {
      for (let i: number = 0; i < 5; i++) {
        fireEvent.click(toggle);
      }
    });

    expect(onChange).toHaveBeenCalledTimes(5);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expectAllClasses(toggle, TOGGLE_TRACK_ON_CLASS);
  });
});
