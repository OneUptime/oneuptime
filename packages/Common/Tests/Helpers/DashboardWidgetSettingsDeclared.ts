import fs from "fs";
import path from "path";
import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import { ComponentArgument } from "../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { DASHBOARD_WIDGET_SORT_ARGUMENT } from "../../Types/Dashboard/DashboardWidgetSort";
import DashboardComponentsUtil from "../../Utils/Dashboard/Components/Index";
import {
  DASHBOARD_WIDGET_TYPES_SORTED_BY_OWN_COLUMNS,
  getDashboardWidgetSortSpec,
} from "../../Utils/Dashboard/DashboardWidgetSorts";

/*
 * The settings every dashboard widget type has, and the fields a variable
 * has, read from where they are declared rather than from any table that
 * decides about them - for the suites that hold such a table to them
 * (issue #6338: PublicDashboardServedSettings, which says what a public
 * dashboard serves of each widget and each variable):
 *
 * - each type's declared settings, the keys of `arguments` in its
 *   declaration (Types/Dashboard/DashboardComponents/Dashboard<Type>
 *   Component.ts);
 * - the settings its editor writes (DashboardComponentsUtil
 *   .getComponentSettingsArguments);
 * - its own sort (`arguments.sort`), when its kind keeps one (the sort
 *   registry, or a table sorted by its own columns).
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

const DASHBOARD_TYPES_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "Types",
  "Dashboard",
);

// TypeScript source without its comments.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// A line that declares a key: `title?: string | undefined;`, `text: string;`.
const KEY_LINE: RegExp = /^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/;

/*
 * The top-level keys of the object type that follows `opening` in a
 * source: `arguments: {` in a widget type's declaration, `interface
 * DashboardVariable {` in the variable's.
 */
export function declaredKeys(source: string, opening: string): Array<string> {
  const code: string = withoutComments(source);
  const start: number = code.indexOf(opening);

  if (start < 0) {
    return [];
  }

  const keys: Array<string> = [];
  let depth: number = 1;
  let line: string = "";

  for (
    let index: number = start + opening.length;
    index < code.length && depth > 0;
    index++
  ) {
    const character: string = code[index]!;

    if (character === "\n") {
      if (depth === 1) {
        const match: RegExpExecArray | null = KEY_LINE.exec(line);

        if (match) {
          keys.push(match[1]!);
        }
      }

      line = "";
      continue;
    }

    if (depth === 1) {
      line += character;
    }

    if (character === "{" || character === "(" || character === "[") {
      depth++;
    } else if (character === "}" || character === ")" || character === "]") {
      depth--;
    }
  }

  return keys;
}

// The settings a widget type declares, in the order it declares them.
export function declaredWidgetSettings(componentType: string): Array<string> {
  const file: string = path.join(
    DASHBOARD_TYPES_DIRECTORY,
    "DashboardComponents",
    `Dashboard${componentType}Component.ts`,
  );

  if (!fs.existsSync(file)) {
    return [];
  }

  return declaredKeys(fs.readFileSync(file, "utf8"), "arguments: {");
}

// The settings a widget type's editor writes.
export function editorWidgetSettings(
  componentType: DashboardComponentType,
): Array<string> {
  return DashboardComponentsUtil.getComponentSettingsArguments(
    componentType,
  ).map((argument: ComponentArgument<DashboardBaseComponent>): string => {
    return String(argument.id);
  });
}

// Whether a widget type keeps a sort of its own (issue #5082).
export function isSortableWidgetType(
  componentType: DashboardComponentType,
): boolean {
  return (
    getDashboardWidgetSortSpec(componentType) !== null ||
    DASHBOARD_WIDGET_TYPES_SORTED_BY_OWN_COLUMNS.includes(componentType)
  );
}

/*
 * Every setting a widget type has, as its declaration, its editor and its
 * sort say: sorted, each once.
 */
export function widgetSettingsOf(
  componentType: DashboardComponentType,
): Array<string> {
  return [
    ...new Set([
      ...declaredWidgetSettings(componentType),
      ...editorWidgetSettings(componentType),
      ...(isSortableWidgetType(componentType)
        ? [DASHBOARD_WIDGET_SORT_ARGUMENT]
        : []),
    ]),
  ].sort();
}

// The fields DashboardVariable declares.
export function declaredVariableFields(): Array<string> {
  return declaredKeys(
    fs.readFileSync(
      path.join(DASHBOARD_TYPES_DIRECTORY, "DashboardVariable.ts"),
      "utf8",
    ),
    "export default interface DashboardVariable {",
  );
}
