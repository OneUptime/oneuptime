// UX rule: Docs/ux/README.md#one-control-for-one-job
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";

/*
 * A ROLE IS ONE A SCREEN READER KNOWS (#7964).
 *
 * A role tells a screen reader what a part is: a button, a menu, a dialog.
 * One the WAI-ARIA specification does not define means nothing to it: the
 * browser drops it, and accessibility checkers (axe's aria-roles rule,
 * Lighthouse) flag it on every page that draws it. HiddenText, the secret
 * behind "Click to reveal" on every API key, ingestion key, SCIM token and
 * the license key, carried two, role="hidden-text" and role="revealed-text",
 * only so that tests could find its parts. Tests find a part by what a
 * person sees (a button's words) or by a test id (data-testid).
 *
 * Read here, in every frontend's source and the shared components: a role
 * attribute's value (each of a conditional's answers, never what it is
 * compared with), a role set with setAttribute, and a role in an object of
 * attributes (one that holds an aria-* attribute or tabIndex beside it). An
 * abstract role (widget, landmark, section ...) is the specification's own
 * category and no role either. A role whose value the code works out
 * elsewhere (role={props.role}) is read where it is written.
 *
 * A role kept on purpose goes in DELIBERATE, with its reason. There is
 * none: an entry whose role is gone fails, so the list cannot outlive what
 * it excuses.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

/*
 * WAI-ARIA 1.2's roles (https://www.w3.org/TR/wai-aria-1.2/#role_definitions),
 * with 1.3's additions, the graphics module's and the digital publishing
 * module's (doc-*).
 */
const ARIA_ROLES: ReadonlySet<string> = new Set<string>([
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "comment",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "image",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "mark",
  "marquee",
  "math",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "meter",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "suggestion",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
  // The graphics module (SVG).
  "graphics-document",
  "graphics-object",
  "graphics-symbol",
]);

// The digital publishing module's roles, all of one family.
const DPUB_ROLE: RegExp = /^doc-[a-z]+$/;

/*
 * The specification's categories, which it says authors must not use: a
 * browser and a screen reader treat each as no role at all.
 */
const ABSTRACT_ROLES: ReadonlySet<string> = new Set<string>([
  "command",
  "composite",
  "input",
  "landmark",
  "range",
  "roletype",
  "section",
  "sectionhead",
  "select",
  "structure",
  "widget",
  "window",
]);

const isAriaRole: (role: string) => boolean = (role: string): boolean => {
  return ARIA_ROLES.has(role) || DPUB_ROLE.test(role);
};

/*
 * The roles of a value a role is set to: several, space apart, are a role
 * and its fallbacks (role="switch checkbox"), each of which must be one.
 * An empty value sets no role.
 */
const getRolesNotInAria: (value: string) => Array<string> = (
  value: string,
): Array<string> => {
  return value
    .split(/\s+/)
    .filter((role: string): boolean => {
      return role.length > 0;
    })
    .filter((role: string): boolean => {
      return !isAriaRole(role) || ABSTRACT_ROLES.has(role);
    });
};

interface RoleInSource {
  value: string;
  line: number;
  // How the source sets it.
  how: "attribute" | "setAttribute" | "attributes object";
}

/*
 * The strings an expression can be: a literal, each answer of a
 * conditional (never the values it compares), either side of || and ??,
 * and the right of &&. Anything else is worked out where it is written.
 */
function valueLiterals(node: ts.Node | undefined): Array<string> {
  if (!node) {
    return [];
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }

  if (
    ts.isJsxExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return valueLiterals(node.expression);
  }

  if (ts.isConditionalExpression(node)) {
    return [...valueLiterals(node.whenTrue), ...valueLiterals(node.whenFalse)];
  }

  if (ts.isBinaryExpression(node)) {
    const operator: ts.SyntaxKind = node.operatorToken.kind;

    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [...valueLiterals(node.left), ...valueLiterals(node.right)];
    }

    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return valueLiterals(node.right);
    }
  }

  return [];
}

function propertyName(name: ts.PropertyName): string {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }

  return "";
}

// An object of an element's attributes: it holds an aria-* one, or tabIndex.
function isAttributesObject(node: ts.ObjectLiteralExpression): boolean {
  return node.properties.some((property: ts.ObjectLiteralElement): boolean => {
    if (!ts.isPropertyAssignment(property)) {
      return false;
    }

    const name: string = propertyName(property.name);

    return name.startsWith("aria-") || name === "tabIndex";
  });
}

// Every role the source sets, with where.
const findRolesInSource: (
  fileName: string,
  text: string,
) => Array<RoleInSource> = (
  fileName: string,
  text: string,
): Array<RoleInSource> => {
  if (!text.includes("role")) {
    return [];
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<RoleInSource> = [];

  const record: (
    values: Array<string>,
    node: ts.Node,
    how: RoleInSource["how"],
  ) => void = (
    values: Array<string>,
    node: ts.Node,
    how: RoleInSource["how"],
  ): void => {
    const line: number =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;

    for (const value of values) {
      found.push({ value, line, how });
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sourceFile) === "role" &&
      node.initializer
    ) {
      record(valueLiterals(node.initializer), node, "attribute");
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setAttribute" &&
      node.arguments.length >= 2 &&
      valueLiterals(node.arguments[0]).includes("role")
    ) {
      record(valueLiterals(node.arguments[1]), node, "setAttribute");
    }

    if (ts.isObjectLiteralExpression(node) && isAttributesObject(node)) {
      for (const property of node.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          propertyName(property.name) === "role"
        ) {
          record(
            valueLiterals(property.initializer),
            property,
            "attributes object",
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
};

interface RoleNotInAria {
  file: string;
  line: number;
  value: string;
  how: RoleInSource["how"];
}

// The roles kept on purpose, by file, each with its reason. None today.
const DELIBERATE: Record<string, { values: Array<string>; reason: string }> =
  {};

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

let cachedScan: {
  files: Array<string>;
  roles: Array<RoleInSource & { file: string }>;
} | null = null;

// Every frontend's source and the shared components, read once.
function scanRepository(): {
  files: Array<string>;
  roles: Array<RoleInSource & { file: string }>;
} {
  if (cachedScan) {
    return cachedScan;
  }

  const files: Array<string> = listScanRoots(REPOSITORY_ROOT)
    .flatMap(listSourceFiles)
    .map(relative)
    .sort();
  const roles: Array<RoleInSource & { file: string }> = [];

  for (const file of files) {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, file),
      "utf8",
    );

    for (const role of findRolesInSource(file, text)) {
      roles.push({ ...role, file });
    }
  }

  cachedScan = { files, roles };

  return cachedScan;
}

function rolesNotInAria(
  roles: ReadonlyArray<RoleInSource & { file: string }>,
): Array<RoleNotInAria> {
  return roles.flatMap(
    (role: RoleInSource & { file: string }): Array<RoleNotInAria> => {
      const kept: Array<string> = DELIBERATE[role.file]?.values || [];

      return getRolesNotInAria(role.value)
        .filter((value: string): boolean => {
          return !kept.includes(value);
        })
        .map((value: string): RoleNotInAria => {
          return { file: role.file, line: role.line, value, how: role.how };
        });
    },
  );
}

describe("every role a frontend draws is one a screen reader knows (#7964)", () => {
  test("no frontend or shared component sets a role WAI-ARIA does not define", () => {
    expect(rolesNotInAria(scanRepository().roles)).toEqual([]);
  });

  test("the scan reads every frontend and the shared components (positive control)", () => {
    const { files, roles } = scanRepository();

    // Many: a scan that read nothing would pass.
    expect(files.length).toBeGreaterThan(3000);
    expect(roles.length).toBeGreaterThan(500);
    expect(
      files.some((file: string): boolean => {
        return file.startsWith("packages/App/FeatureSet/Dashboard/src/");
      }),
    ).toBe(true);
    expect(files).toContain(
      "packages/Common/UI/Components/HiddenText/HiddenText.tsx",
    );
    // A conditional's answers are read, and MoreMenu's setAttribute.
    expect(
      roles.some((role: RoleInSource & { file: string }): boolean => {
        return (
          role.how === "setAttribute" &&
          role.file === "packages/Common/UI/Components/MoreMenu/MoreMenu.tsx"
        );
      }),
    ).toBe(true);
  });

  test("HiddenText draws no role of its own but its copy's status line", () => {
    const file: string =
      "packages/Common/UI/Components/HiddenText/HiddenText.tsx";
    const values: Array<string> = findRolesInSource(
      file,
      fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
    ).map((role: RoleInSource): string => {
      return role.value;
    });

    expect(values).toEqual(["status"]);
  });

  test("every role kept on purpose is still drawn where it is listed", () => {
    const { roles } = scanRepository();

    for (const [file, entry] of Object.entries(DELIBERATE)) {
      expect(entry.reason.length).toBeGreaterThan(20);

      for (const value of entry.values) {
        expect({
          file,
          value,
          drawn: roles.some(
            (role: RoleInSource & { file: string }): boolean => {
              return (
                role.file === file && role.value.split(/\s+/).includes(value)
              );
            },
          ),
        }).toEqual({ file, value, drawn: true });
      }
    }
  });
});

describe("what the scan reads as a role", () => {
  const rolesOf: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    return findRolesInSource("Planted.tsx", text).map(
      (role: RoleInSource): string => {
        return role.value;
      },
    );
  };

  test("a made-up role is caught in each place a role is set (negative control)", () => {
    const planted: string = [
      'const A = () => <div role="hidden-text">x</div>;',
      'const B = (p: { on: boolean }) => <code role={p.on ? "revealed-text" : "status"} />;',
      'const C = (el: HTMLElement): void => { el.setAttribute("role", "refresh-button"); };',
      'const D = { role: "fancy-picker", "aria-label": "Pick" };',
      'const E = () => <div role={"widget"} />;',
      'const F = () => <button role="switch toggle-thing" />;',
    ].join("\n");

    expect(
      findRolesInSource("Planted.tsx", planted).flatMap(
        (role: RoleInSource): Array<string> => {
          return getRolesNotInAria(role.value);
        },
      ),
    ).toEqual([
      "hidden-text",
      "revealed-text",
      "refresh-button",
      "fancy-picker",
      "widget",
      "toggle-thing",
    ]);
  });

  test("a conditional's answers are its roles, never what it compares", () => {
    expect(
      rolesOf(
        'const A = (p: { v: string }) => <div role={p.v === "floating" ? "dialog" : "region"} />;',
      ),
    ).toEqual(["dialog", "region"]);
    expect(
      rolesOf(
        'const B = (p: { r?: string }) => <div role={p.r || "group"} />;',
      ),
    ).toEqual(["group"]);
    expect(
      rolesOf(
        'const C = (p: { on: boolean }) => <div role={p.on && "alert"} />;',
      ),
    ).toEqual(["alert"]);
  });

  test("a role worked out elsewhere is read where it is written, not here", () => {
    expect(
      rolesOf("const A = (p: { role: string }) => <div role={p.role} />;"),
    ).toEqual([]);
  });

  test("a role property is read only in an object of attributes", () => {
    // A person's role in a project, or a chat message's, is no ARIA role.
    expect(rolesOf('const member = { role: "owner", name: "Ada" };')).toEqual(
      [],
    );
    expect(
      rolesOf('const props = { role: "img", "aria-label": "Slack" };'),
    ).toEqual(["img"]);
    expect(rolesOf('const props = { role: "button", tabIndex: 0 };')).toEqual([
      "button",
    ]);
  });

  test("real roles pass, fallbacks too, and an empty role sets none", () => {
    expect(getRolesNotInAria("menuitemradio")).toEqual([]);
    expect(getRolesNotInAria("switch checkbox")).toEqual([]);
    expect(getRolesNotInAria("doc-footnote")).toEqual([]);
    expect(getRolesNotInAria("graphics-symbol")).toEqual([]);
    expect(getRolesNotInAria("")).toEqual([]);
    expect(getRolesNotInAria("landmark")).toEqual(["landmark"]);
  });
});
