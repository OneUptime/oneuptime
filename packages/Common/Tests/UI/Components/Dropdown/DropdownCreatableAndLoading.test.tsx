import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "../../../../UI/Components/Dropdown/Dropdown";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import React from "react";

/*
 * What the shared Dropdown took on for the External Status Page monitor's
 * Components field (issue #5156), each off unless asked for:
 *
 *   - isCreatable: what a person types, when no option has it, is offered
 *     at the foot of the menu (formatCreateLabel words the row) and picked,
 *     is a value drawn as written - never looked up as a translation;
 *   - isLoading and loadingMessage: the options are on their way;
 *   - noOptionsMessage: what the open menu says when nothing matches;
 *   - onMenuOpen: a list read only once it is needed, and onMenuClose:
 *     what the open list lay over can show again.
 */

type OnChange = (value: DropdownValue | Array<DropdownValue> | null) => void;

const OPTIONS: Array<DropdownOption> = [
  { value: "Git Operations", label: "Git Operations", isUserContent: true },
  { value: "Pull Requests", label: "Pull Requests", isUserContent: true },
];

function box(): HTMLElement {
  return screen.getByRole("combobox", { name: "Components" });
}

async function openMenu(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(box(), { key: "ArrowDown" });
  });
}

async function type(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(box(), { target: { value: text } });
  });
}

afterEach(() => {
  cleanup();
});

describe("a creatable multi-select", () => {
  function renderCreatable(
    onChange: OnChange,
    value: Array<DropdownOption> = [],
  ): void {
    render(
      <Dropdown
        ariaLabel="Components"
        isMultiSelect={true}
        isCreatable={true}
        options={OPTIONS}
        value={value}
        formatCreateLabel={(input: string): string => {
          return `Add “${input}”`;
        }}
        onChange={onChange}
      />,
    );
  }

  test("offers to add what was typed, at the foot of the menu, and adds it trimmed", async () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();

    renderCreatable(onChange);
    await openMenu();
    await type("  Webhook  ");

    const add: HTMLElement = screen.getByText("Add “Webhook”");
    const options: Array<HTMLElement> = screen.getAllByRole("option");

    expect(options[options.length - 1]).toContainElement(add);

    await act(async () => {
      fireEvent.mouseDown(add);
      fireEvent.click(add);
    });

    expect(onChange).toHaveBeenLastCalledWith(["Webhook"]);
  });

  test("the added value is drawn as written", async () => {
    const onChange: Mock<OnChange> = jest.fn<OnChange>();

    renderCreatable(onChange);
    await openMenu();
    await type("Probe");
    await act(async () => {
      fireEvent.keyDown(box(), { key: "ArrowUp" });
    });
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter" });
    });

    expect(onChange).toHaveBeenLastCalledWith(["Probe"]);
    expect(screen.getByTestId("dropdown-value-label")).toHaveTextContent(
      /^Probe$/,
    );
  });

  test("never offers to add an option's own name, one already picked, or nothing", async () => {
    renderCreatable(jest.fn<OnChange>(), [
      { value: "Webhooks", label: "Webhooks", isUserContent: true },
    ]);
    await openMenu();

    for (const text of ["git operations", "PULL REQUESTS", "webhooks", "   "]) {
      await type(text);

      expect({ text, offered: screen.queryByText(/^Add “/) }).toEqual({
        text,
        offered: null,
      });
    }
  });
});

describe("a dropdown that is not creatable", () => {
  test("offers nothing to add, as before", async () => {
    render(
      <Dropdown
        ariaLabel="Components"
        isMultiSelect={true}
        options={OPTIONS}
        onChange={(): void => {}}
      />,
    );

    await openMenu();
    await type("Webhook");

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No options")).toBeInTheDocument();
  });
});

describe("the open menu's words", () => {
  test("while the options are on their way: the loading message", async () => {
    render(
      <Dropdown
        ariaLabel="Components"
        options={[]}
        isLoading={true}
        loadingMessage="Loading the components of status.example.com…"
      />,
    );

    await openMenu();

    expect(
      screen.getByText("Loading the components of status.example.com…"),
    ).toBeInTheDocument();
  });

  test("when nothing matches: the message, told what was typed", async () => {
    const noOptionsMessage: Mock<(input: string) => string> = jest.fn(
      (input: string): string => {
        return input ? `Nothing named ${input}.` : "Nothing to pick.";
      },
    );

    render(
      <Dropdown
        ariaLabel="Components"
        options={[]}
        noOptionsMessage={noOptionsMessage}
      />,
    );

    await openMenu();

    expect(screen.getByText("Nothing to pick.")).toBeInTheDocument();

    await type("Copilot");

    expect(screen.getByText("Nothing named Copilot.")).toBeInTheDocument();
  });

  /*
   * A message of the caller's own is a sentence or two: centred line by
   * line, a phone's narrow menu set it as a ragged column ("Could not load
   * the components of status.example.com. Type a component's name...").
   * It starts where the options start; react-select's own short "No
   * options" stays centred, as every other dropdown draws it.
   */
  test("a message of the caller's own starts where the options start; the stock one stays centred", async () => {
    const sentence: string =
      "Could not load the components of status.example.com. Type a component's name as the page shows it, then press Enter.";

    render(
      <Dropdown
        ariaLabel="Components"
        options={[]}
        noOptionsMessage={(): string => {
          return sentence;
        }}
      />,
    );

    await openMenu();

    expect(getComputedStyle(screen.getByText(sentence)).textAlign).toBe(
      "start",
    );

    cleanup();

    render(<Dropdown ariaLabel="Components" options={[]} />);

    await openMenu();

    expect(getComputedStyle(screen.getByText("No options")).textAlign).toBe(
      "center",
    );
  });

  test("the loading line is drawn as the no-options line is, and starts where the options start", async () => {
    render(
      <Dropdown
        ariaLabel="Components"
        options={[]}
        isLoading={true}
        loadingMessage="Loading the components of status.example.com…"
      />,
    );

    await openMenu();

    const loading: HTMLElement = screen.getByText(
      "Loading the components of status.example.com…",
    );

    for (const className of ["px-3", "py-2", "text-sm", "text-gray-500"]) {
      expect(loading).toHaveClass(className);
    }
    expect(getComputedStyle(loading).textAlign).toBe("start");
  });
});

describe("opening the menu", () => {
  test("tells the caller, each time it opens", async () => {
    const onMenuOpen: Mock<() => void> = jest.fn<() => void>();

    render(
      <Dropdown
        ariaLabel="Components"
        options={OPTIONS}
        onMenuOpen={onMenuOpen}
      />,
    );

    expect(onMenuOpen).not.toHaveBeenCalled();

    await openMenu();

    expect(onMenuOpen).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });
    await openMenu();

    expect(onMenuOpen).toHaveBeenCalledTimes(2);
  });

  test("tells the caller when it closes, and not before", async () => {
    const onMenuOpen: Mock<() => void> = jest.fn<() => void>();
    const onMenuClose: Mock<() => void> = jest.fn<() => void>();

    render(
      <Dropdown
        ariaLabel="Components"
        options={OPTIONS}
        onMenuOpen={onMenuOpen}
        onMenuClose={onMenuClose}
      />,
    );

    await openMenu();

    expect(onMenuOpen).toHaveBeenCalledTimes(1);
    expect(onMenuClose).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });

    expect(onMenuClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("a dropdown told nothing of its menu opens and closes as before", async () => {
    render(<Dropdown ariaLabel="Components" options={OPTIONS} />);

    await openMenu();

    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
