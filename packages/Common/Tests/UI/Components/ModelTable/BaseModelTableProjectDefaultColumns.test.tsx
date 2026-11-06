import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

// A real BaseModelTable, a card and (here) a modal: give it the time.
configure({ asyncUtilTimeout: 15000 });

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "Default columns per project" (#5485's follow-ups), through a real
 * BaseModelTable.
 *
 * Which columns a list draws, in order of who decides: the viewer's own
 * choice (Customize Columns, kept in their browser), else the project's
 * default for the list (Project.defaultTableColumns, set by a Project Owner
 * or Admin with "Show these columns to everyone in this project"), else the
 * list's own columns. The project's defaults come with the project the page
 * holds (ProjectUtil), so a list draws them from its first paint. Reset to
 * default takes the viewer back to the project's default.
 */
jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import Columns from "../../../../UI/Components/ModelTable/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../Models/DatabaseModels/Project";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../../UI/Utils/Project";
import UserPreferences, {
  UserPreferenceType,
} from "../../../../Utils/UserPreferences";
import {
  COLUMN_CUSTOMIZATION_EVERYONE_TEST_ID,
  COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_NOTE_TEST_ID,
  COLUMN_CUSTOMIZATION_REMOVE_DEFAULT_TEST_ID,
} from "../../../../UI/Components/ModelTable/ColumnCustomizationModal";

const PREFS_KEY: string = "monitors-project-default-table";

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
);

const DECLARED_TITLES: Array<string> = [
  "Name",
  "Description",
  "Monitor Status",
  "Labels",
];

// The project's default for this list: Labels first, Description off.
const PROJECT_DEFAULT: JSONObject = {
  order: ["labels", "name", "description", "currentMonitorStatus"],
  hidden: ["description"],
};

// Another list's default, which no save of this list may lose.
const OTHER_LIST_DEFAULT: JSONObject = {
  order: ["title", "createdAt"],
  hidden: [],
};

const makeColumns: () => Columns<Monitor> = (): Columns<Monitor> => {
  return [
    { field: { name: true }, title: "Name", type: FieldType.Text },
    {
      field: { description: true },
      title: "Description",
      type: FieldType.LongText,
    },
    {
      field: { currentMonitorStatus: { name: true } },
      title: "Monitor Status",
      type: FieldType.Entity,
    },
    {
      field: { labels: { name: true } },
      title: "Labels",
      type: FieldType.EntityArray,
    },
  ] as unknown as Columns<Monitor>;
};

/*
 * The project the page holds, as ProjectUtil keeps it, and the project the
 * server stores: the two a save reads and writes.
 */
let heldProject: Project | null = null;
let storedDefaults: JSONObject | null = null;
let updates: Array<JSONObject> = [];
let canChange: boolean = true;
let refuseUpdate: string | null = null;

const projectWith: (defaults: JSONObject | null) => Project = (
  defaults: JSONObject | null,
): Project => {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme";

  if (defaults) {
    project.defaultTableColumns = defaults;
  }

  return project;
};

const getHeaders: () => Array<string> = (): Array<string> => {
  return screen.getAllByRole("columnheader").map((header: HTMLElement) => {
    return (header.textContent || "").trim();
  });
};

const readOwnLayout: () => JSONObject | null = (): JSONObject | null => {
  return UserPreferences.getUserPreferenceByTypeAsJSON({
    key: PREFS_KEY,
    userPreferenceType: UserPreferenceType.BaseModelTableColumns,
  });
};

const seedOwnLayout: (layout: JSONObject) => void = (
  layout: JSONObject,
): void => {
  UserPreferences.saveUserPreferenceByTypeAsJSON({
    key: PREFS_KEY,
    userPreferenceType: UserPreferenceType.BaseModelTableColumns,
    value: layout,
  });
};

const callbacks: BaseTableCallbacks<Monitor> = {
  deleteItem: async () => {
    return undefined;
  },
  getModelFromJSON: (item: JSONObject) => {
    return item as unknown as Monitor;
  },
  getJSONFromModel: (item: Monitor) => {
    return item as unknown as JSONObject;
  },
  addSlugToSelect: (select: unknown) => {
    return select;
  },
  getList: async (data: { limit: number }): Promise<ListResult<Monitor>> => {
    return { data: [], count: 0, skip: 0, limit: data.limit };
  },
  toJSONArray: () => {
    return [];
  },
  updateById: async () => {
    return undefined;
  },
  showCreateEditModal: () => {
    return <></>;
  },
} as unknown as BaseTableCallbacks<Monitor>;

const renderTable: () => ReturnType<typeof render> = (): ReturnType<
  typeof render
> => {
  const props: BaseModelTableProps<Monitor> = {
    modelType: Monitor,
    id: "monitors-table",
    name: "Monitors",
    userPreferencesKey: PREFS_KEY,
    cardProps: { title: "Monitors" },
    columns: makeColumns(),
    filters: [],
    isDeleteable: false,
    isCreateable: false,
    isViewable: false,
    isEditable: false,
    disableUrlState: true,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<Monitor>;

  return render(<BaseModelTable<Monitor> {...props} />);
};

const waitForHeaders: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
  });
};

const click: (element: HTMLElement) => Promise<void> = async (
  element: HTMLElement,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(element);
  });
};

const openPicker: () => Promise<void> = async (): Promise<void> => {
  await click(screen.getByRole("button", { name: "More options" }));
  await click(screen.getByText("Columns"));

  await waitFor(() => {
    expect(screen.queryByTestId("column-customization-modal")).not.toBeNull();
  });
};

const pressSave: () => Promise<void> = async (): Promise<void> => {
  await click(screen.getByTestId("modal-footer-submit-button"));
};

const waitForPickerClosed: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.queryByTestId("column-customization-modal")).toBeNull();
  });
};

// The checkbox inside the "everyone" block.
const everyoneCheckbox: () => HTMLInputElement = (): HTMLInputElement => {
  return screen
    .getByTestId(COLUMN_CUSTOMIZATION_EVERYONE_TEST_ID)
    .closest("div")
    ?.querySelector("input[type='checkbox']") as HTMLInputElement;
};

beforeEach(() => {
  window.localStorage.clear();
  heldProject = projectWith({
    [PREFS_KEY]: PROJECT_DEFAULT,
    "alerts-table": OTHER_LIST_DEFAULT,
  });
  storedDefaults = {
    [PREFS_KEY]: PROJECT_DEFAULT,
    "alerts-table": OTHER_LIST_DEFAULT,
  };
  updates = [];
  canChange = true;
  refuseUpdate = null;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(() => {
    return heldProject ? PROJECT_ID : null;
  });
  jest.spyOn(ProjectUtil, "getCurrentProject").mockImplementation(() => {
    return heldProject;
  });
  jest
    .spyOn(ProjectUtil, "setCurrentProject")
    .mockImplementation((project: JSONObject | Project): void => {
      heldProject = project as Project;
    });
  jest
    .spyOn(PermissionGate, "checkColumnUpdate")
    .mockImplementation((): PermissionGateResult => {
      return { isAllowed: canChange } as PermissionGateResult;
    });
  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return projectWith(storedDefaults);
  }) as unknown as typeof ModelAPI.getItem);
  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (data: {
    data: JSONObject;
  }) => {
    if (refuseUpdate) {
      throw new Error(refuseUpdate);
    }

    updates.push(data.data);
    storedDefaults = (data.data["defaultTableColumns"] as JSONObject) || null;
    return undefined;
  }) as unknown as typeof ModelAPI.updateById);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("a list draws the project's default columns", () => {
  test("from its first paint, for anyone who has picked none of their own", async () => {
    renderTable();
    await waitForHeaders();

    expect(getHeaders()).toEqual(["Labels", "Name", "Monitor Status"]);
  });

  test("a person's own columns win over it", async () => {
    seedOwnLayout({
      order: ["name", "description", "currentMonitorStatus", "labels"],
      hidden: ["labels"],
    });

    renderTable();
    await waitForHeaders();

    expect(getHeaders()).toEqual(["Name", "Description", "Monitor Status"]);
  });

  test("a project with no default for the list: the list's own columns", async () => {
    heldProject = projectWith({ "alerts-table": OTHER_LIST_DEFAULT });

    renderTable();
    await waitForHeaders();

    expect(getHeaders()).toEqual(DECLARED_TITLES);
  });

  test("a default naming columns the list no longer has keeps the ones it has", async () => {
    heldProject = projectWith({
      [PREFS_KEY]: {
        order: ["retired-column", "labels", "name"],
        hidden: ["retired-column", "description"],
      },
    });

    renderTable();
    await waitForHeaders();

    expect(getHeaders()).toEqual(["Labels", "Name", "Monitor Status"]);
  });

  test("where there is no project (the Admin Dashboard): the list's own columns, and no project controls in its picker", async () => {
    heldProject = null;

    renderTable();
    await waitForHeaders();

    expect(getHeaders()).toEqual(DECLARED_TITLES);

    await openPicker();

    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_EVERYONE_TEST_ID),
    ).toBeNull();
    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_NOTE_TEST_ID),
    ).toBeNull();
  });
});

describe("Reset to default", () => {
  test("takes a person's own columns away: back to the project's default, and the button says so", async () => {
    seedOwnLayout({
      order: ["name", "description", "currentMonitorStatus", "labels"],
      hidden: ["labels"],
    });

    renderTable();
    await waitForHeaders();
    await openPicker();

    const reset: HTMLElement = screen.getByTestId("column-customization-reset");

    expect(reset).toHaveTextContent("Reset to project default");

    await click(reset);
    await waitForPickerClosed();

    await waitFor(() => {
      expect(getHeaders()).toEqual(["Labels", "Name", "Monitor Status"]);
    });
    expect(readOwnLayout()).toBeNull();
  });

  test("is not offered to someone who sees the project's default already: there is nothing of their own to reset", async () => {
    renderTable();
    await waitForHeaders();
    await openPicker();

    expect(screen.queryByTestId("column-customization-reset")).toBeNull();
  });

  test("with no project default it reads as before: Reset to default", async () => {
    heldProject = projectWith(null);
    seedOwnLayout({
      order: ["name", "description", "currentMonitorStatus", "labels"],
      hidden: ["labels"],
    });

    renderTable();
    await waitForHeaders();
    await openPicker();

    expect(screen.getByTestId("column-customization-reset")).toHaveTextContent(
      "Reset to default",
    );
  });
});

describe("someone who may not set the project's default", () => {
  beforeEach(() => {
    canChange = false;
  });

  test("seeing it is told so, and that what they save is theirs alone; no box to show their columns to everyone", async () => {
    renderTable();
    await waitForHeaders();
    await openPicker();

    expect(
      screen.getByTestId(COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_NOTE_TEST_ID),
    ).toHaveTextContent(
      "These are this project's default columns for this list. Changes you save are only for you.",
    );
    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_EVERYONE_TEST_ID),
    ).toBeNull();
    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_REMOVE_DEFAULT_TEST_ID),
    ).toBeNull();
  });

  test("saves their own columns only, and the project's default stays", async () => {
    renderTable();
    await waitForHeaders();
    await openPicker();

    await click(screen.getByTestId("column-toggle-description"));
    await pressSave();
    await waitForPickerClosed();

    await waitFor(() => {
      expect(getHeaders()).toEqual([
        "Labels",
        "Name",
        "Description",
        "Monitor Status",
      ]);
    });
    expect(readOwnLayout()).toEqual({
      order: ["labels", "name", "description", "currentMonitorStatus"],
      hidden: [],
    });
    expect(updates).toEqual([]);
  });

  test("saving the project's default as it is stores nothing: they keep following it", async () => {
    renderTable();
    await waitForHeaders();
    await openPicker();
    await pressSave();
    await waitForPickerClosed();

    expect(readOwnLayout()).toBeNull();
  });

  test("with their own columns, nothing is said of the project's default", async () => {
    seedOwnLayout({
      order: ["name", "description", "currentMonitorStatus", "labels"],
      hidden: [],
    });

    renderTable();
    await waitForHeaders();
    await openPicker();

    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_PROJECT_DEFAULT_NOTE_TEST_ID),
    ).toBeNull();
  });
});

describe("a Project Owner or Admin", () => {
  test("may show the columns to everyone: off each time the picker opens", async () => {
    renderTable();
    await waitForHeaders();
    await openPicker();

    expect(
      screen.getByTestId(COLUMN_CUSTOMIZATION_EVERYONE_TEST_ID),
    ).toBeInTheDocument();
    expect(everyoneCheckbox().checked).toBe(false);
  });

  test("shows their columns to everyone: the list's default is replaced, every other list's kept, and they see what everyone sees", async () => {
    seedOwnLayout({
      order: ["name", "description", "currentMonitorStatus", "labels"],
      hidden: ["labels"],
    });

    renderTable();
    await waitForHeaders();
    await openPicker();

    await click(everyoneCheckbox());
    await pressSave();
    await waitForPickerClosed();

    expect(updates).toEqual([
      {
        defaultTableColumns: {
          [PREFS_KEY]: {
            order: ["name", "description", "currentMonitorStatus", "labels"],
            hidden: ["labels"],
          },
          "alerts-table": OTHER_LIST_DEFAULT,
        },
      },
    ]);
    // Their own layout is let go: they follow the project's, as everyone does.
    expect(readOwnLayout()).toBeNull();
    expect(getHeaders()).toEqual(["Name", "Description", "Monitor Status"]);
    // The project the page holds has it: every list drawn from here reads it.
    expect((heldProject?.defaultTableColumns as JSONObject)[PREFS_KEY]).toEqual(
      {
        order: ["name", "description", "currentMonitorStatus", "labels"],
        hidden: ["labels"],
      },
    );
  });

  test("reads the project's defaults afresh before saving: another Owner's default for another list set since is kept", async () => {
    heldProject = projectWith(null);
    storedDefaults = { "incidents-table": OTHER_LIST_DEFAULT };

    renderTable();
    await waitForHeaders();
    await openPicker();

    await click(screen.getByTestId("column-toggle-labels"));
    await click(everyoneCheckbox());
    await pressSave();
    await waitForPickerClosed();

    expect(updates).toEqual([
      {
        defaultTableColumns: {
          "incidents-table": OTHER_LIST_DEFAULT,
          [PREFS_KEY]: {
            order: ["name", "description", "currentMonitorStatus", "labels"],
            hidden: ["labels"],
          },
        },
      },
    ]);
  });

  test("showing the list's own columns to everyone takes the list's default away, rather than pinning it", async () => {
    renderTable();
    await waitForHeaders();
    await openPicker();

    // Back to the declared layout: Description on, Labels last.
    await click(screen.getByTestId("column-customization-show-all"));

    for (let move: number = 0; move < 3; move++) {
      await click(screen.getByTestId("column-move-down-labels"));
    }

    await click(everyoneCheckbox());
    await pressSave();
    await waitForPickerClosed();

    expect(updates).toEqual([
      { defaultTableColumns: { "alerts-table": OTHER_LIST_DEFAULT } },
    ]);
    expect(getHeaders()).toEqual(DECLARED_TITLES);
  });

  test("may take the list's default away: everyone sees the list's own columns again", async () => {
    renderTable();
    await waitForHeaders();
    await openPicker();

    await click(
      screen.getByTestId(COLUMN_CUSTOMIZATION_REMOVE_DEFAULT_TEST_ID),
    );
    await waitForPickerClosed();

    expect(updates).toEqual([
      { defaultTableColumns: { "alerts-table": OTHER_LIST_DEFAULT } },
    ]);
    await waitFor(() => {
      expect(getHeaders()).toEqual(DECLARED_TITLES);
    });
  });

  test("taking the last list's default away clears the project's defaults", async () => {
    heldProject = projectWith({ [PREFS_KEY]: PROJECT_DEFAULT });
    storedDefaults = { [PREFS_KEY]: PROJECT_DEFAULT };

    renderTable();
    await waitForHeaders();
    await openPicker();

    await click(
      screen.getByTestId(COLUMN_CUSTOMIZATION_REMOVE_DEFAULT_TEST_ID),
    );
    await waitForPickerClosed();

    expect(updates).toEqual([{ defaultTableColumns: null }]);
    expect(heldProject?.defaultTableColumns).toBeUndefined();
  });

  test("taking it away keeps the Owner's own columns, where they have some", async () => {
    seedOwnLayout({
      order: ["name", "description", "currentMonitorStatus", "labels"],
      hidden: ["labels"],
    });

    renderTable();
    await waitForHeaders();
    await openPicker();

    await click(
      screen.getByTestId(COLUMN_CUSTOMIZATION_REMOVE_DEFAULT_TEST_ID),
    );
    await waitForPickerClosed();

    expect(readOwnLayout()).not.toBeNull();
    expect(getHeaders()).toEqual(["Name", "Description", "Monitor Status"]);
  });

  test("with no default for the list yet, there is nothing to take away: no Remove default", async () => {
    heldProject = projectWith(null);

    renderTable();
    await waitForHeaders();
    await openPicker();

    expect(
      screen.queryByTestId(COLUMN_CUSTOMIZATION_REMOVE_DEFAULT_TEST_ID),
    ).toBeNull();
    expect(
      screen.getByTestId(COLUMN_CUSTOMIZATION_EVERYONE_TEST_ID),
    ).toBeInTheDocument();
  });

  test("a refused save is said in the picker, which stays open; nothing of theirs is lost", async () => {
    seedOwnLayout({
      order: ["name", "description", "currentMonitorStatus", "labels"],
      hidden: ["labels"],
    });
    refuseUpdate = "You do not have permission to update this project.";

    renderTable();
    await waitForHeaders();
    await openPicker();

    await click(everyoneCheckbox());
    await pressSave();

    await waitFor(() => {
      expect(
        screen.getByText("You do not have permission to update this project."),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("column-customization-modal"),
    ).toBeInTheDocument();
    expect(readOwnLayout()).not.toBeNull();
  });
});
