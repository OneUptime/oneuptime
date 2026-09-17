/**
 * Source-level guards for the HTML widget.
 *
 * Common/Tests/Utils/Dashboard/HtmlWidgetDocument.test.ts proves the document
 * builder behaves; nothing there stops the React side from ignoring it and
 * hard-coding a sandbox attribute, dropping the attribute altogether, or
 * rendering the author's markup with dangerouslySetInnerHTML instead. Those
 * are the changes that would quietly turn a contained widget into stored XSS
 * on a public, anonymously-viewable dashboard, so they are pinned here.
 *
 * The other half of the file covers wiring. A new widget type has to be
 * registered in four separate places and each omission fails differently —
 * two throw BadDataException at runtime, one makes the widget unreachable,
 * and the fourth renders a silently empty card. None of them fail at compile
 * time.
 *
 * The widget is a React component that needs a browser to render and this
 * suite runs under jest's node environment, so the checks are static.
 */
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/* __dirname is App/Tests/Dashboard. */
const REPO_ROOT: string = path.join(__dirname, "../../..");

const WIDGET_COMPONENTS_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Components",
);

const HTML_WIDGET_RENDERER: string = path.join(
  WIDGET_COMPONENTS_DIR,
  "DashboardHtmlComponent.tsx",
);

const HTML_WIDGET_DOCUMENT: string = path.join(
  REPO_ROOT,
  "Common/Utils/Dashboard/HtmlWidgetDocument.ts",
);

/*
 * Comments in both files discuss allow-same-origin at length — that is the
 * point of them — so a bare substring search would always match. Strip
 * comments first and search the code that actually ships.
 */
function readCode(filePath: string): string {
  return fs
    .readFileSync(filePath, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

describe("HTML widget sandbox", () => {
  const renderer: string = readCode(HTML_WIDGET_RENDERER);
  const documentBuilder: string = readCode(HTML_WIDGET_DOCUMENT);

  test("the renderer isolates the author's markup in an iframe", () => {
    expect(renderer).toContain("<iframe");
    expect(renderer).toContain("srcDoc");
  });

  test("the renderer sets a sandbox attribute", () => {
    expect(renderer).toContain("sandbox=");
  });

  /*
   * Derived, not literal: the permission toggles have to reach the attribute,
   * and getSandboxAttribute is the single place that decides what a
   * permission grants.
   */
  test("the sandbox attribute comes from HtmlWidgetDocument", () => {
    expect(renderer).toContain("HtmlWidgetDocument.getSandboxAttribute");
  });

  /*
   * allow-same-origin plus allow-scripts is equivalent to no sandbox: the
   * frame can reach the parent DOM, the viewer's cookies and localStorage,
   * and can strip its own sandbox attribute. The public dashboard shares an
   * origin with /dashboard and /api, so this is the difference between a
   * contained widget and full account takeover from a shared dashboard.
   */
  test("neither file ever grants allow-same-origin", () => {
    expect(renderer).not.toContain("allow-same-origin");
    expect(documentBuilder).not.toContain("allow-same-origin");
  });

  test("neither file grants navigation of the hosting page", () => {
    expect(renderer).not.toContain("allow-top-navigation");
    expect(documentBuilder).not.toContain("allow-top-navigation");
  });

  /*
   * An iframe swallows every pointer event, so without this the widget
   * cannot be selected, dragged, or resized on the canvas.
   */
  test("the renderer stops the iframe eating pointer events in edit mode", () => {
    expect(renderer).toContain("pointerEvents");
    expect(renderer).toContain("props.isEditMode");
  });

  /*
   * The whole design rests on the author's HTML never touching the
   * dashboard's own document. Any widget reaching for innerHTML has left the
   * sandbox behind.
   */
  test("no dashboard widget renders author content with dangerouslySetInnerHTML", () => {
    const offenders: Array<string> = fs
      .readdirSync(WIDGET_COMPONENTS_DIR)
      .filter((name: string): boolean => {
        return name.endsWith(".tsx") || name.endsWith(".ts");
      })
      .filter((name: string): boolean => {
        return readCode(path.join(WIDGET_COMPONENTS_DIR, name)).includes(
          "dangerouslySetInnerHTML",
        );
      });

    expect(offenders).toEqual([]);
  });
});

describe("HTML widget registration", () => {
  /*
   * Each of these fails differently and none of them fails at compile time:
   * a missing settings entry throws when the modal opens, a missing
   * create-default entry throws when the widget is added, a missing catalog
   * entry makes it unreachable, and a missing render branch draws an empty
   * card with no error at all.
   */
  const registries: Array<{ file: string; description: string }> = [
    {
      file: "Common/Types/Dashboard/DashboardComponentType.ts",
      description: "the component type enum",
    },
    {
      file: "Common/Utils/Dashboard/Components/Index.ts",
      description: "the settings-arguments registry",
    },
    {
      file: "App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx",
      description: "the add-widget default component factory",
    },
    {
      file: "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent.tsx",
      description: "the renderer dispatch",
    },
    {
      file: "App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog.ts",
      description: "the Add Widget catalog",
    },
  ];

  test.each(registries)(
    "the Html component type is wired into $description",
    ({ file }: { file: string; description: string }) => {
      expect(readSource(path.join(REPO_ROOT, file))).toContain("Html");
    },
  );

  test("the settings form maps every code-editor input type to a code editor", () => {
    const mapping: string = readCode(
      path.join(
        REPO_ROOT,
        "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentInputTypeToFormFieldType.tsx",
      ),
    );

    /*
     * The mapping falls through to a plain single-line text input for any
     * unmapped type, so a missing branch here is a silently terrible editing
     * experience rather than an error.
     */
    expect(mapping).toContain("ComponentInputType.Html");
    expect(mapping).toContain("ComponentInputType.Css");
    expect(mapping).toContain("ComponentInputType.JavaScript");
    expect(mapping).toContain("FormFieldSchemaType.HTML");
    expect(mapping).toContain("FormFieldSchemaType.CSS");
    expect(mapping).toContain("FormFieldSchemaType.JavaScript");
  });
});
