import Button, { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Toggle, {
  TOGGLE_HELP_BUTTON_CLASS_NAME,
  TOGGLE_HELP_BUTTON_FALLBACK_NAME,
  TOGGLE_HELP_BUTTON_NAME_TEMPLATE,
  TOGGLE_HELP_BUTTON_TEST_ID,
  TOGGLE_TITLE_LINE_CLASS_NAME,
} from "../../../UI/Components/Toggle/Toggle";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A LOCKED SWITCH OR BUTTON SAYS WHY ON A TAP.
 *
 * A switch somebody may not change (ModelSwitchRow, the workflow and form
 * switches, the security source cards) keeps its reason behind the help icon
 * after its title; a locked button (every gated card button, Page now, Turn
 * monitoring on) keeps it in a tooltip. Both opened on hover alone, so on a
 * phone a tap showed the reason for a moment and took it away as the finger
 * lifted - Chrome sends mouseleave then - and a locked switch or button just
 * looked broken. Now a press shows the reason and keeps it until the next
 * press, as a locked menu item's does (MoreMenuItemPressToExplain); hover
 * and the keyboard's focus show it as before.
 */

jest.setTimeout(30000);

afterEach(() => {
  cleanup();
});

const LOCK_REASON: string =
  "You need one of these permissions: Project Owner, Project Admin.";

const HELP_TEXT: string =
  "Alerts notify the team but are not shown on the status page.";

// What a finger's tap sends an element, in the order the browser sends it.
function tap(element: HTMLElement): void {
  fireEvent.pointerDown(element);
  fireEvent.mouseOver(element);
  fireEvent.mouseEnter(element);
  fireEvent.mouseDown(element);
  act(() => {
    element.focus();
  });
  fireEvent.pointerUp(element);
  fireEvent.mouseUp(element);
  fireEvent.click(element);
  // The finger lifts: the pointer leaves at once.
  fireEvent.mouseLeave(element);
  fireEvent.mouseOut(element);
}

// Lets Tippy's deferred work run, then says which tooltips are shown.
async function tooltipsShown(): Promise<Array<string>> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
  });

  return screen.queryAllByRole("tooltip").map((tooltip: HTMLElement) => {
    return tooltip.textContent || "";
  });
}

async function expectNoTooltip(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryAllByRole("tooltip")).toHaveLength(0);
  });
}

function lockedSwitch(data?: {
  onChange?: (value: boolean) => void;
  onRowClick?: () => void;
  onRowKey?: () => void;
}): void {
  render(
    <div
      data-testid="row"
      onClick={data?.onRowClick}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Enter" || event.key === " ") {
          data?.onRowKey?.();
        }
      }}
    >
      <Toggle
        title="Show on status page"
        value={true}
        disabled={true}
        tooltip={LOCK_REASON}
        dataTestId="status-page-switch"
        onChange={data?.onChange || ((): void => {})}
      />
    </div>,
  );
}

function helpButton(testId: string = "status-page-switch"): HTMLElement {
  return screen.getByTestId(`${testId}-${TOGGLE_HELP_BUTTON_TEST_ID}`);
}

describe("a locked switch's help icon, on a phone", () => {
  test("is a button, named for the switch and described by the reason", () => {
    lockedSwitch();

    const help: HTMLElement = screen.getByRole("button", {
      name: "About Show on status page",
    });

    expect(help).toBe(helpButton());
    expect(help).toHaveAttribute("type", "button");
    expect(help).toHaveAccessibleDescription(LOCK_REASON);
    // Its look: a 24px target, the help cursor, a focus ring.
    for (const className of TOGGLE_HELP_BUTTON_CLASS_NAME.split(" ")) {
      expect({
        className,
        present: help.classList.contains(className),
      }).toEqual({ className, present: true });
    }
    expect(help).toHaveClass("h-6", "w-6", "cursor-help");
    // The question mark it draws.
    expect(help.querySelector("svg")).not.toBeNull();
  });

  test("a tap says why, and the reason stays once the finger lifts", async () => {
    lockedSwitch();

    tap(helpButton());

    expect(await tooltipsShown()).toEqual([LOCK_REASON]);
  });

  test("a second tap puts the reason away", async () => {
    lockedSwitch();

    tap(helpButton());
    expect(await tooltipsShown()).toEqual([LOCK_REASON]);

    tap(helpButton());
    await expectNoTooltip();
  });

  test("a tap never flips the switch, nor reaches the row around it", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const onRowClick: MockFunction = getJestMockFunction();
    const onRowKey: MockFunction = getJestMockFunction();

    lockedSwitch({ onChange, onRowClick, onRowKey });

    tap(helpButton());
    fireEvent.keyDown(helpButton(), { key: "Enter" });
    fireEvent.keyDown(helpButton(), { key: " " });
    await tooltipsShown();

    expect(onChange).not.toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowKey).not.toHaveBeenCalled();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  test("the switch itself is still described by the reason", () => {
    lockedSwitch();

    expect(
      screen.getByRole("switch", { name: "Show on status page" }),
    ).toHaveAccessibleDescription(LOCK_REASON);
  });

  test("the help icon is not part of the switch's label: pressing it is not pressing the title", () => {
    lockedSwitch();

    expect(helpButton().closest("label")).toBeNull();
  });
});

describe("a switch's help icon, with a mouse and a keyboard", () => {
  test("hovering shows the words and moving away hides them", async () => {
    render(
      <Toggle
        title="When filters match, create an alert"
        value={false}
        tooltip={HELP_TEXT}
        dataTestId="alert-switch"
        onChange={(): void => {}}
      />,
    );

    fireEvent.mouseEnter(helpButton("alert-switch"));
    expect(await tooltipsShown()).toEqual([HELP_TEXT]);

    fireEvent.mouseLeave(helpButton("alert-switch"));
    await expectNoTooltip();
  });

  test("Tab reaches it after the switch, and its focus shows the words", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(
      <Toggle
        title="When filters match, create an alert"
        value={false}
        tooltip={HELP_TEXT}
        dataTestId="alert-switch"
        onChange={(): void => {}}
      />,
    );

    await user.tab();
    expect(screen.getByRole("switch")).toHaveFocus();

    await user.tab();
    expect(helpButton("alert-switch")).toHaveFocus();
    expect(await tooltipsShown()).toEqual([HELP_TEXT]);
  });

  test("a switch with no help has no help button and no extra stop for Tab", () => {
    render(
      <Toggle
        title="When filters match, create an alert"
        value={false}
        dataTestId="alert-switch"
        onChange={(): void => {}}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.queryByTestId(`alert-switch-${TOGGLE_HELP_BUTTON_TEST_ID}`),
    ).toBeNull();
  });

  /*
   * The keyboard's ring is drawn inside the button's 24px square, around the
   * question mark: drawn outside it, 2px from the title, it ran into the
   * title's last letter ("page" under the ring).
   */
  test("the keyboard's ring is drawn inside the button, clear of the title", () => {
    lockedSwitch();

    const tokens: Array<string> = TOGGLE_HELP_BUTTON_CLASS_NAME.split(" ");

    expect(tokens).toEqual(
      expect.arrayContaining([
        "focus-visible:ring-2",
        "focus-visible:ring-inset",
        "focus-visible:ring-indigo-500",
      ]),
    );
    expect(tokens).not.toContain("focus-visible:ring-offset-1");
    expect(tokens).not.toContain("focus-visible:ring-offset-2");
    expect(helpButton()).toHaveClass("focus-visible:ring-inset");
  });

  /*
   * On a phone "When filters match, create an alert" filled its line, and
   * the question mark after it went on to a line of its own. The title's
   * line wraps "pretty": its last word goes down with the button.
   */
  test("a title that wraps takes its last word down with the help button", () => {
    render(
      <Toggle
        title="When filters match, create an alert"
        value={false}
        tooltip={HELP_TEXT}
        dataTestId="alert-switch"
        onChange={(): void => {}}
      />,
    );

    const line: HTMLElement = helpButton("alert-switch").closest(
      "div",
    ) as HTMLElement;
    const title: HTMLElement = screen
      .getByText("When filters match, create an alert")
      .closest("label") as HTMLElement;

    // The title and its button share the one line element...
    expect(line.contains(title)).toBe(true);
    expect(line.className).toBe(TOGGLE_TITLE_LINE_CLASS_NAME);
    // ...which wraps "pretty" (text-wrap: pretty).
    expect(TOGGLE_TITLE_LINE_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["text-sm", "leading-6", "text-pretty"]),
    );
  });
});

describe("the help button's name", () => {
  test("without a test id of the switch's, the button has the plain one", () => {
    render(
      <Toggle
        title="Secret"
        value={false}
        tooltip={HELP_TEXT}
        onChange={(): void => {}}
      />,
    );

    expect(screen.getByTestId(TOGGLE_HELP_BUTTON_TEST_ID)).toHaveAccessibleName(
      "About Secret",
    );
  });

  test("a switch named only for screen readers lends that name", () => {
    render(
      <Toggle
        ariaLabel="Enabled"
        value={false}
        tooltip={HELP_TEXT}
        onChange={(): void => {}}
      />,
    );

    expect(screen.getByTestId(TOGGLE_HELP_BUTTON_TEST_ID)).toHaveAccessibleName(
      "About Enabled",
    );
  });

  test("a switch whose title is not words, with no other name, is Help", () => {
    const title: ReactElement = <strong>Secret</strong>;

    render(
      <Toggle
        title={title}
        value={false}
        tooltip={HELP_TEXT}
        onChange={(): void => {}}
      />,
    );

    expect(screen.getByTestId(TOGGLE_HELP_BUTTON_TEST_ID)).toHaveAccessibleName(
      "Help",
    );
  });

  test("the words it is named with are the shared ones the locales translate", () => {
    expect(TOGGLE_HELP_BUTTON_NAME_TEMPLATE).toBe("About {{label}}");
    expect(TOGGLE_HELP_BUTTON_FALLBACK_NAME).toBe("Help");
  });
});

/*
 * The German, Persian and Japanese values are the shipped ones, copied from
 * App/FeatureSet/Dashboard/src/Locales.
 */
describe("the help button in the reader's language", () => {
  const readers: Array<{
    language: string;
    words: Record<string, string>;
    name: string;
    fallback: string;
  }> = [
    {
      language: "de",
      words: {
        "About {{label}}": "Info zu {{label}}",
        Help: "Hilfe",
        "Show on status page": "Auf der Statusseite anzeigen",
      },
      name: "Info zu Auf der Statusseite anzeigen",
      fallback: "Hilfe",
    },
    {
      language: "fa",
      words: {
        "About {{label}}": "دربارهٔ {{label}}",
        Help: "راهنما",
      },
      // A title the locale has no words for: the sentence stays English.
      name: "دربارهٔ Show on status page",
      fallback: "راهنما",
    },
    {
      language: "ja",
      words: {
        "About {{label}}": "{{label}} について",
        Help: "ヘルプ",
      },
      name: "Show on status page について",
      fallback: "ヘルプ",
    },
  ];

  for (const reader of readers) {
    const instance: i18n = createInstance();

    beforeAll(async () => {
      await instance.init({
        lng: reader.language,
        resources: { [reader.language]: { translation: reader.words } },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });
    });

    test(`in ${reader.language} the button is named in the reader's words`, () => {
      render(
        <I18nextProvider i18n={instance}>
          <Toggle
            title="Show on status page"
            value={true}
            disabled={true}
            tooltip={LOCK_REASON}
            dataTestId="status-page-switch"
            onChange={(): void => {}}
          />
          <Toggle
            title={<span>Secret</span>}
            value={false}
            tooltip={HELP_TEXT}
            dataTestId="secret-switch"
            onChange={(): void => {}}
          />
        </I18nextProvider>,
      );

      expect(helpButton()).toHaveAccessibleName(reader.name);
      expect(helpButton("secret-switch")).toHaveAccessibleName(reader.fallback);
    });
  }
});

describe("a locked button, on a phone", () => {
  function lockedButton(onClick?: () => void): HTMLElement {
    render(
      <Button
        title="Page now"
        buttonStyle={ButtonStyleType.NORMAL}
        disabled={true}
        tooltip={LOCK_REASON}
        dataTestId="page-now"
        onClick={onClick}
      />,
    );

    return screen.getByTestId("page-now-disabled-wrapper");
  }

  test("a tap says why it is locked, and the reason stays once the finger lifts", async () => {
    const onClick: MockFunction = getJestMockFunction();

    tap(lockedButton(onClick));

    expect(await tooltipsShown()).toEqual([LOCK_REASON]);
    // Still locked: the tap did nothing else.
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("page-now")).toBeDisabled();
  });

  test("a second tap puts the reason away", async () => {
    const wrapper: HTMLElement = lockedButton();

    tap(wrapper);
    expect(await tooltipsShown()).toEqual([LOCK_REASON]);

    tap(wrapper);
    await expectNoTooltip();
  });

  test("hovering still shows the reason, and moving away still hides it", async () => {
    const wrapper: HTMLElement = lockedButton();

    fireEvent.mouseEnter(wrapper);
    expect(await tooltipsShown()).toEqual([LOCK_REASON]);

    fireEvent.mouseLeave(wrapper);
    await expectNoTooltip();
  });

  test("a click keeps the reason up while the pointer moves on to read it", async () => {
    const wrapper: HTMLElement = lockedButton();

    fireEvent.mouseEnter(wrapper);
    fireEvent.click(wrapper);
    fireEvent.mouseLeave(wrapper);

    expect(await tooltipsShown()).toEqual([LOCK_REASON]);
  });
});

describe("a busy button is not locked", () => {
  test("its tooltip stays a hover: a tap that ends with the finger lifting leaves nothing up", async () => {
    render(
      <Button
        title="Test connection"
        buttonStyle={ButtonStyleType.NORMAL}
        isLoading={true}
        tooltip="Testing the connection."
        dataTestId="busy"
      />,
    );

    const wrapper: HTMLElement = screen.getByTestId("busy-disabled-wrapper");

    fireEvent.mouseEnter(wrapper);
    fireEvent.click(wrapper);
    fireEvent.mouseLeave(wrapper);

    await expectNoTooltip();
  });
});
