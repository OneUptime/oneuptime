import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ListOrderSettings } from "Common/Types/Database/ListOrderColumn";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Instead of showing orders, can you do drag and drop in the list ... When
 * the user adds it, it adds it to the end, and the user can drag and drop
 * those things to reorder it. Please do this everywhere else in the project
 * where order is mentioned."
 *
 * The models whose rows are put in order by dragging carry @ListOrderColumn,
 * and the server keeps their order column. This holds every Dashboard screen
 * of those models to the same three rules, so a new page cannot quietly
 * bring the number back:
 *
 *   1. a table of such a model can be dragged, by the column the model keeps;
 *   2. no form, table, filter or detail view of such a model shows or asks
 *      for that number;
 *   3. nothing sets the number for the person on create - the server puts a
 *      new row at the end, and a client-side "order = 1" would put every new
 *      row at the top instead (the log pipelines, drop filters and scrub
 *      rules used to do exactly that).
 */

type ModelType = { new (): BaseModel; name: string };

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const listModels: Array<{ name: string; settings: ListOrderSettings }> = (
  AllModelTypes as unknown as Array<ModelType>
)
  .map((modelType: ModelType) => {
    return {
      name: modelType.name,
      settings: new modelType().getListOrder(),
    };
  })
  .filter((entry: { name: string; settings: ListOrderSettings | null }) => {
    return Boolean(entry.settings);
  }) as Array<{ name: string; settings: ListOrderSettings }>;

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "Locales" || entry.name === "node_modules") {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

/*
 * The source of one JSX element, from its opening `<` to the `/>` or `>`
 * that closes its opening tag - attribute values in braces (which may hold
 * JSX of their own) are skipped over whole, and so are strings.
 */
function openingTagAt(source: string, start: number): string {
  let depth: number = 0;
  let quote: string | null = null;
  // Skip the element's own `<Name<Generic>` before reading attributes.
  let index: number = source.indexOf(">", source.indexOf("<", start + 1)) + 1;

  for (; index < source.length; index++) {
    const char: string = source[index] as string;

    if (quote) {
      if (char === "\\") {
        index++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth++;
      continue;
    }

    if (char === "}") {
      depth--;
      continue;
    }

    if (depth === 0 && char === ">") {
      return source.slice(start, index + 1);
    }
  }

  return source.slice(start);
}

interface Element {
  file: string;
  component: string;
  model: string;
  column: string;
  source: string;
}

const elements: Array<Element> = [];

for (const file of listSourceFiles(DASHBOARD_SRC)) {
  const source: string = fs.readFileSync(file, "utf8");

  for (const model of listModels) {
    const pattern: RegExp = new RegExp(
      `<([A-Za-z]+)<${model.name}>(?=[\\s>])`,
      "g",
    );

    for (const match of source.matchAll(pattern)) {
      elements.push({
        file: path.relative(DASHBOARD_SRC, file),
        component: match[1] as string,
        model: model.name,
        column: model.settings.column,
        source: openingTagAt(source, match.index as number),
      });
    }
  }
}

const tables: Array<Element> = elements.filter((element: Element) => {
  return element.component === "ModelTable";
});

describe("the Dashboard's drag-ordered lists", () => {
  test("there are drag-ordered models and tables of them to check", () => {
    expect(listModels.length).toBeGreaterThan(20);
    expect(tables.length).toBeGreaterThan(20);
  });

  /*
   * Incident custom fields render through the shared CustomFieldsPageBase
   * (Tests/App/Dashboard/CustomFieldsSettingsIncidentOptions covers it);
   * every other drag-ordered model has a table of its own.
   */
  test("every drag-ordered model has a table people can drag", () => {
    const withTable: Set<string> = new Set(
      tables.map((table: Element) => {
        return table.model;
      }),
    );

    const missing: Array<string> = listModels
      .map((model: { name: string }) => {
        return model.name;
      })
      .filter((name: string) => {
        return name !== "IncidentCustomField" && !withTable.has(name);
      });

    expect(missing).toEqual([]);
  });

  test.each(
    tables.map((table: Element) => {
      return [`${table.file} (${table.model})`, table] as [string, Element];
    }),
  )("%s can be dragged, by the column the model keeps", (_name: string, table: Element) => {
    expect(table.source).toContain("enableDragAndDrop={true}");
    expect(table.source).toContain(`dragDropIndexField="${table.column}"`);
  });

  test.each(
    elements.map((element: Element) => {
      return [
        `${element.file} <${element.component}<${element.model}>>`,
        element,
      ] as [string, Element];
    }),
  )("%s neither shows nor asks for the order number", (_name: string, element: Element) => {
    /*
     * A field, column, filter or selected field naming the order column.
     * sortBy and dragDropIndexField name it as a string, which is how the
     * list is kept in order - that is the only way it may appear.
     */
    expect(element.source).not.toMatch(
      new RegExp(`\\b${element.column}\\s*:\\s*true`),
    );
  });

  test.each(
    elements.map((element: Element) => {
      return [
        `${element.file} <${element.component}<${element.model}>>`,
        element,
      ] as [string, Element];
    }),
  )("%s leaves the number of a new row to the server", (_name: string, element: Element) => {
    expect(element.source).not.toMatch(
      new RegExp(`\\.${element.column}\\s*=(?!=)`),
    );
  });
});
