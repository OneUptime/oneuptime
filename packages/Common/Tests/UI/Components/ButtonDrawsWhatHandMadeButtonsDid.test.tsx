import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement, useRef, useState } from "react";
import Button, {
  BUTTON_KEY_HINT_CLASS_NAMES,
  BUTTON_TITLE_HIDDEN_ON_PHONE_CLASS_NAME,
  ButtonSize,
  ButtonStyleType,
} from "../../../UI/Components/Button/Button";
import MoreMenu from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import IconProp from "../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * What the shared Button learned so the last seven primary buttons drawn by
 * hand could be it (#9195): the chat and note composers' Send and Post, the
 * LLM replay bar's Play, the two label pickers' Apply and the paging
 * ladder's menu trigger.
 *
 *   - onMouseDown: an Apply under a search field keeps the field focused.
 *   - shortcutHint: Post says its keys in a chip, and listens for nothing.
 *   - isTitleHiddenOnPhone: Send beside its pickers is its arrow on a phone.
 *   - dataState: Play says whether it is playing.
 *   - MoreMenu takes a Button as its trigger, with the menu's aria and click.
 */

afterEach(() => {
  cleanup();
});

describe("onMouseDown", () => {
  test("is called as the pointer goes down, and can keep the focus where it is", () => {
    const onClick: MockFunction = getJestMockFunction();

    const Picker: () => ReactElement = (): ReactElement => {
      const fieldRef: React.RefObject<HTMLInputElement> =
        useRef<HTMLInputElement>(null);

      return (
        <>
          <input ref={fieldRef} data-testid="search" />
          <Button
            title="Apply"
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Small}
            dataTestId="apply"
            onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
            }}
            onClick={onClick}
          />
        </>
      );
    };

    render(<Picker />);

    const search: HTMLElement = screen.getByTestId("search");
    search.focus();

    const apply: HTMLElement = screen.getByTestId("apply");
    const wasNotPrevented: boolean = fireEvent.mouseDown(apply);

    // preventDefault on mousedown is what keeps a browser's focus put.
    expect(wasNotPrevented).toBe(false);
    expect(document.activeElement).toBe(search);

    fireEvent.click(apply);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("left out, a press goes on as before", () => {
    render(<Button title="Apply" dataTestId="apply" />);

    expect(fireEvent.mouseDown(screen.getByTestId("apply"))).toBe(true);
  });
});

describe("shortcutHint", () => {
  test("says its keys in a chip after the words, pale on a filled button, never on a phone", () => {
    render(
      <Button
        title="Post update"
        buttonStyle={ButtonStyleType.PRIMARY}
        shortcutHint="⌘ Enter"
        dataTestId="post"
      />,
    );

    const chip: HTMLElement = screen.getByText("⌘ Enter");

    expect(chip.tagName).toBe("KBD");
    expect(chip.className).toBe(BUTTON_KEY_HINT_CLASS_NAMES.filled);
    expect(chip).toHaveClass("max-sm:hidden", "bg-white/15");
    expect(screen.getByTestId("post")).toHaveTextContent("Post update⌘ Enter");
  });

  test("on a plain button it is a grey chip", () => {
    render(<Button title="Save" shortcutHint="Ctrl S" />);

    expect(screen.getByText("Ctrl S").className).toBe(
      BUTTON_KEY_HINT_CLASS_NAMES.plain,
    );
  });

  test("only says the keys: pressing them is the page's to do", () => {
    const onClick: MockFunction = getJestMockFunction();

    render(<Button title="Post" shortcutHint="Enter" onClick={onClick} />);

    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("isTitleHiddenOnPhone", () => {
  test("keeps the words for a screen reader and draws a square round the icon on a phone", () => {
    render(
      <Button
        title="Start task"
        icon={IconProp.ArrowUp}
        buttonStyle={ButtonStyleType.PRIMARY}
        buttonSize={ButtonSize.Small}
        isTitleHiddenOnPhone={true}
        dataTestId="send"
      />,
    );

    const send: HTMLElement = screen.getByTestId("send");

    expect(send).toHaveAccessibleName("Start task");
    expect(screen.getByText("Start task")).toHaveClass(
      BUTTON_TITLE_HIDDEN_ON_PHONE_CLASS_NAME,
    );
    // From sm up its size's padding; under it, a square.
    expect(send).toHaveClass("px-2", "py-1", "max-sm:p-1");
    // No gap after the icon where no words follow it.
    expect(send.querySelector("svg")).toHaveClass("me-1", "max-sm:me-0");
  });

  test("left out, the words are drawn at every width", () => {
    render(
      <Button
        title="Send"
        icon={IconProp.ArrowUp}
        buttonStyle={ButtonStyleType.PRIMARY}
        dataTestId="send"
      />,
    );

    const send: HTMLElement = screen.getByTestId("send");

    expect(send.querySelector(".max-sm\\:sr-only")).toBeNull();
    expect(send.className).not.toContain("max-sm:p-");
  });
});

describe("dataState", () => {
  test("is the button's data-state", () => {
    render(<Button title="Pause" dataState="playing" dataTestId="play" />);

    expect(screen.getByTestId("play")).toHaveAttribute("data-state", "playing");
  });
});

describe("a MoreMenu opened from the shared Button", () => {
  const Menu: (props: { isDisabled?: boolean }) => ReactElement = (props: {
    isDisabled?: boolean;
  }): ReactElement => {
    const [picked, setPicked] = useState<string>("");

    return (
      <>
        <MoreMenu
          isDisabled={props.isDisabled}
          elementToBeShownInsteadOfButton={
            <Button
              title="Add a way to reach you"
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.PRIMARY}
              dataTestId="add-first"
            />
          }
        >
          {[
            <MoreMenuItem
              text="Email"
              key="email"
              onClick={() => {
                setPicked("email");
              }}
            />,
          ]}
        </MoreMenu>
        <span data-testid="picked">{picked}</span>
      </>
    );
  };

  test("is the Button itself, with the menu's aria, and opens the menu", () => {
    render(<Menu />);

    const trigger: HTMLElement = screen.getByTestId("add-first");

    // The shared primary Button, not a wrapper around it.
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveClass("bg-indigo-600", "rounded-md");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.parentElement?.getAttribute("role")).not.toBe("button");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu: HTMLElement = screen.getByRole("menu");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);

    fireEvent.click(screen.getByRole("menuitem", { name: "Email" }));

    expect(screen.getByTestId("picked")).toHaveTextContent("email");
  });

  test("a locked menu locks its Button, and a press opens nothing", () => {
    render(<Menu isDisabled={true} />);

    const trigger: HTMLElement = screen.getByTestId("add-first");

    expect(trigger).toBeDisabled();

    fireEvent.click(trigger);

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
