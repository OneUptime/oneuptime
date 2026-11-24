import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * SETTINGS > LABELS MARKS THE LABELS THAT SHARE A NAME (#9856).
 *
 * A label cannot take a name another label of the project has, on a create
 * or a rename (#9723), but labels named alike before that keep their names,
 * and every label picker lists the name twice. Settings > Labels now marks
 * them the way Teams and the on-call lists do (Components/SharedName
 * /UseSharedNames). This draws the real page, with only its tables, the
 * rename dialog and the server stood in for:
 *
 *   - the server is asked which labels share a name, as labels, each time
 *     the list reads its rows - never before;
 *   - the Name column still draws each label as its coloured chip, now with
 *     the pill beside it when another label shares its name, and still
 *     sorts, exports and reads its way as a name;
 *   - a note above the list counts them and says how to tell them apart,
 *     and says nothing while none share a name, or when the server could
 *     not say;
 *   - a marked row's button is Rename, a dialog of the name alone, where a
 *     name another label has is said under the field; Used by, Archive and
 *     Edit stay where they were;
 *   - a saved rename reads the list again, and with it who shares a name.
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedDialogs: Array<Record<string, unknown>> = [];
const readMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", {
        "data-testid": `model-table-${String(props["id"])}`,
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedDialogs.push(props);
      return React.createElement("div", {
        "data-testid": "rename-dialog",
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SharedName/SharedNamesApi",
  () => {
    return {
      __esModule: true,
      default: {
        read: (...args: Array<unknown>) => {
          return readMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      updateById: async (): Promise<void> => {
        // Saved.
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ArchivableValue/FetchArchivableValueUsage",
  () => {
    return {
      __esModule: true,
      fetchArchivableValueUsage: async (): Promise<Array<unknown>> => {
        return [];
      },
    };
  },
);

jest.mock("../../../UI/Utils/PermissionGate", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/PermissionGate",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      check: (): { isAllowed: boolean } => {
        return { isAllowed: true };
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import LabelsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Labels";
import {
  SHARED_NAME_RENAME_BUTTON,
  SHARED_NAME_WORDS,
  SharedNameWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SharedName/SharedNameWords";
import { USED_BY_ACTION } from "../../../../App/FeatureSet/Dashboard/src/Components/UsedBy/UsedByWords";
import Label from "../../../Models/DatabaseModels/Label";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import { SharedNameKind } from "../../../Types/Database/SharedNames";
import { isNameTakenRefusal } from "../../../Types/Database/UniqueName";
import ObjectID from "../../../Types/ObjectID";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import Column from "../../../UI/Components/ModelTable/Column";
import { drawsItsOwnLines } from "../../../UI/Components/Table/ColumnLineText";
import FieldType from "../../../UI/Components/Types/FieldType";

const PRODUCTION: string = "0193c0de-9856-4000-8000-000000000001";
const PRODUCTION_TWIN: string = "0193c0de-9856-4000-8000-000000000002";
const STAGING: string = "0193c0de-9856-4000-8000-000000000003";

const WORDS: SharedNameWords = SHARED_NAME_WORDS[SharedNameKind.Label];

function labelRow(id: string, name: string, color: string): Label {
  const label: Label = new Label(new ObjectID(id));
  label.name = name;
  label.color = Color.fromString(color);
  return label;
}

const ROWS: Array<Label> = [
  labelRow(PRODUCTION, "Production", "#dc2626"),
  labelRow(PRODUCTION_TWIN, "production", "#2563eb"),
  labelRow(STAGING, "Staging", "#16a34a"),
];

// The last props the list of labels in use was drawn with.
function labelsTable(): Record<string, unknown> {
  for (let index: number = recordedTables.length - 1; index >= 0; index--) {
    if (recordedTables[index]!["id"] === "labels-table") {
      return recordedTables[index]!;
    }
  }

  throw new Error("The labels table was not drawn.");
}

function actions(): Array<ActionButtonSchema<Label>> {
  return labelsTable()["actionButtons"] as Array<ActionButtonSchema<Label>>;
}

function actionTitled(title: string): ActionButtonSchema<Label> {
  const found: ActionButtonSchema<Label> | undefined = actions().find(
    (action: ActionButtonSchema<Label>): boolean => {
      return action.title === title;
    },
  );

  if (!found) {
    throw new Error(`No ${title} action`);
  }

  return found;
}

function nameColumn(): Column<Label> {
  return (labelsTable()["columns"] as Array<Column<Label>>)[0]!;
}

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <LabelsPage
        pageRoute={new Route("/dashboard/project/settings/labels")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });
}

// The list reads its rows, as ModelTable does once they arrive.
async function listFetched(): Promise<void> {
  await act(async () => {
    (labelsTable()["onFetchSuccess"] as (items: Array<Label>) => void)(ROWS);
    await Promise.resolve();
  });
}

async function openRename(row: Label): Promise<Record<string, unknown>> {
  await act(async () => {
    actionTitled(WORDS.rename).onClick(
      row,
      () => {},
      () => {},
    );
  });

  const dialog: Record<string, unknown> | undefined =
    recordedDialogs[recordedDialogs.length - 1];

  if (!dialog) {
    throw new Error("The rename dialog was not drawn.");
  }

  return dialog;
}

// Each row's name cell, as the table draws it.
function renderNameCells(): void {
  render(
    <div>
      {ROWS.map((row: Label): ReactElement => {
        return (
          <div key={row.id!.toString()} data-testid={`row-${row.id}`}>
            {nameColumn().getElement!(row)}
          </div>
        );
      })}
    </div>,
  );
}

function sharedNamePillOf(id: string): HTMLElement | null {
  return screen
    .getByTestId(`row-${id}`)
    .querySelector('[data-testid="shared-name-pill"]');
}

// The label's own chip: a pill that is not the mark.
function chipsOf(id: string): Array<Element> {
  return Array.from(
    screen.getByTestId(`row-${id}`).querySelectorAll('[data-testid="pill"]'),
  );
}

beforeEach(() => {
  recordedTables.length = 0;
  recordedDialogs.length = 0;
  readMock.mockReset();
  readMock.mockResolvedValue({ groups: [[PRODUCTION, PRODUCTION_TWIN]] });
  countMock.mockReset();
  countMock.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
});

describe("which labels share a name", () => {
  test("is asked of the server, as labels, when the list reads its rows - never before", async () => {
    await renderPage();

    expect(readMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("shared-names-note")).toBeNull();

    await listFetched();

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(readMock).toHaveBeenCalledWith(SharedNameKind.Label);
  });

  test("a note above the list counts them and says how to tell them apart", async () => {
    await renderPage();
    await listFetched();

    expect(screen.getByTestId("shared-names-note")).toHaveTextContent(
      "2 labels have the same name as another label, and pickers can't tell them apart. Compare where each one is used, then rename one.",
    );
  });

  test("one, in the one form", async () => {
    // Its twin is a label the reader may not read: it still holds the name.
    readMock.mockResolvedValue({ groups: [[STAGING]] });

    await renderPage();
    await listFetched();

    expect(screen.getByTestId("shared-names-note")).toHaveTextContent(
      "1 label has the same name as another label, and pickers can't tell them apart. Compare where each one is used, then rename one.",
    );
  });

  test("nothing is said while no label shares a name", async () => {
    readMock.mockResolvedValue({ groups: [] });

    await renderPage();
    await listFetched();

    expect(screen.queryByTestId("shared-names-note")).toBeNull();
  });

  test("nothing is marked when the server could not say", async () => {
    readMock.mockRejectedValue(new Error("Failed to fetch"));

    await renderPage();
    await listFetched();

    expect(screen.queryByTestId("shared-names-note")).toBeNull();
    expect(actionTitled(WORDS.rename).isVisible!(ROWS[0]!)).toBe(false);
  });
});

describe("the Name column", () => {
  test("draws each label as its chip, with the pill beside the ones that share a name", async () => {
    await renderPage();
    await listFetched();

    renderNameCells();

    expect(sharedNamePillOf(PRODUCTION)).toHaveTextContent(WORDS.pill);
    expect(sharedNamePillOf(PRODUCTION_TWIN)).toHaveTextContent(WORDS.pill);
    expect(sharedNamePillOf(STAGING)).toBeNull();

    // Every row keeps its label's chip, its name as written.
    for (const row of ROWS) {
      const chips: Array<Element> = chipsOf(row.id!.toString());

      expect(chips).toHaveLength(1);
      expect(chips[0]).toHaveTextContent(row.name!);
    }
  });

  test("is still a name: it sorts by it, exports it and reads its way", async () => {
    await renderPage();

    const column: Column<Label> = nameColumn();

    expect(column.field).toEqual({ name: true });
    expect(column.title).toBe("Name");
    expect(column.type).toBe(FieldType.Element);
    expect(column.disableSort).toBeUndefined();
    expect(column.getLineText).toBe(drawsItsOwnLines);
    expect(column.getExportValue!(ROWS[1]!)).toBe("production");
  });
});

describe("Rename", () => {
  test("is a marked row's button, and on no other row", async () => {
    await renderPage();
    await listFetched();

    const rename: ActionButtonSchema<Label> = actionTitled(WORDS.rename);

    expect(actions()[0]).toBe(rename);
    expect(rename.title).toBe("Rename Label");
    expect(rename.rowButtonTitle).toBe(SHARED_NAME_RENAME_BUTTON);
    expect(rename.placement).toBe(ActionButtonPlacement.Primary);
    expect(rename.isVisible!(ROWS[0]!)).toBe(true);
    expect(rename.isVisible!(ROWS[1]!)).toBe(true);
    expect(rename.isVisible!(ROWS[2]!)).toBe(false);
  });

  test("Used by, Archive and Edit stay where they were", async () => {
    await renderPage();
    await listFetched();

    expect(actionTitled(USED_BY_ACTION).placement).toBe(
      ActionButtonPlacement.MoreMenu,
    );
    expect(actionTitled("Archive").placement).toBe(
      ActionButtonPlacement.MoreMenu,
    );
    // Edit, the label's whole form, is still there for every row.
    expect(labelsTable()["isEditable"]).toBe(true);
  });

  test("opens a dialog of the name alone, where a name another label has is said under the field", async () => {
    await renderPage();
    await listFetched();

    expect(screen.queryByTestId("rename-dialog")).toBeNull();

    const dialog: Record<string, unknown> = await openRename(ROWS[1]!);

    expect(screen.getByTestId("rename-dialog")).toBeInTheDocument();
    expect(dialog["modelType"]).toBe(Label);
    expect(String(dialog["modelIdToEdit"])).toBe(PRODUCTION_TWIN);
    expect(dialog["title"]).toBe(WORDS.rename);
    expect(dialog["description"]).toBe(WORDS.renameDescription);
    expect(dialog["submitButtonText"]).toBe(WORDS.rename);

    const formProps: Record<string, unknown> = dialog["formProps"] as Record<
      string,
      unknown
    >;

    expect(formProps["formType"]).toBe(FormType.Update);
    expect(formProps["fields"]).toHaveLength(1);

    const field: Record<string, unknown> = (
      formProps["fields"] as Array<Record<string, unknown>>
    )[0]!;

    expect(field["field"]).toEqual({ name: true });
    expect(field["required"]).toBe(true);
    expect(field["ownsServerError"]).toBe(isNameTakenRefusal);
  });

  test("once saved, closes and reads the list again, and with it who shares a name", async () => {
    await renderPage();
    await listFetched();

    const before: unknown = labelsTable()["refreshToggle"];
    const dialog: Record<string, unknown> = await openRename(ROWS[1]!);

    await act(async () => {
      (dialog["onSuccess"] as () => void)();
    });

    expect(screen.queryByTestId("rename-dialog")).toBeNull();
    expect(labelsTable()["refreshToggle"]).not.toBe(before);

    // The table reads its rows again, and the marks are asked again.
    readMock.mockResolvedValue({ groups: [] });
    await listFetched();

    expect(readMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("shared-names-note")).toBeNull();
  });

  test("closed without saving, reads nothing again", async () => {
    await renderPage();
    await listFetched();

    const before: unknown = labelsTable()["refreshToggle"];
    const dialog: Record<string, unknown> = await openRename(ROWS[0]!);

    await act(async () => {
      (dialog["onClose"] as () => void)();
    });

    expect(screen.queryByTestId("rename-dialog")).toBeNull();
    expect(labelsTable()["refreshToggle"]).toBe(before);
  });
});
