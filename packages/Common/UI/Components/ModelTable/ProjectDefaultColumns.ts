import { ColumnPreference } from "./ColumnPreference";
import Project from "../../../Models/DatabaseModels/Project";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DefaultTableColumns,
  DefaultTableColumnsUtil,
  TableColumnLayout,
} from "../../../Types/Table/DefaultTableColumns";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../Utils/PermissionGate";
import ProjectUtil from "../../Utils/Project";

/*
 * A LIST'S COLUMNS FOR EVERYONE IN THE PROJECT (Project.defaultTableColumns,
 * Types/Table/DefaultTableColumns).
 *
 * Which columns a list draws, in order of who decides:
 *
 *   1. The person's own choice for the list (Customize Columns), kept in
 *      their browser - a saved view's columns are applied as one.
 *   2. The project's default for the list, set by a Project Owner or Admin
 *      ("Show these columns to everyone in this project").
 *   3. The list's own columns, as the page declares them.
 *
 * The project's defaults come with the project the Dashboard reads as it
 * starts (ProjectAPI's list-user-projects; ProjectUtil keeps a copy), so a
 * list reads its default here as it is first drawn - no read of its own,
 * and no columns that change once a read lands. Elsewhere (the Admin
 * Dashboard, a status page) there is no project: every list draws its own.
 *
 * React-free: the rules are read here and pinned by their tests.
 */

// The project's column the defaults are kept in.
export const PROJECT_DEFAULT_COLUMNS_COLUMN: string = "defaultTableColumns";

// A stored layout as the picker and the table read one.
export const layoutToColumnPreference: (
  layout: TableColumnLayout | null,
) => ColumnPreference | null = (
  layout: TableColumnLayout | null,
): ColumnPreference | null => {
  if (!layout) {
    return null;
  }

  return { order: [...layout.order], hidden: [...layout.hidden] };
};

/*
 * The project's default columns for a list - by its key, a ModelTable's
 * userPreferencesKey - or null where the project keeps none, or there is
 * no project.
 */
export const readProjectDefaultColumns: (
  tableKey: string | undefined,
) => ColumnPreference | null = (
  tableKey: string | undefined,
): ColumnPreference | null => {
  if (!tableKey) {
    return null;
  }

  let project: Project | null = null;

  try {
    project = ProjectUtil.getCurrentProject();
  } catch {
    // A copy that cannot be read is no default.
    return null;
  }

  return layoutToColumnPreference(
    DefaultTableColumnsUtil.getLayout(project?.defaultTableColumns, tableKey),
  );
};

/*
 * Whether the reader may set the project's default columns: the column's
 * own update permissions (Project Owner, Project Admin), and a project to
 * set them on. Hidden rather than refused while the permission snapshot has
 * not landed, as every gate is.
 */
export const canChangeProjectDefaultColumns: () => boolean = (): boolean => {
  if (!ProjectUtil.getCurrentProjectId()) {
    return false;
  }

  return PermissionGate.checkColumnUpdate(
    new Project(),
    PROJECT_DEFAULT_COLUMNS_COLUMN,
  ).isAllowed;
};

/*
 * Makes a layout the project's default for a list, or - with null - takes
 * the list's default away, so everyone who has not chosen their own sees
 * the list's own columns again.
 *
 * The project's defaults are read afresh first and only this list's is
 * changed: another Owner may have set another list's since this page read
 * the project. The project this page keeps (ProjectUtil) is given the new
 * defaults, so every list drawn from here on reads them. Returns the list's
 * default as stored. Throws what the server says when it refuses.
 */
export const saveProjectDefaultColumns: (data: {
  tableKey: string;
  preference: ColumnPreference | null;
}) => Promise<ColumnPreference | null> = async (data: {
  tableKey: string;
  preference: ColumnPreference | null;
}): Promise<ColumnPreference | null> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    throw new Error("No project is selected.");
  }

  const stored: Project | null = await ModelAPI.getItem<Project>({
    modelType: Project,
    id: projectId,
    select: {
      defaultTableColumns: true,
    },
  });

  const next: DefaultTableColumns | null = DefaultTableColumnsUtil.withLayout({
    value: stored?.defaultTableColumns,
    tableKey: data.tableKey,
    layout: data.preference,
  });

  const nextJson: JSONObject | null = DefaultTableColumnsUtil.toJSON(next);

  await ModelAPI.updateById<Project>({
    modelType: Project,
    id: projectId,
    data: {
      [PROJECT_DEFAULT_COLUMNS_COLUMN]: nextJson,
    },
  });

  const current: Project | null = ProjectUtil.getCurrentProject();

  if (current) {
    if (nextJson) {
      current.defaultTableColumns = nextJson;
    } else {
      delete current.defaultTableColumns;
    }

    ProjectUtil.setCurrentProject(current);
  }

  return layoutToColumnPreference(
    DefaultTableColumnsUtil.getLayout(next, data.tableKey),
  );
};
