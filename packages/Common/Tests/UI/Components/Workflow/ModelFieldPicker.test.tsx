/*
 * A record step's field lists, as the settings dialog draws them
 * (Workflow/ModelFieldPicker): Fields to pass on and Fields to watch.
 *
 * They were "Select Fields" and "Listen on" - two identical lists of 70-odd
 * checkboxes with counters, Select all and a JSON toggle, stacked in one
 * dialog. Now each shows what it holds as chips, says what empty means, and
 * adds fields from one grouped, searchable list. These hold what a builder
 * sees and what the step stores.
 */

import React from "react";

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      getFriendlyMessage: jest.fn((error: unknown) => {
        return error instanceof Error ? error.message : String(error);
      }),
    },
  };
});

// The code editor does not run under jsdom; the box only has to hold text.
jest.mock("../../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: {
      value?: string;
      onChange?: (value: string) => void;
    }): React.ReactElement => {
      return (
        <textarea
          data-testid="code-editor"
          value={props.value || ""}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import { ADD_FIELDS_LIST_MAX_HEIGHT } from "../../../../UI/Components/Workflow/FieldPicker/AddFieldsPanel";
import ModelFieldPicker, {
  FieldPickerMode,
} from "../../../../UI/Components/Workflow/ModelFieldPicker";
import API from "../../../../UI/Utils/API/API";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  AA_TEXT_CONTRAST,
  PAGE_TEXT_CLASS,
  WrittenWords,
  contrastOf,
  unreadableWords,
  wordsIn,
} from "../../../Helpers/TailwindContrast";
import { INCIDENT_COLUMNS } from "./FieldPicker/FieldPickerFixture";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";

type ApiGetFunction = () => MockFunction;

const apiGet: ApiGetFunction = (): MockFunction => {
  return API.get as unknown as MockFunction;
};

beforeEach(() => {
  apiGet().mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        tableName: "Incident",
        columns: INCIDENT_COLUMNS,
      } as unknown as JSONObject,
      {},
    ),
  );
});

afterEach(() => {
  apiGet().mockReset();
});

interface Harness {
  onChange: MockFunction;
  // The form's "this field was left": what shows a required list's message.
  onBlur: MockFunction;
  testId: string;
}

interface RenderPickerOptions {
  mode?: FieldPickerMode;
  value?: string | JSONObject | null;
  // What the form found wrong with the list, as it hands it over.
  error?: string | undefined;
}

type RenderPickerFunction = (options: RenderPickerOptions) => Promise<Harness>;

const renderPicker: RenderPickerFunction = async (
  options: RenderPickerOptions,
): Promise<Harness> => {
  const onChange: MockFunction = getJestMockFunction();
  const onBlur: MockFunction = getJestMockFunction();
  const testId: string =
    options.mode === FieldPickerMode.Watch
      ? "fields-to-watch"
      : "fields-to-pass-on";

  render(
    <ModelFieldPicker
      tableName="Incident"
      mode={options.mode}
      initialValue={options.value}
      onChange={(value: string) => {
        onChange(value);
      }}
      onBlur={() => {
        onBlur();
      }}
      error={options.error}
    />,
  );

  await screen.findByTestId(testId);

  return { onChange: onChange, onBlur: onBlur, testId: testId };
};

type ChipsFunction = (testId: string) => Array<string>;

const chips: ChipsFunction = (testId: string): Array<string> => {
  return screen
    .queryAllByTestId(`${testId}-chip`)
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
};

type LastValueFunction = (harness: Harness) => unknown;

const lastValue: LastValueFunction = (harness: Harness): unknown => {
  const calls: Array<Array<unknown>> = harness.onChange.mock.calls;
  const value: unknown = calls[calls.length - 1]?.[0];

  return typeof value === "string" && value ? JSON.parse(value) : value;
};

describe("Fields to pass on", () => {
  test("shows what it passes on as chips, a related record's field by both names", async () => {
    const harness: Harness = await renderPicker({
      value: '{"title": true, "currentIncidentState": {"name": true}}',
    });

    expect(chips(harness.testId)).toEqual([
      "Title",
      "Current Incident State › Name",
    ]);
    // Nothing is rewritten by opening the step.
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  test("empty, it says what to do", async () => {
    const harness: Harness = await renderPicker({ value: "" });

    expect(screen.getByTestId(`${harness.testId}-empty`)).toHaveTextContent(
      "Pick the fields the next steps need.",
    );
  });

  test("Add field opens one grouped list, and a pick adds a chip and keeps it open", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));

    const panel: HTMLElement = screen.getByTestId(`${harness.testId}-panel`);

    expect(screen.getByTestId(`${harness.testId}-search`)).toHaveFocus();
    expect(within(panel).getByText("Main fields")).toBeInTheDocument();
    expect(within(panel).getByText("Related records")).toBeInTheDocument();
    expect(
      within(panel).getByText("Filled in by OneUptime"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`${harness.testId}-option-title`),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByTestId(`${harness.testId}-option-declaredAt`));

    expect(chips(harness.testId)).toEqual(["Title", "Declared At"]);
    expect(lastValue(harness)).toEqual({ title: true, declaredAt: true });
    expect(screen.getByTestId(`${harness.testId}-panel`)).toBeInTheDocument();
    expect(
      screen.getByTestId(`${harness.testId}-chosen-count`),
    ).toHaveTextContent("2 chosen");

    // A second press on a chosen field takes it out again.
    fireEvent.click(screen.getByTestId(`${harness.testId}-option-declaredAt`));
    expect(chips(harness.testId)).toEqual(["Title"]);
  });

  test("a related record opens to its fields, and one of them is passed on inside it", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));

    const state: HTMLElement = screen.getByTestId(
      `${harness.testId}-option-currentIncidentState`,
    );

    expect(state).toHaveAttribute("aria-expanded", "false");
    expect(state).toHaveTextContent("5 fields");

    fireEvent.click(state);

    expect(state).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(
      screen.getByTestId(`${harness.testId}-option-currentIncidentState.name`),
    );

    expect(lastValue(harness)).toEqual({
      title: true,
      currentIncidentState: { name: true },
    });
    expect(state).toHaveTextContent("1 chosen");
  });

  test("the keyboard: arrows walk the list, Enter picks, Escape closes it and returns to Add field", async () => {
    const harness: Harness = await renderPicker({ value: "" });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));

    const search: HTMLElement = screen.getByTestId(`${harness.testId}-search`);

    // Title, then Current Incident State, which Enter opens and Left closes.
    expect(search).toHaveAttribute(
      "aria-activedescendant",
      screen.getByTestId(`${harness.testId}-option-title`).id,
    );

    fireEvent.keyDown(search, { key: "ArrowDown" });

    const state: HTMLElement = screen.getByTestId(
      `${harness.testId}-option-currentIncidentState`,
    );

    expect(search).toHaveAttribute("aria-activedescendant", state.id);

    fireEvent.keyDown(search, { key: "Enter" });
    expect(state).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(search, { key: "ArrowLeft" });
    expect(state).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(search, { key: "ArrowRight" });
    expect(state).toHaveAttribute("aria-expanded", "true");

    // Into its fields, and Left goes back up to the record.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search).toHaveAttribute(
      "aria-activedescendant",
      screen.getByTestId(`${harness.testId}-option-currentIncidentState.name`)
        .id,
    );
    fireEvent.keyDown(search, { key: "ArrowLeft" });
    expect(search).toHaveAttribute("aria-activedescendant", state.id);

    // Nothing was picked by walking.
    expect(harness.onChange).not.toHaveBeenCalled();

    fireEvent.change(search, { target: { value: "desc" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(chips(harness.testId)).toEqual(["Description"]);

    const outer: MockFunction = getJestMockFunction();
    document.addEventListener("keydown", outer as unknown as EventListener);

    try {
      fireEvent.keyDown(search, { key: "Escape" });
    } finally {
      document.removeEventListener(
        "keydown",
        outer as unknown as EventListener,
      );
    }

    expect(screen.queryByTestId(`${harness.testId}-panel`)).toBeNull();
    expect(screen.getByTestId(`${harness.testId}-add`)).toHaveFocus();
    // Escape closed the list, not the dialog around it.
    expect(outer).not.toHaveBeenCalled();
  });

  test("a search with no match says so", async () => {
    const harness: Harness = await renderPicker({ value: "" });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));
    fireEvent.change(screen.getByTestId(`${harness.testId}-search`), {
      target: { value: "zzzz" },
    });

    expect(screen.getByTestId(`${harness.testId}-no-match`)).toHaveTextContent(
      "No fields match “zzzz”.",
    );
  });

  test("a chip's remove button takes the field out, and the focus moves to the next one", async () => {
    const harness: Harness = await renderPicker({
      value: { title: true, description: true, declaredAt: true },
    });

    const removes: Array<HTMLElement> = screen.getAllByTestId(
      `${harness.testId}-remove`,
    );

    expect(removes[1]).toHaveAccessibleName("Remove Description");

    fireEvent.click(removes[1]!);

    expect(chips(harness.testId)).toEqual(["Title", "Declared At"]);
    expect(lastValue(harness)).toEqual({ title: true, declaredAt: true });

    await waitFor(() => {
      expect(
        screen.getAllByTestId(`${harness.testId}-remove`)[1],
      ).toHaveFocus();
    });
  });

  /*
   * The press that comes the moment the chips are drawn, before React has
   * run that render's effects. Where the focus goes used to be a ref an
   * effect read: the effect still waiting from the render before read it
   * first, put the focus on the very chip being removed, and the focus was
   * left on nothing. It showed as a test that failed once in a long while.
   */
  test("a chip removed the moment the chips are drawn still hands the focus on", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const pressed: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        const observer: MutationObserver = new MutationObserver((): void => {
          const removes: NodeListOf<HTMLElement> =
            document.querySelectorAll<HTMLElement>(
              '[data-testid="fields-to-pass-on-remove"]',
            );

          if (removes.length === 3) {
            observer.disconnect();
            // Description, the middle one of three.
            removes[1]!.click();
            resolve();
          }
        });

        observer.observe(document.body, { childList: true, subtree: true });
      },
    );

    render(
      <ModelFieldPicker
        tableName="Incident"
        initialValue={{ title: true, description: true, declaredAt: true }}
        onChange={(value: string) => {
          onChange(value);
        }}
      />,
    );

    await pressed;

    await waitFor(() => {
      expect(chips("fields-to-pass-on")).toEqual(["Title", "Declared At"]);
    });

    await waitFor(() => {
      expect(
        screen.getAllByTestId("fields-to-pass-on-remove")[1],
      ).toHaveFocus();
    });
    expect(
      screen.getAllByTestId("fields-to-pass-on-remove")[1],
    ).toHaveAccessibleName("Remove Declared At");
  });

  test("taking every field out stores nothing, which the form reads as not filled in", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-remove`));

    expect(harness.onChange).toHaveBeenLastCalledWith("");

    await waitFor(() => {
      expect(screen.getByTestId(`${harness.testId}-add`)).toHaveFocus();
    });
  });

  test("a field the record does not have is a warning chip, and can be removed", async () => {
    const harness: Harness = await renderPicker({
      value: { title: true, nonsense: true },
    });

    const chip: HTMLElement = screen
      .getAllByTestId(`${harness.testId}-chip`)
      .find((candidate: HTMLElement): boolean => {
        return candidate.getAttribute("data-path") === "nonsense";
      })!;

    expect(chip).toHaveAttribute("data-unknown", "true");
    expect(chip).toHaveAttribute(
      "title",
      "There is no field called “nonsense”, so the run leaves it out.",
    );

    fireEvent.click(within(chip).getByRole("button"));

    expect(lastValue(harness)).toEqual({ title: true });
  });

  test("Edit as JSON shows the value, and Back to the list reads what was typed", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-edit-json`));

    const editor: HTMLElement = screen.getByTestId("code-editor");

    expect(
      screen.getByText(
        'Keys are the field names, such as "title". The ID is "_id".',
      ),
    ).toBeInTheDocument();

    fireEvent.change(editor, {
      target: { value: '{"title": true, "description": true}' },
    });

    expect(harness.onChange).toHaveBeenLastCalledWith(
      '{"title": true, "description": true}',
    );

    fireEvent.click(screen.getByTestId(`${harness.testId}-back-to-list`));

    expect(chips(harness.testId)).toEqual(["Title", "Description"]);
  });

  test("a value the list cannot show is kept as JSON, with the reasons, until started over", async () => {
    const harness: Harness = await renderPicker({
      value: { currentIncidentState: true, title: "yes" },
    });

    const kept: HTMLElement = screen.getByTestId(
      `${harness.testId}-kept-as-json`,
    );

    expect(kept).toHaveTextContent("Kept as JSON");
    expect(kept).toHaveTextContent(
      "“currentIncidentState” passes on the whole related record.",
    );
    expect(kept).toHaveTextContent("“title” has an unexpected value.");
    expect(harness.onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(`${harness.testId}-start-over`));

    expect(harness.onChange).toHaveBeenLastCalledWith("");
    expect(screen.getByTestId(harness.testId)).toHaveAttribute(
      "data-view",
      "list",
    );
  });

  test("fields that could not be loaded leave the JSON, and say why", async () => {
    apiGet().mockReset();
    apiGet().mockRejectedValue(new Error("Network unreachable"));

    const harness: Harness = await renderPicker({ value: { title: true } });

    expect(
      screen.getByTestId(`${harness.testId}-load-error`),
    ).toHaveTextContent(
      "Could not load the fields, so they are shown as JSON: Network unreachable",
    );
    expect(screen.getByTestId("code-editor")).toHaveValue(
      JSON.stringify({ title: true }, null, 2),
    );
  });

  test("says it is loading until the fields are in", () => {
    apiGet().mockReset();
    apiGet().mockReturnValue(new Promise(() => {}));

    render(<ModelFieldPicker tableName="Incident" onChange={(): void => {}} />);

    expect(screen.getByTestId("fields-to-pass-on-loading")).toHaveTextContent(
      "Loading the fields…",
    );
  });
});

/*
 * What a real browser showed and jsdom's one-event clicks do not: a press is
 * a mousedown, a change of focus and then a click, and each of the three
 * reaches the list.
 */
describe("opening and closing the Add field list", () => {
  type PressFunction = (harness: Harness) => void;

  // A press on Add field, as a browser delivers it.
  const pressAddField: PressFunction = (harness: Harness): void => {
    const add: HTMLElement = screen.getByTestId(`${harness.testId}-add`);
    const search: HTMLElement | null = screen.queryByTestId(
      `${harness.testId}-search`,
    );

    fireEvent.mouseDown(add);

    if (search && document.activeElement === search) {
      // The button takes the focus from the search box.
      fireEvent.blur(search, { relatedTarget: add });
      add.focus();
    }

    fireEvent.mouseUp(add);
    fireEvent.click(add);
  };

  test("a second press on Add field closes the list, and a third opens it again", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    pressAddField(harness);
    expect(screen.getByTestId(`${harness.testId}-panel`)).toBeInTheDocument();
    expect(screen.getByTestId(`${harness.testId}-add`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // It used to close on the press and open again on its click.
    pressAddField(harness);
    expect(screen.queryByTestId(`${harness.testId}-panel`)).toBeNull();
    expect(screen.getByTestId(`${harness.testId}-add`)).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    pressAddField(harness);
    expect(screen.getByTestId(`${harness.testId}-panel`)).toBeInTheDocument();
  });

  test("a press anywhere else closes it, and the focus stays where the press put it", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    pressAddField(harness);
    fireEvent.mouseDown(document.body);
    fireEvent.mouseUp(document.body);

    await waitFor(() => {
      expect(screen.queryByTestId(`${harness.testId}-panel`)).toBeNull();
    });
    expect(screen.getByTestId(`${harness.testId}-add`)).not.toHaveFocus();
  });

  /*
   * The list is in the page: closing it pulls everything under it up by its
   * height. Closed as the press landed, the button being pressed - Edit as
   * JSON right under it, the other list's Add field, a chip's remove - was
   * gone from under the pointer before the release, and its click never
   * came. So the list waits for the press to be over.
   */
  test("it is still there while the press that closes it is down, so what is pressed stays put", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    pressAddField(harness);

    const editJson: HTMLElement = screen.getByTestId(
      `${harness.testId}-edit-json`,
    );
    const search: HTMLElement = screen.getByTestId(`${harness.testId}-search`);

    // The press lands, and takes the focus from the search box.
    fireEvent.mouseDown(editJson);
    fireEvent.blur(search, { relatedTarget: editJson });

    expect(screen.getByTestId(`${harness.testId}-panel`)).toBeInTheDocument();
    expect(editJson).toBeInTheDocument();

    // Released: the click is Edit as JSON's, on the first press.
    fireEvent.mouseUp(editJson);
    fireEvent.click(editJson);

    expect(screen.getByTestId(harness.testId)).toHaveAttribute(
      "data-view",
      "json",
    );
    expect(screen.queryByTestId(`${harness.testId}-panel`)).toBeNull();
  });

  test("a press that is held does not close it; the release does", async () => {
    jest.useFakeTimers();

    try {
      const harness: Harness = await renderPicker({ value: { title: true } });

      pressAddField(harness);
      fireEvent.mouseDown(document.body);

      // Held, however long.
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(screen.getByTestId(`${harness.testId}-panel`)).toBeInTheDocument();

      fireEvent.mouseUp(document.body);
      act(() => {
        jest.advanceTimersByTime(1);
      });

      expect(screen.queryByTestId(`${harness.testId}-panel`)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test("a press on another list's chip under it takes that chip, on the first press", async () => {
    // Two lists in one dialog, as the On Update trigger has them.
    const onChangeWatch: MockFunction = getJestMockFunction();
    const onChangePassOn: MockFunction = getJestMockFunction();

    render(
      <div>
        <ModelFieldPicker
          tableName="Incident"
          mode={FieldPickerMode.Watch}
          initialValue={{ title: true }}
          onChange={(value: string) => {
            onChangeWatch(value);
          }}
        />
        <ModelFieldPicker
          tableName="Incident"
          mode={FieldPickerMode.PassOn}
          initialValue={{ title: true, description: true }}
          onChange={(value: string) => {
            onChangePassOn(value);
          }}
        />
      </div>,
    );

    await screen.findByTestId("fields-to-watch");
    await screen.findByTestId("fields-to-pass-on");

    fireEvent.click(screen.getByTestId("fields-to-watch-add"));
    expect(screen.getByTestId("fields-to-watch-panel")).toBeInTheDocument();

    const remove: HTMLElement = screen.getAllByTestId(
      "fields-to-pass-on-remove",
    )[0]!;

    fireEvent.mouseDown(remove);
    // Still open under the press: nothing has moved.
    expect(screen.getByTestId("fields-to-watch-panel")).toBeInTheDocument();
    fireEvent.mouseUp(remove);
    fireEvent.click(remove);

    expect(onChangePassOn).toHaveBeenLastCalledWith(
      JSON.stringify({ description: true }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("fields-to-watch-panel")).toBeNull();
    });
  });

  test("a press on the other list's Add field opens that list and closes this one", async () => {
    render(
      <div>
        <ModelFieldPicker
          tableName="Incident"
          mode={FieldPickerMode.Watch}
          initialValue={{ title: true }}
          onChange={getJestMockFunction()}
        />
        <ModelFieldPicker
          tableName="Incident"
          mode={FieldPickerMode.PassOn}
          initialValue={{ title: true }}
          onChange={getJestMockFunction()}
        />
      </div>,
    );

    await screen.findByTestId("fields-to-watch");
    await screen.findByTestId("fields-to-pass-on");

    fireEvent.click(screen.getByTestId("fields-to-watch-add"));

    const otherAdd: HTMLElement = screen.getByTestId("fields-to-pass-on-add");

    fireEvent.mouseDown(otherAdd);
    fireEvent.mouseUp(otherAdd);
    fireEvent.click(otherAdd);

    expect(screen.getByTestId("fields-to-pass-on-panel")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId("fields-to-watch-panel")).toBeNull();
    });
    // One list open at a time, and it is the one that was asked for.
    expect(screen.getByTestId("fields-to-pass-on-panel")).toBeInTheDocument();
  });

  test("a press inside it - on a field, on its foot - keeps it open", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    pressAddField(harness);
    fireEvent.mouseDown(screen.getByTestId(`${harness.testId}-option-title`));
    fireEvent.mouseDown(screen.getByTestId(`${harness.testId}-chosen-count`));

    expect(screen.getByTestId(`${harness.testId}-panel`)).toBeInTheDocument();
  });

  test("the focus moving on past it closes it; moving within it does not", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    pressAddField(harness);

    const search: HTMLElement = screen.getByTestId(`${harness.testId}-search`);
    const done: HTMLElement = screen.getByTestId(`${harness.testId}-done`);

    fireEvent.blur(search, { relatedTarget: done });
    expect(screen.getByTestId(`${harness.testId}-panel`)).toBeInTheDocument();

    // Tab, on past Done: no press is down, so it closes as the keys move on.
    fireEvent.blur(done, {
      relatedTarget: screen.getByTestId(`${harness.testId}-edit-json`),
    });
    await waitFor(() => {
      expect(screen.queryByTestId(`${harness.testId}-panel`)).toBeNull();
    });
  });

  test.each(["done", "close", "list"])(
    "Escape with the focus on its %s closes the list, and is not the dialog's to hear",
    async (part: string) => {
      const harness: Harness = await renderPicker({ value: { title: true } });
      const outer: MockFunction = getJestMockFunction();

      pressAddField(harness);
      document.addEventListener("keydown", outer as unknown as EventListener);

      let wasLeftAlone: boolean = true;

      try {
        // False when the key was answered here: the dialog checks for that.
        wasLeftAlone = fireEvent.keyDown(
          screen.getByTestId(`${harness.testId}-${part}`),
          { key: "Escape" },
        );
      } finally {
        document.removeEventListener(
          "keydown",
          outer as unknown as EventListener,
        );
      }

      expect(wasLeftAlone).toBe(false);
      expect(outer).not.toHaveBeenCalled();
      expect(screen.queryByTestId(`${harness.testId}-panel`)).toBeNull();
      expect(screen.getByTestId(`${harness.testId}-add`)).toHaveFocus();
    },
  );

  test("Escape with the focus back on Add field, or on a chip, closes the list too", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    for (const part of ["add", "remove"]) {
      pressAddField(harness);
      expect(screen.getByTestId(`${harness.testId}-panel`)).toBeInTheDocument();

      const wasLeftAlone: boolean = fireEvent.keyDown(
        screen.getByTestId(`${harness.testId}-${part}`),
        { key: "Escape" },
      );

      expect({ part, wasLeftAlone }).toEqual({ part, wasLeftAlone: false });
      expect(screen.queryByTestId(`${harness.testId}-panel`)).toBeNull();
      expect(screen.getByTestId(`${harness.testId}-add`)).toHaveFocus();
    }
  });

  test("with no list open, Escape is the dialog's: the field leaves it alone", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });
    const outer: MockFunction = getJestMockFunction();

    document.addEventListener("keydown", outer as unknown as EventListener);

    let wasLeftAlone: boolean = false;

    try {
      wasLeftAlone = fireEvent.keyDown(
        screen.getByTestId(`${harness.testId}-add`),
        { key: "Escape" },
      );
    } finally {
      document.removeEventListener(
        "keydown",
        outer as unknown as EventListener,
      );
    }

    expect(wasLeftAlone).toBe(true);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  test("any other key on Done is Done's own", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    pressAddField(harness);

    expect(
      fireEvent.keyDown(screen.getByTestId(`${harness.testId}-done`), {
        key: "Enter",
      }),
    ).toBe(true);
    expect(screen.getByTestId(`${harness.testId}-panel`)).toBeInTheDocument();
  });
});

describe("where the Add field list lands when it opens", () => {
  type ScrollIntoViewFunction = typeof Element.prototype.scrollIntoView;

  const original: ScrollIntoViewFunction | undefined =
    Element.prototype.scrollIntoView;
  let scrolled: Array<{ testId: string | null; options: unknown }> = [];

  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function (
      this: Element,
      options?: boolean | ScrollIntoViewOptions,
    ): void {
      scrolled.push({
        testId: this.getAttribute("data-testid"),
        options: options,
      });
    };
  });

  afterEach(() => {
    if (original) {
      Element.prototype.scrollIntoView = original;
    } else {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  test("the whole list is brought into view - down to Done - and no further than it needs", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));

    // The list first, then the row the keyboard is on, which is in it.
    expect(scrolled[0]).toEqual({
      testId: `${harness.testId}-panel`,
      options: { block: "nearest" },
    });
    expect(scrolled[1]).toEqual({
      testId: `${harness.testId}-option-title`,
      options: { block: "nearest" },
    });
  });

  test("a pick that adds a chip above it brings it back into view; walking the list does not", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));

    type PanelScrollsFunction = () => number;

    const panelScrolls: PanelScrollsFunction = (): number => {
      return scrolled.filter(
        (call: { testId: string | null; options: unknown }): boolean => {
          return call.testId === `${harness.testId}-panel`;
        },
      ).length;
    };

    expect(panelScrolls()).toBe(1);

    // The keys move the row they are on, never the list itself.
    fireEvent.keyDown(screen.getByTestId(`${harness.testId}-search`), {
      key: "ArrowDown",
    });
    fireEvent.change(screen.getByTestId(`${harness.testId}-search`), {
      target: { value: "de" },
    });

    expect(panelScrolls()).toBe(1);

    fireEvent.click(screen.getByTestId(`${harness.testId}-option-declaredAt`));

    expect(chips(harness.testId)).toEqual(["Title", "Declared At"]);
    expect(panelScrolls()).toBe(2);

    // Taking one out can pull the list up: it is kept in view then too.
    fireEvent.click(screen.getByTestId(`${harness.testId}-option-declaredAt`));

    expect(panelScrolls()).toBe(3);
  });

  test("its height is on the element, so it is right the moment it is measured", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));

    const list: HTMLElement = screen.getByTestId(`${harness.testId}-list`);

    expect(ADD_FIELDS_LIST_MAX_HEIGHT).toBe("18rem");
    expect(list.style.maxHeight).toBe(ADD_FIELDS_LIST_MAX_HEIGHT);
    expect(list.style.overflowY).toBe("auto");
    // Not left to a class the page may not have drawn yet.
    expect(list.className).not.toContain("max-h-");
  });
});

describe("the Add field list where a finger is the pointer", () => {
  type MatchMediaFunction = typeof window.matchMedia;

  const original: MatchMediaFunction | undefined = window.matchMedia;

  type SetPointerFunction = (coarse: boolean) => void;

  const setPointer: SetPointerFunction = (coarse: boolean): void => {
    window.matchMedia = ((query: string): MediaQueryList => {
      return {
        matches: coarse && query === "(pointer: coarse)",
        media: query,
      } as MediaQueryList;
    }) as MatchMediaFunction;
  };

  afterEach(() => {
    if (original) {
      window.matchMedia = original;
    } else {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  test("on a phone it opens for browsing: the search box is not focused, so no keyboard covers the fields", async () => {
    setPointer(true);

    const harness: Harness = await renderPicker({ value: { title: true } });
    const add: HTMLElement = screen.getByTestId(`${harness.testId}-add`);

    add.focus();
    fireEvent.click(add);

    expect(screen.getByTestId(`${harness.testId}-panel`)).toBeInTheDocument();
    expect(screen.getByTestId(`${harness.testId}-search`)).not.toHaveFocus();
    expect(add).toHaveFocus();

    // A tap on a field still picks it, and the list stays open.
    fireEvent.click(screen.getByTestId(`${harness.testId}-option-declaredAt`));
    expect(chips(harness.testId)).toEqual(["Title", "Declared At"]);
    expect(screen.getByTestId(`${harness.testId}-panel`)).toBeInTheDocument();
  });

  test("with a mouse it opens with the search box focused, ready to type", async () => {
    setPointer(false);

    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));

    expect(screen.getByTestId(`${harness.testId}-search`)).toHaveFocus();
  });
});

describe("a list left with nothing in it", () => {
  test("taking the last field out tells the form at once, so a list that must hold one says so", async () => {
    const harness: Harness = await renderPicker({
      value: { title: true, description: true },
    });

    fireEvent.click(screen.getAllByTestId(`${harness.testId}-remove`)[0]!);

    // One field is left: nothing to say yet.
    expect(harness.onBlur).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(`${harness.testId}-remove`));

    expect(harness.onChange).toHaveBeenLastCalledWith("");
    expect(harness.onBlur).toHaveBeenCalledTimes(1);
  });

  test("unticking the last field in the open list does not: the list is still being picked from", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));
    fireEvent.click(screen.getByTestId(`${harness.testId}-option-title`));

    expect(harness.onChange).toHaveBeenLastCalledWith("");
    expect(harness.onBlur).not.toHaveBeenCalled();
  });

  test("leaving the field tells the form, as leaving any field does", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });
    const add: HTMLElement = screen.getByTestId(`${harness.testId}-add`);

    // To the chip beside it: still inside the field.
    fireEvent.blur(add, {
      relatedTarget: screen.getByTestId(`${harness.testId}-remove`),
    });
    expect(harness.onBlur).not.toHaveBeenCalled();

    fireEvent.blur(add, { relatedTarget: document.body });
    await waitFor(() => {
      expect(harness.onBlur).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * What the form says once the list is left can take a line of its own
   * under it. Said as the press that left the list landed, it pushed what
   * was being pressed down from under the pointer.
   */
  test("left by a press, the form hears of it once the press is over, not as it lands", async () => {
    const harness: Harness = await renderPicker({ value: "" });
    const add: HTMLElement = screen.getByTestId(`${harness.testId}-add`);

    add.focus();

    // The press lands somewhere under the list, and takes the focus.
    fireEvent.mouseDown(document.body);
    fireEvent.blur(add, { relatedTarget: document.body });

    // Still down: nothing has been said, so nothing has moved.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 30);
    });
    expect(harness.onBlur).not.toHaveBeenCalled();

    fireEvent.mouseUp(document.body);

    await waitFor(() => {
      expect(harness.onBlur).toHaveBeenCalledTimes(1);
    });
  });

  test("left by the keyboard, the form hears of it as the keys move on", async () => {
    const harness: Harness = await renderPicker({ value: "" });
    const add: HTMLElement = screen.getByTestId(`${harness.testId}-add`);

    add.focus();
    // Tab: no press is down.
    fireEvent.blur(add, { relatedTarget: document.body });

    await waitFor(() => {
      expect(harness.onBlur).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * What the list says when it must hold a field and holds none. The form's
   * words were "Fields to pass on is required.", for any box left blank -
   * and they came a line below Edit as JSON, away from the list they were
   * about.
   */
  test("it says so in its own words: pick at least one field", async () => {
    const harness: Harness = await renderPicker({
      value: "",
      error: "Fields to pass on is required.",
    });

    const message: HTMLElement = screen.getByTestId("error-message");

    expect(message).toHaveTextContent(/^Pick at least one field\.$/);
    expect(screen.queryByText("Fields to pass on is required.")).toBeNull();
    expect(message).toHaveAttribute("role", "alert");
    expect(message).toHaveClass("text-red-600");
    // The list is drawn as the field in error it is.
    expect(
      screen.getByTestId(`${harness.testId}-chips`).parentElement,
    ).toHaveClass("border-red-300");
  });

  test("the message is on the line under the list, and Edit as JSON at the far end of it", async () => {
    const harness: Harness = await renderPicker({
      value: "",
      error: "Fields to pass on is required.",
    });

    const message: HTMLElement = screen.getByTestId("error-message");
    const editJson: HTMLElement = screen.getByTestId(
      `${harness.testId}-edit-json`,
    );
    const row: HTMLElement = editJson.parentElement as HTMLElement;

    // One row holds both: the message first, the way out to JSON last.
    expect(row).toContainElement(message);
    expect(row).toHaveClass("flex", "items-start", "justify-between");
    expect(
      message.compareDocumentPosition(editJson) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // And the row comes right after the list, with nothing between.
    expect(
      screen.getByTestId(`${harness.testId}-chips`).parentElement
        ?.nextElementSibling,
    ).toBe(row);
    // Edit as JSON keeps to its end however long the message is.
    expect(editJson).toHaveClass("shrink-0");
  });

  test("the line is there without a message too, so nothing moves when one comes", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });
    const editJson: HTMLElement = screen.getByTestId(
      `${harness.testId}-edit-json`,
    );

    expect(screen.queryByTestId("error-message")).toBeNull();
    expect(editJson.parentElement).toHaveClass(
      "flex",
      "items-start",
      "justify-between",
    );
    /*
     * The message is as tall as the link beside it - 20px of words and 4px
     * over them, to the link's 16px and 4px on each side - so the row does
     * not grow when it appears, and what is under the list stays where the
     * pointer is.
     */
    expect(editJson).toHaveClass("py-1", "text-xs");
  });

  test("a message the form has for a list that holds fields is the form's to word", async () => {
    await renderPicker({
      value: { title: true },
      error: "Something only the form knows.",
    });

    expect(screen.getByTestId("error-message")).toHaveTextContent(
      "Something only the form knows.",
    );
  });

  test("picking a field takes the message's reason away; the form says when", async () => {
    const harness: Harness = await renderPicker({
      value: "",
      error: "Fields to pass on is required.",
    });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));
    fireEvent.click(screen.getByTestId(`${harness.testId}-option-title`));

    // The list holds a field now, and tells the form so.
    expect(harness.onChange).toHaveBeenLastCalledWith(
      JSON.stringify({ title: true }),
    );
    // Until the form answers, its own words stand - never "pick at least one".
    expect(screen.getByTestId("error-message")).not.toHaveTextContent(
      "Pick at least one field.",
    );
  });

  test("Fields to watch may be empty, and says nothing of the kind", async () => {
    await renderPicker({ mode: FieldPickerMode.Watch, value: "" });

    expect(screen.queryByTestId("error-message")).toBeNull();
  });
});

/*
 * The lists in the reader's language. The Dashboard words a record's fields
 * in German, so a chip, a row, what a search finds and the order of the
 * list are all the German name - and a related record's field is named from
 * two of them: its chip read "Current Incident State › Name" in English
 * beside a list that said "Aktueller Vorfallsstatus".
 */
describe("in another language", () => {
  const WORDS: Record<string, string> = {
    Title: "Titel",
    Description: "Beschreibung",
    "Current Incident State": "Aktueller Vorfallsstatus",
    "Incident Severity": "Vorfallschweregrad",
    "Declared At": "Erklärt am",
    Color: "Farbe",
    "Long text": "Langer Text",
    Record: "Datensatz",
    "Add field": "Feld hinzufügen",
    "Remove {{field}}": "{{field}} entfernen",
    "Pick at least one field.": "Wählen Sie mindestens ein Feld aus.",
  };

  const german: i18n = createInstance();

  beforeAll(async () => {
    await german.init({
      lng: "de",
      fallbackLng: "de",
      resources: { de: { translation: WORDS } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  type GermanWrapperFunction = (props: {
    children?: React.ReactNode;
  }) => React.ReactElement;

  const GermanWrapper: GermanWrapperFunction = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.ReactElement => {
    return <I18nextProvider i18n={german}>{children}</I18nextProvider>;
  };

  type RenderGermanFunction = (
    value: JSONObject | string,
    error?: string,
  ) => Promise<void>;

  const renderGerman: RenderGermanFunction = async (
    value: JSONObject | string,
    error?: string,
  ): Promise<void> => {
    render(
      <ModelFieldPicker
        tableName="Incident"
        initialValue={value}
        onChange={getJestMockFunction()}
        error={error}
      />,
      { wrapper: GermanWrapper },
    );

    await screen.findByTestId("fields-to-pass-on");
  };

  test("a chip reads in it, a related record's field from both of its names", async () => {
    await renderGerman({
      title: true,
      description: true,
      currentIncidentState: { name: true, color: true },
    });

    expect(chips("fields-to-pass-on")).toEqual([
      "Titel",
      "Beschreibung",
      // Was "Current Incident State › Name": no dictionary holds the pair.
      "Aktueller Vorfallsstatus › Name",
      "Aktueller Vorfallsstatus › Farbe",
    ]);
    expect(
      screen.getAllByTestId("fields-to-pass-on-remove")[2],
    ).toHaveAccessibleName("Aktueller Vorfallsstatus › Name entfernen");
  });

  test("the list names, sorts and types its fields in it", async () => {
    await renderGerman({ title: true });

    fireEvent.click(screen.getByTestId("fields-to-pass-on-add"));

    type NameOfFunction = (path: string) => string;

    const nameOf: NameOfFunction = (path: string): string => {
      return (
        screen
          .getByTestId(`fields-to-pass-on-option-${path}`)
          .querySelector('[data-part="name"]')?.textContent || ""
      );
    };

    expect(nameOf("title")).toBe("Titel");
    expect(nameOf("currentIncidentState")).toBe("Aktueller Vorfallsstatus");
    expect(
      screen
        .getByTestId("fields-to-pass-on-option-title")
        .querySelector('[data-part="kind"]'),
    ).toHaveTextContent("Langer Text");

    // The main fields, the title first, then by the names the list shows.
    const main: Array<string> = [
      "title",
      "currentIncidentState",
      "declaredAt",
      "incidentSeverity",
    ];
    const order: Array<string> = screen
      .getAllByRole("option")
      .map((option: HTMLElement): string => {
        return (option.getAttribute("data-testid") || "").replace(
          "fields-to-pass-on-option-",
          "",
        );
      })
      .filter((path: string): boolean => {
        return main.includes(path);
      });

    expect(order).toEqual(main);
    expect(main.map(nameOf)).toEqual([
      "Titel",
      "Aktueller Vorfallsstatus",
      "Erklärt am",
      "Vorfallschweregrad",
    ]);
  });

  test("a search finds a field by the name on the screen, and still by its key", async () => {
    await renderGerman({ title: true });

    fireEvent.click(screen.getByTestId("fields-to-pass-on-add"));

    const search: HTMLElement = screen.getByTestId("fields-to-pass-on-search");

    type FoundFunction = () => Array<string>;

    const found: FoundFunction = (): Array<string> => {
      return screen
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.querySelector('[data-part="name"]')?.textContent || "";
        });
    };

    fireEvent.change(search, { target: { value: "beschr" } });
    expect(found()[0]).toBe("Beschreibung");

    // Through a related record's German name, to its fields.
    fireEvent.change(search, { target: { value: "vorfallsstatus" } });
    expect(found()[0]).toBe("Aktueller Vorfallsstatus › Name");

    // The key is the same in every language.
    fireEvent.change(search, { target: { value: "description" } });
    expect(found()[0]).toBe("Beschreibung");
  });

  test("a list that must hold a field says so in it", async () => {
    await renderGerman("", "Fields to pass on ist erforderlich.");

    expect(screen.getByTestId("error-message")).toHaveTextContent(
      /^Wählen Sie mindestens ein Feld aus\.$/,
    );
  });

  test("what picking stores is no language's: the keys", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ModelFieldPicker
        tableName="Incident"
        initialValue={{ title: true }}
        onChange={(value: string) => {
          onChange(value);
        }}
      />,
      { wrapper: GermanWrapper },
    );

    await screen.findByTestId("fields-to-pass-on");

    fireEvent.click(screen.getByTestId("fields-to-pass-on-add"));
    fireEvent.click(
      screen.getByTestId("fields-to-pass-on-option-currentIncidentState"),
    );
    fireEvent.click(
      screen.getByTestId("fields-to-pass-on-option-currentIncidentState.name"),
    );

    expect(onChange).toHaveBeenLastCalledWith(
      JSON.stringify({ title: true, currentIncidentState: { name: true } }),
    );
  });
});

describe("Fields to watch", () => {
  test("empty, it says every change runs the workflow", async () => {
    const harness: Harness = await renderPicker({
      mode: FieldPickerMode.Watch,
      value: "",
    });

    expect(screen.getByTestId(`${harness.testId}-empty`)).toHaveTextContent(
      "Every change to the incident runs this workflow.",
    );
  });

  test("a related record reads by its name, and is stored by the column an update changes", async () => {
    const harness: Harness = await renderPicker({
      mode: FieldPickerMode.Watch,
      value: "",
    });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));
    fireEvent.click(
      screen.getByTestId(`${harness.testId}-option-currentIncidentStateId`),
    );

    expect(chips(harness.testId)).toEqual(["Current Incident State"]);
    expect(lastValue(harness)).toEqual({ currentIncidentStateId: true });
  });

  test("the old list's related record is shown as the field it stands for, and stored by it once changed", async () => {
    const harness: Harness = await renderPicker({
      mode: FieldPickerMode.Watch,
      value: { currentIncidentState: { name: true } },
    });

    expect(chips(harness.testId)).toEqual(["Current Incident State"]);
    expect(harness.onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));
    fireEvent.click(screen.getByTestId(`${harness.testId}-option-title`));

    expect(lastValue(harness)).toEqual({
      currentIncidentStateId: true,
      title: true,
    });
  });

  test("offers no related record's own fields and nothing set when a record is created", async () => {
    const harness: Harness = await renderPicker({
      mode: FieldPickerMode.Watch,
      value: "",
    });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));

    const panel: HTMLElement = screen.getByTestId(`${harness.testId}-panel`);

    expect(within(panel).queryByText("Related records")).toBeNull();
    expect(screen.queryByTestId(`${harness.testId}-option-_id`)).toBeNull();
    expect(
      screen.queryByTestId(`${harness.testId}-option-createdAt`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`${harness.testId}-option-incidentNumber`),
    ).toBeNull();
    expect(
      screen.getByTestId(`${harness.testId}-option-labels`),
    ).toBeInTheDocument();
  });
});

/*
 * Every word the two lists ask a reader to read can be read where it is: a
 * chip, the line that says what empty means, a group's name and its hint, a
 * field's name, the line under it and its kind - on the list's white, and on
 * the tint of the row the pointer or the keys are on, where gray-500 would
 * be 4.3:1. A group's hint was gray-400, 2.5:1.
 */
describe("every word of the lists can be read", () => {
  type RootFunction = (harness: Harness) => HTMLElement;

  const root: RootFunction = (harness: Harness): HTMLElement => {
    return screen.getByTestId(harness.testId);
  };

  type OpenWordsFunction = (harness: Harness) => Array<WrittenWords>;

  // The words of the open Add field list.
  const panelWords: OpenWordsFunction = (
    harness: Harness,
  ): Array<WrittenWords> => {
    return wordsIn(
      screen.getByTestId(`${harness.testId}-panel`),
      PAGE_TEXT_CLASS,
    );
  };

  test("what a list holds: chips, a related record's field, a field the record does not have", async () => {
    const harness: Harness = await renderPicker({
      value: {
        title: true,
        oldField: true,
        currentIncidentState: { name: true },
      },
    });

    expect(chips(harness.testId)).toHaveLength(3);
    expect(unreadableWords(root(harness), PAGE_TEXT_CLASS)).toEqual([]);
  });

  test("an empty list, in both: the line that says what empty means", async () => {
    const passOn: Harness = await renderPicker({ value: "" });

    expect(screen.getByTestId(`${passOn.testId}-empty`)).toBeInTheDocument();
    expect(unreadableWords(root(passOn), PAGE_TEXT_CLASS)).toEqual([]);

    const watch: Harness = await renderPicker({
      mode: FieldPickerMode.Watch,
      value: "",
    });

    expect(screen.getByTestId(`${watch.testId}-empty`)).toBeInTheDocument();
    expect(unreadableWords(root(watch), PAGE_TEXT_CLASS)).toEqual([]);
  });

  test("the open Add field list, with a related record opened and the keys on each row in turn", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));
    fireEvent.click(
      screen.getByTestId(`${harness.testId}-option-currentIncidentState`),
    );

    const search: HTMLElement = screen.getByTestId(`${harness.testId}-search`);
    const rows: number = within(
      screen.getByTestId(`${harness.testId}-panel`),
    ).getAllByRole("option").length;

    expect(rows).toBeGreaterThan(15);

    for (let step: number = 0; step < rows; step++) {
      expect({
        step: step,
        unreadable: unreadableWords(root(harness), PAGE_TEXT_CLASS),
      }).toEqual({ step: step, unreadable: [] });

      fireEvent.keyDown(search, { key: "ArrowDown" });
    }
  });

  test("a group's hint is written to be read, beside the group's name", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));

    const hint: WrittenWords | undefined = panelWords(harness).find(
      (written: WrittenWords): boolean => {
        return written.words === "Open one to pick its fields";
      },
    );

    expect(hint).toEqual({
      words: "Open one to pick its fields",
      textClass: "text-gray-500",
      groundClass: "bg-white",
      contrast: 4.8,
    });
    expect(
      screen
        .getByTestId(`${harness.testId}-group-related`)
        .querySelector('[data-part="hint"]'),
    ).toHaveTextContent("Open one to pick its fields");
  });

  test("the line under a field's name is a shade darker on the row the keys are on, and as it was on the others", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));

    type DetailFunction = (path: string) => HTMLElement;

    const detail: DetailFunction = (path: string): HTMLElement => {
      return screen
        .getByTestId(`${harness.testId}-option-${path}`)
        .querySelector('[data-part="detail"]') as HTMLElement;
    };

    type RowFunction = (path: string) => HTMLElement;

    const row: RowFunction = (path: string): HTMLElement => {
      return screen.getByTestId(`${harness.testId}-option-${path}`);
    };

    // The list opens with the keys on its first row, the title: not these.
    expect(detail("declaredAt")).toHaveTextContent(
      "Date and time when this incident was declared.",
    );
    expect(detail("declaredAt")).toHaveClass("text-gray-500");
    // A related record's line says how many fields it has.
    expect(detail("currentIncidentState")).toHaveTextContent(/^\d+ fields$/);
    expect(detail("currentIncidentState")).toHaveClass("text-gray-500");

    // The pointer on one of them.
    fireEvent.mouseMove(row("declaredAt"));

    expect(row("declaredAt")).toHaveClass("bg-indigo-50");
    expect(detail("declaredAt")).toHaveClass("text-gray-600");
    expect(detail("declaredAt")).not.toHaveClass("text-gray-500");
    expect(detail("currentIncidentState")).toHaveClass("text-gray-500");

    for (const path of ["declaredAt", "currentIncidentState"]) {
      expect(contrastOf(detail(path))).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    }

    // And on the other: the first is as it was.
    fireEvent.mouseMove(row("currentIncidentState"));

    expect(detail("declaredAt")).toHaveClass("text-gray-500");
    expect(detail("currentIncidentState")).toHaveClass("text-gray-600");

    for (const path of ["declaredAt", "currentIncidentState"]) {
      expect(contrastOf(detail(path))).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    }
  });

  test("a search with no match, and a value kept as JSON with the reason", async () => {
    const harness: Harness = await renderPicker({ value: { title: true } });

    fireEvent.click(screen.getByTestId(`${harness.testId}-add`));
    fireEvent.change(screen.getByTestId(`${harness.testId}-search`), {
      target: { value: "zzzz" },
    });

    expect(
      screen.getByTestId(`${harness.testId}-no-match`),
    ).toBeInTheDocument();
    expect(unreadableWords(root(harness), PAGE_TEXT_CLASS)).toEqual([]);

    const kept: Harness = await renderPicker({
      mode: FieldPickerMode.Watch,
      value: "not json",
    });

    expect(
      screen.getByTestId(`${kept.testId}-kept-as-json`),
    ).toBeInTheDocument();
    expect(unreadableWords(root(kept), PAGE_TEXT_CLASS)).toEqual([]);
  });
});
