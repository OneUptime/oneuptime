import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getModelTypeByName } from "Common/Models/DatabaseModels/Index";
import { getLiveRowEventTypes } from "Common/UI/Components/ModelTable/LiveRows";

/*
 * Lists that keep themselves current (Common ModelTable/LiveRows.ts): a list
 * of incidents, alerts, episodes, SLOs, security cases or AI runs reads its
 * page again whenever the server announces a change to one of its records.
 * A list joins the live connection the app keeps open and never opens one
 * of its own, so:
 *
 *   - the Dashboard opens the connection as it starts, for someone signed
 *     in, before its first render;
 *   - the visitors' frontends (status pages, public dashboards) never do:
 *     a visitor has no project whose changes they could hear;
 *   - no list opts out of keeping itself current without saying here why;
 *   - a list that reads several projects at once hears each of them.
 *
 * The behaviour itself is covered in Common (Tests/UI/Components/ModelTable:
 * LiveRows, UseLiveRows, BaseModelTableLiveRows).
 */

const FEATURE_SET_DIR: string = path.join(__dirname, "..", "..", "FeatureSet");
const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..");

const parse: (file: string) => ts.SourceFile = (
  file: string,
): ts.SourceFile => {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
};

// The top-level statements of an entry that call Realtime.init().
const findRealtimeStarts: (
  sourceFile: ts.SourceFile,
) => Array<{ statement: ts.Statement; guard: string | null }> = (
  sourceFile: ts.SourceFile,
): Array<{ statement: ts.Statement; guard: string | null }> => {
  const starts: Array<{ statement: ts.Statement; guard: string | null }> = [];

  for (const statement of sourceFile.statements) {
    let found: boolean = false;

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sourceFile) === "Realtime.init"
      ) {
        found = true;
      }

      ts.forEachChild(node, visit);
    };

    visit(statement);

    if (found) {
      starts.push({
        statement,
        guard: ts.isIfStatement(statement)
          ? statement.expression.getText(sourceFile)
          : null,
      });
    }
  }

  return starts;
};

// Where the entry first renders: the root.render(...) call.
const findRenderPosition: (sourceFile: ts.SourceFile) => number = (
  sourceFile: ts.SourceFile,
): number => {
  let position: number = -1;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      position < 0 &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.getText(sourceFile) === "render"
    ) {
      position = node.getStart(sourceFile);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return position;
};

describe("the live connection a list joins", () => {
  test("the Dashboard opens it as it starts, for someone signed in, before it renders", () => {
    const file: string = path.join(
      FEATURE_SET_DIR,
      "Dashboard",
      "src",
      "Index.tsx",
    );
    const sourceFile: ts.SourceFile = parse(file);

    expect(sourceFile.getFullText()).toContain(
      'import Realtime from "Common/UI/Utils/Realtime";',
    );

    const starts: Array<{ statement: ts.Statement; guard: string | null }> =
      findRealtimeStarts(sourceFile);

    expect(
      starts.map((start: { guard: string | null }): string | null => {
        return start.guard;
      }),
    ).toEqual(["UserUtil.isLoggedIn()"]);

    const renderAt: number = findRenderPosition(sourceFile);
    expect(renderAt).toBeGreaterThan(0);
    expect(starts[0]!.statement.getStart(sourceFile)).toBeLessThan(renderAt);
  });

  test.each(["StatusPage", "PublicDashboard"])(
    "%s, whose readers are visitors, never opens it",
    (frontend: string) => {
      const sourceFile: ts.SourceFile = parse(
        path.join(FEATURE_SET_DIR, frontend, "src", "Index.tsx"),
      );

      expect(findRealtimeStarts(sourceFile)).toEqual([]);
    },
  );
});

/*
 * A list that should not move while it is read says so with isLive={false},
 * listed here with the reason. None does today: a list of incidents or
 * alerts that keeps itself current is what someone watching it expects.
 */
const LISTS_KEPT_AS_LOADED: Array<{ file: string; reason: string }> = [];

// A table element: ModelTable, BaseModelTable, IncidentsTable, <X>Table<Y>.
const TABLE_ELEMENT: RegExp = /Table(<.*>)?$/;

const FRONTEND_SOURCES: Array<string> = [
  path.join(FEATURE_SET_DIR, "Dashboard", "src"),
  path.join(FEATURE_SET_DIR, "AdminDashboard", "src"),
  path.join(REPO_ROOT, "ee"),
];

const listSourceFiles: (dir: string) => Array<string> = (
  dir: string,
): Array<string> => {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
};

describe("lists that opt out of keeping themselves current", () => {
  test("say why here, and say it with a plain isLive={false}", () => {
    const optOuts: Array<string> = [];
    const unreadable: Array<string> = [];

    for (const dir of FRONTEND_SOURCES) {
      for (const file of listSourceFiles(dir)) {
        const source: string = fs.readFileSync(file, "utf8");

        if (!source.includes("isLive")) {
          continue;
        }

        const sourceFile: ts.SourceFile = parse(file);

        const visit: (node: ts.Node) => void = (node: ts.Node): void => {
          /*
           * On a table: ModelTable, BaseModelTable or a page's own list
           * built on them (IncidentsTable, AlertsTable, ...). Other
           * components have an isLive of their own (a running AI
           * investigation's badge).
           */
          if (
            ts.isJsxAttribute(node) &&
            node.name.getText(sourceFile) === "isLive" &&
            ts.isJsxAttributes(node.parent) &&
            (ts.isJsxOpeningElement(node.parent.parent) ||
              ts.isJsxSelfClosingElement(node.parent.parent)) &&
            TABLE_ELEMENT.test(node.parent.parent.tagName.getText(sourceFile))
          ) {
            const value: string = node.initializer
              ? node.initializer.getText(sourceFile)
              : "";

            if (value === "{false}") {
              optOuts.push(path.relative(REPO_ROOT, file));
            } else {
              unreadable.push(`${path.relative(REPO_ROOT, file)}: ${value}`);
            }
          }

          ts.forEachChild(node, visit);
        };

        visit(sourceFile);
      }
    }

    expect(unreadable).toEqual([]);
    expect(optOuts.sort()).toEqual(
      LISTS_KEPT_AS_LOADED.map((entry: { file: string }): string => {
        return entry.file;
      }).sort(),
    );

    for (const entry of LISTS_KEPT_AS_LOADED) {
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });
});

/*
 * A list that reads several projects at once - a ModelTable whose
 * fetchRequestOptions asks with isMultiTenantRequest, such as Active
 * Incidents, which lists every project the person belongs to - hears the
 * changes of each of them (liveProjectIds), not only the open project's
 * (#6917). A change is announced in its own project, so a list that
 * listened to one missed the others'. The page is handed the person's
 * projects by App.tsx, which the project picker lists.
 */
describe("a list across projects hears every project it reads", () => {
  // A table's fetchRequestOptions that read every project the person is in.
  const READS_SEVERAL_PROJECTS: RegExp = /isMultiTenantRequest:\s*true/;

  interface CrossProjectList {
    file: string;
    component: string;
    modelName: string;
    hearsEveryProject: boolean;
  }

  // The name a page's file exports as its default.
  const defaultExportOf: (sourceFile: ts.SourceFile) => string = (
    sourceFile: ts.SourceFile,
  ): string => {
    for (const statement of sourceFile.statements) {
      if (ts.isExportAssignment(statement)) {
        return statement.expression.getText(sourceFile);
      }
    }

    return "";
  };

  const findCrossProjectLists: () => Array<CrossProjectList> =
    (): Array<CrossProjectList> => {
      const lists: Array<CrossProjectList> = [];

      for (const file of listSourceFiles(
        path.join(FEATURE_SET_DIR, "Dashboard", "src"),
      )) {
        const source: string = fs.readFileSync(file, "utf8");

        if (!source.includes("isMultiTenantRequest")) {
          continue;
        }

        const sourceFile: ts.SourceFile = parse(file);

        const visit: (node: ts.Node) => void = (node: ts.Node): void => {
          if (
            (ts.isJsxOpeningElement(node) ||
              ts.isJsxSelfClosingElement(node)) &&
            TABLE_ELEMENT.test(node.tagName.getText(sourceFile))
          ) {
            const attributes: Map<string, string> = new Map<string, string>();

            for (const property of node.attributes.properties) {
              if (ts.isJsxAttribute(property)) {
                attributes.set(
                  property.name.getText(sourceFile),
                  property.initializer
                    ? property.initializer.getText(sourceFile)
                    : "",
                );
              }
            }

            if (
              READS_SEVERAL_PROJECTS.test(
                attributes.get("fetchRequestOptions") || "",
              )
            ) {
              lists.push({
                file: path.relative(REPO_ROOT, file),
                component: defaultExportOf(sourceFile),
                modelName: (attributes.get("modelType") || "").replace(
                  /[{}\s]/g,
                  "",
                ),
                hearsEveryProject: attributes.has("liveProjectIds"),
              });
            }
          }

          ts.forEachChild(node, visit);
        };

        visit(sourceFile);
      }

      return lists;
    };

  const lists: Array<CrossProjectList> = findCrossProjectLists();

  const announcesChanges: (modelName: string) => boolean = (
    modelName: string,
  ): boolean => {
    const modelType: { new (): BaseModel } | null =
      getModelTypeByName(modelName);

    expect([modelName, Boolean(modelType)]).toEqual([modelName, true]);

    return getLiveRowEventTypes(new modelType!()).length > 0;
  };

  test("the scan finds the inboxes the bell opens", () => {
    expect(
      lists
        .map((list: CrossProjectList): string => {
          return list.component;
        })
        .sort(),
    ).toEqual(
      expect.arrayContaining([
        "ActiveAlertEpisodes",
        "ActiveAlerts",
        "ActiveIncidentEpisodes",
        "ActiveIncidents",
      ]),
    );
  });

  test("each one whose records are announced hears every project it reads", () => {
    const deaf: Array<string> = lists
      .filter((list: CrossProjectList): boolean => {
        return announcesChanges(list.modelName) && !list.hearsEveryProject;
      })
      .map((list: CrossProjectList): string => {
        return list.file;
      });

    expect(deaf).toEqual([]);
  });

  test("App.tsx hands each of those pages the person's projects", () => {
    const app: string = fs
      .readFileSync(
        path.join(FEATURE_SET_DIR, "Dashboard", "src", "App.tsx"),
        "utf8",
      )
      .replace(/\s+/g, " ");

    const handed: Array<string> = lists
      .filter((list: CrossProjectList): boolean => {
        return list.hearsEveryProject;
      })
      .map((list: CrossProjectList): string => {
        return list.component;
      });

    expect(handed.length).toBeGreaterThan(0);

    for (const component of handed) {
      const element: RegExp = new RegExp(
        `<${component} [^>]*projects=\\{projects\\}[^>]*/>`,
      );

      expect([component, element.test(app)]).toEqual([component, true]);
    }
  });
});
