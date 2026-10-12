import "@testing-library/jest-dom";
import DropdownOptionsInput from "../../../../UI/Components/CustomFields/DropdownOptionsInput";
import {
  CustomFieldOptionRename,
  CustomFieldOptionUsage,
} from "../../../../Types/CustomField/CustomFieldOptionEdit";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../UI/Components/Forms/Fields/ColorPicker", () => {
  interface MockColorPickerProps {
    dataTestId?: string | undefined;
    value?: string | undefined;
    onChange: (value: { toString: () => string } | null) => void;
  }

  const MockColorPicker: React.FunctionComponent<MockColorPickerProps> = (
    props: MockColorPickerProps,
  ): React.ReactElement => {
    return (
      <input
        data-testid={props.dataTestId}
        value={props.value || ""}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          const value: string = event.target.value;
          props.onChange(
            value
              ? {
                  toString: () => {
                    return value;
                  },
                }
              : null,
          );
        }}
      />
    );
  };

  return {
    __esModule: true,
    default: MockColorPicker,
  };
});

/*
 * Editing the options of a saved dropdown field (#4564), in the option
 * editor itself: what it reports to be sent with the save (the renames), and
 * what it says on screen about each change - how many incidents a rename
 * moves, which options taken out records still hold, a value no longer
 * offered that can be moved onto an option, Undo. The order is changed by
 * dragging the grips, here from the keyboard (Space, arrows, Space), the way
 * react-beautiful-dnd moves rows in jsdom. Without onRenamesChange - a new
 * field, a form's own question - the editor is a plain list.
 */

const SAVED: string = JSON.stringify([
  { value: "Facility A", color: "#ef4444" },
  { value: "Facility B" },
  { value: "Facility C", color: "#16a34a" },
]);

const USAGE: CustomFieldOptionUsage = {
  values: [
    { value: "Facility A", count: 12 },
    { value: "Facility B", count: 1 },
    { value: "Old Site", count: 3 },
  ],
  copiedBy: [],
};

const SPACE: { keyCode: number; key: string } = { keyCode: 32, key: " " };
const ARROW_DOWN: { keyCode: number; key: string } = {
  keyCode: 40,
  key: "ArrowDown",
};
const ARROW_UP: { keyCode: number; key: string } = {
  keyCode: 38,
  key: "ArrowUp",
};

type JestMock = ReturnType<typeof jest.fn>;

let onChange: JestMock;
let onRenamesChange: JestMock;

beforeEach(() => {
  onChange = jest.fn();
  onRenamesChange = jest.fn();
});

afterEach(() => {
  cleanup();
});

function renderEditor(
  props: Partial<React.ComponentProps<typeof DropdownOptionsInput>> = {},
): UserEvent {
  render(
    <DropdownOptionsInput
      initialValue={SAVED}
      onChange={onChange as never}
      onRenamesChange={onRenamesChange as never}
      usage={USAGE}
      recordName={{ singular: "Incident", plural: "Incidents" }}
      {...props}
    />,
  );

  return userEvent.setup({ delay: null });
}

function lastRenames(): Array<CustomFieldOptionRename> {
  const calls: Array<Array<unknown>> = onRenamesChange.mock.calls;
  return (calls[calls.length - 1]?.[0] || []) as Array<CustomFieldOptionRename>;
}

function lastValue(): string {
  const calls: Array<Array<unknown>> = onChange.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? "");
}

function optionInput(index: number): HTMLInputElement {
  return screen.getByTestId(
    `dropdown-option-value-${index}`,
  ) as HTMLInputElement;
}

function rowTexts(): Array<string> {
  return screen
    .getAllByTestId(/^dropdown-option-value-\d+$/)
    .map((input: HTMLElement): string => {
      return (input as HTMLInputElement).value;
    });
}

function removeRow(index: number): void {
  fireEvent.click(
    within(screen.getByTestId(`dropdown-option-row-${index}`)).getByRole(
      "button",
      { name: "Remove" },
    ),
  );
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, ms);
    });
  });
}

async function press(
  element: HTMLElement,
  key: { keyCode: number; key: string },
): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(element, key);
  });
  await wait(30);
}

// Picks the option at `from` up by its grip, moves it, drops it.
async function dragFromKeyboard(from: number, steps: number): Promise<void> {
  const grip: HTMLElement = screen.getAllByTestId("drag-handle")[from]!;
  grip.focus();

  await press(grip, SPACE);

  for (let index: number = 0; index < Math.abs(steps); index++) {
    await press(grip, steps < 0 ? ARROW_UP : ARROW_DOWN);
  }

  await press(grip, SPACE);
  await wait(400);
}

describe("the rows of a saved field", () => {
  test("open with the saved options, each with its grip named after it, and report nothing", () => {
    renderEditor();

    expect(rowTexts()).toEqual(["Facility A", "Facility B", "Facility C"]);
    expect(
      screen.getAllByTestId("drag-handle").map((grip: HTMLElement) => {
        return grip.getAttribute("aria-label");
      }),
    ).toEqual([
      "Drag to reorder Facility A",
      "Drag to reorder Facility B",
      "Drag to reorder Facility C",
    ]);
    expect(onChange).not.toHaveBeenCalled();
    expect(onRenamesChange).not.toHaveBeenCalled();
  });

  test("an empty row's grip is named by its place", () => {
    renderEditor({ initialValue: "" });

    expect(screen.getByTestId("drag-handle")).toHaveAttribute(
      "aria-label",
      "Drag to reorder Option 1",
    );
  });
});

describe("reordering", () => {
  test("dragging an option from the keyboard changes the order saved, and renames nothing", async () => {
    renderEditor();

    await dragFromKeyboard(0, 2);

    await waitFor(() => {
      expect(rowTexts()).toEqual(["Facility B", "Facility C", "Facility A"]);
    });
    expect(JSON.parse(lastValue())).toEqual([
      { value: "Facility B" },
      { value: "Facility C", color: "#16a34a" },
      { value: "Facility A", color: "#ef4444" },
    ]);
    expect(onRenamesChange).not.toHaveBeenCalled();
  });

  test("an option dragged up keeps its color and its rename", async () => {
    renderEditor();

    fireEvent.change(optionInput(2), { target: { value: "Facility Gamma" } });
    await dragFromKeyboard(2, -2);

    await waitFor(() => {
      expect(rowTexts()).toEqual([
        "Facility Gamma",
        "Facility A",
        "Facility B",
      ]);
    });
    expect(JSON.parse(lastValue())[0]).toEqual({
      value: "Facility Gamma",
      color: "#16a34a",
    });
    expect(lastRenames()).toEqual([
      { from: "Facility C", to: "Facility Gamma" },
    ]);
    expect(screen.getByTestId("dropdown-option-renamed-0")).toHaveTextContent(
      'Renamed from "Facility C".',
    );
  });
});

describe("renaming", () => {
  test("says what an option was renamed from and how many incidents will show the new name", async () => {
    renderEditor();

    fireEvent.change(optionInput(0), { target: { value: "Facility Alpha" } });

    expect(screen.getByTestId("dropdown-option-renamed-0")).toHaveTextContent(
      'Renamed from "Facility A": 12 incidents will show the new name.',
    );

    await waitFor(() => {
      expect(lastRenames()).toEqual([
        { from: "Facility A", to: "Facility Alpha" },
      ]);
    });
  });

  test("one incident is one incident", () => {
    renderEditor();

    fireEvent.change(optionInput(1), { target: { value: "Facility Beta" } });

    expect(screen.getByTestId("dropdown-option-renamed-1")).toHaveTextContent(
      'Renamed from "Facility B": 1 incident will show the new name.',
    );
  });

  test("without counts, or with none holding it, the rename is said without a count", () => {
    renderEditor({ usage: null });

    fireEvent.change(optionInput(0), { target: { value: "Facility Alpha" } });

    expect(screen.getByTestId("dropdown-option-renamed-0")).toHaveTextContent(
      'Renamed from "Facility A".',
    );
  });

  test("without the records' name, they are items", () => {
    renderEditor({ recordName: undefined });

    fireEvent.change(optionInput(0), { target: { value: "Facility Alpha" } });

    expect(screen.getByTestId("dropdown-option-renamed-0")).toHaveTextContent(
      'Renamed from "Facility A": 12 items will show the new name.',
    );
  });

  test("typing the old text back takes the rename away", async () => {
    renderEditor();

    fireEvent.change(optionInput(0), { target: { value: "Facility Alpha" } });
    await waitFor(() => {
      expect(lastRenames()).toHaveLength(1);
    });

    fireEvent.change(optionInput(0), { target: { value: "Facility A " } });

    await waitFor(() => {
      expect(lastRenames()).toEqual([]);
    });
    expect(screen.queryByTestId("dropdown-option-renamed-0")).toBeNull();
  });

  test("a new option is no rename, whatever it is called", async () => {
    const user: UserEvent = renderEditor();

    await user.click(screen.getByRole("button", { name: "Add Option" }));
    fireEvent.change(optionInput(3), { target: { value: "Facility D" } });

    await waitFor(() => {
      expect(JSON.parse(lastValue())).toHaveLength(4);
    });
    expect(onRenamesChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dropdown-option-renamed-3")).toBeNull();
  });

  test("two options of the same name are both pointed out, and no rename is hinted", () => {
    renderEditor();

    fireEvent.change(optionInput(0), { target: { value: "Facility B" } });

    expect(screen.getByTestId("dropdown-option-duplicate-0")).toHaveTextContent(
      "Another option has this name. Each option needs its own.",
    );
    expect(screen.getByTestId("dropdown-option-duplicate-1")).toBeVisible();
    expect(screen.queryByTestId("dropdown-option-renamed-0")).toBeNull();
  });
});

describe("taking options out", () => {
  test("an option records hold is listed with how many keep it, and the list says what happens to them", () => {
    renderEditor();

    removeRow(1);

    const retired: HTMLElement = screen.getByTestId("dropdown-options-retired");

    expect(retired).toHaveTextContent("No longer options");
    expect(retired).toHaveTextContent(
      "Incidents that have these values keep them unless you pick an option for them.",
    );
    expect(screen.getByTestId("dropdown-option-retired-0")).toHaveTextContent(
      "Facility B",
    );
    expect(
      screen.getByTestId("dropdown-option-retired-count-0"),
    ).toHaveTextContent("1 incident has it.");
    expect(
      screen.getByTestId("dropdown-option-retired-count-1"),
    ).toHaveTextContent("3 incidents have it.");
    expect(onRenamesChange).not.toHaveBeenCalled();
  });

  test("Undo puts it back where it was, with its color", async () => {
    renderEditor();

    removeRow(0);
    expect(rowTexts()).toEqual(["Facility B", "Facility C"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Put Facility A back" }),
    );

    expect(rowTexts()).toEqual(["Facility A", "Facility B", "Facility C"]);
    await waitFor(() => {
      expect(JSON.parse(lastValue())).toEqual(JSON.parse(SAVED));
    });
    expect(
      screen.queryByRole("button", { name: "Put Facility A back" }),
    ).toBeNull();
  });

  test("Undo after taking out the last option leaves no blank row behind", () => {
    renderEditor({ initialValue: "Only", usage: null });

    removeRow(0);
    expect(rowTexts()).toEqual([""]);

    fireEvent.click(screen.getByRole("button", { name: "Put Only back" }));

    expect(rowTexts()).toEqual(["Only"]);
  });

  test("an option nobody chose is not listed: taking it out touches nothing", () => {
    renderEditor();

    removeRow(2);

    expect(
      screen.getByTestId("dropdown-options-retired"),
    ).not.toHaveTextContent("Facility C");
  });

  test("without counts, an option taken out is listed anyway, as it may be held", () => {
    renderEditor({ usage: null });

    removeRow(2);

    expect(screen.getByTestId("dropdown-option-retired-0")).toHaveTextContent(
      "Facility C",
    );
    expect(
      screen.getByTestId("dropdown-option-retired-count-0"),
    ).toHaveTextContent(
      "Incidents that have it keep it unless you pick an option for them.",
    );
  });

  test("the records of an option taken out can be moved onto another option", async () => {
    const user: UserEvent = renderEditor();

    removeRow(1);

    await user.click(
      screen.getByRole("combobox", { name: "What happens to Facility B" }),
    );
    await user.click((await screen.findAllByText("Facility C")).pop()!);

    await waitFor(() => {
      expect(lastRenames()).toEqual([{ from: "Facility B", to: "Facility C" }]);
    });
  });

  test("a value no option offered before is listed, and can be tidied onto an option, or kept", async () => {
    const user: UserEvent = renderEditor();

    expect(screen.getByTestId("dropdown-option-retired-0")).toHaveTextContent(
      "Old Site",
    );
    // Nothing to undo: it was not taken out here.
    expect(
      screen.queryByRole("button", { name: "Put Old Site back" }),
    ).toBeNull();

    const choice: HTMLElement = screen.getByRole("combobox", {
      name: "What happens to Old Site",
    });

    await user.click(choice);
    await user.click((await screen.findAllByText("Facility A")).pop()!);

    await waitFor(() => {
      expect(lastRenames()).toEqual([{ from: "Old Site", to: "Facility A" }]);
    });

    await user.click(choice);
    await user.click((await screen.findAllByText("Keep it as it is")).pop()!);

    await waitFor(() => {
      expect(lastRenames()).toEqual([]);
    });
  });

  test("a value moved onto an option follows that option's rename", async () => {
    const user: UserEvent = renderEditor();

    await user.click(
      screen.getByRole("combobox", { name: "What happens to Old Site" }),
    );
    await user.click((await screen.findAllByText("Facility C")).pop()!);

    fireEvent.change(optionInput(2), { target: { value: "Facility Gamma" } });

    await waitFor(() => {
      expect(lastRenames()).toEqual([
        { from: "Facility C", to: "Facility Gamma" },
        { from: "Old Site", to: "Facility Gamma" },
      ]);
    });
  });

  test("a value typed back into the list is offered again, and is no longer listed", () => {
    renderEditor();

    removeRow(1);
    expect(screen.getByTestId("dropdown-option-retired-0")).toHaveTextContent(
      "Facility B",
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Option" }));
    fireEvent.change(optionInput(2), { target: { value: "Facility B" } });

    expect(
      screen.getByTestId("dropdown-options-retired"),
    ).not.toHaveTextContent("Facility B");
  });
});

describe("fields that copy this one", () => {
  test("are named, one line each", () => {
    renderEditor({
      usage: {
        values: [],
        copiedBy: [
          { resource: "Incident", fieldName: "Facility" },
          { resource: "Scheduled Maintenance", fieldName: "Site" },
        ],
      },
    });

    expect(
      screen.getByTestId("dropdown-options-copied-by-0"),
    ).toHaveTextContent(
      'The incident field "Facility" copies this field: options you rename here are renamed there too, and options you add are added to it.',
    );
    expect(
      screen.getByTestId("dropdown-options-copied-by-1"),
    ).toHaveTextContent('The scheduled maintenance field "Site"');
  });
});

describe("a plain list - a new field, a form's own question", () => {
  test("reports no renames and lists nothing as no longer an option", () => {
    render(
      <DropdownOptionsInput
        initialValue={SAVED}
        onChange={onChange as never}
      />,
    );

    fireEvent.change(optionInput(0), { target: { value: "Facility Alpha" } });
    removeRow(1);

    expect(screen.queryByTestId("dropdown-option-renamed-0")).toBeNull();
    expect(screen.queryByTestId("dropdown-options-retired")).toBeNull();
    expect(JSON.parse(lastValue())).toEqual([
      { value: "Facility Alpha", color: "#ef4444" },
      { value: "Facility C", color: "#16a34a" },
    ]);
  });

  test("still drags into order and points out two options of one name", async () => {
    render(
      <DropdownOptionsInput
        initialValue={"Low\nHigh"}
        onChange={onChange as never}
      />,
    );

    await dragFromKeyboard(1, -1);

    await waitFor(() => {
      expect(lastValue()).toBe("High\nLow");
    });

    fireEvent.change(optionInput(0), { target: { value: "Low" } });

    expect(screen.getByTestId("dropdown-option-duplicate-0")).toBeVisible();
  });
});
