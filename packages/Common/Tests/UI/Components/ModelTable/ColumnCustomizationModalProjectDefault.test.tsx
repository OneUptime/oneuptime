import ColumnCustomizationModal, {
  COLUMN_CUSTOMIZATION_EVERYONE_TEST_ID,
  COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_NOTE_TEST_ID,
  COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_PANEL_CLASS_NAME,
  COLUMN_CUSTOMIZATION_REMOVE_DEFAULT_TEST_ID,
  ColumnCustomizationProjectDefault,
} from "../../../../UI/Components/ModelTable/ColumnCustomizationModal";
import {
  CustomizableColumn,
  ModelTableColumn,
} from "../../../../UI/Components/ModelTable/ColumnPreference";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The Customize Columns picker's part in "Default columns per project"
 * (#5485's follow-ups): a Project Owner or Admin may show the columns to
 * everyone in the project, with a box off each time the picker opens, and
 * take a list's default away; anyone else who sees the project's default is
 * told so, and that what they save is theirs alone; Reset says where it
 * takes them. BaseModelTableProjectDefaultColumns drives the same picker
 * through a real list.
 */

const makeEntry: (id: string, title: string) => CustomizableColumn<Monitor> = (
  id: string,
  title: string,
): CustomizableColumn<Monitor> => {
  const column: ModelTableColumn<Monitor> = {
    field: { name: true },
    title: title,
    type: FieldType.Text,
  };

  return { id: id, column: column, isVisible: true, isPinned: false };
};

const COLUMNS: Array<CustomizableColumn<Monitor>> = [
  makeEntry("name", "Name"),
  makeEntry("labels", "Labels"),
];

interface Drawn {
  view: RenderResult;
  onSave: MockFunction;
  onRemove: MockFunction;
}

const draw: (data?: {
  projectDefault?: Partial<ColumnCustomizationProjectDefault> | undefined;
  hasProject?: boolean | undefined;
  isDefaultLayout?: boolean | undefined;
  isSaving?: boolean | undefined;
  error?: string | undefined;
}) => Drawn = (data?: {
  projectDefault?: Partial<ColumnCustomizationProjectDefault> | undefined;
  hasProject?: boolean | undefined;
  isDefaultLayout?: boolean | undefined;
  isSaving?: boolean | undefined;
  error?: string | undefined;
}): Drawn => {
  const onSave: MockFunction = getJestMockFunction();
  const onRemove: MockFunction = getJestMockFunction();
  const projectDefault: ColumnCustomizationProjectDefault | undefined =
    data?.hasProject === false
      ? undefined
      : {
          hasDefault: false,
          isFollowed: true,
          canChange: false,
          onRemove: onRemove,
          ...(data?.projectDefault || {}),
        };

  const view: RenderResult = render(
    <ColumnCustomizationModal<Monitor>
      columns={COLUMNS}
      onSave={onSave}
      onClose={getJestMockFunction()}
      onReset={getJestMockFunction()}
      isDefaultLayout={data?.isDefaultLayout ?? true}
      projectDefault={projectDefault}
      isSaving={data?.isSaving}
      error={data?.error}
    />,
  );

  return { view, onSave, onRemove };
};

const everyoneBox: () => HTMLInputElement = (): HTMLInputElement => {
  return screen
    .getByTestId(COLUMN_CUSTOMIZATION_EVERYONE_TEST_ID)
    .closest("div")
    ?.querySelector("input[type='checkbox']") as HTMLInputElement;
};

afterEach(() => {
  cleanup();
});

describe("Save says whether the columns are everyone's", () => {
  test("not unless the box is ticked: a person's own save is theirs alone", () => {
    const { onSave }: Drawn = draw({ projectDefault: { canChange: true } });

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![1]).toEqual({ isForEveryone: false });
  });

  test("ticked, they are", () => {
    const { onSave }: Drawn = draw({ projectDefault: { canChange: true } });

    expect(everyoneBox().checked).toBe(false);
    fireEvent.click(everyoneBox());
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(onSave.mock.calls[0]![1]).toEqual({ isForEveryone: true });
    expect(
      (onSave.mock.calls[0]![0] as Array<CustomizableColumn<Monitor>>).map(
        (entry: CustomizableColumn<Monitor>): string => {
          return entry.id;
        },
      ),
    ).toEqual(["name", "labels"]);
  });

  test("with no project (the Admin Dashboard), never: no box, no note", () => {
    const { onSave }: Drawn = draw({ hasProject: false });

    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_EVERYONE_TEST_ID),
    ).toBeNull();
    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_NOTE_TEST_ID),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(onSave.mock.calls[0]![1]).toEqual({ isForEveryone: false });
  });
});

describe("what a Project Owner or Admin is told", () => {
  test("with no default for the list: who will see the columns", () => {
    draw({ projectDefault: { canChange: true } });

    expect(
      screen.getByText("Show these columns to everyone in this project"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Anyone who hasn't picked their own columns for this list sees these.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_REMOVE_DEFAULT_TEST_ID),
    ).toBeNull();
  });

  test("with one: that ticking it replaces it, and that it may be taken away", () => {
    const { onRemove }: Drawn = draw({
      projectDefault: { canChange: true, hasDefault: true },
    });

    expect(
      screen.getByText(
        "Replaces this list's default columns. Anyone who picked their own keeps theirs.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This list has default columns for everyone in this project.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(COLUMN_CUSTOMIZATION_REMOVE_DEFAULT_TEST_ID),
    );

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  test("is not told the note others get: the box says it all", () => {
    draw({ projectDefault: { canChange: true, hasDefault: true } });

    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_NOTE_TEST_ID),
    ).toBeNull();
  });

  test("while it saves, the box and Remove default wait", () => {
    draw({
      projectDefault: { canChange: true, hasDefault: true },
      isSaving: true,
    });

    expect(everyoneBox()).toBeDisabled();
    expect(
      screen.getByTestId(COLUMN_CUSTOMIZATION_REMOVE_DEFAULT_TEST_ID),
    ).toBeDisabled();
  });

  test("what the server refused is said in the picker", () => {
    draw({
      projectDefault: { canChange: true },
      error: "You do not have permission to update this project.",
    });

    expect(
      screen.getByText("You do not have permission to update this project."),
    ).toBeInTheDocument();
  });
});

describe("what anyone else is told", () => {
  test("seeing the project's default: that it is, and that what they save is theirs alone", () => {
    draw({ projectDefault: { hasDefault: true, isFollowed: true } });

    expect(
      screen.getByTestId(COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_NOTE_TEST_ID),
    ).toHaveTextContent(
      "These are this project's default columns for this list. Changes you save are only for you.",
    );
    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_EVERYONE_TEST_ID),
    ).toBeNull();
  });

  /*
   * In the panel an Owner's box is drawn in, with the project's people for
   * its mark: under the list's hint on how to arrange it ("Drag a row..."),
   * a line of the same small grey read as one more hint, where it is a word
   * about everyone's columns.
   */
  test("in the panel an Owner's box is drawn in, set apart from the hint on arranging the list", () => {
    draw({ projectDefault: { hasDefault: true, isFollowed: true } });

    const note: HTMLElement = screen.getByTestId(
      COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_NOTE_TEST_ID,
    );

    for (const name of COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_PANEL_CLASS_NAME.split(
      " ",
    )) {
      expect(note.className.split(" ")).toContain(name);
    }
    expect(note.querySelector("svg")).not.toBeNull();
    expect(note.querySelector("p")).toHaveClass("text-sm");

    cleanup();
    draw({ projectDefault: { hasDefault: true, canChange: true } });

    // The Owner's box sits in a panel of the same classes.
    const isPanel: (element: Element) => boolean = (
      element: Element,
    ): boolean => {
      return COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_PANEL_CLASS_NAME.split(
        " ",
      ).every((name: string): boolean => {
        return element.classList.contains(name);
      });
    };

    let element: Element | null = screen.getByTestId(
      COLUMN_CUSTOMIZATION_EVERYONE_TEST_ID,
    );

    while (element && !isPanel(element)) {
      element = element.parentElement;
    }

    expect(element).not.toBeNull();
  });

  test("seeing their own columns, or with no default for the list: nothing", () => {
    draw({ projectDefault: { hasDefault: true, isFollowed: false } });

    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_NOTE_TEST_ID),
    ).toBeNull();

    cleanup();
    draw({ projectDefault: { hasDefault: false } });

    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_NOTE_TEST_ID),
    ).toBeNull();
  });
});

describe("Reset says where it takes the viewer", () => {
  test("to the project's default, where the list has one", () => {
    draw({ projectDefault: { hasDefault: true }, isDefaultLayout: false });

    expect(screen.getByTestId("column-customization-reset")).toHaveTextContent(
      "Reset to project default",
    );
  });

  test("to the list's own columns, where it has none, or there is no project", () => {
    draw({ projectDefault: { hasDefault: false }, isDefaultLayout: false });

    expect(screen.getByTestId("column-customization-reset")).toHaveTextContent(
      "Reset to default",
    );

    cleanup();
    draw({ hasProject: false, isDefaultLayout: false });

    expect(screen.getByTestId("column-customization-reset")).toHaveTextContent(
      "Reset to default",
    );
  });

  test("waits while the project's default saves", () => {
    draw({
      projectDefault: { hasDefault: true },
      isDefaultLayout: false,
      isSaving: true,
    });

    expect(screen.getByTestId("column-customization-reset")).toBeDisabled();
  });
});
