import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every form that creates a project asks the same, the same way.
 *
 * The maintainer asked for the Create New Project dialog to be easier to
 * understand, with the promo code hidden away. Before, the Dashboard's dialog,
 * the Admin Dashboard's Projects page and an unused copy of the dialog in the
 * Admin Dashboard each built their own two-step form, each with a "Yearly Plan
 * (Save 20%)" switch - a saving no plan gave. Now one builder
 * (CreateProjectFormFields) makes the form, a plan picker (PlanPicker) works
 * out the saving from the prices, and this guard keeps it that way:
 *
 *   - a ModelFormModal or a creating ModelTable of Project takes its fields
 *     from getCreateProjectFormFields, and walks no steps;
 *   - only that builder asks for a promo code, and only it and the Billing
 *     page's Change Plan ask for a plan;
 *   - no source writes a yearly saving into its copy ("Save 20%").
 */

const REPOSITORY_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SOURCE_ROOTS: Array<string> = [
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/PublicDashboard/src",
  "packages/Common/UI",
  // Read when present: Common and App tests run without ee/.
  "ee/Dashboard",
  "ee/AdminDashboard",
];

const BUILDER: string =
  "packages/Common/UI/Components/Project/CreateProjectFormFields.tsx";
const BILLING_PAGE: string =
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/Billing.tsx";

// The forms that create a project. A new one is added here on purpose.
const PROJECT_CREATE_FORMS: Array<string> = [
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/Index.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/Header/ProjectPicker.tsx",
];

const SKIPPED_DIRECTORIES: Set<string> = new Set([
  "node_modules",
  "build",
  "dist",
  "Tests",
]);

function listSources(root: string): Array<string> {
  const absolute: string = path.join(REPOSITORY_ROOT, root);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const files: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(path.join(directory, entry.name));
        }
        continue;
      }

      if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.includes(".test.")
      ) {
        files.push(path.join(directory, entry.name));
      }
    }
  };

  walk(absolute);
  return files;
}

interface SourceFile {
  // Repository-relative, with forward slashes.
  file: string;
  text: string;
  tree: ts.SourceFile;
}

const SOURCES: Array<SourceFile> = SOURCE_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listSources(root);
  },
).map((absolute: string): SourceFile => {
  const text: string = fs.readFileSync(absolute, "utf8");

  return {
    file: path.relative(REPOSITORY_ROOT, absolute).split(path.sep).join("/"),
    text: text,
    tree: ts.createSourceFile(
      absolute,
      text,
      ts.ScriptTarget.Latest,
      true,
      absolute.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  };
});

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child: ts.Node) => {
    walk(child, visit);
  });
}

type JsxElementLike = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function jsxElements(source: SourceFile): Array<JsxElementLike> {
  const found: Array<JsxElementLike> = [];

  walk(source.tree, (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      found.push(node);
    }
  });

  return found;
}

function attribute(
  element: JsxElementLike,
  name: string,
): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (property: ts.JsxAttributeLike): property is ts.JsxAttribute => {
      return ts.isJsxAttribute(property) && property.name.getText() === name;
    },
  );
}

function attributeExpression(
  element: JsxElementLike,
  name: string,
): string | null {
  const found: ts.JsxAttribute | undefined = attribute(element, name);

  if (!found || !found.initializer) {
    return null;
  }

  if (ts.isJsxExpression(found.initializer)) {
    return found.initializer.expression?.getText() || null;
  }

  return found.initializer.getText();
}

function tagName(element: JsxElementLike): string {
  return element.tagName.getText();
}

interface ProjectForm {
  file: string;
  host: string;
  element: JsxElementLike;
}

// <ModelFormModal<Project> ...> and <ModelTable modelType={Project} isCreateable={true}>.
const PROJECT_FORMS: Array<ProjectForm> = SOURCES.flatMap(
  (source: SourceFile): Array<ProjectForm> => {
    return jsxElements(source)
      .filter((element: JsxElementLike): boolean => {
        const name: string = tagName(element);
        const isProject: boolean =
          attributeExpression(element, "modelType") === "Project";

        if (name === "ModelFormModal") {
          return isProject;
        }

        if (name === "ModelTable") {
          return (
            isProject && attributeExpression(element, "isCreateable") === "true"
          );
        }

        return false;
      })
      .map((element: JsxElementLike): ProjectForm => {
        return { file: source.file, host: tagName(element), element: element };
      });
  },
);

/*
 * Every `field: { <column>: true }` - a form field naming the column it
 * writes - for the given column.
 */
function filesWithFormFieldFor(column: string): Array<string> {
  return SOURCES.filter((source: SourceFile): boolean => {
    let found: boolean = false;

    walk(source.tree, (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText() === "field" &&
        ts.isObjectLiteralExpression(node.initializer) &&
        node.initializer.properties.some(
          (property: ts.ObjectLiteralElementLike): boolean => {
            return property.name?.getText() === column;
          },
        )
      ) {
        found = true;
      }
    });

    return found;
  })
    .map((source: SourceFile): string => {
      return source.file;
    })
    .sort();
}

describe("Every form that creates a project", () => {
  it("reads the sources it guards", () => {
    expect(SOURCES.length).toBeGreaterThan(1000);
    expect(
      SOURCES.map((source: SourceFile): string => {
        return source.file;
      }),
    ).toEqual(
      expect.arrayContaining([BUILDER, BILLING_PAGE, ...PROJECT_CREATE_FORMS]),
    );
  });

  it("is one of the known create-project forms", () => {
    expect(
      [
        ...new Set(
          PROJECT_FORMS.map((form: ProjectForm): string => {
            return form.file;
          }),
        ),
      ].sort(),
    ).toEqual(PROJECT_CREATE_FORMS);
  });

  it("takes its fields from getCreateProjectFormFields", () => {
    for (const file of PROJECT_CREATE_FORMS) {
      const source: SourceFile = SOURCES.find((candidate: SourceFile) => {
        return candidate.file === file;
      })!;

      expect({
        file,
        imports: source.text.includes(
          'import { getCreateProjectFormFields } from "Common/UI/Components/Project/CreateProjectFormFields";',
        ),
        calls: source.text.includes("getCreateProjectFormFields({"),
      }).toEqual({ file, imports: true, calls: true });
    }
  });

  it("walks no steps: the dialog is one page", () => {
    for (const form of PROJECT_FORMS) {
      if (form.host === "ModelTable") {
        expect({
          file: form.file,
          formSteps: attribute(form.element, "formSteps") !== undefined,
        }).toEqual({ file: form.file, formSteps: false });
        continue;
      }

      const formProps: string =
        attributeExpression(form.element, "formProps") || "";
      const formPropsNode: ts.Node | undefined = ((): ts.Node | undefined => {
        const found: ts.JsxAttribute | undefined = attribute(
          form.element,
          "formProps",
        );
        return found?.initializer && ts.isJsxExpression(found.initializer)
          ? found.initializer.expression
          : undefined;
      })();

      expect(formProps.length).toBeGreaterThan(0);
      expect(
        formPropsNode &&
          ts.isObjectLiteralExpression(formPropsNode) &&
          formPropsNode.properties.some(
            (property: ts.ObjectLiteralElementLike): boolean => {
              return property.name?.getText() === "steps";
            },
          ),
      ).toBe(false);
    }
  });

  it("is the only place a promo code is asked for", () => {
    expect(filesWithFormFieldFor("paymentProviderPromoCode")).toEqual([
      BUILDER,
    ]);
  });

  it("asks for a plan only there, and on the Billing page's Change Plan", () => {
    expect(filesWithFormFieldFor("paymentProviderPlanId")).toEqual(
      [BILLING_PAGE, BUILDER].sort(),
    );
  });

  it("folds the promo code under More fields", () => {
    const builder: SourceFile = SOURCES.find((source: SourceFile) => {
      return source.file === BUILDER;
    })!;

    expect(builder.text).toContain(
      "collapsibleSection: getAdvancedFormSection<Project>()",
    );
    expect(builder.text).not.toContain("stepId");
  });
});

describe("No yearly saving is written into the product's copy", () => {
  it("says what yearly saves from the prices (SubscriptionPlanPricing), never a fixed percent", () => {
    const fixedSaving: RegExp = /\bSave\s+(?:up\s+to\s+)?\d+\s*%/i;
    const offenders: Array<string> = [];

    for (const source of SOURCES) {
      walk(source.tree, (node: ts.Node) => {
        const text: string | null =
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isJsxText(node)
            ? node.text
            : ts.isTemplateExpression(node)
              ? node.getText()
              : null;

        if (text && fixedSaving.test(text)) {
          const position: ts.LineAndCharacter =
            source.tree.getLineAndCharacterOfPosition(node.getStart());
          offenders.push(`${source.file}:${position.line + 1}: ${text}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
