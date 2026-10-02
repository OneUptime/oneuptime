import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";
import {
  DELETE_IRREVERSIBLE_SENTENCE,
  DELETE_QUESTION_TEMPLATE,
  DELETE_STATEMENT_TEMPLATE,
} from "../../UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import { DELETE_MORE_ITEMS_TEMPLATE } from "../../UI/Components/DeleteConfirmation/DeleteItemNames";
import { TYPE_TO_CONFIRM_TEMPLATE } from "../../UI/Components/DeleteConfirmation/TypeToConfirmDelete";
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * "When I want to delete any resource in OneUptime, please show the name of
 * the resource in the delete modal so we're sure which resource we're
 * deleting. Please do this across OneUptime." - the maintainer, looking at
 * "Delete Workflow - Are you sure you want to delete this workflow?".
 *
 * This keeps it that way, across every front end's source, Common's UI and,
 * when the checkout has it, ee:
 *
 *   - nothing builds the old nameless sentence ("delete this ${kind}") except
 *     the shared fallback for a record that truly has no name;
 *   - no delete or remove confirmation (a ConfirmModal whose action is Delete
 *     or Remove) says "delete this ..." or is fixed text from title to body -
 *     each one names what it deletes, somewhere;
 *   - the shared confirmations stay wired to the naming components;
 *   - the sentences that name things are in every locale, as whole sentences
 *     that keep their {{placeholder}}.
 *
 * A dialog that is right to name nothing goes in ALLOWED_DIALOGS below with
 * its reason. The guard fails when an entry stops matching, so the list
 * cannot outlive the code it excuses.
 */

// packages/Common/Tests/UI -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const SHARED_FALLBACK_FILE: string =
  "packages/Common/UI/Components/DeleteConfirmation/DeleteConfirmationMessage.tsx";

// "delete this ${", "remove this ${": a sentence about a kind, not a record.
const NAMELESS_TEMPLATE_PATTERN: RegExp = /\b(delete|remove) this \$\{/i;

const NAMELESS_SENTENCE_PATTERN: RegExp = /\b(delete|remove) this\b/i;

const DESTRUCTIVE_LABEL_PATTERN: RegExp = /^(delete|remove)\b/i;

const TYPED_NAME_PATTERN: RegExp = /requireTypedName=\{true\}/;

const TRANSLATION_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "t",
  "tx",
  "translateString",
  "translateValue",
]);

// Calls whose first argument is a whole sentence with {{placeholders}}.
const TEMPLATE_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "translateTemplate",
  "translatePlural",
]);

type DialogRule = "says-this" | "names-nothing";

interface AllowedDialog {
  file: string;
  title: string;
  rule: DialogRule;
  reason: string;
}

const ALLOWED_DIALOGS: Array<AllowedDialog> = [];

interface AllowedNamelessTemplate {
  file: string;
  // The line as written, trimmed.
  text: string;
  reason: string;
}

const ALLOWED_NAMELESS_TEMPLATES: Array<AllowedNamelessTemplate> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/NotificationMethods.tsx",
    text: "title={`Remove this ${methodToDelete.methodType} method?`}",
    reason:
      "Only the title asks about the kind of method. The body, getDeletionDescription, names it by its masked address or number and the user it belongs to, and counts the notification rules that go with it.",
  },
];

/*
 * A prop's value as written: its text when it is a string, a template or a
 * translation call on one, with "${…}" for each substitution. `isFixed` is
 * true when the text is all there is; null when the value is not written
 * down here (a variable, an element, a function call) and so may well name
 * the record.
 */
interface WrittenValue {
  text: string;
  isFixed: boolean;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function readWritten(
  expression: ts.Expression | undefined,
): WrittenValue | null {
  if (!expression) {
    return null;
  }

  const value: ts.Expression = unwrap(expression);

  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return { text: value.text, isFixed: true };
  }

  if (ts.isTemplateExpression(value)) {
    let text: string = value.head.text;

    for (const span of value.templateSpans) {
      text += "${…}" + span.literal.text;
    }

    return { text: text, isFixed: false };
  }

  if (
    ts.isCallExpression(value) &&
    ts.isIdentifier(value.expression) &&
    TRANSLATION_FUNCTIONS.has(value.expression.text) &&
    value.arguments.length > 0
  ) {
    return readWritten(value.arguments[0]);
  }

  /*
   * A whole translated sentence: translator.translateTemplate("Delete
   * {{itemName}}", ...), or translateNamedAction(translator, { template:
   * "Delete {{itemName}}" }). A {{placeholder}} is a value filled in, like
   * a template literal's substitution.
   */
  const calleeName: string | undefined = ts.isCallExpression(value)
    ? ts.isIdentifier(value.expression)
      ? value.expression.text
      : ts.isPropertyAccessExpression(value.expression)
        ? value.expression.name.text
        : undefined
    : undefined;

  if (ts.isCallExpression(value) && calleeName) {
    let template: WrittenValue | null = null;

    if (TEMPLATE_FUNCTIONS.has(calleeName) && value.arguments.length > 0) {
      template = readWritten(value.arguments[0]);
    }

    if (calleeName === "translateNamedAction" && value.arguments[1]) {
      const options: ts.Expression = unwrap(value.arguments[1]);

      if (ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "template"
          ) {
            template = readWritten(property.initializer);
          }
        }
      }
    }

    if (template) {
      return {
        text: template.text.replace(/\{\{\s*[\w.]+\s*\}\}/g, "${…}"),
        isFixed: template.isFixed && !template.text.includes("{{"),
      };
    }
  }

  return null;
}

function readAttribute(
  element: ts.JsxOpeningLikeElement,
  name: string,
): { present: boolean; value: WrittenValue | null } {
  for (const property of element.attributes.properties) {
    if (
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === name
    ) {
      const initializer: ts.JsxAttributeValue | undefined =
        property.initializer;

      if (!initializer) {
        return { present: true, value: null };
      }

      if (ts.isStringLiteral(initializer)) {
        return {
          present: true,
          value: { text: initializer.text, isFixed: true },
        };
      }

      if (ts.isJsxExpression(initializer)) {
        return { present: true, value: readWritten(initializer.expression) };
      }

      return { present: true, value: null };
    }
  }

  return { present: false, value: null };
}

interface DeleteDialog {
  file: string;
  line: number;
  title: string;
  submitLabel: string;
  description: string;
  findings: Array<DialogRule>;
}

/*
 * Every <ConfirmModal> in one source file whose action is a Delete or a
 * Remove, with what it says and which rules it breaks.
 */
function findDeleteDialogs(file: string, source: string): Array<DeleteDialog> {
  if (!source.includes("ConfirmModal")) {
    return [];
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const dialogs: Array<DeleteDialog> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === "ConfirmModal"
    ) {
      const title: WrittenValue | null = readAttribute(node, "title").value;
      const submit: { present: boolean; value: WrittenValue | null } =
        readAttribute(node, "submitButtonText");
      const description: WrittenValue | null = readAttribute(
        node,
        "description",
      ).value;

      // ConfirmModal's own default when no submit label is given.
      const submitLabel: WrittenValue | null = submit.present
        ? submit.value
        : { text: "Confirm", isFixed: true };

      const isDeleteDialog: boolean = submitLabel
        ? DESTRUCTIVE_LABEL_PATTERN.test(submitLabel.text.trim())
        : Boolean(title && DESTRUCTIVE_LABEL_PATTERN.test(title.text.trim()));

      if (isDeleteDialog) {
        const findings: Array<DialogRule> = [];

        if (description && NAMELESS_SENTENCE_PATTERN.test(description.text)) {
          findings.push("says-this");
        }

        if (title?.isFixed && description?.isFixed) {
          findings.push("names-nothing");
        }

        dialogs.push({
          file: file,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
          title: title?.text || "",
          submitLabel: submitLabel?.text || "",
          description: description?.text || "",
          findings: findings,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return dialogs;
}

interface Scan {
  files: Array<string>;
  dialogs: Array<DeleteDialog>;
  namelessTemplates: Array<{ file: string; line: number; text: string }>;
}

const scan: Scan = { files: [], dialogs: [], namelessTemplates: [] };

beforeAll(() => {
  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const file of listSourceFiles(root)) {
      const relativePath: string = toRelativePath(REPOSITORY_ROOT, file);
      const source: string = fs.readFileSync(file, "utf8");

      scan.files.push(relativePath);
      scan.dialogs.push(...findDeleteDialogs(relativePath, source));

      if (relativePath === SHARED_FALLBACK_FILE) {
        continue;
      }

      source.split("\n").forEach((lineText: string, index: number) => {
        if (NAMELESS_TEMPLATE_PATTERN.test(lineText)) {
          scan.namelessTemplates.push({
            file: relativePath,
            line: index + 1,
            text: lineText.trim(),
          });
        }
      });
    }
  }
});

const readSource: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
};

describe("the detector", () => {
  test("flags the sentence the maintainer saw", () => {
    const [dialog] = findDeleteDialogs(
      "Example.tsx",
      `const x = <ConfirmModal
        description={\`Are you sure you want to delete this \${model.singularName?.toLowerCase()}?\`}
        title={\`Delete \${model.singularName}\`}
        submitButtonText={\`Delete \${model.singularName}\`}
        onSubmit={() => {}}
      />;`,
    );

    expect(dialog?.findings).toEqual(["says-this"]);
  });

  test("flags a dialog that is fixed text from title to body", () => {
    const [dialog] = findDeleteDialogs(
      "Example.tsx",
      `const x = <ConfirmModal
        title="Delete Widget"
        description="This cannot be undone."
        submitButtonText="Delete"
        onSubmit={() => {}}
      />;`,
    );

    expect(dialog?.findings).toEqual(["names-nothing"]);
  });

  test("passes a dialog whose title names the record", () => {
    const [dialog] = findDeleteDialogs(
      "Example.tsx",
      `const x = <ConfirmModal
        title={\`Delete \${layer.name}?\`}
        description={"This removes the layer and its rotation."}
        submitButtonText={"Delete Layer"}
        onSubmit={() => {}}
      />;`,
    );

    expect(dialog?.findings).toEqual([]);
  });

  test("passes a dialog whose body is drawn by a component", () => {
    const [dialog] = findDeleteDialogs(
      "Example.tsx",
      `const x = <ConfirmModal
        title="Delete Saved View"
        description={<DeleteConfirmationMessage name={name} typeLabel="saved view" />}
        submitButtonText="Delete"
        onSubmit={() => {}}
      />;`,
    );

    expect(dialog?.findings).toEqual([]);
  });

  test("reads a translated label", () => {
    const dialogs: Array<DeleteDialog> = findDeleteDialogs(
      "Example.tsx",
      `const x = <ConfirmModal
        title={tx("Delete note")}
        description={tx("Are you sure you want to delete this note?")}
        submitButtonText={tx("Delete note")}
        onSubmit={() => {}}
      />;`,
    );

    expect(dialogs[0]?.findings).toEqual(["says-this", "names-nothing"]);
  });

  test("leaves error notices and other actions alone", () => {
    expect(
      findDeleteDialogs(
        "Example.tsx",
        `const a = <ConfirmModal title="Delete Error" description={error} submitButtonText="Close" onSubmit={() => {}} />;
         const b = <ConfirmModal title="Archive" description="Archive this monitor?" submitButtonText="Archive" onSubmit={() => {}} />;`,
      ),
    ).toEqual([]);
  });

  test("falls back to the title when the label is not written down", () => {
    const [dialog] = findDeleteDialogs(
      "Example.tsx",
      `const x = <ConfirmModal
        title="Remove this member?"
        description="Are you sure you want to remove this member?"
        submitButtonText={label}
        onSubmit={() => {}}
      />;`,
    );

    expect(dialog?.findings).toEqual(["says-this", "names-nothing"]);
  });
});

describe("delete confirmations across OneUptime", () => {
  test("the scan reached every front end", () => {
    for (const expected of [
      "packages/Common/UI/Components/ModelDelete/ModelDelete.tsx",
      "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/DeleteAccount.tsx",
      "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/Index.tsx",
    ]) {
      expect(scan.files).toContain(expected);
    }

    // And found the delete dialogs in them.
    expect(scan.dialogs.length).toBeGreaterThan(15);
    expect(
      scan.dialogs.some((dialog: DeleteDialog) => {
        return dialog.file.endsWith("ModelDelete/ModelDelete.tsx");
      }),
    ).toBe(true);
  });

  test('nothing builds "delete this <kind>" but the shared fallback', () => {
    const unexcused: Array<{ file: string; line: number; text: string }> =
      scan.namelessTemplates.filter(
        (site: { file: string; line: number; text: string }) => {
          return !ALLOWED_NAMELESS_TEMPLATES.some(
            (allowed: AllowedNamelessTemplate) => {
              return allowed.file === site.file && allowed.text === site.text;
            },
          );
        },
      );

    expect(unexcused).toEqual([]);
    expect(readSource(SHARED_FALLBACK_FILE)).toMatch(NAMELESS_TEMPLATE_PATTERN);
  });

  test("every allowed nameless template still exists", () => {
    for (const allowed of ALLOWED_NAMELESS_TEMPLATES) {
      expect(
        scan.namelessTemplates.some(
          (site: { file: string; line: number; text: string }) => {
            return site.file === allowed.file && site.text === allowed.text;
          },
        ),
      ).toBe(true);
    }
  });

  test("every delete dialog names what it deletes", () => {
    const unexcused: Array<string> = [];

    for (const dialog of scan.dialogs) {
      for (const rule of dialog.findings) {
        const isAllowed: boolean = ALLOWED_DIALOGS.some(
          (allowed: AllowedDialog) => {
            return (
              allowed.file === dialog.file &&
              allowed.title === dialog.title &&
              allowed.rule === rule
            );
          },
        );

        if (!isAllowed) {
          unexcused.push(
            `${dialog.file}:${dialog.line} "${dialog.title}" (${rule}): ${dialog.description}`,
          );
        }
      }
    }

    expect(unexcused).toEqual([]);
  });

  test("every allowance still matches a dialog", () => {
    for (const allowed of ALLOWED_DIALOGS) {
      expect(
        scan.dialogs.some((dialog: DeleteDialog) => {
          return (
            dialog.file === allowed.file &&
            dialog.title === allowed.title &&
            dialog.findings.includes(allowed.rule)
          );
        }),
      ).toBe(true);
    }
  });
});

describe("the shared confirmations are wired to the names", () => {
  test("a Delete page's card and its dialog both name the record", () => {
    const source: string = readSource(
      "packages/Common/UI/Components/ModelDelete/ModelDelete.tsx",
    );

    expect(source.match(/<DeleteConfirmationMessage/g)).toHaveLength(2);
    expect(source).toContain('kind="statement"');
    expect(source).toContain('kind="question"');
    expect(source).toContain("getDisplayNameColumn(model)");
    expect(source).toContain("<TypeToConfirmDelete");
  });

  test("a table names the row it deletes, and lists the rows a bulk delete takes", () => {
    const source: string = readSource(
      "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
    );

    expect(source).toContain("<DeleteConfirmationMessage");
    expect(source).toContain("getRecordDisplayName(item, { model: model })");
    expect(source).toContain("confirmDetails: (items: Array<TBaseModel>)");
    expect(source).toContain("<DeleteItemNames");
  });

  test("the bulk confirmation draws what the action lists", () => {
    expect(
      readSource("packages/Common/UI/Components/BulkUpdate/BulkUpdateForm.tsx"),
    ).toContain("children: button.confirmDetails?.(props.selectedItems)");
  });

  test.each([
    "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/Index.tsx",
    "packages/App/FeatureSet/AdminDashboard/src/Pages/Users/Index.tsx",
  ])("%s lists the records its own bulk delete takes", (file: string) => {
    const source: string = readSource(file);

    expect(source).toContain("confirmDetails:");
    expect(source).toContain("<DeleteItemNames");
  });

  /*
   * A project takes everything in it with it, for every member: the one
   * delete where reading the name is not enough and it has to be typed.
   */
  test.each([
    "packages/App/FeatureSet/Dashboard/src/Pages/Settings/DangerZone.tsx",
    "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Delete.tsx",
  ])("%s has the project's name typed before it deletes", (file: string) => {
    expect(readSource(file)).toMatch(TYPED_NAME_PATTERN);
  });

  test("the typed confirmation is kept to projects", () => {
    const users: Array<string> = scan.files.filter((file: string) => {
      return TYPED_NAME_PATTERN.test(readSource(file));
    });

    expect(users.sort()).toEqual([
      "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Delete.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Settings/DangerZone.tsx",
    ]);
  });
});

describe("the sentences in every locale", () => {
  const LOCALE_DIRECTORIES: Array<string> = [
    "packages/App/FeatureSet/Dashboard/src/Locales",
    "packages/App/FeatureSet/AdminDashboard/src/Locales",
  ];

  const SHARED_SENTENCES: Array<string> = [
    DELETE_QUESTION_TEMPLATE,
    DELETE_STATEMENT_TEMPLATE,
    DELETE_IRREVERSIBLE_SENTENCE,
    DELETE_MORE_ITEMS_TEMPLATE,
    TYPE_TO_CONFIRM_TEMPLATE,
  ];

  type ReadLocalesFunction = (
    directory: string,
  ) => Array<{ locale: string; entries: Record<string, unknown> }>;

  const readLocales: ReadLocalesFunction = (
    directory: string,
  ): Array<{ locale: string; entries: Record<string, unknown> }> => {
    return fs
      .readdirSync(path.join(REPOSITORY_ROOT, directory))
      .filter((file: string) => {
        return file.endsWith(".json");
      })
      .sort()
      .map((file: string) => {
        return {
          locale: file.replace(/\.json$/, ""),
          entries: JSON.parse(readSource(path.join(directory, file))),
        };
      });
  };

  test.each(LOCALE_DIRECTORIES)(
    "%s has every shared sentence, translated, keeping its placeholder",
    (directory: string) => {
      const locales: Array<{
        locale: string;
        entries: Record<string, unknown>;
      }> = readLocales(directory);

      expect(locales).toHaveLength(17);

      for (const { locale, entries } of locales) {
        for (const sentence of SHARED_SENTENCES) {
          const value: unknown = entries[sentence];

          expect({
            locale,
            sentence,
            isString: typeof value === "string",
          }).toEqual({
            locale,
            sentence,
            isString: true,
          });

          const placeholders: Array<string> =
            sentence.match(/\{\{\w+\}\}/g) || [];

          for (const placeholder of placeholders) {
            expect({
              locale,
              sentence,
              count: (value as string).split(placeholder).length - 1,
            }).toEqual({
              locale,
              sentence,
              count: 1,
            });
          }

          if (locale === "en") {
            expect(value).toBe(sentence);
          } else {
            expect({ locale, sentence, same: value === sentence }).toEqual({
              locale,
              sentence,
              same: false,
            });
          }
        }
      }
    },
  );
});
