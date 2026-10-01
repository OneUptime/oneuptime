/*
 * The "Add a field" list in a database step's settings.
 *
 * What the maintainer saw was a react-select dropdown 18rem wide: each option
 * "Change Monitor Status To ID · changeMonitorStatusToId" over a four-line
 * description, three options to a screen, a horizontal scrollbar, and no way to
 * tell which fields mattered. These hold the replacement to what it promises -
 * a search box, groups that say what matters, one line per field - and to the
 * keyboard and focus behaviour a list inside a modal needs.
 */

import TableColumnType from "../../../../../Types/Database/TableColumnType";
import AddColumnPicker from "../../../../../UI/Components/Workflow/ColumnEditor/AddColumnPicker";
import { ColumnUse } from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnUse";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import "@testing-library/jest-dom";
import { RenderResult, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

type MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string; title: string },
) => ModelSchemaColumn;

const makeColumn: MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string; title: string },
): ModelSchemaColumn => {
  return {
    type: TableColumnType.ShortText,
    isRelation: false,
    ...overrides,
  };
};

const LONG_DESCRIPTION: string =
  "Relation to Monitor Status Object ID. All monitors connected to this incident will be changed to this status when the incident is created.";

// Create One Incident's fields, as the endpoint describes them.
const COLUMNS: Array<ModelSchemaColumn> = [
  makeColumn({
    id: "title",
    title: "Title",
    type: TableColumnType.LongText,
    required: true,
    description: "Title of this incident.",
  }),
  makeColumn({
    id: "incidentSeverityId",
    title: "Incident Severity ID",
    type: TableColumnType.ObjectID,
    required: true,
    description: "How bad this incident is.",
  }),
  makeColumn({
    id: "declaredAt",
    title: "Declared At",
    type: TableColumnType.Date,
    required: true,
    hasDefault: true,
    description: "When this incident was declared.",
  }),
  makeColumn({
    id: "currentIncidentStateId",
    title: "Current Incident State ID",
    type: TableColumnType.ObjectID,
    required: true,
    hasDefault: true,
    description: "Current state of this incident.",
  }),
  makeColumn({
    id: "description",
    title: "Description",
    type: TableColumnType.Markdown,
    description: "Short description of this incident.",
  }),
  makeColumn({
    id: "changeMonitorStatusToId",
    title: "Change Monitor Status To ID",
    type: TableColumnType.ObjectID,
    description: LONG_DESCRIPTION,
  }),
  makeColumn({
    id: "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    title: "Should subscribers be notified?",
    type: TableColumnType.Boolean,
    description:
      "Should status page subscribers be notified when this incident is created?",
  }),
  makeColumn({
    id: "isPrivate",
    title: "Is Private?",
    type: TableColumnType.Boolean,
    description: "Private incidents are only visible to their owners.",
  }),
];

const TEST_ID: string = "model-column-add";

interface PickerHarness {
  user: UserEvent;
  onAdd: MockFunction;
  result: RenderResult;
}

interface RenderPickerOptions {
  columns?: Array<ModelSchemaColumn> | undefined;
  use?: ColumnUse | undefined;
  requiredColumnIds?: Array<string> | undefined;
  allowCustomColumn?: boolean | undefined;
  wrapInForm?: (() => void) | undefined;
}

type RenderPickerFunction = (options?: RenderPickerOptions) => PickerHarness;

const renderPicker: RenderPickerFunction = (
  options?: RenderPickerOptions,
): PickerHarness => {
  const onAdd: MockFunction = getJestMockFunction();

  const picker: React.ReactElement = (
    <AddColumnPicker
      columns={options?.columns || COLUMNS}
      use={options?.use || ColumnUse.Create}
      requiredColumnIds={
        options?.requiredColumnIds || ["title", "incidentSeverityId"]
      }
      triggerLabel="Add a field"
      allowCustomColumn={options?.allowCustomColumn ?? true}
      dataTestId={TEST_ID}
      onAdd={onAdd as unknown as (columnId: string) => void}
    />
  );

  const submit: (() => void) | undefined = options?.wrapInForm;

  const result: RenderResult = render(
    <div>
      {submit ? (
        <form
          onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            submit();
          }}
        >
          {picker}
        </form>
      ) : (
        picker
      )}
      <button type="button" data-testid="outside">
        Somewhere else
      </button>
    </div>,
  );

  return { user: userEvent.setup(), onAdd: onAdd, result: result };
};

type OpenFunction = (user: UserEvent) => Promise<HTMLElement>;

// Opens the list and hands back its search box.
const open: OpenFunction = async (user: UserEvent): Promise<HTMLElement> => {
  await user.click(screen.getByTestId(TEST_ID));

  return screen.getByTestId(`${TEST_ID}-search`);
};

type OptionIdsFunction = (container?: HTMLElement) => Array<string>;

const optionIds: OptionIdsFunction = (
  container?: HTMLElement,
): Array<string> => {
  return (container ? within(container) : screen)
    .getAllByRole("option")
    .map((option: HTMLElement) => {
      return (option.getAttribute("data-testid") || "").replace(
        `${TEST_ID}-option-`,
        "",
      );
    });
};

// Every keydown that reached the document still unhandled - what Modal acts on.
const unhandledDocumentKeys: Array<string> = [];

const documentKeyListener: (event: KeyboardEvent) => void = (
  event: KeyboardEvent,
): void => {
  if (!event.defaultPrevented) {
    unhandledDocumentKeys.push(event.key);
  }
};

beforeEach(() => {
  unhandledDocumentKeys.length = 0;
  document.addEventListener("keydown", documentKeyListener);
});

afterEach(() => {
  document.removeEventListener("keydown", documentKeyListener);
});

describe("before it is opened", () => {
  test("is one plain button, not a dropdown already full of fields", () => {
    renderPicker();

    expect(screen.getByRole("button", { name: "Add a field" })).toBeVisible();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
  });
});

describe("opening the list", () => {
  test("puts the cursor in a search box that says how many fields there are", async () => {
    const { user }: PickerHarness = renderPicker();

    const search: HTMLElement = await open(user);

    expect(search).toHaveFocus();
    expect(search).toHaveAttribute("placeholder", "Search 8 fields");
    expect(search).toHaveAttribute("role", "combobox");
    expect(search).toHaveAttribute("aria-expanded", "true");
  });

  test("groups the fields: required, then the model's main fields, then the rest", async () => {
    const { user }: PickerHarness = renderPicker();

    await open(user);

    const groups: Array<HTMLElement> = screen.getAllByRole("group");

    expect(
      groups.map((group: HTMLElement) => {
        return group.getAttribute("data-testid");
      }),
    ).toEqual([
      `${TEST_ID}-group-required`,
      `${TEST_ID}-group-main`,
      `${TEST_ID}-group-other`,
    ]);

    expect(within(groups[0]!).getByText("Required")).toBeVisible();
    expect(optionIds(groups[0]!)).toEqual(["incidentSeverityId", "title"]);

    expect(within(groups[1]!).getByText("Main fields")).toBeVisible();
    expect(
      within(groups[1]!).getByText("Filled in for you if you leave them out"),
    ).toBeVisible();
    expect(optionIds(groups[1]!)).toEqual([
      "currentIncidentStateId",
      "declaredAt",
    ]);

    expect(within(groups[2]!).getByText("Other fields")).toBeVisible();
    expect(optionIds(groups[2]!)).toEqual([
      "changeMonitorStatusToId",
      "description",
      "isPrivate",
      "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    ]);
  });

  test("each group is named for assistive technology by its heading", async () => {
    const { user }: PickerHarness = renderPicker();

    await open(user);

    expect(
      screen.getByRole("group", { name: /Main fields/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /Other fields/ }),
    ).toBeInTheDocument();
  });

  test("a single group gets no heading - 'Other fields' over everything says nothing", async () => {
    const { user }: PickerHarness = renderPicker({
      columns: [
        makeColumn({ id: "note", title: "Note" }),
        makeColumn({ id: "postedAt", title: "Posted At" }),
      ],
      use: ColumnUse.Update,
      requiredColumnIds: [],
    });

    await open(user);

    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByText("Other fields")).toBeNull();
    expect(optionIds()).toEqual(["note", "postedAt"]);
  });
});

describe("one line per field", () => {
  test("shows the field's name and the kind of value it takes", async () => {
    const { user }: PickerHarness = renderPicker();

    await open(user);

    const declaredAt: HTMLElement = screen.getByTestId(
      `${TEST_ID}-option-declaredAt`,
    );

    expect(within(declaredAt).getByText("Declared At")).toBeVisible();
    expect(within(declaredAt).getByText("Date and time")).toBeVisible();

    const isPrivate: HTMLElement = screen.getByTestId(
      `${TEST_ID}-option-isPrivate`,
    );

    expect(within(isPrivate).getByText("True or false")).toBeVisible();
  });

  /*
   * "Created At · createdAt" was the noise: the key repeated the name. It is
   * shown only where the name does not already spell it.
   */
  test("leaves out the key where it only repeats the name", async () => {
    const { user }: PickerHarness = renderPicker();

    await open(user);

    const option: HTMLElement = screen.getByTestId(
      `${TEST_ID}-option-currentIncidentStateId`,
    );

    expect(within(option).queryByText("currentIncidentStateId")).toBeNull();
  });

  test("shows the key, quietly, where the name does not say it", async () => {
    const { user }: PickerHarness = renderPicker();

    await open(user);

    const option: HTMLElement = screen.getByTestId(
      `${TEST_ID}-option-shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`,
    );
    const key: HTMLElement = within(option).getByText(
      "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    );

    expect(key).toHaveClass("font-mono");
    expect(key).toHaveClass("truncate");
  });

  test("cuts a long description to one line and keeps the whole of it in a tooltip", async () => {
    const { user }: PickerHarness = renderPicker();

    await open(user);

    const option: HTMLElement = screen.getByTestId(
      `${TEST_ID}-option-changeMonitorStatusToId`,
    );
    const description: HTMLElement = within(option).getByText(LONG_DESCRIPTION);

    expect(description).toHaveClass("truncate");
    expect(description).toHaveAttribute("title", LONG_DESCRIPTION);
  });

  test("drops a description that only repeats the field's name", async () => {
    const { user }: PickerHarness = renderPicker({
      columns: [
        ...COLUMNS,
        makeColumn({
          id: "incidentEpisodeId",
          title: "Incident Episode ID",
          type: TableColumnType.ObjectID,
          description: "Incident Episode ID",
        }),
      ],
    });

    await open(user);

    const option: HTMLElement = screen.getByTestId(
      `${TEST_ID}-option-incidentEpisodeId`,
    );

    expect(within(option).getAllByText("Incident Episode ID")).toHaveLength(1);
  });

  test("stays a readable width in the wide settings modal", async () => {
    const { user }: PickerHarness = renderPicker();

    await open(user);

    expect(screen.getByTestId(`${TEST_ID}-panel`)).toHaveClass("max-w-2xl");
  });

  test("the list scrolls up and down, never sideways", async () => {
    const { user }: PickerHarness = renderPicker();

    await open(user);

    const list: HTMLElement = screen.getByRole("listbox");

    expect(list).toHaveClass("overflow-y-auto");
    expect(list).toHaveClass("overflow-x-hidden");
  });
});

describe("searching", () => {
  test("narrows the list to what matches, best match first, without the groups", async () => {
    const { user }: PickerHarness = renderPicker();

    const search: HTMLElement = await open(user);
    await user.type(search, "state");

    expect(optionIds()[0]).toBe("currentIncidentStateId");
    expect(screen.queryByText("Main fields")).toBeNull();
  });

  test("Enter adds the best match - type a few letters and you are done", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    const search: HTMLElement = await open(user);
    await user.type(search, "desc{Enter}");

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith("description");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("finds a field by what its description says", async () => {
    const { user }: PickerHarness = renderPicker();

    const search: HTMLElement = await open(user);
    await user.type(search, "owners");

    expect(optionIds()).toEqual(["isPrivate"]);
  });

  test("says so when nothing matches", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    const search: HTMLElement = await open(user);
    await user.type(search, "kubernetes{Enter}");

    expect(screen.getByTestId(`${TEST_ID}-no-match`)).toHaveTextContent(
      "No fields match “kubernetes”.",
    );
    expect(screen.queryByRole("option")).toBeNull();
    // Enter on an empty list adds nothing.
    expect(onAdd).not.toHaveBeenCalled();
  });

  test("clearing the search brings the groups back", async () => {
    const { user }: PickerHarness = renderPicker();

    const search: HTMLElement = await open(user);
    await user.type(search, "state");
    await user.clear(search);

    expect(screen.getByText("Main fields")).toBeVisible();
    expect(optionIds()).toHaveLength(COLUMNS.length);
  });
});

describe("the keyboard", () => {
  test("the arrows move through the list and Enter adds the field they are on", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    const search: HTMLElement = await open(user);

    // The first option is active to begin with.
    expect(
      screen.getByTestId(`${TEST_ID}-option-incidentSeverityId`),
    ).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}{ArrowDown}");

    const active: HTMLElement = screen.getByTestId(
      `${TEST_ID}-option-currentIncidentStateId`,
    );

    expect(active).toHaveAttribute("aria-selected", "true");
    expect(search).toHaveAttribute("aria-activedescendant", active.id);

    await user.keyboard("{Enter}");

    expect(onAdd).toHaveBeenCalledWith("currentIncidentStateId");
  });

  test("going up from the first field wraps round to the last", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    await open(user);
    await user.keyboard("{ArrowUp}{Enter}");

    expect(onAdd).toHaveBeenCalledWith(
      "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    );
  });

  /*
   * The settings modal closes on Escape from a document listener that stands
   * down for an event already handled. Escape in the list must close the list,
   * not throw away the step's settings.
   */
  test("Escape closes the list, adds nothing, and never reaches the modal", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    await open(user);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
    expect(unhandledDocumentKeys).not.toContain("Escape");
    // Back on the button that opened it, ready to try again.
    expect(screen.getByTestId(TEST_ID)).toHaveFocus();
  });

  test("Enter in the search box never submits the form around it", async () => {
    const submit: MockFunction = getJestMockFunction();
    const { user, onAdd }: PickerHarness = renderPicker({
      wrapInForm: submit as unknown as () => void,
    });

    const search: HTMLElement = await open(user);
    await user.type(search, "title{Enter}");

    expect(onAdd).toHaveBeenCalledWith("title");
    expect(submit).not.toHaveBeenCalled();
  });

  test("tabbing out of the list closes it", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    await open(user);
    // Search box -> close button -> "Add a column by name" -> out.
    await user.tab();
    await user.tab();
    await user.tab();

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("the mouse", () => {
  test("clicking a field adds it and closes the list", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    await open(user);
    await user.click(screen.getByTestId(`${TEST_ID}-option-isPrivate`));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith("isPrivate");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("pointing at a field makes it the one Enter would add", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    await open(user);
    await user.hover(screen.getByTestId(`${TEST_ID}-option-description`));

    expect(screen.getByTestId(`${TEST_ID}-option-description`)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{Enter}");

    expect(onAdd).toHaveBeenCalledWith("description");
  });

  test("pressing anywhere else closes the list without adding anything", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    await open(user);
    await user.click(screen.getByTestId("outside"));

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });

  test("the close button closes it too", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    await open(user);
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByTestId(TEST_ID)).toHaveFocus();
  });

  test("it opens fresh: a search typed before closing is gone", async () => {
    const { user }: PickerHarness = renderPicker();

    const search: HTMLElement = await open(user);
    await user.type(search, "state");
    await user.keyboard("{Escape}");

    const reopened: HTMLElement = await open(user);

    expect(reopened).toHaveValue("");
    expect(optionIds()).toHaveLength(COLUMNS.length);
  });
});

describe("adding a column by name", () => {
  test("is a quiet link at the foot of the list", async () => {
    const { user }: PickerHarness = renderPicker();

    await open(user);

    expect(screen.getByTestId(`${TEST_ID}-by-name`)).toHaveTextContent(
      "Add a column by name",
    );
  });

  test("carries a one-word search over as the column name", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    const search: HTMLElement = await open(user);
    await user.type(search, "incidentNumber");
    await user.click(screen.getByTestId(`${TEST_ID}-by-name`));

    const nameInput: HTMLElement = screen.getByTestId(`${TEST_ID}-custom`);

    expect(nameInput).toHaveValue("incidentNumber");
    // Ready to type into, without reaching for the mouse.
    expect(nameInput).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledWith("incidentNumber");
  });

  test("does not carry over a search that is a phrase", async () => {
    const { user }: PickerHarness = renderPicker();

    const search: HTMLElement = await open(user);
    await user.type(search, "root cause");
    await user.click(screen.getByTestId(`${TEST_ID}-by-name`));

    expect(screen.getByTestId(`${TEST_ID}-custom`)).toHaveValue("");
  });

  test("can be backed out of", async () => {
    const { user, onAdd }: PickerHarness = renderPicker();

    await open(user);
    await user.click(screen.getByTestId(`${TEST_ID}-by-name`));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByTestId(`${TEST_ID}-custom`)).toBeNull();
    expect(screen.getByTestId(TEST_ID)).toBeVisible();
    expect(onAdd).not.toHaveBeenCalled();
  });

  test("is not offered when the caller does not allow it", async () => {
    const { user }: PickerHarness = renderPicker({ allowCustomColumn: false });

    await open(user);

    expect(screen.queryByTestId(`${TEST_ID}-by-name`)).toBeNull();
  });

  /*
   * When the schema could not be loaded there is nothing to list, and naming
   * the column is the only way left to add one.
   */
  test("is the whole control when there is nothing to list", () => {
    renderPicker({ columns: [] });

    expect(screen.getByTestId(`${TEST_ID}-custom`)).toBeVisible();
    expect(screen.queryByTestId(TEST_ID)).toBeNull();
  });

  /*
   * The editor mounts every time a step's settings open. A box that grabbed
   * focus on mount would pull it away from the step's other fields.
   */
  test("does not take focus when it is only there because nothing could be listed", () => {
    renderPicker({ columns: [] });

    expect(screen.getByTestId(`${TEST_ID}-custom`)).not.toHaveFocus();
  });
});
