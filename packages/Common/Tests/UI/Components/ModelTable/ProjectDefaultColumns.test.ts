import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../../UI/Utils/Project";
import {
  PROJECT_DEFAULT_COLUMNS_COLUMN,
  canChangeProjectDefaultColumns,
  layoutToColumnPreference,
  readProjectDefaultColumns,
  saveProjectDefaultColumns,
} from "../../../../UI/Components/ModelTable/ProjectDefaultColumns";

/*
 * Reading and writing a list's columns for everyone in the project
 * (ModelTable/ProjectDefaultColumns): read off the project the page holds,
 * with no request of its own; written by merging into what the server holds
 * now, so another list's default set meanwhile is never lost; and offered
 * only to whoever may write the project's column.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
);

const projectWith: (defaults: unknown) => Project = (
  defaults: unknown,
): Project => {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();

  if (defaults !== undefined) {
    project.defaultTableColumns = defaults as JSONObject;
  }

  return project;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("readProjectDefaultColumns", () => {
  test("a list's layout, as a picker reads one", () => {
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(
      projectWith({
        "incidents-table": { order: ["title", "labels"], hidden: ["labels"] },
      }),
    );

    expect(readProjectDefaultColumns("incidents-table")).toEqual({
      order: ["title", "labels"],
      hidden: ["labels"],
    });
  });

  test("none for a list the project keeps no default for, nor for a list with no key", () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProject")
      .mockReturnValue(
        projectWith({ "alerts-table": { order: ["title"], hidden: [] } }),
      );

    expect(readProjectDefaultColumns("incidents-table")).toBeNull();
    expect(readProjectDefaultColumns(undefined)).toBeNull();
    expect(readProjectDefaultColumns("")).toBeNull();
  });

  test("none with no project, or a project copy that cannot be read", () => {
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(null);

    expect(readProjectDefaultColumns("incidents-table")).toBeNull();

    jest.spyOn(ProjectUtil, "getCurrentProject").mockImplementation(() => {
      throw new Error("Unexpected token in JSON");
    });

    expect(readProjectDefaultColumns("incidents-table")).toBeNull();
  });

  test("a stored value that is no layout reads as none", () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProject")
      .mockReturnValue(projectWith({ "incidents-table": "title" }));

    expect(readProjectDefaultColumns("incidents-table")).toBeNull();
  });

  test("layoutToColumnPreference copies, never shares the stored lists", () => {
    const order: Array<string> = ["title"];

    const preference: ReturnType<typeof layoutToColumnPreference> =
      layoutToColumnPreference({ order: order, hidden: [] });

    expect(preference).toEqual({ order: ["title"], hidden: [] });
    expect(preference?.order).not.toBe(order);
    expect(layoutToColumnPreference(null)).toBeNull();
  });
});

describe("canChangeProjectDefaultColumns", () => {
  test("with no project, nobody: there is nothing to set it on", () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    expect(canChangeProjectDefaultColumns()).toBe(false);
  });

  test("asks the gate about the project's own column, as the server does", () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

    const gate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(PermissionGate, "checkColumnUpdate")
      .mockReturnValue({ isAllowed: true } as PermissionGateResult);

    expect(canChangeProjectDefaultColumns()).toBe(true);
    expect(gate).toHaveBeenCalledWith(
      expect.any(Project),
      PROJECT_DEFAULT_COLUMNS_COLUMN,
    );

    gate.mockReturnValue({ isAllowed: false } as PermissionGateResult);

    expect(canChangeProjectDefaultColumns()).toBe(false);
  });

  test("the column it asks about is the project's", () => {
    expect(PROJECT_DEFAULT_COLUMNS_COLUMN).toBe("defaultTableColumns");
    expect(new Project().hasColumn(PROJECT_DEFAULT_COLUMNS_COLUMN)).toBe(true);
  });
});

describe("saveProjectDefaultColumns", () => {
  test("with no project it refuses rather than write nowhere", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    await expect(
      saveProjectDefaultColumns({
        tableKey: "incidents-table",
        preference: { order: ["title"], hidden: [] },
      }),
    ).rejects.toThrow("No project is selected.");
  });

  test("merges into what the server holds now, writes it, and hands the page's project the result", async () => {
    let held: Project | null = projectWith(undefined);
    const writes: Array<JSONObject> = [];

    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ProjectUtil, "getCurrentProject").mockImplementation(() => {
      return held;
    });
    jest
      .spyOn(ProjectUtil, "setCurrentProject")
      .mockImplementation((project: JSONObject | Project): void => {
        held = project as Project;
      });
    jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
      return projectWith({ "alerts-table": { order: ["title"], hidden: [] } });
    }) as unknown as typeof ModelAPI.getItem);
    jest.spyOn(ModelAPI, "updateById").mockImplementation((async (data: {
      id: ObjectID;
      data: JSONObject;
    }) => {
      expect(data.id.toString()).toBe(PROJECT_ID.toString());
      writes.push(data.data);
      return undefined;
    }) as unknown as typeof ModelAPI.updateById);

    const stored: ReturnType<typeof layoutToColumnPreference> =
      await saveProjectDefaultColumns({
        tableKey: "incidents-table",
        preference: { order: ["title", "title", "labels"], hidden: [] },
      });

    expect(stored).toEqual({ order: ["title", "labels"], hidden: [] });
    expect(writes).toEqual([
      {
        defaultTableColumns: {
          "alerts-table": { order: ["title"], hidden: [] },
          "incidents-table": { order: ["title", "labels"], hidden: [] },
        },
      },
    ]);
    expect(held?.defaultTableColumns).toEqual(
      writes[0]!["defaultTableColumns"],
    );
  });

  test("a refusal reaches the caller, and the page's project keeps what it had", async () => {
    const held: Project = projectWith({
      "incidents-table": { order: ["title"], hidden: [] },
    });
    const setCurrent: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ProjectUtil,
      "setCurrentProject",
    );

    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(held);
    jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
      return held;
    }) as unknown as typeof ModelAPI.getItem);
    jest.spyOn(ModelAPI, "updateById").mockImplementation((async () => {
      throw new Error("You do not have permission to update this project.");
    }) as unknown as typeof ModelAPI.updateById);

    await expect(
      saveProjectDefaultColumns({
        tableKey: "incidents-table",
        preference: null,
      }),
    ).rejects.toThrow("You do not have permission to update this project.");
    expect(setCurrent).not.toHaveBeenCalled();
  });
});
