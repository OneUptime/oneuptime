import ColumnCustomizationModal from "../../../../UI/Components/ModelTable/ColumnCustomizationModal";
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
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The "Customize Columns" picker. Two invariants carry real weight here and
 * are pinned below:
 *
 *  1. Nothing leaves the modal until Save. Cancel has to be a genuine escape
 *     hatch, so every checkbox and every reorder is staged in local state.
 *
 *  2. The viewer can never end up with zero columns. A table with no columns
 *     renders as an empty shell with no header row, and the only control that
 *     could undo that is the picker they just closed. Both the per-row
 *     checkbox and "Hide all" have to respect that.
 *
 * Drag-and-drop is deliberately not exercised: react-beautiful-dnd renders
 * fine in jsdom but a synthetic drag cannot be driven through it. The Up/Down
 * buttons exist precisely so that reordering is reachable without a pointer,
 * which also makes it the reorder path these tests use.
 */

type MakeEntryFunction = (data: {
  id: string;
  title: string;
  isVisible: boolean;
}) => CustomizableColumn<Monitor>;

const makeEntry: MakeEntryFunction = (data: {
  id: string;
  title: string;
  isVisible: boolean;
}): CustomizableColumn<Monitor> => {
  const column: ModelTableColumn<Monitor> = {
    field: { name: true },
    title: data.title,
    type: FieldType.Text,
  };

  return {
    id: data.id,
    column: column,
    isVisible: data.isVisible,
    isPinned: false,
  };
};

type GetDefaultColumnsFunction = () => Array<CustomizableColumn<Monitor>>;

// Three on, one off - so the count line has something to say from the start.
const getDefaultColumns: GetDefaultColumnsFunction = (): Array<
  CustomizableColumn<Monitor>
> => {
  return [
    makeEntry({ id: "name", title: "Monitor Name", isVisible: true }),
    makeEntry({
      id: "currentMonitorStatus",
      title: "Status",
      isVisible: true,
    }),
    makeEntry({ id: "description", title: "Description", isVisible: true }),
    makeEntry({ id: "createdAt", title: "Created At", isVisible: false }),
  ];
};

interface RenderedModal {
  view: RenderResult;
  onSave: MockFunction;
  onClose: MockFunction;
  onReset: MockFunction;
}

type RenderModalFunction = (data?: {
  columns?: Array<CustomizableColumn<Monitor>> | undefined;
  isDefaultLayout?: boolean | undefined;
  title?: string | undefined;
}) => RenderedModal;

const renderModal: RenderModalFunction = (data?: {
  columns?: Array<CustomizableColumn<Monitor>> | undefined;
  isDefaultLayout?: boolean | undefined;
  title?: string | undefined;
}): RenderedModal => {
  const onSave: MockFunction = getJestMockFunction();
  const onClose: MockFunction = getJestMockFunction();
  const onReset: MockFunction = getJestMockFunction();

  const view: RenderResult = render(
    <ColumnCustomizationModal<Monitor>
      columns={data?.columns || getDefaultColumns()}
      onSave={onSave}
      onClose={onClose}
      onReset={onReset}
      isDefaultLayout={data?.isDefaultLayout}
      title={data?.title}
    />,
  );

  return { view, onSave, onClose, onReset };
};

type GetSavedFunction = (
  onSave: MockFunction,
) => Array<CustomizableColumn<Monitor>>;

const getSaved: GetSavedFunction = (
  onSave: MockFunction,
): Array<CustomizableColumn<Monitor>> => {
  return onSave.mock.calls[0]![0] as Array<CustomizableColumn<Monitor>>;
};

type GetSavedIdsFunction = (onSave: MockFunction) => Array<string>;

const getSavedIds: GetSavedIdsFunction = (
  onSave: MockFunction,
): Array<string> => {
  return getSaved(onSave).map((entry: CustomizableColumn<Monitor>) => {
    return entry.id;
  });
};

type TypeSearchFunction = (view: RenderResult, text: string) => void;

const typeSearch: TypeSearchFunction = (
  view: RenderResult,
  text: string,
): void => {
  fireEvent.change(view.getByTestId("column-customization-search"), {
    target: { value: text },
  });
};

describe("ColumnCustomizationModal", () => {
  beforeEach(() => {
    /*
     * The whole Common suite runs --runInBand, so storage written by an
     * earlier file is still around. Nothing here reads it, but leaving it
     * behind is how the next test starts flaking.
     */
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("renders one row per column, with the titles visible", () => {
    const { view }: RenderedModal = renderModal();

    expect(view.getByTestId("column-customization-modal")).toBeInTheDocument();
    expect(view.getAllByTestId(/^column-toggle-/)).toHaveLength(4);

    expect(view.getByText("Monitor Name")).toBeInTheDocument();
    expect(view.getByText("Status")).toBeInTheDocument();
    expect(view.getByText("Description")).toBeInTheDocument();
    expect(view.getByText("Created At")).toBeInTheDocument();

    expect(view.getByTestId("column-toggle-name")).toBeChecked();
    expect(view.getByTestId("column-toggle-createdAt")).not.toBeChecked();
  });

  test("counts the visible columns and keeps the count in step with the checkboxes", () => {
    const { view }: RenderedModal = renderModal();

    expect(view.getByTestId("column-customization-count")).toHaveTextContent(
      "3 of 4 columns shown",
    );

    fireEvent.click(view.getByTestId("column-toggle-createdAt"));

    expect(view.getByTestId("column-customization-count")).toHaveTextContent(
      "4 of 4 columns shown",
    );

    fireEvent.click(view.getByTestId("column-toggle-description"));

    expect(view.getByTestId("column-customization-count")).toHaveTextContent(
      "3 of 4 columns shown",
    );
  });

  test("stages changes locally: nothing is handed back before Save", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("column-toggle-description"));

    expect(onSave).not.toHaveBeenCalled();
  });

  test("Cancel discards the staged changes", () => {
    const { view, onSave, onClose }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("column-toggle-description"));
    fireEvent.click(view.getByTestId("modal-footer-close-button"));

    // The caller is told to close and is told nothing else - the edit is gone.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  test("Save hands back every entry with its new isVisible flag", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("column-toggle-description"));
    fireEvent.click(view.getByTestId("column-toggle-createdAt"));
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(onSave).toHaveBeenCalledTimes(1);

    /*
     * Hidden columns are still in the list. The caller needs the full set to
     * build the stored layout - "hidden" is not the complement of "order".
     */
    expect(
      getSaved(onSave).map((entry: CustomizableColumn<Monitor>) => {
        return { id: entry.id, isVisible: entry.isVisible };
      }),
    ).toEqual([
      { id: "name", isVisible: true },
      { id: "currentMonitorStatus", isVisible: true },
      { id: "description", isVisible: false },
      { id: "createdAt", isVisible: true },
    ]);
  });

  test("the last visible column cannot be switched off", () => {
    const { view, onSave }: RenderedModal = renderModal({
      columns: [
        makeEntry({ id: "name", title: "Monitor Name", isVisible: true }),
        makeEntry({
          id: "description",
          title: "Description",
          isVisible: false,
        }),
        makeEntry({ id: "createdAt", title: "Created At", isVisible: false }),
      ],
    });

    const onlyVisible: HTMLElement = view.getByTestId("column-toggle-name");

    // First line of defence: the viewer cannot reach the control at all.
    expect(onlyVisible).toBeDisabled();

    /*
     * Second line of defence: even if a change does arrive - a stray
     * programmatic event, a future restyle that drops `disabled` - the state
     * update refuses rather than leaving the table with no columns to render.
     */
    fireEvent.click(onlyVisible);
    fireEvent.change(onlyVisible, { target: { checked: false } });

    expect(view.getByTestId("column-customization-count")).toHaveTextContent(
      "1 of 3 columns shown",
    );

    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(
      getSaved(onSave).filter((entry: CustomizableColumn<Monitor>) => {
        return entry.isVisible;
      }),
    ).toHaveLength(1);
  });

  test("switching the second-to-last column off locks the survivor", () => {
    const { view }: RenderedModal = renderModal({
      columns: [
        makeEntry({ id: "name", title: "Monitor Name", isVisible: true }),
        makeEntry({ id: "description", title: "Description", isVisible: true }),
      ],
    });

    expect(view.getByTestId("column-toggle-name")).not.toBeDisabled();

    fireEvent.click(view.getByTestId("column-toggle-description"));

    expect(view.getByTestId("column-customization-count")).toHaveTextContent(
      "1 of 2 columns shown",
    );
    expect(view.getByTestId("column-toggle-name")).toBeDisabled();
  });

  test("Down moves a column later and Save reports the new order", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("column-move-down-name"));
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(getSavedIds(onSave)).toEqual([
      "currentMonitorStatus",
      "name",
      "description",
      "createdAt",
    ]);
  });

  test("Up moves a column earlier and Save reports the new order", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("column-move-up-createdAt"));
    fireEvent.click(view.getByTestId("column-move-up-createdAt"));
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(getSavedIds(onSave)).toEqual([
      "name",
      "createdAt",
      "currentMonitorStatus",
      "description",
    ]);
  });

  test("reordering does not disturb the visibility flags", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("column-move-up-createdAt"));
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(
      getSaved(onSave).map((entry: CustomizableColumn<Monitor>) => {
        return { id: entry.id, isVisible: entry.isVisible };
      }),
    ).toEqual([
      { id: "name", isVisible: true },
      { id: "currentMonitorStatus", isVisible: true },
      { id: "createdAt", isVisible: false },
      { id: "description", isVisible: true },
    ]);
  });

  test("Up is dead on the first row and Down on the last, and that follows the move", () => {
    const { view }: RenderedModal = renderModal();

    expect(view.getByTestId("column-move-up-name")).toBeDisabled();
    expect(view.getByTestId("column-move-down-name")).not.toBeDisabled();
    expect(view.getByTestId("column-move-down-createdAt")).toBeDisabled();
    expect(view.getByTestId("column-move-up-createdAt")).not.toBeDisabled();

    fireEvent.click(view.getByTestId("column-move-down-name"));

    // "name" is now second, so both of its buttons are live and Status leads.
    expect(view.getByTestId("column-move-up-name")).not.toBeDisabled();
    expect(
      view.getByTestId("column-move-up-currentMonitorStatus"),
    ).toBeDisabled();
  });

  test("Show all turns every column on", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("column-customization-show-all"));

    expect(view.getByTestId("column-customization-count")).toHaveTextContent(
      "4 of 4 columns shown",
    );

    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(
      getSaved(onSave).every((entry: CustomizableColumn<Monitor>) => {
        return entry.isVisible;
      }),
    ).toBe(true);
  });

  test("Hide all leaves exactly one column standing - the first", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("column-customization-hide-all"));

    /*
     * Not zero: the leftmost column is kept because it is normally the one
     * that identifies the row, and because a table with no columns cannot be
     * recovered from.
     */
    expect(view.getByTestId("column-customization-count")).toHaveTextContent(
      "1 of 4 columns shown",
    );
    expect(view.getByTestId("column-toggle-name")).toBeDisabled();

    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(
      getSaved(onSave)
        .filter((entry: CustomizableColumn<Monitor>) => {
          return entry.isVisible;
        })
        .map((entry: CustomizableColumn<Monitor>) => {
          return entry.id;
        }),
    ).toEqual(["name"]);
  });

  test("Hide all keeps the first column even after the list has been reordered", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("column-move-up-createdAt"));
    fireEvent.click(view.getByTestId("column-move-up-createdAt"));
    fireEvent.click(view.getByTestId("column-move-up-createdAt"));
    fireEvent.click(view.getByTestId("column-customization-hide-all"));
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    // "createdAt" is now the leftmost column, so it is the one that survives.
    expect(
      getSaved(onSave)
        .filter((entry: CustomizableColumn<Monitor>) => {
          return entry.isVisible;
        })
        .map((entry: CustomizableColumn<Monitor>) => {
          return entry.id;
        }),
    ).toEqual(["createdAt"]);
  });

  test("search filters the list by title", () => {
    const { view }: RenderedModal = renderModal();

    typeSearch(view, "desc");

    expect(view.getAllByTestId(/^column-toggle-/)).toHaveLength(1);
    expect(view.getByTestId("column-toggle-description")).toBeInTheDocument();
    expect(view.queryByTestId("column-toggle-name")).not.toBeInTheDocument();
  });

  test("search is case-insensitive and ignores surrounding whitespace", () => {
    const { view }: RenderedModal = renderModal();

    typeSearch(view, "  STATUS  ");

    expect(view.getAllByTestId(/^column-toggle-/)).toHaveLength(1);
    expect(
      view.getByTestId("column-toggle-currentMonitorStatus"),
    ).toBeInTheDocument();
  });

  test("search says so when nothing matches", () => {
    const { view }: RenderedModal = renderModal();

    typeSearch(view, "no-such-column");

    expect(view.queryAllByTestId(/^column-toggle-/)).toHaveLength(0);
    expect(
      view.getByTestId("column-customization-no-results"),
    ).toHaveTextContent('No columns match "no-such-column".');
  });

  test("the move buttons are inert while a search is active", () => {
    const { view }: RenderedModal = renderModal();

    typeSearch(view, "e");

    /*
     * A filtered list renumbers the rows, so "move down" would land the column
     * at a position that only means something inside the filter. Rather than
     * guess what the viewer meant, reordering is switched off until the search
     * is cleared.
     */
    expect(view.getByTestId("column-move-up-description")).toBeDisabled();
    expect(view.getByTestId("column-move-down-description")).toBeDisabled();
    expect(view.getByTestId("column-move-up-name")).toBeDisabled();
    expect(view.getByTestId("column-move-down-name")).toBeDisabled();
  });

  test("clearing the search restores the full list and the move buttons", () => {
    const { view, onSave }: RenderedModal = renderModal();

    typeSearch(view, "desc");
    expect(view.getAllByTestId(/^column-toggle-/)).toHaveLength(1);

    typeSearch(view, "");

    expect(view.getAllByTestId(/^column-toggle-/)).toHaveLength(4);
    expect(view.getByTestId("column-move-down-name")).not.toBeDisabled();
    expect(view.getByTestId("column-move-up-description")).not.toBeDisabled();

    // And reordering works again once the buttons come back.
    fireEvent.click(view.getByTestId("column-move-down-name"));
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(getSavedIds(onSave)).toEqual([
      "currentMonitorStatus",
      "name",
      "description",
      "createdAt",
    ]);
  });

  test("a change made before searching survives the search", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("column-toggle-description"));
    typeSearch(view, "created");
    fireEvent.click(view.getByTestId("column-toggle-createdAt"));
    typeSearch(view, "");
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(
      getSaved(onSave).map((entry: CustomizableColumn<Monitor>) => {
        return { id: entry.id, isVisible: entry.isVisible };
      }),
    ).toEqual([
      { id: "name", isVisible: true },
      { id: "currentMonitorStatus", isVisible: true },
      { id: "description", isVisible: false },
      { id: "createdAt", isVisible: true },
    ]);
  });

  test("Reset is absent while the layout is still the one the table ships", () => {
    const { view }: RenderedModal = renderModal({ isDefaultLayout: true });

    // Nothing to reset to, so offering the button would only be confusing.
    expect(
      view.queryByTestId("column-customization-reset"),
    ).not.toBeInTheDocument();
  });

  test("Reset appears once the layout has been customized and calls back", () => {
    const { view, onReset, onSave }: RenderedModal = renderModal({
      isDefaultLayout: false,
    });

    const reset: HTMLElement = view.getByTestId("column-customization-reset");

    expect(reset).toBeInTheDocument();

    fireEvent.click(reset);

    // Reset is the caller's business: it drops the stored layout, not a draft.
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  test("uses a custom title when one is given", () => {
    const { view }: RenderedModal = renderModal({
      title: "Pick your columns",
    });

    expect(view.getByTestId("modal-title")).toHaveTextContent(
      "Pick your columns",
    );
  });

  test("falls back to the default title", () => {
    const { view }: RenderedModal = renderModal();

    expect(view.getByTestId("modal-title")).toHaveTextContent(
      "Customize Columns",
    );
  });
});
