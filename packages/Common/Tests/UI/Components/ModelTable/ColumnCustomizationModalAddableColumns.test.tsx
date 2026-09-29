import ColumnCustomizationModal, {
  AddableColumnsConfig,
} from "../../../../UI/Components/ModelTable/ColumnCustomizationModal";
import {
  CustomizableColumn,
  ModelTableColumn,
} from "../../../../UI/Components/ModelTable/ColumnPreference";
import { getAttributeColumns } from "../../../../UI/Components/ModelTable/AttributeColumns";
import Column from "../../../../UI/Components/ModelTable/Column";
import Columns from "../../../../UI/Components/ModelTable/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
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
 * The "add a column" half of the picker.
 *
 * It exists because some columns cannot be a checklist: the keys inside a
 * security event's `attributes` map are whatever the source sent, differ per
 * event class, and there can be several hundred of them. A checkbox each would
 * bury the columns the table was designed around and hand "Show all" a way to
 * put 500 columns on screen. So they are offered through a search box, and
 * only what someone asks for is materialized.
 *
 * The invariants that carry weight, all pinned below:
 *
 *  1. Adding is still staging. Nothing leaves the modal before Save, exactly
 *     like every checkbox and every reorder.
 *  2. A column already in the list is not offered again - otherwise adding it
 *     twice would put two columns with the same id into the layout.
 *  3. Removing is hiding plus forgetting, so it is bound by the same rule:
 *     the last column standing cannot go.
 *  4. Only columns that say they are removable get a remove button. A column
 *     the table ships must never be removable, because nothing would put it
 *     back.
 */

type MakeEntryFunction = (data: {
  id: string;
  title: string;
  isVisible: boolean;
  isRemovable?: boolean | undefined;
}) => CustomizableColumn<SecurityEvent>;

const makeEntry: MakeEntryFunction = (data: {
  id: string;
  title: string;
  isVisible: boolean;
  isRemovable?: boolean | undefined;
}): CustomizableColumn<SecurityEvent> => {
  const column: ModelTableColumn<SecurityEvent> = {
    field: { message: true },
    title: data.title,
    type: FieldType.Text,
  };

  return {
    id: data.id,
    column: column,
    isVisible: data.isVisible,
    isPinned: false,
    isRemovable: data.isRemovable,
  };
};

type GetDeclaredColumnsFunction = () => Array<
  CustomizableColumn<SecurityEvent>
>;

const getDeclaredColumns: GetDeclaredColumnsFunction = (): Array<
  CustomizableColumn<SecurityEvent>
> => {
  return [
    makeEntry({ id: "time", title: "Time", isVisible: true }),
    makeEntry({ id: "severityName", title: "Severity", isVisible: true }),
    makeEntry({ id: "eventUid", title: "Event UID", isVisible: false }),
  ];
};

/*
 * Real generated attribute columns rather than placeholders: the ids the
 * layout is keyed on come out of that generator, so a pool of fake entries
 * would not exercise the same identity the app uses.
 */
type MakePoolFunction = (
  attributeKeys: Array<string>,
) => Array<CustomizableColumn<SecurityEvent>>;

const makePool: MakePoolFunction = (
  attributeKeys: Array<string>,
): Array<CustomizableColumn<SecurityEvent>> => {
  const columns: Columns<SecurityEvent> = getAttributeColumns<SecurityEvent>({
    attributesColumnKey: "attributes",
    attributeKeys: attributeKeys,
  });

  return columns.map(
    (column: Column<SecurityEvent>): CustomizableColumn<SecurityEvent> => {
      return {
        id: column.id as string,
        column: column,
        isVisible: true,
        isPinned: false,
        isRemovable: true,
      };
    },
  );
};

const POOL_KEYS: Array<string> = [
  "activity_name",
  "class_uid",
  "device.hostname",
  "finding_info.title",
  "metadata.product.name",
];

interface RenderedModal {
  view: RenderResult;
  onSave: MockFunction;
  onClose: MockFunction;
  onReset: MockFunction;
}

type RenderModalFunction = (data?: {
  columns?: Array<CustomizableColumn<SecurityEvent>> | undefined;
  addableColumns?: AddableColumnsConfig<SecurityEvent> | undefined | null;
}) => RenderedModal;

const renderModal: RenderModalFunction = (data?: {
  columns?: Array<CustomizableColumn<SecurityEvent>> | undefined;
  addableColumns?: AddableColumnsConfig<SecurityEvent> | undefined | null;
}): RenderedModal => {
  const onSave: MockFunction = getJestMockFunction();
  const onClose: MockFunction = getJestMockFunction();
  const onReset: MockFunction = getJestMockFunction();

  const addableColumns: AddableColumnsConfig<SecurityEvent> | undefined =
    data?.addableColumns === null
      ? undefined
      : data?.addableColumns || {
          title: "Add Attribute Column",
          description: "Attributes differ per event.",
          placeholder: "Search attributes...",
          columns: makePool(POOL_KEYS),
        };

  const view: RenderResult = render(
    <ColumnCustomizationModal<SecurityEvent>
      columns={data?.columns || getDeclaredColumns()}
      addableColumns={addableColumns}
      onSave={onSave}
      onClose={onClose}
      onReset={onReset}
    />,
  );

  return { view, onSave, onClose, onReset };
};

type GetSavedIdsFunction = (onSave: MockFunction) => Array<string>;

const getSavedIds: GetSavedIdsFunction = (
  onSave: MockFunction,
): Array<string> => {
  return (
    onSave.mock.calls[0]![0] as Array<CustomizableColumn<SecurityEvent>>
  ).map((entry: CustomizableColumn<SecurityEvent>) => {
    return entry.id;
  });
};

type TypeAddSearchFunction = (view: RenderResult, text: string) => void;

const typeAddSearch: TypeAddSearchFunction = (
  view: RenderResult,
  text: string,
): void => {
  fireEvent.change(view.getByTestId("add-column-search"), {
    target: { value: text },
  });
};

describe("ColumnCustomizationModal - addable columns", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("the section is absent entirely when no pool is configured", () => {
    const { view }: RenderedModal = renderModal({ addableColumns: null });

    expect(view.queryByTestId("add-column-section")).not.toBeInTheDocument();
    expect(view.queryByTestId("add-column-search")).not.toBeInTheDocument();
  });

  test("renders its own title, description and search box", () => {
    const { view }: RenderedModal = renderModal();

    expect(view.getByTestId("add-column-section")).toBeInTheDocument();
    expect(view.getByText("Add Attribute Column")).toBeInTheDocument();
    expect(view.getByText("Attributes differ per event.")).toBeInTheDocument();
    expect(view.getByTestId("add-column-search")).toHaveAttribute(
      "placeholder",
      "Search attributes...",
    );
  });

  test("offers every key in the pool", () => {
    const { view }: RenderedModal = renderModal();

    expect(view.getAllByTestId(/^add-column-attributes\./)).toHaveLength(
      POOL_KEYS.length,
    );
    expect(view.getByText("device.hostname")).toBeInTheDocument();
  });

  /*
   * The pool is offered against the column TITLE, which for an attribute
   * column is the raw key - so searching for the key someone read in the
   * detail panel is what finds it.
   */
  test("searching narrows the pool by key", () => {
    const { view }: RenderedModal = renderModal();

    typeAddSearch(view, "device");

    expect(view.getAllByTestId(/^add-column-attributes\./)).toHaveLength(1);
    expect(
      view.getByTestId("add-column-attributes.device.hostname"),
    ).toBeInTheDocument();
  });

  test("the search is case-insensitive and matches anywhere in the key", () => {
    const { view }: RenderedModal = renderModal();

    typeAddSearch(view, "PRODUCT");

    expect(
      view.getByTestId("add-column-attributes.metadata.product.name"),
    ).toBeInTheDocument();
  });

  test("surrounding whitespace in the search is ignored", () => {
    const { view }: RenderedModal = renderModal();

    typeAddSearch(view, "   class_uid   ");

    expect(view.getAllByTestId(/^add-column-attributes\./)).toHaveLength(1);
  });

  test("a search that matches nothing says so", () => {
    const { view }: RenderedModal = renderModal();

    typeAddSearch(view, "no-such-key");

    expect(view.getByTestId("add-column-no-results")).toHaveTextContent(
      'No matches for "no-such-key"',
    );
    expect(view.queryAllByTestId(/^add-column-attributes\./)).toHaveLength(0);
  });

  test("the search can be cleared, which brings the whole pool back", () => {
    const { view }: RenderedModal = renderModal();

    typeAddSearch(view, "device");
    expect(view.getAllByTestId(/^add-column-attributes\./)).toHaveLength(1);

    fireEvent.click(view.getByTestId("add-column-search-clear"));

    expect(view.getAllByTestId(/^add-column-attributes\./)).toHaveLength(
      POOL_KEYS.length,
    );
  });

  test("adding puts the column in the list, visible, at the end", () => {
    const { view }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("add-column-attributes.device.hostname"));

    expect(
      view.getByTestId("column-toggle-attributes.device.hostname"),
    ).toBeChecked();

    expect(view.getByTestId("column-customization-count")).toHaveTextContent(
      "3 of 4 columns shown",
    );
  });

  test("an added column is no longer offered in the pool", () => {
    const { view }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("add-column-attributes.device.hostname"));

    expect(
      view.queryByTestId("add-column-attributes.device.hostname"),
    ).not.toBeInTheDocument();
    expect(view.getAllByTestId(/^add-column-attributes\./)).toHaveLength(
      POOL_KEYS.length - 1,
    );
  });

  test("adding stages: nothing is handed back before Save", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("add-column-attributes.device.hostname"));

    expect(onSave).not.toHaveBeenCalled();
  });

  test("Save hands back the added column alongside the declared ones", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("add-column-attributes.device.hostname"));
    fireEvent.click(view.getByTestId("add-column-attributes.class_uid"));
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(getSavedIds(onSave)).toEqual([
      "time",
      "severityName",
      "eventUid",
      "attributes.device.hostname",
      "attributes.class_uid",
    ]);
  });

  test("Cancel discards an added column", () => {
    const { view, onSave, onClose }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("add-column-attributes.device.hostname"));
    fireEvent.click(view.getByTestId("modal-footer-close-button"));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test("an added column can be reordered like any other", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("add-column-attributes.device.hostname"));
    fireEvent.click(
      view.getByTestId("column-move-up-attributes.device.hostname"),
    );
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(getSavedIds(onSave)).toEqual([
      "time",
      "severityName",
      "attributes.device.hostname",
      "eventUid",
    ]);
  });

  test("an added column can be switched off without being removed", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("add-column-attributes.device.hostname"));
    fireEvent.click(
      view.getByTestId("column-toggle-attributes.device.hostname"),
    );
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    const saved: Array<CustomizableColumn<SecurityEvent>> = onSave.mock
      .calls[0]![0] as Array<CustomizableColumn<SecurityEvent>>;

    const added: CustomizableColumn<SecurityEvent> | undefined = saved.find(
      (entry: CustomizableColumn<SecurityEvent>) => {
        return entry.id === "attributes.device.hostname";
      },
    );

    expect(added).toBeDefined();
    expect(added!.isVisible).toBe(false);
  });

  test("the same pool entry cannot be added twice", () => {
    /*
     * Not reachable through the UI (an added column leaves the pool), but the
     * guard is what keeps two columns with one id out of the stored layout if
     * a double click ever races the re-render.
     */
    const pool: Array<CustomizableColumn<SecurityEvent>> = makePool([
      "device.hostname",
    ]);

    const { view, onSave }: RenderedModal = renderModal({
      columns: [
        ...getDeclaredColumns(),
        { ...(pool[0] as CustomizableColumn<SecurityEvent>) },
      ],
      addableColumns: {
        title: "Add Attribute Column",
        columns: pool,
      },
    });

    // Already staged, so the pool has nothing left to offer.
    expect(view.getByTestId("add-column-empty")).toBeInTheDocument();

    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(
      getSavedIds(onSave).filter((id: string) => {
        return id === "attributes.device.hostname";
      }),
    ).toHaveLength(1);
  });
});

describe("ColumnCustomizationModal - removing a column", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("only removable columns get a remove button", () => {
    const { view }: RenderedModal = renderModal();

    expect(view.queryByTestId("column-remove-time")).not.toBeInTheDocument();
    expect(
      view.queryByTestId("column-remove-severityName"),
    ).not.toBeInTheDocument();

    fireEvent.click(view.getByTestId("add-column-attributes.device.hostname"));

    expect(
      view.getByTestId("column-remove-attributes.device.hostname"),
    ).toBeInTheDocument();
  });

  test("removing takes the column out of the list", () => {
    const { view }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("add-column-attributes.device.hostname"));
    fireEvent.click(
      view.getByTestId("column-remove-attributes.device.hostname"),
    );

    expect(
      view.queryByTestId("column-toggle-attributes.device.hostname"),
    ).not.toBeInTheDocument();
    expect(view.getByTestId("column-customization-count")).toHaveTextContent(
      "2 of 3 columns shown",
    );
  });

  test("a removed column goes back into the pool", () => {
    const { view }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("add-column-attributes.device.hostname"));
    fireEvent.click(
      view.getByTestId("column-remove-attributes.device.hostname"),
    );

    expect(
      view.getByTestId("add-column-attributes.device.hostname"),
    ).toBeInTheDocument();
  });

  test("Save without the removed column is what drops it for good", () => {
    const { view, onSave }: RenderedModal = renderModal({
      columns: [
        ...getDeclaredColumns(),
        ...makePool(["device.hostname"]).map(
          (entry: CustomizableColumn<SecurityEvent>) => {
            return { ...entry, isVisible: true };
          },
        ),
      ],
    });

    fireEvent.click(
      view.getByTestId("column-remove-attributes.device.hostname"),
    );
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(getSavedIds(onSave)).toEqual(["time", "severityName", "eventUid"]);
  });

  /*
   * Removing is hiding plus forgetting, so it inherits the rule that keeps a
   * table from becoming an empty shell with no header row and no way back.
   */
  test("the last visible column cannot be removed", () => {
    const only: Array<CustomizableColumn<SecurityEvent>> = makePool([
      "device.hostname",
    ]);

    const { view }: RenderedModal = renderModal({
      columns: only,
      addableColumns: { title: "Add Attribute Column", columns: [] },
    });

    const removeButton: HTMLElement = view.getByTestId(
      "column-remove-attributes.device.hostname",
    );

    expect(removeButton).toBeDisabled();

    fireEvent.click(removeButton);

    expect(
      view.getByTestId("column-toggle-attributes.device.hostname"),
    ).toBeInTheDocument();
  });

  test("a hidden removable column can still be removed while another is on", () => {
    const { view, onSave }: RenderedModal = renderModal();

    fireEvent.click(view.getByTestId("add-column-attributes.device.hostname"));
    fireEvent.click(
      view.getByTestId("column-toggle-attributes.device.hostname"),
    );
    fireEvent.click(
      view.getByTestId("column-remove-attributes.device.hostname"),
    );
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(getSavedIds(onSave)).toEqual(["time", "severityName", "eventUid"]);
  });
});

describe("ColumnCustomizationModal - pool states", () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("says it is loading rather than reading as empty", () => {
    const { view }: RenderedModal = renderModal({
      addableColumns: {
        title: "Add Attribute Column",
        isLoading: true,
        columns: [],
      },
    });

    expect(view.getByTestId("add-column-loading")).toBeInTheDocument();
    expect(view.queryByTestId("add-column-empty")).not.toBeInTheDocument();
  });

  test("surfaces a failure instead of pretending there is nothing to add", () => {
    const { view }: RenderedModal = renderModal({
      addableColumns: {
        title: "Add Attribute Column",
        errorMessage: "Could not load attributes.",
        columns: [],
      },
    });

    expect(view.getByTestId("add-column-error")).toHaveTextContent(
      "Could not load attributes.",
    );
  });

  /*
   * An error takes precedence over the loading state: a retry that fails
   * again must not flash back to "Loading..." and hide why.
   */
  test("an error wins over a concurrent loading flag", () => {
    const { view }: RenderedModal = renderModal({
      addableColumns: {
        title: "Add Attribute Column",
        isLoading: true,
        errorMessage: "Could not load attributes.",
        columns: [],
      },
    });

    expect(view.getByTestId("add-column-error")).toBeInTheDocument();
    expect(view.queryByTestId("add-column-loading")).not.toBeInTheDocument();
  });

  test("an empty pool shows the caller's message", () => {
    const { view }: RenderedModal = renderModal({
      addableColumns: {
        title: "Add Attribute Column",
        emptyMessage: "No attributes seen on recent events.",
        columns: [],
      },
    });

    expect(view.getByTestId("add-column-empty")).toHaveTextContent(
      "No attributes seen on recent events.",
    );
  });

  test("a pool whose entries are all already added says something different", () => {
    const pool: Array<CustomizableColumn<SecurityEvent>> = makePool([
      "device.hostname",
    ]);

    const { view }: RenderedModal = renderModal({
      columns: [...getDeclaredColumns(), ...pool],
      addableColumns: {
        title: "Add Attribute Column",
        emptyMessage: "No attributes seen on recent events.",
        columns: pool,
      },
    });

    expect(view.getByTestId("add-column-empty")).toHaveTextContent(
      "already in the list above",
    );
  });

  /*
   * A project can carry thousands of attribute keys. Rendering all of them
   * would put the whole list in the DOM and make the picker crawl, so the
   * list is capped and the cap is said out loud - otherwise someone whose key
   * is not shown has no reason to believe typing more would find it.
   */
  test("caps how many matches are rendered at once", () => {
    const keys: Array<string> = Array.from(
      { length: 40 },
      (_unused: unknown, index: number) => {
        return `attr.key${String(index).padStart(2, "0")}`;
      },
    );

    const { view }: RenderedModal = renderModal({
      addableColumns: {
        title: "Add Attribute Column",
        columns: makePool(keys),
        maxResults: 10,
      },
    });

    expect(view.getAllByTestId(/^add-column-attributes\./)).toHaveLength(10);
    expect(view.getByTestId("add-column-hint")).toHaveTextContent(
      "Showing 10 of 40",
    );
  });

  test("the cap notice disappears once the search fits inside it", () => {
    const keys: Array<string> = Array.from(
      { length: 40 },
      (_unused: unknown, index: number) => {
        return `attr.key${String(index).padStart(2, "0")}`;
      },
    );

    const { view }: RenderedModal = renderModal({
      addableColumns: {
        title: "Add Attribute Column",
        columns: makePool(keys),
        maxResults: 10,
      },
    });

    typeAddSearch(view, "key07");

    expect(view.getAllByTestId(/^add-column-attributes\./)).toHaveLength(1);
    expect(view.queryByTestId("add-column-hint")).not.toBeInTheDocument();
  });

  test("a key beyond the cap is still reachable by searching for it", () => {
    const keys: Array<string> = Array.from(
      { length: 40 },
      (_unused: unknown, index: number) => {
        return `attr.key${String(index).padStart(2, "0")}`;
      },
    );

    const { view, onSave }: RenderedModal = renderModal({
      addableColumns: {
        title: "Add Attribute Column",
        columns: makePool(keys),
        maxResults: 10,
      },
    });

    expect(
      view.queryByTestId("add-column-attributes.attr.key39"),
    ).not.toBeInTheDocument();

    typeAddSearch(view, "key39");
    fireEvent.click(view.getByTestId("add-column-attributes.attr.key39"));
    fireEvent.click(view.getByTestId("modal-footer-submit-button"));

    expect(getSavedIds(onSave)).toContain("attributes.attr.key39");
  });
});
