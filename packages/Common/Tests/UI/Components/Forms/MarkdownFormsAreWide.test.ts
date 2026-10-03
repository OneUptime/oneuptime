import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  FormHostName,
  scanFormFiles,
  toRepositoryPath,
} from "../../../Helpers/FormStepsScan";

/*
 * "We have a markdown editor and forms, but the form is not wide, so the
 * controls of the markdown editor show in two lines. Can you please make
 * these forms wide where markdown editor is shown? Please do this
 * everywhere in the project where this is an issue." - the maintainer.
 *
 * How it holds everywhere:
 *
 *   - a form dialog with a Markdown field opens Large, whatever its page
 *     asked for: ModelFormModal and BasicFormModal decide it
 *     (Forms/Utils/FormModalWidth.ts), so every table's Create and Edit,
 *     every card's Edit and every other form dialog follows on its own;
 *   - the editor's toolbar never wraps: where a form is narrower than it
 *     - a page with a side menu, a phone - the buttons that do not fit go
 *     under its More formatting button (MarkdownToolbarLayout.ts);
 *   - an editor folded away in a collapsed section is not on screen until
 *     the section is opened, so the dialog opens at its own width and grows
 *     to the wide one when someone opens it to write - the optional note of
 *     an Acknowledge or Resolve confirm. The dialogs learn which sections
 *     are open from the sections themselves (Forms/Utils/OpenFormSections),
 *     before anything is painted.
 *
 * This guard reads every form in the frontends (Tests/Helpers/FormStepsScan
 * finds them and their fields) and fails on what would undo that:
 *
 *   - a page asking for a narrower dialog for a form with a Markdown field.
 *     It would be overruled, so the code would say something untrue, and a
 *     change to the rule would quietly make it true;
 *   - a page form with a Markdown field inside a hand-built <Modal> that is
 *     not Large;
 *   - the editor drawn outside a form field - not through FormField - other
 *     than in a Large dialog, unless it is listed below with where it is
 *     and why its width is right there.
 *
 * The scan is checked to have really read the forms first, so a broken walk
 * cannot pass by finding nothing.
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const MARKDOWN_FIELD_TYPE: string = "FormFieldSchemaType.Markdown";

const WIDE: string = "ModalWidth.Large";

// The hosts whose form opens in a dialog, and the attribute that sizes it.
const DIALOG_HOSTS: Partial<Record<FormHostName, string>> = {
  ModelTable: "createEditModalWidth",
  RuleTable: "createEditModalWidth",
  LabelRuleTable: "createEditModalWidth",
  CardModelDetail: "createEditModalWidth",
  ModelFormModal: "modalWidth",
  BasicFormModal: "modalWidth",
};

// The hosts that draw their form where they are: a page, or a dialog around them.
const IN_PLACE_HOSTS: Array<FormHostName> = ["ModelForm", "BasicForm"];

interface ListedEditor {
  // Repository-relative, with "/".
  file: string;
  reason: string;
}

/*
 * The editor drawn by hand, outside a form field and outside a Large dialog,
 * and why that is right where it is.
 */
export const EDITORS_OUTSIDE_FORM_DIALOGS: Array<ListedEditor> = [
  {
    file: `${DASHBOARD}/Components/EventNotes/NoteComposer.tsx`,
    reason:
      "The notes feed's composer, on the incident, alert, scheduled maintenance and episode note pages themselves: as wide as the feed, which is the page's main column. Its toolbar fits itself to that width and puts the rest under More formatting. The overview feeds' Add Public Note / Add Private Note draw the same composer inside a ModalWidth.Large dialog (EventNoteComposer).",
  },
  {
    file: `${DASHBOARD}/Components/Form/Monitor/MonitorCriteriaIncidentForm.tsx`,
    reason:
      "The incident a monitor criteria instance declares, inside that instance in the monitor's form: on the Create Monitor page, or in the Large dialogs of a monitor's Criteria card and of a monitor template. Its toolbar fits itself to the instance's width.",
  },
  {
    file: `${DASHBOARD}/Components/Form/Monitor/MonitorCriteriaAlertForm.tsx`,
    reason:
      "The alert a monitor criteria instance creates, inside that instance in the monitor's form: on the Create Monitor page, or in the Large dialogs of a monitor's Criteria card and of a monitor template. Its toolbar fits itself to the instance's width.",
  },
];

const parsedFiles: Map<string, ts.SourceFile> = new Map<
  string,
  ts.SourceFile
>();

function parse(repositoryPath: string): ts.SourceFile {
  const cached: ts.SourceFile | undefined = parsedFiles.get(repositoryPath);

  if (cached) {
    return cached;
  }

  const fileName: string = path.join(REPOSITORY_ROOT, repositoryPath);
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    fs.readFileSync(fileName, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  parsedFiles.set(repositoryPath, sourceFile);

  return sourceFile;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

type JsxTag = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function jsxTagsNamed(sourceFile: ts.SourceFile, name: string): Array<JsxTag> {
  const found: Array<JsxTag> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === name
    ) {
      found.push(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

// The JSX tag a scanned form was read from: its host, at its line.
function hostTagOf(form: FormFacts): JsxTag {
  const sourceFile: ts.SourceFile = parse(form.file);
  const tag: JsxTag | undefined = jsxTagsNamed(sourceFile, form.host).find(
    (candidate: JsxTag): boolean => {
      return lineOf(sourceFile, candidate) === form.line;
    },
  );

  if (!tag) {
    throw new Error(`no <${form.host}> at ${form.file}:${form.line}`);
  }

  return tag;
}

// An attribute's value as written - `ModalWidth.Large` - or undefined.
function attributeText(tag: JsxTag, name: string): string | undefined {
  const sourceFile: ts.SourceFile = tag.getSourceFile();

  for (const property of tag.attributes.properties) {
    if (
      ts.isJsxAttribute(property) &&
      property.name.getText(sourceFile) === name
    ) {
      const initializer: ts.JsxAttributeValue | undefined =
        property.initializer;

      if (!initializer) {
        return "true";
      }

      if (ts.isJsxExpression(initializer) && initializer.expression) {
        return initializer.expression.getText(sourceFile).replace(/\s+/g, "");
      }

      return initializer.getText(sourceFile);
    }
  }

  return undefined;
}

// The nearest <Modal> the tag is drawn inside, in its own file.
function enclosingModalOf(tag: JsxTag): JsxTag | null {
  const sourceFile: ts.SourceFile = tag.getSourceFile();
  let node: ts.Node | undefined = tag.parent;

  while (node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement !== tag &&
      node.openingElement.tagName.getText(sourceFile) === "Modal"
    ) {
      return node.openingElement;
    }

    node = node.parent;
  }

  return null;
}

function hasMarkdownField(form: FormFacts): boolean {
  return form.fields.some((field: FormFieldFacts): boolean => {
    return field.fieldType === MARKDOWN_FIELD_TYPE;
  });
}

function describeForm(form: FormFacts): string {
  return `${form.file}:${form.line} ${form.label}`;
}

const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(root);
  },
);

const forms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files,
});

const markdownForms: Array<FormFacts> = forms.filter(hasMarkdownField);

describe("forms with a Markdown editor", () => {
  // A broken walk must not pass by finding nothing.
  test("are really found, the maintainer's dialog among them", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(markdownForms.length).toBeGreaterThan(50);

    const noteTemplates: FormFacts | undefined = markdownForms.find(
      (form: FormFacts): boolean => {
        return (
          form.file ===
            `${DASHBOARD}/Pages/Incidents/Settings/IncidentNoteTemplates.tsx` &&
          form.host === "ModelTable"
        );
      },
    );

    expect(noteTemplates).toBeDefined();
    expect(noteTemplates?.hasSteps).toBe(true);
    // It asks for no width: the rule makes its dialog wide.
    expect(
      attributeText(hostTagOf(noteTemplates!), "createEditModalWidth"),
    ).toBe(undefined);

    // Dialogs, cards and page forms alike.
    const hosts: Set<FormHostName> = new Set<FormHostName>(
      markdownForms.map((form: FormFacts): FormHostName => {
        return form.host;
      }),
    );

    expect(Array.from(hosts)).toEqual(
      expect.arrayContaining([
        "ModelTable",
        "CardModelDetail",
        "ModelFormModal",
        "ModelForm",
        "BasicForm",
      ]),
    );
  });

  test("in a dialog never ask for one narrower than the wide one", () => {
    const narrow: Array<string> = [];

    for (const form of markdownForms) {
      const attribute: string | undefined = DIALOG_HOSTS[form.host];

      if (!attribute) {
        continue;
      }

      const width: string | undefined = attributeText(
        hostTagOf(form),
        attribute,
      );

      if (width !== undefined && width !== WIDE) {
        narrow.push(`${describeForm(form)} asks for ${attribute}=${width}`);
      }
    }

    expect(narrow).toEqual([]);
  });

  test("drawn in place sit on a page, or in a Large dialog", () => {
    const narrow: Array<string> = [];

    for (const form of markdownForms) {
      if (!IN_PLACE_HOSTS.includes(form.host)) {
        continue;
      }

      const modal: JsxTag | null = enclosingModalOf(hostTagOf(form));

      if (modal && attributeText(modal, "modalWidth") !== WIDE) {
        narrow.push(
          `${describeForm(form)} is in a <Modal> with modalWidth=${attributeText(modal, "modalWidth")}`,
        );
      }
    }

    expect(narrow).toEqual([]);
  });
});

describe("the Markdown editor drawn by hand", () => {
  const FORM_FIELD: string =
    "packages/Common/UI/Components/Forms/Fields/FormField.tsx";

  // Every <MarkdownEditor> outside the form field that draws it for forms.
  const usages: Array<{ file: string; line: number; tag: JsxTag }> = files
    .filter((file: string): boolean => {
      return (
        file.endsWith(".tsx") &&
        fs.readFileSync(file, "utf8").includes("<MarkdownEditor")
      );
    })
    .map((file: string): string => {
      return toRepositoryPath(REPOSITORY_ROOT, file);
    })
    .filter((file: string): boolean => {
      return file !== FORM_FIELD;
    })
    .flatMap((file: string) => {
      const sourceFile: ts.SourceFile = parse(file);

      return jsxTagsNamed(sourceFile, "MarkdownEditor").map((tag: JsxTag) => {
        return { file, line: lineOf(sourceFile, tag), tag };
      });
    });

  test("is found where it is drawn", () => {
    expect(
      jsxTagsNamed(parse(FORM_FIELD), "MarkdownEditor").length,
    ).toBeGreaterThan(0);
    expect(
      usages.map((usage: { file: string }): string => {
        return usage.file;
      }),
    ).toEqual(
      expect.arrayContaining([
        "packages/Common/UI/Components/AI/GenerateFromAIModal.tsx",
        `${DASHBOARD}/Components/EventNotes/NoteComposer.tsx`,
      ]),
    );
  });

  test("is in a Large dialog, or listed with where it is and why", () => {
    const listed: Set<string> = new Set<string>(
      EDITORS_OUTSIDE_FORM_DIALOGS.map((entry: ListedEditor): string => {
        return entry.file;
      }),
    );

    const unlisted: Array<string> = usages
      .filter((usage: { file: string; tag: JsxTag }): boolean => {
        const modal: JsxTag | null = enclosingModalOf(usage.tag);

        if (modal) {
          return attributeText(modal, "modalWidth") !== WIDE;
        }

        return !listed.has(usage.file);
      })
      .map((usage: { file: string; line: number }): string => {
        return `${usage.file}:${usage.line}`;
      });

    expect(unlisted).toEqual([]);
  });

  test("listed outside a dialog is still drawn there, so the list never goes stale", () => {
    const drawnOutsideADialog: Set<string> = new Set<string>(
      usages
        .filter((usage: { tag: JsxTag }): boolean => {
          return enclosingModalOf(usage.tag) === null;
        })
        .map((usage: { file: string }): string => {
          return usage.file;
        }),
    );

    expect(
      EDITORS_OUTSIDE_FORM_DIALOGS.filter((entry: ListedEditor): boolean => {
        return !drawnOutsideADialog.has(entry.file);
      }),
    ).toEqual([]);

    for (const entry of EDITORS_OUTSIDE_FORM_DIALOGS) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });
});

describe("what makes them wide", () => {
  function read(repositoryPath: string): string {
    return fs.readFileSync(path.join(REPOSITORY_ROOT, repositoryPath), "utf8");
  }

  test("both form dialogs size themselves by the rule", () => {
    for (const dialog of [
      "packages/Common/UI/Components/ModelFormModal/ModelFormModal.tsx",
      "packages/Common/UI/Components/FormModal/BasicFormModal.tsx",
    ]) {
      const source: string = read(dialog);

      expect(source).toContain("getFormModalWidth({");
      expect(source).toContain("fields: props.formProps.fields");
    }
  });

  test("both form dialogs grow wide while a folded editor's section is open", () => {
    for (const dialog of [
      "packages/Common/UI/Components/ModelFormModal/ModelFormModal.tsx",
      "packages/Common/UI/Components/FormModal/BasicFormModal.tsx",
    ]) {
      const source: string = read(dialog);

      // The dialog keeps the record and sizes itself by it...
      expect(source).toContain("useOpenFormSections()");
      expect(source).toContain(
        "openSectionIds: openFormSections.openSectionIds",
      );
      // ...which its form's sections report to.
      expect(source).toContain("<OpenFormSectionsContext.Provider");
      expect(source).toContain("value={openFormSections.reportSectionOpen}");
    }

    // Each folded section reports itself, before paint, by its id.
    const section: string = read(
      "packages/Common/UI/Components/Forms/CollapsibleFormSection.tsx",
    );

    expect(section).toMatch(/useContext\(\s*OpenFormSectionsContext,?\s*\)/);
    expect(section).toContain("useLayoutEffect(() => {");
    expect(section).toContain("isOpen: !isCollapsed,");
    expect(read("packages/Common/UI/Components/Forms/BasicForm.tsx")).toContain(
      "sectionId={section.id}",
    );
  });

  test("a folded editor counts only while its section is open", () => {
    const rule: string = read(
      "packages/Common/UI/Components/Forms/Utils/FormModalWidth.ts",
    );

    expect(rule).toContain("if (field.collapsibleSection && openSectionIds) {");
    expect(rule).toContain(
      "return openSectionIds.includes(field.collapsibleSection.id);",
    );
  });

  test("the rule's wide dialog is the Large one", () => {
    expect(
      read("packages/Common/UI/Components/Forms/Utils/FormModalWidth.ts"),
    ).toContain("MARKDOWN_FORM_MODAL_WIDTH: ModalWidth = ModalWidth.Large");
  });

  test("the editor's toolbar keeps one line instead of wrapping", () => {
    const source: string = read(
      "packages/Common/UI/Components/Markdown.tsx/MarkdownEditor.tsx",
    );
    const toolbar: string = source.slice(
      source.indexOf('data-testid="markdown-editor-toolbar"'),
      source.indexOf("{/* Editor Area */}"),
    );

    expect(toolbar.length).toBeGreaterThan(500);
    expect(toolbar).not.toContain("flex-wrap");
    // What does not fit goes under More formatting.
    expect(toolbar).toContain("toolbarLayout.hasMoreMenu");
    expect(toolbar).toContain("<MoreMenu");
  });
});
