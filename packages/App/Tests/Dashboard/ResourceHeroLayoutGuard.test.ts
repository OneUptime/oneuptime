import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  RESOURCE_HERO_CONTROLS_CLASS_NAME,
  RESOURCE_HERO_CONTROLS_TEST_ID,
  RESOURCE_HERO_DESCRIPTION_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_TEST_ID,
  RESOURCE_HERO_IDENTITY_CLASS_NAME,
  RESOURCE_HERO_IDENTITY_TEST_ID,
  RESOURCE_HERO_TOP_ROW_CLASS_NAME,
  RESOURCE_HERO_TOP_ROW_TEST_ID,
} from "../../FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceHeroLayout";

/*
 * EVERY RESOURCE HERO LAYS ITS TOP ROW OUT ONE WAY (ResourceHeroLayout).
 *
 * A resource's Overview opens with a hero: its icon, its name and badges,
 * when it was last seen, and the page's controls - the refresh control and,
 * on most pages, the time range picker. Eleven heroes put those controls
 * beside the name from the md breakpoint and kept their whole width, and
 * every hero sits beside the resource's side menu: at a 768px window a
 * host's name vanished under its time picker and its Auto-refresh select ran
 * 35px past the window, and at 1024 the name read "a.." (#5268's
 * follow-up). The Kubernetes cluster's hero had been fixed for this (#4105)
 * and a Docker Swarm's for phones (#5076's follow-up), each its own way.
 * Now every hero takes the Kubernetes layout from one module, and this guard
 * holds every one of them to it:
 *
 *   1. ResourceHeroLayout's classes are the Kubernetes hero's, measured in a
 *      browser by E2E/ChartTimeZoom (KubernetesOverviewHeader and
 *      HostOverviewHeader) and E2E/DockerSwarmPages; the identity never
 *      carries min-w-0 (what let the controls squeeze the name to nothing),
 *      and no container query: a container is a containing block for the
 *      fixed dialogs a hero opens (the agent version's upgrade dialog).
 *   2. Every Dashboard page that draws a hero - an <h1> beside the shared
 *      AutoRefreshControl - lays its top row out with the three class names:
 *      the row holds the identity (with the <h1>) and then the controls
 *      (with the refresh control), each with its test id.
 *   3. No Dashboard file that draws the refresh control keeps the old
 *      window-keyed hero row, its squeezable name or its unshrinkable
 *      controls.
 *   4. Every hero this change moved onto the layout is still found, so a
 *      page that is renamed or moved does not slip out of the guard.
 *
 * Services, RUM applications, databases, queues, serverless functions and
 * cloud resources draw their hero through ResourceOverview, which wraps its
 * own row (a title basis, the controls under it when they do not fit;
 * Common's DatabaseOverviewHeader suite): it has no <h1> beside an
 * AutoRefreshControl in one file, so rule 2 does not read it.
 *
 * #5298's UI review added:
 *
 *   5. Every hero draws the resource's description one way: under its
 *      name, with ResourceHeroDescription - two lines that wrap between
 *      words, 20rem from md. A Docker Swarm, a vCenter, a Proxmox cluster
 *      and an IoT fleet cut it to one line that never wrapped: half a
 *      sentence on a phone, and at 1280 the line claimed the identity's
 *      whole width and pushed Refresh under the name. ResourceOverview
 *      draws it the same way, in its title.
 *   6. ResourceOverview's controls keep to the row's end when they wrap
 *      from md, as the heroes' do: they wrapped to the left.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LAYOUT_MODULE: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "TelemetryResource",
  "ResourceHeroLayout.ts",
);

const SKIPPED_DIRECTORIES: Array<string> = ["node_modules", "Locales"];

// The heroes moved onto the shared layout (rule 4).
const KNOWN_HEROES: Array<string> = [
  "Pages/Ceph/View/Index.tsx",
  "Pages/Docker/View/Overview.tsx",
  "Pages/DockerSwarm/View/Index.tsx",
  "Pages/Host/View/Overview.tsx",
  "Pages/Host/View/ProcessView.tsx",
  "Pages/Host/View/ServiceView.tsx",
  "Pages/Host/View/SystemdUnitView.tsx",
  "Pages/IoT/View/Index.tsx",
  "Pages/Kubernetes/View/Index.tsx",
  "Pages/Podman/View/Overview.tsx",
  "Pages/Proxmox/View/Index.tsx",
  "Pages/StorageArray/View/Index.tsx",
  "Pages/VMware/View/Index.tsx",
];

// The hero row every page used before: controls beside the name from md.
const OLD_HERO_ROW: string =
  "flex flex-col gap-4 md:flex-row md:items-start md:justify-between";
// Its controls, which never gave up any of their width.
const OLD_HERO_CONTROLS: string = "flex-shrink-0 md:self-start";
// Its identity, which let the controls squeeze the name to nothing.
const OLD_HERO_IDENTITY: string = "flex items-start gap-4 min-w-0";

const AUTO_REFRESH_MODULE_SUFFIX: string =
  "TelemetryResource/AutoRefreshControl";
const LAYOUT_MODULE_SUFFIX: string = "TelemetryResource/ResourceHeroLayout";

const CLASS_CONSTANTS: Array<string> = [
  "RESOURCE_HERO_TOP_ROW_CLASS_NAME",
  "RESOURCE_HERO_IDENTITY_CLASS_NAME",
  "RESOURCE_HERO_CONTROLS_CLASS_NAME",
];

function walk(directory: string): Array<string> {
  const files: Array<string> = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...walk(path.join(directory, entry.name)));
      }
      continue;
    }
    if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node): void => {
    visit(child, onNode);
  });
}

// The module specifiers a file imports from, with the names it imports.
function importsOf(source: ts.SourceFile): Array<{
  from: string;
  names: Array<string>;
}> {
  const found: Array<{ from: string; names: Array<string> }> = [];
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const names: Array<string> = [];
    const clause: ts.ImportClause | undefined = statement.importClause;
    if (clause?.name) {
      names.push(clause.name.text);
    }
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        names.push(element.name.text);
      }
    }
    found.push({ from: statement.moduleSpecifier.text, names });
  }
  return found;
}

type JsxTag = ts.JsxElement | ts.JsxSelfClosingElement;

function tagName(element: JsxTag): string {
  return (
    ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName
  ).getText();
}

function attributesOf(element: JsxTag): ts.JsxAttributes {
  return ts.isJsxElement(element)
    ? element.openingElement.attributes
    : element.attributes;
}

// The identifier a JSX attribute is set to (`name={IDENTIFIER}`), if any.
function attributeIdentifier(
  element: JsxTag,
  attributeName: string,
): string | undefined {
  for (const property of attributesOf(element).properties) {
    if (
      ts.isJsxAttribute(property) &&
      property.name.getText() === attributeName &&
      property.initializer &&
      ts.isJsxExpression(property.initializer) &&
      property.initializer.expression &&
      ts.isIdentifier(property.initializer.expression)
    ) {
      return property.initializer.expression.text;
    }
  }
  return undefined;
}

// Every string literal written as a className, in JSX or in a template.
function classNameLiterals(source: ts.SourceFile): Array<string> {
  const literals: Array<string> = [];
  visit(source, (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText() === "className" &&
      node.initializer
    ) {
      visit(node.initializer, (inner: ts.Node): void => {
        if (
          ts.isStringLiteral(inner) ||
          ts.isNoSubstitutionTemplateLiteral(inner)
        ) {
          literals.push(inner.text);
        }
        if (ts.isTemplateExpression(inner)) {
          literals.push(inner.head.text);
          for (const span of inner.templateSpans) {
            literals.push(span.literal.text);
          }
        }
      });
    }
  });
  return literals;
}

function jsxTags(source: ts.SourceFile): Array<JsxTag> {
  const tags: Array<JsxTag> = [];
  visit(source, (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      tags.push(node);
    }
  });
  return tags;
}

// The JSX elements directly inside an element, in order.
function childElements(element: JsxTag): Array<JsxTag> {
  if (!ts.isJsxElement(element)) {
    return [];
  }
  return element.children.filter(
    (child: ts.JsxChild): child is ts.JsxElement | ts.JsxSelfClosingElement => {
      return ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child);
    },
  );
}

function containsTag(element: JsxTag, name: string): boolean {
  let found: boolean = false;
  visit(element, (node: ts.Node): void => {
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagName(node) === name
    ) {
      found = true;
    }
  });
  return found;
}

// The refresh control, drawn in place or by the page's renderRefreshControl().
function containsRefreshControl(element: JsxTag): boolean {
  if (containsTag(element, "AutoRefreshControl")) {
    return true;
  }
  let found: boolean = false;
  visit(element, (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "renderRefreshControl"
    ) {
      found = true;
    }
  });
  return found;
}

const FILES: Array<string> = walk(DASHBOARD_SRC);

interface Hero {
  file: string;
  source: ts.SourceFile;
}

// A page that draws an <h1> beside the shared refresh control: a hero.
const HEROES: Array<Hero> = FILES.filter((file: string): boolean => {
  return file.endsWith(".tsx");
})
  .map((file: string): Hero => {
    return { file, source: parse(file) };
  })
  .filter((hero: Hero): boolean => {
    const importsRefresh: boolean = importsOf(hero.source).some(
      (entry: { from: string; names: Array<string> }): boolean => {
        return entry.from.endsWith(AUTO_REFRESH_MODULE_SUFFIX);
      },
    );
    return (
      importsRefresh &&
      jsxTags(hero.source).some((tag: JsxTag): boolean => {
        return tagName(tag) === "h1";
      })
    );
  });

describe("ResourceHeroLayout", () => {
  test("is the Kubernetes hero's layout: a column on a phone, one wrapping row from md", () => {
    expect(RESOURCE_HERO_TOP_ROW_CLASS_NAME).toBe(
      "flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between",
    );
  });

  test("the identity keeps its own width, capped at the row: no min-w-0", () => {
    expect(RESOURCE_HERO_IDENTITY_CLASS_NAME).toBe(
      "flex items-start gap-4 md:w-full md:flex-1",
    );
    expect(RESOURCE_HERO_IDENTITY_CLASS_NAME.split(" ")).not.toContain(
      "min-w-0",
    );
  });

  test("the controls take the rest of the row, under the name below 24rem, kept on the right", () => {
    expect(RESOURCE_HERO_CONTROLS_CLASS_NAME.split(" ")).toEqual([
      /*
       * The inline start's margin: the row's end on a right-to-left page as
       * on a left-to-right one. ml-auto pushed a Persian hero's wrapped
       * controls to the name's side (#5298's UI review).
       */
      "md:ms-auto",
      "md:min-w-[min(100%,24rem)]",
      "md:max-w-max",
      "md:flex-[1000_1_0%]",
      "md:self-start",
      "md:[&>div]:justify-end",
    ]);
    // Never the old unshrinkable controls.
    expect(RESOURCE_HERO_CONTROLS_CLASS_NAME).not.toContain("flex-shrink-0");
    expect(RESOURCE_HERO_CONTROLS_CLASS_NAME).not.toContain("ml-auto");
  });

  test("no container query: a container would hold the fixed dialogs a hero opens", () => {
    const module: string = fs.readFileSync(LAYOUT_MODULE, "utf8");
    for (const className of [
      RESOURCE_HERO_TOP_ROW_CLASS_NAME,
      RESOURCE_HERO_IDENTITY_CLASS_NAME,
      RESOURCE_HERO_CONTROLS_CLASS_NAME,
    ]) {
      expect(className).not.toContain("container");
      expect(className).not.toContain("@");
    }
    expect(module).not.toContain('"[container-type');
  });

  test("its test ids", () => {
    expect([
      RESOURCE_HERO_TOP_ROW_TEST_ID,
      RESOURCE_HERO_IDENTITY_TEST_ID,
      RESOURCE_HERO_CONTROLS_TEST_ID,
    ]).toEqual([
      "resource-hero-top-row",
      "resource-hero-identity",
      "resource-hero-controls",
    ]);
  });
});

describe("every resource hero", () => {
  test("is found where this change left it (a moved page must stay in the guard)", () => {
    const found: Array<string> = HEROES.map((hero: Hero): string => {
      return relative(hero.file);
    });
    for (const known of KNOWN_HEROES) {
      expect(found).toContain(known);
    }
  });

  test.each(
    HEROES.map((hero: Hero): [string, Hero] => {
      return [relative(hero.file), hero];
    }),
  )(
    "%s imports the three class names from ResourceHeroLayout",
    (_name: string, hero: Hero) => {
      const imported: Array<string> = importsOf(hero.source)
        .filter((entry: { from: string; names: Array<string> }): boolean => {
          return entry.from.endsWith(LAYOUT_MODULE_SUFFIX);
        })
        .flatMap((entry: { from: string; names: Array<string> }) => {
          return entry.names;
        });
      for (const name of CLASS_CONSTANTS) {
        expect(imported).toContain(name);
      }
    },
  );

  test.each(
    HEROES.map((hero: Hero): [string, Hero] => {
      return [relative(hero.file), hero];
    }),
  )(
    "%s: one top row, holding the identity with its <h1>, then the controls with the refresh control",
    (_name: string, hero: Hero) => {
      const rows: Array<JsxTag> = jsxTags(hero.source).filter(
        (tag: JsxTag): boolean => {
          return (
            attributeIdentifier(tag, "className") ===
            "RESOURCE_HERO_TOP_ROW_CLASS_NAME"
          );
        },
      );
      expect(rows).toHaveLength(1);
      const row: JsxTag = rows[0]!;
      expect(attributeIdentifier(row, "data-testid")).toBe(
        "RESOURCE_HERO_TOP_ROW_TEST_ID",
      );

      const parts: Array<JsxTag> = childElements(row);
      expect(parts).toHaveLength(2);
      const [identity, controls] = parts as [JsxTag, JsxTag];

      expect(attributeIdentifier(identity, "className")).toBe(
        "RESOURCE_HERO_IDENTITY_CLASS_NAME",
      );
      expect(attributeIdentifier(identity, "data-testid")).toBe(
        "RESOURCE_HERO_IDENTITY_TEST_ID",
      );
      expect(containsTag(identity, "h1")).toBe(true);
      expect(containsRefreshControl(identity)).toBe(false);

      expect(attributeIdentifier(controls, "className")).toBe(
        "RESOURCE_HERO_CONTROLS_CLASS_NAME",
      );
      expect(attributeIdentifier(controls, "data-testid")).toBe(
        "RESOURCE_HERO_CONTROLS_TEST_ID",
      );
      expect(containsRefreshControl(controls)).toBe(true);
      expect(containsTag(controls, "h1")).toBe(false);
    },
  );
});

describe("no file that draws the refresh control keeps the old hero row", () => {
  /*
   * Only where the refresh control is drawn: a component with nothing to do
   * with a hero may still write any of these class lists.
   */
  const offenders: Array<string> = [];
  let filesRead: number = 0;
  for (const file of FILES) {
    if (!file.endsWith(".tsx")) {
      continue;
    }
    const source: ts.SourceFile = parse(file);
    const drawsRefresh: boolean = importsOf(source).some(
      (entry: { from: string; names: Array<string> }): boolean => {
        return entry.from.endsWith(AUTO_REFRESH_MODULE_SUFFIX);
      },
    );
    if (!drawsRefresh) {
      continue;
    }
    filesRead++;
    for (const literal of classNameLiterals(source)) {
      const trimmed: string = literal.trim();
      if (
        trimmed === OLD_HERO_ROW ||
        trimmed === OLD_HERO_CONTROLS ||
        trimmed === OLD_HERO_IDENTITY
      ) {
        offenders.push(`${relative(file)}: "${trimmed}"`);
      }
    }
  }

  test("neither its window-keyed row, its squeezable name nor its unshrinkable controls", () => {
    // Every hero, and the pages and components that draw the control alone.
    expect(filesRead).toBeGreaterThan(KNOWN_HEROES.length);
    expect(offenders).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Rule 5: the description, one way in every hero
 * ---------------------------------------------------------------------------
 */
const DESCRIPTION_COMPONENT: string = "ResourceHeroDescription";

// The heroes that show their resource's description.
const DESCRIBED_HEROES: Array<string> = [
  "Pages/DockerSwarm/View/Index.tsx",
  "Pages/IoT/View/Index.tsx",
  "Pages/Proxmox/View/Index.tsx",
  "Pages/VMware/View/Index.tsx",
];

// The line those four drew before: one line, cut short.
const OLD_DESCRIPTION_LINE: string = "mt-1 truncate text-sm text-gray-500";

// The identity element of a hero's top row.
function identityOf(hero: Hero): JsxTag {
  const row: JsxTag | undefined = jsxTags(hero.source).find(
    (tag: JsxTag): boolean => {
      return (
        attributeIdentifier(tag, "className") ===
        "RESOURCE_HERO_TOP_ROW_CLASS_NAME"
      );
    },
  );
  const identity: JsxTag | undefined = row ? childElements(row)[0] : undefined;
  if (!identity) {
    throw new Error(`${relative(hero.file)} has no hero identity`);
  }
  return identity;
}

/*
 * Every `<something>.description` read inside an element that is not the
 * `text` of a ResourceHeroDescription: a description drawn some other way.
 */
function descriptionsDrawnOtherwise(element: JsxTag): Array<string> {
  const found: Array<string> = [];
  visit(element, (node: ts.Node): void => {
    if (
      !ts.isPropertyAccessExpression(node) ||
      node.name.text !== "description"
    ) {
      return;
    }
    let ancestor: ts.Node | undefined = node.parent;
    let isComponentText: boolean = false;
    while (ancestor && ancestor !== element) {
      if (
        ts.isJsxAttribute(ancestor) &&
        ancestor.name.getText() === "text" &&
        ts.isJsxSelfClosingElement(ancestor.parent.parent) &&
        tagName(ancestor.parent.parent) === DESCRIPTION_COMPONENT
      ) {
        isComponentText = true;
        break;
      }
      ancestor = ancestor.parent;
    }
    if (!isComponentText) {
      found.push(node.getText());
    }
  });
  return found;
}

describe("rule 5: every hero draws its description one way", () => {
  test("the description's class: two lines that wrap, 20rem from md, aligned as the page", () => {
    expect(RESOURCE_HERO_DESCRIPTION_CLASS_NAME.split(" ")).toEqual([
      "mt-1",
      "line-clamp-2",
      "text-left",
      "text-sm",
      "text-gray-500",
      "[overflow-wrap:anywhere]",
      "md:min-w-[20rem]",
      "rtl:text-right",
    ]);
    expect(RESOURCE_HERO_DESCRIPTION_CLASS_NAME).not.toContain("truncate");
    expect(RESOURCE_HERO_DESCRIPTION_TEST_ID).toBe("resource-hero-description");
  });

  test.each(
    HEROES.map((hero: Hero): [string, Hero] => {
      return [relative(hero.file), hero];
    }),
  )(
    "%s draws a description only with ResourceHeroDescription",
    (_name: string, hero: Hero) => {
      expect(descriptionsDrawnOtherwise(identityOf(hero))).toEqual([]);
      expect(classNameLiterals(hero.source)).not.toContain(
        OLD_DESCRIPTION_LINE,
      );
    },
  );

  test.each(DESCRIBED_HEROES)(
    "%s shows its description under its name",
    (file: string) => {
      const hero: Hero | undefined = HEROES.find((candidate: Hero): boolean => {
        return relative(candidate.file) === file;
      });
      expect(hero).toBeDefined();
      expect(containsTag(identityOf(hero!), DESCRIPTION_COMPONENT)).toBe(true);
    },
  );

  test("the component draws the shared class, its test id, its own script's direction and a hover title", () => {
    const component: string = fs
      .readFileSync(
        path.join(
          DASHBOARD_SRC,
          "Components",
          "TelemetryResource",
          "ResourceHeroDescription.tsx",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(component).toContain(
      '<p data-testid={RESOURCE_HERO_DESCRIPTION_TEST_ID} dir="auto" title={text} className={RESOURCE_HERO_DESCRIPTION_CLASS_NAME} >',
    );
  });

  test("ResourceOverview draws it in its title, never as the Details card's line", () => {
    const component: string = fs
      .readFileSync(
        path.join(
          DASHBOARD_SRC,
          "Components",
          "TelemetryResource",
          "ResourceOverview.tsx",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(component).toContain(
      "<ResourceHeroDescription text={props.description} />",
    );
    // The Details card's own line says what its rows are, at every width.
    expect(component).not.toContain("description={ props.description ||");
    expect(component).toContain(
      '<Card title="Details" description="Metadata captured from OpenTelemetry resource attributes."',
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Rule 6: ResourceOverview's wrapped controls keep to the row's end
 * ---------------------------------------------------------------------------
 */
describe("rule 6: ResourceOverview's controls keep to the row's end", () => {
  const component: string = fs
    .readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "TelemetryResource",
        "ResourceOverview.tsx",
      ),
      "utf8",
    )
    .replace(/\s+/g, " ");

  test("from md, by the inline start's margin, their own row too", () => {
    expect(component).toContain(
      'export const RESOURCE_OVERVIEW_CONTROLS_CLASS_NAME: string = "max-w-full md:ms-auto md:[&>div]:justify-end";',
    );
    expect(component).toContain(
      '<div data-testid="resource-overview-controls" className={RESOURCE_OVERVIEW_CONTROLS_CLASS_NAME} >',
    );
    expect(component).not.toContain("ml-auto");
  });
});

describe("the guard reads what it means to", () => {
  test("it sees every hero this change moved, and only pages", () => {
    expect(HEROES.length).toBeGreaterThanOrEqual(KNOWN_HEROES.length);
    for (const hero of HEROES) {
      expect(relative(hero.file).startsWith("Pages/")).toBe(true);
    }
  });

  test("ResourceOverview's hero is not one of them: its row is its own", () => {
    expect(
      HEROES.map((hero: Hero): string => {
        return relative(hero.file);
      }),
    ).not.toContain("Components/TelemetryResource/ResourceOverview.tsx");
  });
});
