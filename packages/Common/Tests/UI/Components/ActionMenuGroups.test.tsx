import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import {
  ActionMenuGroup,
  startsNewMenuGroup,
} from "../../../UI/Components/ActionButton/ActionMenuGroup";
import BulkUpdateForm, {
  BulkActionButtonSchema,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Table from "../../../UI/Components/Table/Table";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A long menu read in runs (ActionMenuGroup).
 *
 * An incident's row now offers Acknowledge, Resolve, Change State, Change
 * Severity, Assign to Me, Add Owner, Show ID and Delete; its Bulk Actions a
 * dozen more. Each action names its kind - the record's state and values,
 * its people, its labels, its export - and the menu draws a gap where one
 * kind ends and the next begins. An action that names no kind sits with its
 * unnamed neighbours, so a list that names none is drawn as it always was,
 * and a destructive action keeps its one gap above it.
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
  _id: string;
  name: string;
}

const ROW: Row = { _id: "1", name: "Checkout API down" };

// A gap, as the sequence below writes it.
const GAP: string = "—";

/*
 * What a menu holds, top to bottom: its items by name, and a GAP for each
 * divider - an empty element a screen reader skips (role "none").
 */
const menuSequence: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="none"]'),
  ).map((element: HTMLElement): string => {
    return element.getAttribute("role") === "none"
      ? GAP
      : (element.textContent || "").trim();
  });
};

const rowAction: (
  title: string,
  options?: {
    group?: string | undefined;
    style?: ButtonStyleType | undefined;
    isVisible?: boolean | undefined;
  },
) => ActionButtonSchema<Row> = (
  title: string,
  options?: {
    group?: string | undefined;
    style?: ButtonStyleType | undefined;
    isVisible?: boolean | undefined;
  },
): ActionButtonSchema<Row> => {
  return {
    title: title,
    icon: IconProp.Check,
    buttonStyleType: options?.style ?? ButtonStyleType.OUTLINE,
    placement: ActionButtonPlacement.MoreMenu,
    ...(options?.group ? { menuGroup: options.group } : {}),
    ...(options?.isVisible === false
      ? {
          isVisible: (): boolean => {
            return false;
          },
        }
      : {}),
    onClick: (): void => {},
  };
};

const VIEW: ActionButtonSchema<Row> = {
  title: "View",
  icon: IconProp.ChevronRight,
  buttonStyleType: ButtonStyleType.OUTLINE,
  placement: ActionButtonPlacement.Primary,
  onClick: (): void => {},
};

const openRowMenu: (actions: Array<ActionButtonSchema<Row>>) => HTMLElement = (
  actions: Array<ActionButtonSchema<Row>>,
): HTMLElement => {
  render(<RowActions<Row> item={ROW} actionButtons={[VIEW, ...actions]} />);
  fireEvent.click(screen.getByTestId("row-actions-more-button"));

  return screen.getByRole("menu");
};

afterEach(() => {
  cleanup();
});

describe("startsNewMenuGroup", () => {
  test.each([
    ["two of one kind", ActionMenuGroup.Change, ActionMenuGroup.Change, false],
    ["two kinds", ActionMenuGroup.Change, ActionMenuGroup.People, true],
    ["a kind, then none", ActionMenuGroup.People, undefined, true],
    ["none, then a kind", undefined, ActionMenuGroup.Labels, true],
    ["none, then none", undefined, undefined, false],
    ["an empty kind is none", "", undefined, false],
  ] as Array<[string, string | undefined, string | undefined, boolean]>)(
    "%s",
    (
      _name: string,
      previous: string | undefined,
      next: string | undefined,
      expected: boolean,
    ) => {
      expect(startsNewMenuGroup(previous, next)).toBe(expected);
    },
  );
});

describe("a row's ⋯ menu draws its actions in runs", () => {
  test("an incident's: its state and severity, its people, then what every row carries, then Delete", () => {
    const menu: HTMLElement = openRowMenu([
      rowAction("Acknowledge", { group: ActionMenuGroup.Change }),
      rowAction("Resolve", { group: ActionMenuGroup.Change }),
      rowAction("Change State", { group: ActionMenuGroup.Change }),
      rowAction("Change Severity", { group: ActionMenuGroup.Change }),
      rowAction("Assign to Me", { group: ActionMenuGroup.People }),
      rowAction("Add Owner", { group: ActionMenuGroup.People }),
      rowAction("Show ID"),
      rowAction("Delete", { style: ButtonStyleType.DANGER_OUTLINE }),
    ]);

    expect(menuSequence(menu)).toEqual([
      "Acknowledge",
      "Resolve",
      "Change State",
      "Change Severity",
      GAP,
      "Assign to Me",
      "Add Owner",
      GAP,
      "Show ID",
      GAP,
      "Delete",
    ]);
  });

  test("a list whose actions name no kind is drawn as it always was: one gap, above Delete", () => {
    const menu: HTMLElement = openRowMenu([
      rowAction("Disable"),
      rowAction("Archive"),
      rowAction("Show ID"),
      rowAction("Delete", { style: ButtonStyleType.DANGER_OUTLINE }),
    ]);

    expect(menuSequence(menu)).toEqual([
      "Disable",
      "Archive",
      "Show ID",
      GAP,
      "Delete",
    ]);
  });

  test("a destructive action keeps one gap above it, whatever kinds meet there", () => {
    const menu: HTMLElement = openRowMenu([
      rowAction("Add Owner", { group: ActionMenuGroup.People }),
      rowAction("Remove", {
        group: ActionMenuGroup.Change,
        style: ButtonStyleType.DANGER_OUTLINE,
      }),
      rowAction("Delete", { style: ButtonStyleType.DANGER_OUTLINE }),
    ]);

    expect(menuSequence(menu)).toEqual(["Add Owner", GAP, "Remove", "Delete"]);
  });

  test("an action a row does not offer leaves no gap of its own behind", () => {
    const menu: HTMLElement = openRowMenu([
      rowAction("Acknowledge", {
        group: ActionMenuGroup.Change,
        isVisible: false,
      }),
      rowAction("Change Severity", { group: ActionMenuGroup.Change }),
      rowAction("Assign to Me", {
        group: ActionMenuGroup.People,
        isVisible: false,
      }),
      rowAction("Add Owner", { group: ActionMenuGroup.People }),
    ]);

    expect(menuSequence(menu)).toEqual(["Change Severity", GAP, "Add Owner"]);
  });

  test("a gap is no stop for the keyboard and nothing a screen reader reads", () => {
    const menu: HTMLElement = openRowMenu([
      rowAction("Change State", { group: ActionMenuGroup.Change }),
      rowAction("Add Owner", { group: ActionMenuGroup.People }),
    ]);

    const gaps: Array<HTMLElement> = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="none"]'),
    );

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.textContent).toBe("");
    expect(gaps[0]!.getAttribute("tabindex")).toBeNull();
  });
});

const bulkAction: (
  title: string,
  options?: {
    group?: string | undefined;
    style?: ButtonStyleType | undefined;
  },
) => BulkActionButtonSchema<Row> = (
  title: string,
  options?: {
    group?: string | undefined;
    style?: ButtonStyleType | undefined;
  },
): BulkActionButtonSchema<Row> => {
  return {
    title: title,
    icon: IconProp.Check,
    buttonStyleType: options?.style ?? ButtonStyleType.NORMAL,
    ...(options?.group ? { menuGroup: options.group } : {}),
    onClick: async (): Promise<void> => {},
  };
};

const openBulkMenu: (
  buttons: Array<BulkActionButtonSchema<Row>>,
) => HTMLElement = (
  buttons: Array<BulkActionButtonSchema<Row>>,
): HTMLElement => {
  render(
    <BulkUpdateForm<Row>
      selectedItems={[ROW]}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Incident"
      pluralLabel="Incidents"
      buttons={buttons}
    />,
  );
  fireEvent.click(screen.getByText("Bulk Actions"));

  return screen.getByRole("menu");
};

describe("Bulk Actions draws its actions in runs", () => {
  test("an incidents list's: its state and severity, its people, its labels, its episodes, its export, then Delete", () => {
    const menu: HTMLElement = openBulkMenu([
      bulkAction("Acknowledge", { group: ActionMenuGroup.Change }),
      bulkAction("Change Severity", { group: ActionMenuGroup.Change }),
      bulkAction("Assign to Me", { group: ActionMenuGroup.People }),
      bulkAction("Remove Owner", { group: ActionMenuGroup.People }),
      bulkAction("Add Labels", { group: ActionMenuGroup.Labels }),
      bulkAction("Remove Labels", { group: ActionMenuGroup.Labels }),
      bulkAction("Add to Existing Episode", { group: "episodes" }),
      bulkAction("Add to New Episode", { group: "episodes" }),
      bulkAction("Export CSV", { group: ActionMenuGroup.Export }),
      bulkAction("Delete", { style: ButtonStyleType.DANGER }),
    ]);

    expect(menuSequence(menu)).toEqual([
      "Acknowledge",
      "Change Severity",
      GAP,
      "Assign to Me",
      "Remove Owner",
      GAP,
      "Add Labels",
      "Remove Labels",
      GAP,
      "Add to Existing Episode",
      "Add to New Episode",
      GAP,
      "Export CSV",
      GAP,
      "Delete",
    ]);
  });

  test("a list whose actions name no kind is drawn as it always was", () => {
    const menu: HTMLElement = openBulkMenu([
      bulkAction("Enable"),
      bulkAction("Disable"),
      bulkAction("Delete", { style: ButtonStyleType.DANGER }),
    ]);

    expect(menuSequence(menu)).toEqual(["Enable", "Disable", GAP, "Delete"]);
  });

  test("an action hidden for this selection leaves no gap of its own behind", () => {
    const menu: HTMLElement = openBulkMenu([
      {
        ...bulkAction("Acknowledge", { group: ActionMenuGroup.Change }),
        isVisible: (): boolean => {
          return false;
        },
      },
      bulkAction("Change State", { group: ActionMenuGroup.Change }),
      bulkAction("Add Owner", { group: ActionMenuGroup.People }),
    ]);

    expect(menuSequence(menu)).toEqual(["Change State", GAP, "Add Owner"]);
  });
});

describe("Export CSV, which every list with Bulk Actions offers", () => {
  test("is a run of its own, after the list's own actions", () => {
    render(
      <Table<Row>
        id="menu-groups-table"
        data={[ROW]}
        columns={[{ title: "Name", type: FieldType.Text, key: "name" }]}
        currentPageNumber={1}
        totalItemsCount={1}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Monitor"
        pluralLabel="Monitors"
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        onNavigateToPage={() => {}}
        matchBulkSelectedItemByField="_id"
        bulkActions={{
          buttons: [
            bulkAction("Archive"),
            bulkAction("Add Labels", { group: ActionMenuGroup.Labels }),
          ],
        }}
        bulkSelectedItems={[ROW]}
      />,
    );

    fireEvent.click(screen.getByText("Bulk Actions"));

    expect(menuSequence(screen.getByRole("menu"))).toEqual([
      "Archive",
      GAP,
      "Add Labels",
      GAP,
      "Export CSV",
    ]);
  });
});
