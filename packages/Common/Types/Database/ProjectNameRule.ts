import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getSharedNameKindOfTable } from "./SharedNameMarks";
import { getUniqueColumnsBy } from "./UniqueColumnBy";
import { getUniqueNameWhenRequiredColumn } from "./UniqueNameWhenRequired";

/*
 * HOW A KIND OF RECORD HOLDS ITS NAME IN ITS PROJECT (#10761).
 *
 * Three ways, read off the model:
 *
 *   - one of its kind while the project requires unique names: the column a
 *     model marks @UniqueNameWhenRequired (a monitor's name, a template's
 *     name);
 *   - one of its kind always: a name held @UniqueColumnBy("projectId") (a
 *     status page, a dashboard, a severity), and the names of teams,
 *     labels, on-call policies and on-call schedules (UniqueNameInProject);
 *   - free to repeat: everything else (an incident's title, a pod's name).
 *
 * A form warns as it takes a name another record of the kind has, for the
 * first two (DuplicateNameNotice), and the server's check of a name
 * (RequiredUniqueNames.checkName) answers for them alone. React-free and
 * server-safe.
 */

export interface ProjectNameRule {
  // The column the kind is known by.
  column: string;
  /*
   * One of its kind always, whatever the project's setting says - or only
   * while the project requires unique names.
   */
  isAlwaysUnique: boolean;
}

// The project's own column, which every rule is scoped to.
const PROJECT_COLUMN: string = "projectId";

// Whether a @UniqueColumnBy scope is the project alone.
const isProjectScope: (scope: unknown) => boolean = (
  scope: unknown,
): boolean => {
  if (scope === PROJECT_COLUMN) {
    return true;
  }

  return (
    Array.isArray(scope) && scope.length === 1 && scope[0] === PROJECT_COLUMN
  );
};

/*
 * How a model holds its name in its project, or null for a kind whose
 * names repeat freely - or that belongs to no project.
 */
export const getProjectNameRule: (
  model: BaseModel | { new (): BaseModel } | null | undefined,
) => ProjectNameRule | null = (
  model: BaseModel | { new (): BaseModel } | null | undefined,
): ProjectNameRule | null => {
  if (!model) {
    return null;
  }

  const instance: BaseModel =
    typeof model === "function" ? new model() : model;

  if (instance.getTenantColumn() !== PROJECT_COLUMN) {
    return null;
  }

  const markedColumn: string | null =
    getUniqueNameWhenRequiredColumn(instance);

  if (markedColumn) {
    return { column: markedColumn, isAlwaysUnique: false };
  }

  if (!instance.hasColumn("name")) {
    return null;
  }

  if (
    getSharedNameKindOfTable(instance.tableName) ||
    isProjectScope(getUniqueColumnsBy(instance)["name"])
  ) {
    return { column: "name", isAlwaysUnique: true };
  }

  return null;
};
