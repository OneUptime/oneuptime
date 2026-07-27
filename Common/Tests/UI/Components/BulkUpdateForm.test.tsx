import { describe, expect, test } from "@jest/globals";
import { fireEvent, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import BulkUpdateForm, {
  BulkActionButtonSchema,
  ComponentProps,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";

/*
 * react-i18next is not initialized in the test environment. Mock the hook so
 * translate helpers echo their input and the component renders synchronously.
 */
jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
}

type MakeRowsFunction = (count: number) => Array<Row>;

const makeRows: MakeRowsFunction = (count: number): Array<Row> => {
  const rows: Array<Row> = [];

  for (let i: number = 0; i < count; i++) {
    rows.push({ _id: `id-${i}`, name: `Row ${i}` });
  }

  return rows;
};

const BUTTONS: Array<BulkActionButtonSchema<Row>> = [
  {
    title: "Archive",
    buttonStyleType: ButtonStyleType.NORMAL,
    onClick: (): Promise<void> => {
      return Promise.resolve();
    },
  },
];

type RenderFormFunction = (
  overrides: Partial<ComponentProps<Row>>,
) => RenderResult;

const renderForm: RenderFormFunction = (
  overrides: Partial<ComponentProps<Row>>,
): RenderResult => {
  const props: ComponentProps<Row> = {
    selectedItems: makeRows(3),
    isAllItemsSelected: false,
    onSelectAllClick: () => {},
    onClearSelectionClick: () => {},
    singularLabel: "Label",
    pluralLabel: "Labels",
    buttons: BUTTONS,
    ...overrides,
  };

  return render(<BulkUpdateForm<Row> {...props} />);
};

describe("BulkUpdateForm", () => {
  test("renders nothing when nothing is selected", () => {
    const { container } = renderForm({ selectedItems: [] });

    expect(container.innerHTML).toBe("");
  });

  test("offers Select All while only part of the table is selected", () => {
    const { getByText } = renderForm({ isAllItemsSelected: false });

    expect(getByText("3 Labels Selected")).toBeTruthy();
    expect(getByText("Select All Labels")).toBeTruthy();
  });

  test("hides Select All once everything really is selected", () => {
    const { queryByText } = renderForm({ isAllItemsSelected: true });

    expect(queryByText("Select All Labels")).toBeNull();
  });

  test("blocks a second Select All while the first is still loading", () => {
    const onSelectAllClick: MockFunction = getJestMockFunction();

    const { getByText } = renderForm({
      isSelectingAllItems: true,
      onSelectAllClick: onSelectAllClick as unknown as () => void,
    });

    const button: HTMLElement = getByText("Selecting All Labels...");

    fireEvent.click(button);

    /*
     * Selecting everything is a paged, multi-request fetch. Letting it be
     * re-entrant would interleave two runs over the same selection.
     */
    expect(onSelectAllClick).not.toHaveBeenCalled();
  });

  test("surfaces a failed select-all next to the button that triggered it", () => {
    const { getByText } = renderForm({
      errorMessage: "Network request failed",
    });

    expect(getByText("Network request failed")).toBeTruthy();
    // The selection the user already had is still reported.
    expect(getByText("3 Labels Selected")).toBeTruthy();
  });

  test("shows no error when the select-all succeeded", () => {
    const { queryByText } = renderForm({ errorMessage: undefined });

    expect(queryByText(/failed/)).toBeNull();
  });

  test("names real numbers when the selection was truncated", () => {
    const { getByText } = renderForm({
      selectedItems: makeRows(5),
      isAllItemsSelected: true,
      isSelectionTruncated: true,
      totalMatchingItemsCount: 24318,
    });

    expect(
      getByText(
        new RegExp(`Selected 5 of ${(24318).toLocaleString()} matching Labels`),
      ),
    ).toBeTruthy();
  });

  test("stays quiet when a full selection happens to sit on the ceiling", () => {
    /*
     * The warning used to be inferred from
     * `selectedItems.length === LIMIT_PER_PROJECT`, so a project holding
     * exactly the ceiling was told its selection had been cut short when
     * nothing had been dropped at all.
     */
    const { queryByText } = renderForm({
      selectedItems: makeRows(LIMIT_PER_PROJECT),
      isAllItemsSelected: true,
      isSelectionTruncated: false,
      totalMatchingItemsCount: LIMIT_PER_PROJECT,
    });

    expect(queryByText(/matching Labels/)).toBeNull();
  });

  test("clearing the selection calls back", () => {
    const onClearSelectionClick: MockFunction = getJestMockFunction();

    const { getByText } = renderForm({
      onClearSelectionClick: onClearSelectionClick as unknown as () => void,
    });

    fireEvent.click(getByText("Clear Selection"));

    expect(onClearSelectionClick).toHaveBeenCalledTimes(1);
  });
});
