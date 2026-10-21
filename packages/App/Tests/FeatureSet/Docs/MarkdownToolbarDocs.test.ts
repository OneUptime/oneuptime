import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "We have a markdown editor and forms, but the form is not wide, so the
 * controls of the markdown editor show in two lines." Forms with the editor
 * now open in a wide dialog, and the toolbar keeps one line anywhere,
 * putting the buttons that do not fit under More formatting.
 *
 * Declaring an Incident describes the editor's toolbar, in English and in
 * Persian (the languages whose incident docs carry that paragraph; Persian
 * names the UI in English, as its incident pages do). Markdown is not
 * compiled, so nothing else notices a page that still describes a toolbar
 * that wraps, or names a menu the editor does not have.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.join(PACKAGES, "App/FeatureSet/Docs/Content");

const MARKDOWN_EDITOR: string = path.join(
  PACKAGES,
  "Common/UI/Components/Markdown.tsx/MarkdownEditor.tsx",
);

const FORM_MODAL_WIDTH: string = path.join(
  PACKAGES,
  "Common/UI/Components/Forms/Utils/FormModalWidth.ts",
);

// What each language says about the toolbar keeping its one line.
const ONE_LINE: Record<string, string> = {
  en: "The toolbar stays on one line",
  fa: "نوار ابزار در یک خط می‌ماند",
};

// And about the forms the editor is in opening wide.
const WIDE_DIALOG: Record<string, string> = {
  en: "forms with the editor open in a wide dialog",
  fa: "در پنجره‌ای پهن باز می‌شوند",
};

function readPage(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "incidents", "declaring-incidents.md"),
    "utf8",
  );
}

// The paragraph that describes writing in the editor.
function editorParagraph(language: string): string {
  const paragraph: string | undefined = readPage(language)
    .split("\n")
    .find((line: string): boolean => {
      return line.includes("**Indent**") && line.includes("**Outdent**");
    });

  if (!paragraph) {
    throw new Error(`no editor paragraph in ${language}`);
  }

  return paragraph;
}

describe("the docs on the Markdown editor's toolbar", () => {
  const editor: string = fs.readFileSync(MARKDOWN_EDITOR, "utf8");

  it("name the menu and the switch as the editor does", () => {
    expect(editor).toContain('tx("More formatting")');
    expect(editor).toContain('mode === "wysiwyg" ? "Markdown" : "Visual"');
    expect(editor).toContain("IconProp.EllipsisHorizontal");
    // The toolbar line does not wrap.
    expect(
      editor.slice(
        editor.indexOf('data-testid="markdown-editor-toolbar"'),
        editor.indexOf("{/* Editor Area */}"),
      ),
    ).not.toContain("flex-wrap");
  });

  it("say the forms open wide, as the form dialogs make them", () => {
    expect(fs.readFileSync(FORM_MODAL_WIDTH, "utf8")).toContain(
      "MARKDOWN_FORM_MODAL_WIDTH: ModalWidth = ModalWidth.Large",
    );
  });

  for (const language of ["en", "fa"]) {
    it(`say, in ${language}, that the toolbar keeps one line and where the rest goes`, () => {
      const paragraph: string = editorParagraph(language);

      expect({
        language: language,
        oneLine: paragraph.includes(ONE_LINE[language] as string),
        wideDialog: paragraph.includes(WIDE_DIALOG[language] as string),
        moreFormatting: paragraph.includes("**More formatting** (**⋯**)"),
        markdownSwitch: paragraph.includes("**Markdown**"),
      }).toEqual({
        language: language,
        oneLine: true,
        wideDialog: true,
        moreFormatting: true,
        markdownSwitch: true,
      });
    });
  }
});
