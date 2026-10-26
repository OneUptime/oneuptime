/*
 * The record a record trigger runs with, in the Run Workflow panel
 * (UI/Components/Workflow/RunRecordField): "Instead of UUID can I enter the
 * user-facing incident ID, for convenience?" - a search that lists the newest
 * records, finds them by number or name, and is walked with the keyboard.
 */

import RunRecordField, {
  RUN_RECORD_NUMBER_COLUMN_MAX_CHARACTERS,
  RUN_RECORD_SEARCH_DELAY_MS,
  RunRecordFieldCopy,
  formatRunRecordCreatedAt,
  getExactRunRecord,
  getRunRecordDescription,
  getRunRecordLabel,
  getRunRecordNumberColumnCharacters,
  getRunRecordPickHint,
  getRunRecordPlaceholder,
} from "../../../../UI/Components/Workflow/RunRecordField";
import { LoadRunRecordsFunction } from "../../../../UI/Components/Workflow/RunRecordSource";
import { FeedClock } from "../../../../UI/Components/Feed/FeedTime";
import { createTranslator } from "../../../../UI/Utils/TranslateTemplate";
import ObjectID from "../../../../Types/ObjectID";
import {
  RunRecordEvent,
  RunRecordMatch,
  RunRecordOption,
  RunRecordTriggerInfo,
} from "../../../../Types/Workflow/RunRecord";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  PAGE_TEXT_CLASS,
  WrittenWords,
  unreadableWords,
  wordsIn,
} from "../../../Helpers/TailwindContrast";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import type { Mock } from "jest-mock";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

const NOW: Date = new Date("2026-10-13T12:00:00.000Z");

const INFO: RunRecordTriggerInfo = {
  argument: {
    id: "_id",
    name: "Incident ID",
    description: "",
    required: true,
    type: "Text" as RunRecordTriggerInfo["argument"]["type"],
  },
  event: RunRecordEvent.Created,
  singularName: "Incident",
  pluralName: "Incidents",
  hasNumber: true,
  hasName: true,
};

const EIGHT: RunRecordOption = {
  id: "11111111-1111-4111-8111-111111111111",
  number: "INC-8",
  name: "Database is down",
  createdAt: "2026-10-13T09:30:00.000Z",
  matchedBy: RunRecordMatch.Number,
};

const SEVEN: RunRecordOption = {
  id: "22222222-2222-4222-8222-222222222222",
  number: "INC-7",
  name: "Disk full",
  createdAt: "2026-09-30T08:00:00.000Z",
  matchedBy: RunRecordMatch.Recent,
};

interface LoadCall {
  search: string;
  resolve: (records: Array<RunRecordOption>) => void;
  reject: (error: unknown) => void;
}

interface Harness {
  calls: Array<LoadCall>;
  onChange: Mock<(value: string) => void>;
  onRecordChange: Mock<(record: RunRecordOption | null) => void>;
  value: () => string;
}

interface RenderFieldOptions {
  info?: RunRecordTriggerInfo;
  initialValue?: string;
  autoResolve?: Array<RunRecordOption> | undefined;
  // What the form found wrong with the field, as it hands it over.
  error?: string | undefined;
  // The panel asks for the typing to start here.
  autoFocus?: boolean | undefined;
}

type RenderFieldFunction = (options?: RenderFieldOptions) => Harness;

const renderField: RenderFieldFunction = (
  options?: RenderFieldOptions,
): Harness => {
  const calls: Array<LoadCall> = [];
  const onChange: Mock<(value: string) => void> = jest.fn();
  const onRecordChange: Mock<(record: RunRecordOption | null) => void> =
    jest.fn();
  let current: string = options?.initialValue || "";

  const load: LoadRunRecordsFunction = (data: {
    workflowId: ObjectID;
    search: string;
  }): Promise<Array<RunRecordOption>> => {
    expect(data.workflowId.toString()).toBe(WORKFLOW_ID.toString());

    return new Promise<Array<RunRecordOption>>(
      (
        resolve: (records: Array<RunRecordOption>) => void,
        reject: (error: unknown) => void,
      ) => {
        calls.push({ search: data.search, resolve: resolve, reject: reject });

        if (options?.autoResolve) {
          resolve(options.autoResolve);
        }
      },
    );
  };

  const Host: () => ReactElement = (): ReactElement => {
    const [value, setValue] = useState<string>(current);

    return (
      <RunRecordField
        workflowId={WORKFLOW_ID}
        info={options?.info || INFO}
        value={value}
        onChange={(next: string) => {
          current = next;
          setValue(next);
          onChange(next);
        }}
        onRecordChange={onRecordChange}
        error={options?.error}
        autoFocus={options?.autoFocus}
        load={load}
        now={NOW}
      />
    );
  };

  render(<Host />);

  return {
    calls: calls,
    onChange: onChange,
    onRecordChange: onRecordChange,
    value: (): string => {
      return current;
    },
  };
};

type SearchBoxFunction = () => HTMLInputElement;

const searchBox: SearchBoxFunction = (): HTMLInputElement => {
  return screen.getByTestId("run-record-field-search") as HTMLInputElement;
};

type OptionsFunction = () => Array<HTMLElement>;

const options: OptionsFunction = (): Array<HTMLElement> => {
  return screen.queryAllByTestId("run-record-field-option");
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

type FlushFunction = (ms?: number) => Promise<void>;

const flush: FlushFunction = async (ms: number = 0): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

describe("the record field", () => {
  test("says what it can be searched by", () => {
    renderField();

    expect(searchBox()).toHaveAttribute(
      "placeholder",
      "Search by number or name",
    );
    expect(searchBox()).toHaveAttribute("role", "combobox");
    expect(searchBox()).toHaveAttribute("aria-expanded", "false");
  });

  test("opened with nothing typed, lists the newest records at once", async () => {
    const harness: Harness = renderField();

    fireEvent.focus(searchBox());
    await flush();

    expect(
      harness.calls.map((call: LoadCall) => {
        return call.search;
      }),
    ).toEqual([""]);

    await act(async () => {
      harness.calls[0]!.resolve([EIGHT, SEVEN]);
    });

    expect(searchBox()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Most recent")).toBeInTheDocument();
    expect(options()).toHaveLength(2);
    expect(options()[0]).toHaveTextContent("INC-8");
    expect(options()[0]).toHaveTextContent("Database is down");
    expect(options()[0]).toHaveTextContent("Created Today");
    expect(options()[1]).toHaveTextContent("INC-7");
    expect(options()[1]).toHaveTextContent("Disk full");
  });

  test("typing searches once the typing pauses, and says it is searching", async () => {
    const harness: Harness = renderField();

    fireEvent.focus(searchBox());
    await flush();
    await act(async () => {
      harness.calls[0]!.resolve([SEVEN]);
    });

    fireEvent.change(searchBox(), { target: { value: "INC" } });
    fireEvent.change(searchBox(), { target: { value: "INC-8" } });

    // Still typing: nothing asked yet, and the list says it is searching.
    await flush(RUN_RECORD_SEARCH_DELAY_MS - 50);
    expect(harness.calls).toHaveLength(1);
    expect(screen.getByTestId("run-record-field-searching")).toHaveTextContent(
      "Searching…",
    );

    await flush(60);
    expect(
      harness.calls.map((call: LoadCall) => {
        return call.search;
      }),
    ).toEqual(["", "INC-8"]);
    expect(harness.onChange).toHaveBeenLastCalledWith("INC-8");

    await act(async () => {
      harness.calls[1]!.resolve([EIGHT]);
    });

    expect(options()).toHaveLength(1);
    expect(screen.queryByText("Most recent")).toBeNull();
  });

  /*
   * The list waits for a pause in the typing before it asks. Closed before
   * the pause was over, it had never asked - and went on saying
   * "Searching…" every time the box was opened on the same words.
   */
  test("closed before the pause was over, the list is asked for when the box is opened again", async () => {
    const harness: Harness = renderField({ autoResolve: [EIGHT] });

    type SearchesFunction = () => Array<string>;

    const searches: SearchesFunction = (): Array<string> => {
      return harness.calls.map((call: LoadCall) => {
        return call.search;
      });
    };

    fireEvent.focus(searchBox());
    await flush();
    expect(searches()).toEqual([""]);

    fireEvent.change(searchBox(), { target: { value: "data" } });
    // Left at once: the pause is not over, and nothing asked for "data".
    fireEvent.blur(searchBox(), { relatedTarget: document.body });
    await flush(RUN_RECORD_SEARCH_DELAY_MS + 10);

    expect(searches()).toEqual([""]);
    expect(options()).toHaveLength(0);

    // Opened again on the same words: asked for now, and answered.
    fireEvent.focus(searchBox());
    await flush(RUN_RECORD_SEARCH_DELAY_MS + 10);

    expect(searches()).toEqual(["", "data"]);
    expect(screen.queryByTestId("run-record-field-searching")).toBeNull();
    expect(options()).toHaveLength(1);
  });

  test("typed on before the pause was over, only the last words are asked for", async () => {
    const harness: Harness = renderField({ autoResolve: [EIGHT] });

    fireEvent.focus(searchBox());
    await flush();

    for (const typed of ["d", "da", "dat", "data"]) {
      fireEvent.change(searchBox(), { target: { value: typed } });
      await flush(RUN_RECORD_SEARCH_DELAY_MS / 5);
    }

    await flush(RUN_RECORD_SEARCH_DELAY_MS + 10);

    expect(
      harness.calls.map((call: LoadCall) => {
        return call.search;
      }),
    ).toEqual(["", "data"]);
    expect(screen.queryByTestId("run-record-field-searching")).toBeNull();
    expect(options()).toHaveLength(1);
  });

  test("an older answer never replaces a newer one", async () => {
    const harness: Harness = renderField();

    fireEvent.focus(searchBox());
    await flush();

    fireEvent.change(searchBox(), { target: { value: "dat" } });
    await flush(RUN_RECORD_SEARCH_DELAY_MS + 10);
    fireEvent.change(searchBox(), { target: { value: "INC-8" } });
    await flush(RUN_RECORD_SEARCH_DELAY_MS + 10);

    // The newest answer first, then the stale one.
    await act(async () => {
      harness.calls[harness.calls.length - 1]!.resolve([EIGHT]);
    });
    await act(async () => {
      harness.calls[0]!.resolve([SEVEN]);
      harness.calls[1]?.resolve([SEVEN]);
    });

    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveTextContent("INC-8");
  });

  test("the keyboard walks the list, Enter picks, and the record shows in place of the box", async () => {
    const harness: Harness = renderField({ autoResolve: [EIGHT, SEVEN] });

    fireEvent.focus(searchBox());
    await flush();

    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    expect(searchBox()).toHaveAttribute(
      "aria-activedescendant",
      options()[0]!.id,
    );

    fireEvent.keyDown(searchBox(), { key: "ArrowDown" });
    expect(options()[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(searchBox(), { key: "ArrowDown" });
    expect(options()[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(searchBox(), { key: "ArrowUp" });
    expect(options()[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(harness.value()).toBe(SEVEN.id);
    expect(harness.onRecordChange).toHaveBeenLastCalledWith(SEVEN);

    const picked: HTMLElement = screen.getByTestId("run-record-field-picked");

    expect(picked).toHaveTextContent("INC-7");
    expect(picked).toHaveTextContent("Disk full");
    expect(screen.queryByTestId("run-record-field-search")).toBeNull();
    expect(options()).toHaveLength(0);
  });

  test("a click picks too, and Change goes back to the search", async () => {
    const harness: Harness = renderField({ autoResolve: [EIGHT] });

    fireEvent.focus(searchBox());
    await flush();

    fireEvent.click(options()[0]!);

    expect(harness.value()).toBe(EIGHT.id);

    fireEvent.click(
      within(screen.getByTestId("run-record-field-picked")).getByRole(
        "button",
        {
          name: "Change",
        },
      ),
    );
    await flush();

    expect(harness.value()).toBe("");
    expect(harness.onRecordChange).toHaveBeenLastCalledWith(null);
    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveValue("");
    expect(options()).toHaveLength(1);
  });

  test("Escape closes the list, not the panel around it", async () => {
    const outer: Mock<() => void> = jest.fn();

    document.addEventListener("keydown", outer);

    try {
      renderField({ autoResolve: [EIGHT] });

      fireEvent.focus(searchBox());
      await flush();
      expect(options()).toHaveLength(1);

      fireEvent.keyDown(searchBox(), { key: "Escape" });

      expect(options()).toHaveLength(0);
      expect(outer).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", outer);
    }
  });

  test("leaving the field closes the list", async () => {
    renderField({ autoResolve: [EIGHT] });

    fireEvent.focus(searchBox());
    await flush();
    expect(options()).toHaveLength(1);

    fireEvent.blur(searchBox(), { relatedTarget: document.body });

    expect(options()).toHaveLength(0);
  });

  test("an empty project says there is nothing to pick yet", async () => {
    renderField({ autoResolve: [] });

    fireEvent.focus(searchBox());
    await flush();

    expect(screen.getByTestId("run-record-field-empty")).toHaveTextContent(
      "There are no incidents in this project yet.",
    );
  });

  test("a search that finds nothing says so", async () => {
    renderField({ autoResolve: [] });

    fireEvent.focus(searchBox());
    fireEvent.change(searchBox(), { target: { value: "INC-80" } });
    await flush(RUN_RECORD_SEARCH_DELAY_MS + 10);

    expect(screen.getByTestId("run-record-field-empty")).toHaveTextContent(
      "Nothing matches “INC-80”.",
    );
  });

  test("a refused search shows the server's words", async () => {
    const harness: Harness = renderField();

    fireEvent.focus(searchBox());
    await flush();

    await act(async () => {
      harness.calls[0]!.reject(
        new Error(
          "You don't have permission to read incidents, so you can't look one up here.",
        ),
      );
    });

    expect(screen.getByTestId("run-record-field-failed")).toHaveTextContent(
      "You don't have permission to read incidents, so you can't look one up here.",
    );
  });

  test("a record without a name is listed by its number, one without either by its ID", async () => {
    renderField({
      autoResolve: [
        { id: "a", number: "INC-1", matchedBy: RunRecordMatch.Recent },
        { id: "bbbb", matchedBy: RunRecordMatch.Recent },
      ],
    });

    fireEvent.focus(searchBox());
    await flush();

    expect(options()[0]).toHaveTextContent("INC-1");
    expect(options()[1]).toHaveTextContent("bbbb");
  });

  test("the clear button empties the box and keeps the focus there", async () => {
    const harness: Harness = renderField({ initialValue: "INC-8" });

    expect(searchBox()).toHaveValue("INC-8");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(searchBox()).toHaveValue("");
    expect(harness.value()).toBe("");
  });
});

type ChangeButtonFunction = () => HTMLElement;

const changeButton: ChangeButtonFunction = (): HTMLElement => {
  return within(screen.getByTestId("run-record-field-picked")).getByRole(
    "button",
    { name: "Change" },
  );
};

type TypeAndListFunction = (
  harness: Harness,
  text: string,
  records: Array<RunRecordOption>,
) => Promise<void>;

// Types into the box, lets the typing pause, and answers the search.
const typeAndList: TypeAndListFunction = async (
  harness: Harness,
  text: string,
  records: Array<RunRecordOption>,
): Promise<void> => {
  fireEvent.focus(searchBox());
  fireEvent.change(searchBox(), { target: { value: text } });
  await flush(RUN_RECORD_SEARCH_DELAY_MS + 10);

  await act(async () => {
    harness.calls[harness.calls.length - 1]!.resolve(records);
  });
};

/*
 * A pick takes the search box away, and the keyboard's place with it: the
 * focus was left on nothing at all, and a screen reader said nothing. It
 * goes to Change, the one control the picked record has.
 */
describe("where the focus is after a pick", () => {
  test("Enter picks, and the focus is on Change", async () => {
    renderField({ autoResolve: [EIGHT, SEVEN] });

    fireEvent.focus(searchBox());
    await flush();
    act(() => {
      searchBox().focus();
    });

    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(changeButton()).toHaveFocus();
  });

  test("a click picks, and the focus is on Change", async () => {
    renderField({ autoResolve: [EIGHT, SEVEN] });

    fireEvent.focus(searchBox());
    await flush();
    act(() => {
      searchBox().focus();
    });

    fireEvent.click(options()[1]!);

    expect(changeButton()).toHaveFocus();
  });

  test("Change takes it back to the box, and a second pick to Change again", async () => {
    renderField({ autoResolve: [EIGHT, SEVEN] });

    fireEvent.focus(searchBox());
    await flush();
    fireEvent.click(options()[0]!);

    fireEvent.click(changeButton());
    await flush();

    expect(searchBox()).toHaveFocus();

    fireEvent.keyDown(searchBox(), { key: "ArrowDown" });
    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(changeButton()).toHaveFocus();
    expect(screen.getByTestId("run-record-field-picked")).toHaveTextContent(
      "INC-7",
    );
  });
});

/*
 * "Instead of UUID can I enter the user-facing incident ID": INC-8 typed out
 * and the box left. The server would look INC-8 up when the run starts; the
 * field shows which incident that is as soon as it knows, so the
 * confirmation can name it before anything runs.
 */
describe("a number or an ID typed out, and the box left", () => {
  const OTHER: HTMLElement = document.body;

  test("the one record its number found is picked, as if it had been chosen", async () => {
    const harness: Harness = renderField();

    await typeAndList(harness, "INC-8", [EIGHT]);

    expect(harness.value()).toBe("INC-8");

    fireEvent.blur(searchBox(), { relatedTarget: OTHER });

    expect(harness.value()).toBe(EIGHT.id);
    expect(harness.onRecordChange).toHaveBeenLastCalledWith(EIGHT);

    const picked: HTMLElement = screen.getByTestId("run-record-field-picked");

    expect(picked).toHaveTextContent("INC-8");
    expect(picked).toHaveTextContent("Database is down");
    expect(screen.queryByTestId("run-record-field-search")).toBeNull();
    expect(options()).toHaveLength(0);
  });

  test("the focus was on its way elsewhere, and is not pulled back to Change", async () => {
    const harness: Harness = renderField();

    await typeAndList(harness, "8", [EIGHT]);

    const elsewhere: HTMLButtonElement = document.createElement("button");

    document.body.appendChild(elsewhere);

    try {
      elsewhere.focus();
      fireEvent.blur(searchBox(), { relatedTarget: elsewhere });

      expect(screen.getByTestId("run-record-field-picked")).toBeInTheDocument();
      expect(changeButton()).not.toHaveFocus();
      expect(elsewhere).toHaveFocus();
    } finally {
      elsewhere.remove();
    }
  });

  test("an ID pasted in is the record it found", async () => {
    const harness: Harness = renderField();
    const byId: RunRecordOption = { ...SEVEN, matchedBy: RunRecordMatch.Id };

    await typeAndList(harness, SEVEN.id, [byId]);
    fireEvent.blur(searchBox(), { relatedTarget: OTHER });

    expect(harness.value()).toBe(SEVEN.id);
    expect(harness.onRecordChange).toHaveBeenLastCalledWith(byId);
    expect(screen.getByTestId("run-record-field-picked")).toHaveTextContent(
      "Disk full",
    );
  });

  test("records found by their name after it do not get in its way", async () => {
    const harness: Harness = renderField();
    const named: RunRecordOption = {
      id: "33333333-3333-4333-8333-333333333333",
      number: "INC-3",
      name: "Port 8 is closed",
      matchedBy: RunRecordMatch.Name,
    };

    await typeAndList(harness, "8", [EIGHT, named]);
    fireEvent.blur(searchBox(), { relatedTarget: OTHER });

    expect(harness.value()).toBe(EIGHT.id);
  });

  test("part of a name is no record's name: nothing is picked", async () => {
    const harness: Harness = renderField();

    await typeAndList(harness, "data", [
      { ...EIGHT, matchedBy: RunRecordMatch.Name },
    ]);
    fireEvent.blur(searchBox(), { relatedTarget: OTHER });

    expect(harness.value()).toBe("data");
    expect(harness.onRecordChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("run-record-field-picked")).toBeNull();
    expect(searchBox()).toHaveValue("data");
  });

  test("a number two records answer to picks neither", async () => {
    const harness: Harness = renderField();

    await typeAndList(harness, "8", [
      EIGHT,
      {
        id: "44444444-4444-4444-8444-444444444444",
        number: "OPS-8",
        name: "Queue is stuck",
        matchedBy: RunRecordMatch.Number,
      },
    ]);
    fireEvent.blur(searchBox(), { relatedTarget: OTHER });

    expect(harness.value()).toBe("8");
    expect(screen.queryByTestId("run-record-field-picked")).toBeNull();
  });

  test("an answer to what was typed before is not what is typed now", async () => {
    const harness: Harness = renderField();

    await typeAndList(harness, "INC-8", [EIGHT]);

    // One more digit, and the box is left before the list has answered.
    fireEvent.change(searchBox(), { target: { value: "INC-80" } });
    fireEvent.blur(searchBox(), { relatedTarget: OTHER });

    expect(harness.value()).toBe("INC-80");
    expect(screen.queryByTestId("run-record-field-picked")).toBeNull();
  });

  test("nothing typed picks nothing from the newest records", async () => {
    const harness: Harness = renderField({ autoResolve: [EIGHT] });

    fireEvent.focus(searchBox());
    await flush();
    fireEvent.blur(searchBox(), { relatedTarget: OTHER });

    expect(harness.onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("run-record-field-picked")).toBeNull();
  });

  test("moving within the field - to its clear button - picks nothing", async () => {
    const harness: Harness = renderField();

    await typeAndList(harness, "INC-8", [EIGHT]);

    fireEvent.blur(searchBox(), {
      relatedTarget: screen.getByRole("button", { name: "Clear" }),
    });

    expect(harness.value()).toBe("INC-8");
    expect(options()).toHaveLength(1);
  });

  test("a search that failed picks nothing", async () => {
    const harness: Harness = renderField();

    fireEvent.focus(searchBox());
    fireEvent.change(searchBox(), { target: { value: "INC-8" } });
    await flush(RUN_RECORD_SEARCH_DELAY_MS + 10);

    await act(async () => {
      harness.calls[harness.calls.length - 1]!.reject(new Error("No"));
    });

    fireEvent.blur(searchBox(), { relatedTarget: OTHER });

    expect(harness.value()).toBe("INC-8");
    expect(screen.queryByTestId("run-record-field-picked")).toBeNull();
  });
});

describe("the record what was typed names outright", () => {
  const byName: RunRecordOption = { ...SEVEN, matchedBy: RunRecordMatch.Name };
  const byId: RunRecordOption = { ...SEVEN, matchedBy: RunRecordMatch.Id };

  test("the only record found by its number", () => {
    expect(
      getExactRunRecord({
        search: "INC-8",
        listedFor: "INC-8",
        records: [EIGHT, byName],
      }),
    ).toBe(EIGHT);
  });

  test("the only record found by its ID", () => {
    expect(
      getExactRunRecord({
        search: SEVEN.id,
        listedFor: SEVEN.id,
        records: [byId],
      }),
    ).toBe(byId);
  });

  test("none when only names matched, when nothing did, or when two numbers did", () => {
    expect(
      getExactRunRecord({
        search: "disk",
        listedFor: "disk",
        records: [byName],
      }),
    ).toBeNull();
    expect(
      getExactRunRecord({ search: "INC-9", listedFor: "INC-9", records: [] }),
    ).toBeNull();
    expect(
      getExactRunRecord({
        search: "8",
        listedFor: "8",
        records: [EIGHT, { ...EIGHT, id: "other" }],
      }),
    ).toBeNull();
  });

  test("none for a list that answers something else, or nothing typed", () => {
    expect(
      getExactRunRecord({
        search: "INC-80",
        listedFor: "INC-8",
        records: [EIGHT],
      }),
    ).toBeNull();
    expect(
      getExactRunRecord({ search: "", listedFor: "", records: [EIGHT] }),
    ).toBeNull();
    // The newest records are how they were found, not a match.
    expect(
      getExactRunRecord({ search: "x", listedFor: "x", records: [SEVEN] }),
    ).toBeNull();
  });
});

/*
 * A row's number, its name and when it was created are each written to be
 * read where they are: on the list's white, and on the tint of the row the
 * pointer or the keys are on, where gray-500 would be 4.3:1.
 */
describe("every word of the field can be read", () => {
  type FieldFunction = () => HTMLElement;

  const field: FieldFunction = (): HTMLElement => {
    return screen.getByTestId("run-record-field");
  };

  test("the newest records listed, with the keys on each row in turn", async () => {
    renderField({ autoResolve: [EIGHT, SEVEN] });

    fireEvent.focus(searchBox());
    await flush();

    expect(options()).toHaveLength(2);
    expect(unreadableWords(field(), PAGE_TEXT_CLASS)).toEqual([]);

    // When it was created is among the words, on both rows.
    expect(
      wordsIn(field(), PAGE_TEXT_CLASS).filter((written: WrittenWords) => {
        return written.words.startsWith("Created");
      }),
    ).toEqual([
      // Under the keys: a shade darker, on the row's tint.
      expect.objectContaining({
        textClass: "text-gray-600",
        groundClass: "bg-indigo-50",
      }),
      expect.objectContaining({
        textClass: "text-gray-500",
        groundClass: "bg-white",
      }),
    ]);

    fireEvent.keyDown(searchBox(), { key: "ArrowDown" });

    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    expect(unreadableWords(field(), PAGE_TEXT_CLASS)).toEqual([]);
    expect(
      wordsIn(field(), PAGE_TEXT_CLASS)
        .filter((written: WrittenWords) => {
          return written.words.startsWith("Created");
        })
        .map((written: WrittenWords) => {
          return written.textClass;
        }),
    ).toEqual(["text-gray-500", "text-gray-600"]);
  });

  test("a record picked, a search that finds nothing, an empty project and a refused search", async () => {
    const picked: Harness = renderField({ autoResolve: [EIGHT] });

    fireEvent.focus(searchBox());
    await flush();
    fireEvent.click(options()[0]!);

    expect(picked.value()).toBe(EIGHT.id);
    expect(screen.getByTestId("run-record-field-picked")).toBeInTheDocument();
    expect(unreadableWords(field(), PAGE_TEXT_CLASS)).toEqual([]);

    cleanup();

    // Nothing to pick: an empty project, then a search with no match.
    renderField({ autoResolve: [] });
    fireEvent.focus(searchBox());
    await flush();

    expect(screen.getByTestId("run-record-field-empty")).toBeInTheDocument();
    expect(unreadableWords(field(), PAGE_TEXT_CLASS)).toEqual([]);

    fireEvent.change(searchBox(), { target: { value: "zzzz" } });
    await flush(RUN_RECORD_SEARCH_DELAY_MS + 10);

    expect(screen.getByTestId("run-record-field-empty")).toBeInTheDocument();
    expect(unreadableWords(field(), PAGE_TEXT_CLASS)).toEqual([]);

    cleanup();

    const refused: Harness = renderField();

    fireEvent.focus(searchBox());
    await flush();
    await act(async () => {
      refused.calls[0]!.reject(new Error("The incidents could not be listed."));
    });

    expect(field()).toHaveTextContent("The incidents could not be listed.");
    expect(unreadableWords(field(), PAGE_TEXT_CLASS)).toEqual([]);
  });
});

/*
 * The numbers are a column. "INC-8" and "INC-80" are a character apart, and
 * each sat in a chip as wide as itself, so the titles after them started at
 * different places down the list: a ragged edge where the eye reads down.
 * Every number now sits in a slot as wide as the longest one listed.
 */
describe("the numbers line up, so the titles do", () => {
  const EIGHTY: RunRecordOption = {
    id: "33333333-3333-4333-8333-333333333333",
    number: "INC-80",
    name: "Database replica lag",
    createdAt: "2026-09-01T08:00:00.000Z",
    matchedBy: RunRecordMatch.Recent,
  };

  type NumberSlotsFunction = () => Array<HTMLElement>;

  const numberSlots: NumberSlotsFunction = (): Array<HTMLElement> => {
    return options().map((option: HTMLElement): HTMLElement => {
      return option.querySelector('[data-part="number"]') as HTMLElement;
    });
  };

  test("the column is as wide as the longest number listed", () => {
    expect(getRunRecordNumberColumnCharacters([EIGHT, SEVEN])).toBe(5);
    expect(getRunRecordNumberColumnCharacters([EIGHT, EIGHTY, SEVEN])).toBe(6);
    // A number under an older, longer prefix sets the width for all.
    expect(
      getRunRecordNumberColumnCharacters([
        EIGHT,
        { ...SEVEN, number: "INCIDENT-7" },
      ]),
    ).toBe(10);
  });

  test("no numbers, no column", () => {
    expect(getRunRecordNumberColumnCharacters([])).toBe(0);
    expect(
      getRunRecordNumberColumnCharacters([
        { id: "a", name: "Website", matchedBy: RunRecordMatch.Recent },
        { id: "b", name: "API", matchedBy: RunRecordMatch.Recent },
      ]),
    ).toBe(0);
  });

  test("a number someone wrote a sentence into does not push every title along", () => {
    const long: string = "PRODUCTION-INCIDENT-NUMBER-123456";

    expect(long.length).toBeGreaterThan(
      RUN_RECORD_NUMBER_COLUMN_MAX_CHARACTERS,
    );
    expect(
      getRunRecordNumberColumnCharacters([EIGHT, { ...SEVEN, number: long }]),
    ).toBe(RUN_RECORD_NUMBER_COLUMN_MAX_CHARACTERS);
  });

  test("every row's number sits in a slot of that width, in the number's own type", async () => {
    renderField({ autoResolve: [EIGHT, EIGHTY, SEVEN] });

    fireEvent.focus(searchBox());
    await flush();

    const slots: Array<HTMLElement> = numberSlots();

    expect(slots).toHaveLength(3);

    for (const slot of slots) {
      /*
       * Six characters of the number's type, and the chip's padding on both
       * sides (px-1.5 twice). On the element, so it is there at first draw.
       */
      expect(slot.style.minWidth).toBe("calc(6ch + 0.75rem)");
      /*
       * ch is the width of a character of the slot's own type: it has to be
       * the chip's - monospace, 12px - for six of them to be six of its.
       */
      expect(slot).toHaveClass("font-mono", "text-xs", "shrink-0");
    }

    // The chip itself is as wide as its number, as before.
    expect(within(slots[0]!).getByText("INC-8")).toHaveClass(
      "font-mono",
      "text-xs",
      "px-1.5",
    );
    expect(within(slots[1]!).getByText("INC-80")).toBeInTheDocument();

    // And the title comes right after the slot, on every row.
    for (const option of options()) {
      const parts: Array<string | null> = Array.from(option.children).map(
        (child: Element): string | null => {
          return child.getAttribute("data-part");
        },
      );

      expect(parts.slice(0, 2)).toEqual(["number", "name"]);
    }
  });

  test("a record without a number keeps its place in the column, empty", async () => {
    renderField({
      autoResolve: [
        EIGHT,
        { ...SEVEN, number: undefined } as unknown as RunRecordOption,
      ],
    });

    fireEvent.focus(searchBox());
    await flush();

    const slots: Array<HTMLElement> = numberSlots();

    expect(slots[1]).toBeInTheDocument();
    expect(slots[1]).toBeEmptyDOMElement();
    expect(slots[1]!.style.minWidth).toBe("calc(5ch + 0.75rem)");
    expect(options()[1]).toHaveTextContent("Disk full");
  });

  test("a model whose records have no numbers has no column at all", async () => {
    renderField({
      info: { ...INFO, hasNumber: false },
      autoResolve: [
        { id: "a", name: "Website", matchedBy: RunRecordMatch.Recent },
        { id: "b", name: "API", matchedBy: RunRecordMatch.Recent },
      ],
    });

    fireEvent.focus(searchBox());
    await flush();

    expect(options()).toHaveLength(2);
    expect(numberSlots()).toEqual([null, null]);
    expect(options()[0]!.firstElementChild).toHaveAttribute(
      "data-part",
      "name",
    );
  });

  test("the column follows what is listed: a search that finds shorter numbers narrows it", async () => {
    const harness: Harness = renderField();

    fireEvent.focus(searchBox());
    await flush();
    await act(async () => {
      harness.calls[0]!.resolve([EIGHT, EIGHTY]);
    });

    expect(numberSlots()[0]!.style.minWidth).toBe("calc(6ch + 0.75rem)");

    fireEvent.change(searchBox(), { target: { value: "8" } });
    await flush(RUN_RECORD_SEARCH_DELAY_MS + 10);
    await act(async () => {
      harness.calls[1]!.resolve([EIGHT]);
    });

    expect(numberSlots()[0]!.style.minWidth).toBe("calc(5ch + 0.75rem)");
  });
});

/*
 * What the field says when there is nothing to run with. The form's own
 * words were "Incident is required." for a box left blank; the field says
 * the way out instead, the same for nothing picked and for words that name
 * no record - and tells only a model whose records have numbers to type one.
 */
describe("what the field says when it has nothing to run with", () => {
  type ErrorFunction = () => HTMLElement | null;

  const error: ErrorFunction = (): HTMLElement | null => {
    return screen.queryByTestId("run-record-field-error");
  };

  test("nothing is said until the form finds something wrong", () => {
    renderField();

    expect(error()).toBeNull();
    expect(searchBox()).toHaveAttribute("aria-invalid", "false");
  });

  test("a box left blank says to pick one, not that a field is required", () => {
    renderField({ error: "Incident is required." });

    expect(error()).toHaveTextContent(
      /^Pick one from the list, or type its number or ID\.$/,
    );
    expect(screen.queryByText("Incident is required.")).toBeNull();
    expect(error()).toHaveAttribute("role", "alert");
    expect(searchBox()).toHaveAttribute("aria-invalid", "true");
    expect(searchBox()).toHaveClass("border-red-300");
  });

  test("words that name no record say the same", () => {
    renderField({
      initialValue: "database",
      error: "Pick one from the list, or type its number or ID.",
    });

    expect(error()).toHaveTextContent(
      /^Pick one from the list, or type its number or ID\.$/,
    );
  });

  test("a model whose records have no numbers is not told to type one", () => {
    renderField({
      info: { ...INFO, singularName: "Monitor", hasNumber: false },
      error: "Monitor is required.",
    });

    expect(error()).toHaveTextContent(
      /^Pick one from the list, or paste its ID\.$/,
    );
    expect(error()).not.toHaveTextContent("number");
  });

  test.each([
    [true, true, RunRecordFieldCopy.pickFromList],
    [true, false, RunRecordFieldCopy.pickFromList],
    [false, true, RunRecordFieldCopy.pickFromListOrId],
    [false, false, RunRecordFieldCopy.pickFromListOrId],
  ])(
    "number %p and name %p: the hint is %p",
    (hasNumber: boolean, hasName: boolean, hint: string) => {
      expect(
        getRunRecordPickHint({
          ...INFO,
          hasNumber: hasNumber,
          hasName: hasName,
        }),
      ).toBe(hint);
    },
  );

  test("the message can be read where it is", () => {
    renderField({ error: "Incident is required." });

    expect(
      unreadableWords(screen.getByTestId("run-record-field"), PAGE_TEXT_CLASS),
    ).toEqual([]);
  });

  test("a pick takes the message with it once the form has nothing to say", async () => {
    type HostFunction = () => ReactElement;

    // A form that says the field is required until it holds something.
    const Host: HostFunction = (): ReactElement => {
      const [value, setValue] = useState<string>("");

      return (
        <RunRecordField
          workflowId={WORKFLOW_ID}
          info={INFO}
          value={value}
          onChange={setValue}
          error={value ? undefined : "Incident is required."}
          load={async (): Promise<Array<RunRecordOption>> => {
            return [EIGHT];
          }}
          now={NOW}
        />
      );
    };

    render(<Host />);

    expect(error()).toBeInTheDocument();

    fireEvent.focus(searchBox());
    await flush();
    fireEvent.click(options()[0]!);

    expect(screen.getByTestId("run-record-field-picked")).toBeInTheDocument();
    expect(error()).toBeNull();
  });
});

/*
 * As the Run Workflow panel opens, the box is where the typing goes: the
 * newest records are listed at once, and "INC-8" can be typed straight
 * away. Not where a finger is the pointer: focusing a box there throws the
 * keyboard over the list the box opens.
 */
describe("the focus as the panel opens", () => {
  type MatchMediaFunction = typeof window.matchMedia;

  const originalMatchMedia: MatchMediaFunction | undefined = window.matchMedia;

  type SetPointerFunction = (isCoarse: boolean) => void;

  const setPointer: SetPointerFunction = (isCoarse: boolean): void => {
    window.matchMedia = ((query: string): MediaQueryList => {
      return {
        matches: query === "(pointer: coarse)" ? isCoarse : false,
        media: query,
      } as MediaQueryList;
    }) as MatchMediaFunction;
  };

  afterEach(() => {
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    } else {
      delete (window as unknown as { matchMedia?: MatchMediaFunction })
        .matchMedia;
    }
  });

  test("asked for, the box has the focus and the newest records are listed", async () => {
    setPointer(false);

    const harness: Harness = renderField({
      autoFocus: true,
      autoResolve: [EIGHT, SEVEN],
    });

    expect(searchBox()).toHaveFocus();

    await flush();

    // Nothing was typed or pressed: the list is there because the box is.
    expect(
      harness.calls.map((call: LoadCall) => {
        return call.search;
      }),
    ).toEqual([""]);
    expect(searchBox()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Most recent")).toBeInTheDocument();
    expect(options()).toHaveLength(2);
    // And nothing is picked or reported for it.
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  test("the panel is not scrolled to it: it is still sliding in", () => {
    setPointer(false);

    type FocusFunction = typeof HTMLElement.prototype.focus;

    const focus: FocusFunction = HTMLElement.prototype.focus;
    const seen: Array<FocusOptions | undefined> = [];

    HTMLElement.prototype.focus = function (
      this: HTMLElement,
      focusOptions?: FocusOptions,
    ): void {
      seen.push(focusOptions);
      focus.call(this, focusOptions);
    };

    try {
      renderField({ autoFocus: true });
    } finally {
      HTMLElement.prototype.focus = focus;
    }

    expect(seen).toEqual([{ preventScroll: true }]);
  });

  test("where a finger is the pointer the box is left alone, and nothing is asked for", async () => {
    setPointer(true);

    const harness: Harness = renderField({
      autoFocus: true,
      autoResolve: [EIGHT],
    });

    await flush();

    expect(searchBox()).not.toHaveFocus();
    expect(searchBox()).toHaveAttribute("aria-expanded", "false");
    expect(harness.calls).toEqual([]);
    expect(options()).toHaveLength(0);

    // A tap on the box opens it, as it always did.
    fireEvent.focus(searchBox());
    await flush();

    expect(options()).toHaveLength(1);
  });

  test("not asked for, the box waits to be opened", async () => {
    setPointer(false);

    const harness: Harness = renderField({ autoResolve: [EIGHT] });

    await flush();

    expect(searchBox()).not.toHaveFocus();
    expect(harness.calls).toEqual([]);
  });

  test("it is not the browser's own autofocus, which would ask a phone for its keyboard", () => {
    setPointer(true);
    renderField({ autoFocus: true });

    expect(searchBox()).not.toHaveAttribute("autofocus");
  });
});

describe("the words around it", () => {
  const translator: ReturnType<typeof createTranslator> = createTranslator(
    undefined,
    "en",
  );

  test.each([
    [
      RunRecordEvent.Created,
      "The run starts as if this incident had just been created.",
    ],
    [
      RunRecordEvent.Updated,
      "The run starts as if this incident had just been updated.",
    ],
    [
      RunRecordEvent.Deleted,
      "The run starts as if this incident had just been deleted. Nothing is deleted.",
    ],
  ])("the help for a %s trigger", (event: RunRecordEvent, help: string) => {
    expect(getRunRecordDescription(translator, { ...INFO, event: event })).toBe(
      help,
    );
  });

  test.each([
    [true, true, RunRecordFieldCopy.searchByNumberOrName],
    [true, false, RunRecordFieldCopy.searchByNumber],
    [false, true, RunRecordFieldCopy.searchByName],
    [false, false, RunRecordFieldCopy.pasteId],
  ])(
    "number %p and name %p: the box says %p",
    (hasNumber: boolean, hasName: boolean, placeholder: string) => {
      expect(
        getRunRecordPlaceholder({
          ...INFO,
          hasNumber: hasNumber,
          hasName: hasName,
        }),
      ).toBe(placeholder);
    },
  );

  test("a record's label", () => {
    expect(getRunRecordLabel(EIGHT)).toBe("INC-8 · Database is down");
    expect(
      getRunRecordLabel({ ...EIGHT, name: undefined } as RunRecordOption),
    ).toBe("INC-8");
    expect(
      getRunRecordLabel({ ...EIGHT, number: undefined } as RunRecordOption),
    ).toBe("Database is down");
    expect(getRunRecordLabel({ id: "x", matchedBy: RunRecordMatch.Id })).toBe(
      "x",
    );
  });

  test("when a record was created, short", () => {
    const clock: FeedClock = {
      timezone: "UTC",
      language: "en",
      use12HourClock: true,
      now: NOW,
    };

    expect(
      formatRunRecordCreatedAt(new Date("2026-10-13T09:30:00.000Z"), clock),
    ).toBe("Today, 9:30 AM");
    expect(
      formatRunRecordCreatedAt(new Date("2026-10-12T21:05:00.000Z"), clock),
    ).toBe("Yesterday, 9:05 PM");
    expect(
      formatRunRecordCreatedAt(new Date("2026-10-02T15:25:00.000Z"), clock),
    ).toBe("Oct 2, 3:25 PM");
    expect(
      formatRunRecordCreatedAt(new Date("2025-12-31T15:25:00.000Z"), clock),
    ).toBe("Dec 31, 2025, 3:25 PM");
  });
});

/*
 * RUN PRESSED STRAIGHT AFTER TYPING, IN ONE CLICK.
 *
 * Pressing Run takes the focus from the box, and the form gives it straight
 * back within the same click: it focuses its first field in error in a
 * layout effect (BasicForm, since #5292). Closed before the pause was over,
 * the list goes back to idle by an update that lands only after that - so
 * the box opened again on a list still "loading" for words nobody had asked
 * for, and said "Searching…" for good (14.0.93's gate, Workflow Builder).
 * What is asked for is the field's to know (askingRef), not the list's
 * "loading". The host here does what the form does; the press and the click
 * are apart by microtasks only, as a quick click is in a browser.
 */
describe("Run pressed straight after typing", () => {
  test("the box given straight back opens a list that is asked for, and answered", async () => {
    const searches: Array<string> = [];
    const load: LoadRunRecordsFunction = (data: {
      workflowId: ObjectID;
      search: string;
    }): Promise<Array<RunRecordOption>> => {
      searches.push(data.search);
      return Promise.resolve(data.search === "" ? [EIGHT, SEVEN] : [EIGHT]);
    };

    const Host: () => ReactElement = (): ReactElement => {
      const [attempt, setAttempt] = useState<number>(0);
      const [value, setValue] = useState<string>("");

      // What BasicForm does after a press that found a field in error.
      React.useLayoutEffect(() => {
        if (attempt > 0) {
          searchBox().focus();
        }
      }, [attempt]);

      return (
        <div>
          <RunRecordField
            workflowId={WORKFLOW_ID}
            info={INFO}
            value={value}
            onChange={setValue}
            error={attempt > 0 ? "Pick one from the list." : undefined}
            load={load}
            now={NOW}
          />
          <button
            type="button"
            onClick={() => {
              setAttempt((current: number) => {
                return current + 1;
              });
            }}
          >
            Run
          </button>
        </div>
      );
    };

    render(<Host />);
    // Really in the box (fireEvent.focus would not move the focus there).
    await act(async () => {
      searchBox().focus();
    });
    await flush();
    expect(document.activeElement).toBe(searchBox());
    expect(searches).toEqual([""]);

    fireEvent.change(searchBox(), { target: { value: "data" } });

    const run: HTMLElement = screen.getByRole("button", { name: "Run" });
    // Outside act, so React orders the updates as a browser's events would.
    const actGlobal: { IS_REACT_ACT_ENVIRONMENT?: unknown } = globalThis as {
      IS_REACT_ACT_ENVIRONMENT?: unknown;
    };
    const actEnvironment: unknown = actGlobal.IS_REACT_ACT_ENVIRONMENT;
    actGlobal.IS_REACT_ACT_ENVIRONMENT = false;

    try {
      // The press takes the focus from the box, before the pause is over...
      run.focus();
      await Promise.resolve();
      // ...and Run is pressed: the form puts the focus back in the box.
      run.click();
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      actGlobal.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }

    expect(document.activeElement).toBe(searchBox());

    await flush(RUN_RECORD_SEARCH_DELAY_MS + 10);

    expect(searches).toEqual(["", "data"]);
    expect(screen.queryByTestId("run-record-field-searching")).toBeNull();
    expect(options()).toHaveLength(1);
  });
});
