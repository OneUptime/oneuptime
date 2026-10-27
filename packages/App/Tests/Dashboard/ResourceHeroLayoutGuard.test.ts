import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  RESOURCE_HERO_CONTROLS_CLASS_NAME,
  RESOURCE_HERO_CONTROLS_TEST_ID,
  RESOURCE_HERO_DESCRIPTION_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_TEST_ID,
  RESOURCE_HERO_DESCRIPTION_TOGGLE_CLASS_NAME,
  RESOURCE_HERO_DESCRIPTION_TOGGLE_TEST_ID,
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
 * cloud resources draw their hero through ResourceOverview: it has no <h1>
 * beside an AutoRefreshControl in one file (its page hands it the
 * controls), so rule 2 does not read it, and rule 6 holds it to the same
 * three class names.
 *
 * #5298's UI review added:
 *
 *   5. Every hero draws the resource's description one way: under its
 *      name, with ResourceHeroDescription - two lines that wrap between
 *      words, 20rem from md, and "Show more" for the rest. A Docker Swarm,
 *      a vCenter, a Proxmox cluster and an IoT fleet cut it to one line that
 *      never wrapped: half a sentence on a phone, and at 1280 the line
 *      claimed the identity's whole width and pushed Refresh under the
 *      name. ResourceOverview draws it the same way, in its title.
 *   6. ResourceOverview lays its hero's row out with the same three class
 *      names: its own row wrapped its controls to the left, and its 24rem
 *      title basis kept them beside a long name at a laptop's width and
 *      cut the name short there, where every other hero shows it whole.
 *   7. A hero with a health pill puts it after its connection pill, as the
 *      Kubernetes, Docker Swarm, vCenter and Proxmox heroes do: a Ceph
 *      cluster's and a storage array's put it first.
 *   8. A hero page's Details card does not repeat the hero's connection
 *      pill: a Docker or Podman host's, a Ceph cluster's and a storage
 *      array's had a "Collector Status" row reading the stored lowercase
 *      word ("connected").
 *   9. A hero's pills are in the reader's language: every connection pill
 *      takes its words from ResourceHeroStatus's
 *      getResourceConnectionLabel, every health pill a cluster's hero
 *      works out from getResourceHealthLabel ("Health Unknown" while the
 *      agent is not connected), and a Ceph cluster's health pill is looked
 *      up. Nine heroes wrote "Connected", "Disconnected", "Healthy" and
 *      "Unknown" in English on every page, German and Persian included.
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
  test("the description's class: words that wrap, 20rem from md, aligned as the page", () => {
    expect(RESOURCE_HERO_DESCRIPTION_CLASS_NAME.split(" ")).toEqual([
      "mt-1",
      "[text-align:left]",
      "text-sm",
      "text-gray-500",
      "[overflow-wrap:anywhere]",
      "md:min-w-[20rem]",
      "rtl:[text-align:right]",
    ]);
    expect(RESOURCE_HERO_DESCRIPTION_CLASS_NAME).not.toContain("truncate");
    expect(RESOURCE_HERO_DESCRIPTION_TEST_ID).toBe("resource-hero-description");
  });

  test("two lines until the reader asks for the rest, with Show more under them", () => {
    // Collapsed: two lines, never one cut line.
    expect(RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME).toBe("line-clamp-2");
    expect(RESOURCE_HERO_DESCRIPTION_TOGGLE_TEST_ID).toBe(
      "resource-hero-description-toggle",
    );
    // Its words start where the description's do, on either side of a page.
    const toggle: Array<string> =
      RESOURCE_HERO_DESCRIPTION_TOGGLE_CLASS_NAME.split(" ");
    expect(toggle).toEqual(
      expect.arrayContaining([
        "-ms-1.5",
        "px-1.5",
        "text-xs",
        "font-semibold",
        "text-indigo-700",
        "focus-visible:ring-2",
      ]),
    );
    expect(RESOURCE_HERO_DESCRIPTION_TOGGLE_CLASS_NAME).not.toContain("-ml-");
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

  test("the component draws the shared classes, its test ids, its own script's direction and a Show more that opens the rest", () => {
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
      'data-testid={RESOURCE_HERO_DESCRIPTION_TEST_ID} dir="auto" className={textClassName}',
    );
    // Two lines while collapsed, all of it once opened.
    expect(component).toContain(
      "const textClassName: string = isExpanded ? RESOURCE_HERO_DESCRIPTION_CLASS_NAME : `${RESOURCE_HERO_DESCRIPTION_CLASS_NAME} ${RESOURCE_HERO_DESCRIPTION_COLLAPSED_CLASS_NAME}`;",
    );
    // A real button, saying what it opens and whether it is open.
    expect(component).toContain(
      'type="button" data-testid={RESOURCE_HERO_DESCRIPTION_TOGGLE_TEST_ID}',
    );
    expect(component).toContain("aria-expanded={isExpanded}");
    expect(component).toContain("aria-controls={textId}");
    expect(component).toContain('translator.translateText("Show less")');
    expect(component).toContain('translator.translateText("Show more")');
    /*
     * The rest is never in a hover title only: a phone, a tablet and a
     * keyboard never show one.
     */
    expect(component).not.toContain("title={");
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
    /*
     * The resource attributes its telemetry reported, unless the page says
     * its rows come from somewhere else (a cloud account's, a listed cloud
     * resource's): never the hero's description.
     */
    expect(component).toContain(
      '<Card title="Details" description={ props.detailsDescription || RESOURCE_OVERVIEW_DETAILS_DESCRIPTION }',
    );
    expect(component).toContain(
      'export const RESOURCE_OVERVIEW_DETAILS_DESCRIPTION: string = "Metadata captured from OpenTelemetry resource attributes.";',
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Rule 6: ResourceOverview's wrapped controls keep to the row's end
 * ---------------------------------------------------------------------------
 */
describe("rule 6: ResourceOverview's hero row is every hero's", () => {
  const file: string = path.join(
    DASHBOARD_SRC,
    "Components",
    "TelemetryResource",
    "ResourceOverview.tsx",
  );
  const source: ts.SourceFile = parse(file);
  const component: string = fs.readFileSync(file, "utf8").replace(/\s+/g, " ");

  test("it imports the three class names from ResourceHeroLayout", () => {
    const imported: Array<string> = importsOf(source)
      .filter((entry: { from: string; names: Array<string> }): boolean => {
        return entry.from === "./ResourceHeroLayout";
      })
      .flatMap((entry: { from: string; names: Array<string> }) => {
        return entry.names;
      });
    for (const name of CLASS_CONSTANTS) {
      expect(imported).toContain(name);
    }
  });

  test("one top row: the title block with its <h1>, then the controls, each with its class name", () => {
    const rows: Array<JsxTag> = jsxTags(source).filter(
      (tag: JsxTag): boolean => {
        return (
          attributeIdentifier(tag, "className") ===
          "RESOURCE_HERO_TOP_ROW_CLASS_NAME"
        );
      },
    );
    expect(rows).toHaveLength(1);
    const row: JsxTag = rows[0]!;

    const identity: JsxTag | undefined = childElements(row)[0];
    expect(identity).toBeDefined();
    expect(attributeIdentifier(identity!, "className")).toBe(
      "RESOURCE_HERO_IDENTITY_CLASS_NAME",
    );
    expect(containsTag(identity!, "h1")).toBe(true);

    // The controls are the page's, drawn only when it hands some in.
    expect(component).toContain(
      '<div data-testid="resource-overview-controls" className={RESOURCE_HERO_CONTROLS_CLASS_NAME} >',
    );
  });

  test("none of its own row is left: no title basis, no left margin", () => {
    const classes: Array<string> = classNameLiterals(source)
      .join(" ")
      .split(" ");
    expect(classes).not.toContain("basis-96");
    expect(component).not.toContain("RESOURCE_OVERVIEW_TITLE_BASIS_CLASS");
    expect(component).not.toContain("ml-auto");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Rule 7: the connection pill, then the health pill
 * ---------------------------------------------------------------------------
 */
// Each hero with a health pill: how its source writes the two pills.
const HEALTH_HEROES: Array<[string, string, string]> = [
  ["Pages/Ceph/View/Index.tsx", "{statusLabel}", "renderHealthPill("],
  [
    "Pages/StorageArray/View/Index.tsx",
    "{statusLabel}",
    "<StorageArrayHealthPill",
  ],
  ["Pages/DockerSwarm/View/Index.tsx", "{connectionLabel}", "{healthLabel}"],
  ["Pages/Kubernetes/View/Index.tsx", "{connectionLabel}", "{healthLabel}"],
  ["Pages/Proxmox/View/Index.tsx", "{connectionLabel}", "{healthLabel}"],
  ["Pages/VMware/View/Index.tsx", "{connectionLabel}", "{healthLabel}"],
];

// What a health pill is written with, in any hero.
const HEALTH_MARKERS: Array<string> = ["healthLabel", "HealthPill"];

describe("rule 7: a hero's connection pill comes before its health pill", () => {
  test.each(HEALTH_HEROES)(
    "%s: whether OneUptime hears from it, then what it says",
    (file: string, connection: string, health: string) => {
      const hero: Hero | undefined = HEROES.find((candidate: Hero): boolean => {
        return relative(candidate.file) === file;
      });
      expect(hero).toBeDefined();
      const identity: string = identityOf(hero!).getText();

      const connectionAt: number = identity.indexOf(connection);
      const healthAt: number = identity.indexOf(health);
      expect(connectionAt).toBeGreaterThan(-1);
      expect(healthAt).toBeGreaterThan(-1);
      expect(connectionAt).toBeLessThan(healthAt);
    },
  );

  test("every hero that draws a health pill is one of them", () => {
    const listed: Array<string> = HEALTH_HEROES.map(
      (entry: [string, string, string]): string => {
        return entry[0];
      },
    );
    const withHealth: Array<string> = HEROES.filter((hero: Hero): boolean => {
      const identity: string = identityOf(hero).getText();
      return HEALTH_MARKERS.some((marker: string): boolean => {
        return identity.includes(marker);
      });
    }).map((hero: Hero): string => {
      return relative(hero.file);
    });

    expect(withHealth.sort()).toEqual([...listed].sort());
  });
});

/*
 * ---------------------------------------------------------------------------
 * Rule 8: no Details card repeats the hero's connection pill, raw
 * ---------------------------------------------------------------------------
 */
// The pages whose Details card had the row (#5298's UI review).
const COLLECTOR_STATUS_PAGES: Array<string> = [
  "Pages/Ceph/View/Index.tsx",
  "Pages/Docker/View/Overview.tsx",
  "Pages/Podman/View/Overview.tsx",
  "Pages/StorageArray/View/Index.tsx",
];

describe("rule 8: a hero page's Details card does not repeat its connection pill", () => {
  test.each(
    HEROES.map((hero: Hero): [string, Hero] => {
      return [relative(hero.file), hero];
    }),
  )(
    "%s has no Collector Status row (the stored lowercase word the pill says in words)",
    (_name: string, hero: Hero) => {
      expect(hero.source.getFullText()).not.toContain(
        'title: "Collector Status"',
      );
    },
  );

  test("the pages that had one are still read", () => {
    const found: Array<string> = HEROES.map((hero: Hero): string => {
      return relative(hero.file);
    });
    for (const page of COLLECTOR_STATUS_PAGES) {
      expect(found).toContain(page);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Rule 9: a hero's pills, in the reader's language
 * ---------------------------------------------------------------------------
 */
const STATUS_MODULE_SUFFIX: string = "TelemetryResource/ResourceHeroStatus";

// The variable a hero's pill is drawn from, and where its words must come from.
const PILL_LABELS: Record<string, string> = {
  statusLabel: "getResourceConnectionLabel",
  connectionLabel: "getResourceConnectionLabel",
  healthLabel: "getResourceHealthLabel",
};

// The heroes that draw a connection pill (#5298's UI review moved them all).
const CONNECTION_PILL_HEROES: Array<string> = [
  "Pages/Ceph/View/Index.tsx",
  "Pages/Docker/View/Overview.tsx",
  "Pages/DockerSwarm/View/Index.tsx",
  "Pages/Host/View/Overview.tsx",
  "Pages/IoT/View/Index.tsx",
  "Pages/Kubernetes/View/Index.tsx",
  "Pages/Podman/View/Overview.tsx",
  "Pages/Proxmox/View/Index.tsx",
  "Pages/StorageArray/View/Index.tsx",
  "Pages/VMware/View/Index.tsx",
];

// The pill variables a hero's identity draws as `{name}`.
function pillVariablesDrawn(hero: Hero): Array<string> {
  const drawn: Array<string> = [];
  visit(identityOf(hero), (node: ts.Node): void => {
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isIdentifier(node.expression) &&
      PILL_LABELS[node.expression.text] &&
      !drawn.includes(node.expression.text)
    ) {
      drawn.push(node.expression.text);
    }
  });
  return drawn;
}

// What each declaration of `name` in the hero's file is initialized with.
function initializersOf(hero: Hero, name: string): Array<ts.Expression> {
  const found: Array<ts.Expression> = [];
  visit(hero.source, (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found.push(node.initializer);
    }
  });
  return found;
}

function calledFunction(expression: ts.Expression): string | undefined {
  return ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression)
    ? expression.expression.text
    : undefined;
}

/*
 * The variable a value is the initializer of, through the conditions,
 * brackets and casts it sits in (`isConnected ? "Connected" : ...`).
 */
function declarationHolding(node: ts.Node): ts.VariableDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (
    current &&
    (ts.isConditionalExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isBinaryExpression(current))
  ) {
    current = current.parent;
  }
  return current && ts.isVariableDeclaration(current) ? current : undefined;
}

// A pill word a hero puts in its pill as it is: English on every page.
function untranslatedPillWords(hero: Hero): Array<string> {
  const words: Array<string> = [];
  const pillWords: Array<string> = [
    "Connected",
    "Disconnected",
    "Healthy",
    "Degraded",
    "Unhealthy",
    "Unknown",
  ];
  visit(hero.source, (node: ts.Node): void => {
    if (!ts.isStringLiteral(node) || !pillWords.includes(node.text)) {
      return;
    }
    const declaration: ts.VariableDeclaration | undefined =
      declarationHolding(node);
    if (
      declaration &&
      ts.isIdentifier(declaration.name) &&
      PILL_LABELS[declaration.name.text]
    ) {
      words.push(`${declaration.name.text}: "${node.text}"`);
    }
  });
  return words;
}

describe("rule 9: a hero's pills are in the reader's language", () => {
  test.each(CONNECTION_PILL_HEROES)(
    "%s draws its connection pill",
    (file: string) => {
      const hero: Hero | undefined = HEROES.find((candidate: Hero): boolean => {
        return relative(candidate.file) === file;
      });
      expect(hero).toBeDefined();
      const drawn: Array<string> = pillVariablesDrawn(hero!);
      expect(
        drawn.filter((name: string): boolean => {
          return PILL_LABELS[name] === "getResourceConnectionLabel";
        }),
      ).toHaveLength(1);
    },
  );

  test.each(
    HEROES.map((hero: Hero): [string, Hero] => {
      return [relative(hero.file), hero];
    }),
  )(
    "%s: each pill it draws takes its words from ResourceHeroStatus",
    (_name: string, hero: Hero) => {
      const drawn: Array<string> = pillVariablesDrawn(hero);
      if (drawn.length === 0) {
        return;
      }

      const imported: Array<string> = importsOf(hero.source)
        .filter((entry: { from: string; names: Array<string> }): boolean => {
          return entry.from.endsWith(STATUS_MODULE_SUFFIX);
        })
        .flatMap((entry: { from: string; names: Array<string> }) => {
          return entry.names;
        });

      for (const name of drawn) {
        const helper: string = PILL_LABELS[name]!;
        expect(imported).toContain(helper);

        const initializers: Array<ts.Expression> = initializersOf(hero, name);
        expect(initializers.length).toBeGreaterThan(0);
        for (const initializer of initializers) {
          expect({ name: name, calls: calledFunction(initializer) }).toEqual({
            name: name,
            calls: helper,
          });
        }
      }
    },
  );

  test.each(
    HEROES.map((hero: Hero): [string, Hero] => {
      return [relative(hero.file), hero];
    }),
  )(
    "%s writes no pill word in English for every reader",
    (_name: string, hero: Hero) => {
      expect(untranslatedPillWords(hero)).toEqual([]);
    },
  );

  test("every hero with a connection pill is listed, and only those", () => {
    const withPill: Array<string> = HEROES.filter((hero: Hero): boolean => {
      return pillVariablesDrawn(hero).some((name: string): boolean => {
        return PILL_LABELS[name] === "getResourceConnectionLabel";
      });
    }).map((hero: Hero): string => {
      return relative(hero.file);
    });

    expect(withPill.sort()).toEqual([...CONNECTION_PILL_HEROES].sort());
  });

  test("the four heroes that work out a health draw it from getResourceHealthLabel", () => {
    const withHealth: Array<string> = HEROES.filter((hero: Hero): boolean => {
      return pillVariablesDrawn(hero).includes("healthLabel");
    }).map((hero: Hero): string => {
      return relative(hero.file);
    });

    expect(withHealth.sort()).toEqual(
      [
        "Pages/DockerSwarm/View/Index.tsx",
        "Pages/Kubernetes/View/Index.tsx",
        "Pages/Proxmox/View/Index.tsx",
        "Pages/VMware/View/Index.tsx",
      ].sort(),
    );
  });

  test("a Ceph cluster's health pill looks its words up", () => {
    const hero: Hero | undefined = HEROES.find((candidate: Hero): boolean => {
      return relative(candidate.file) === "Pages/Ceph/View/Index.tsx";
    });
    expect(hero).toBeDefined();
    const text: string = hero!.source.getFullText();
    const pill: string = text.slice(
      text.indexOf("const renderHealthPill"),
      text.indexOf("const renderHealthPill") + 2000,
    );

    expect(pill).toContain("{translator.translateText(pill.label)}");
    expect(pill).not.toContain("{pill.label}");
    for (const word of [
      "Health OK",
      "Health Warning",
      "Health Error",
      "Health Unknown",
    ]) {
      expect(pill).toContain(`label: translationKey("${word}")`);
    }
  });
});

describe("the guard reads what it means to", () => {
  test("it sees every hero this change moved, and only pages", () => {
    expect(HEROES.length).toBeGreaterThanOrEqual(KNOWN_HEROES.length);
    for (const hero of HEROES) {
      expect(relative(hero.file).startsWith("Pages/")).toBe(true);
    }
  });

  test("ResourceOverview is not one of the pages rule 2 reads (its page hands it the controls); rule 6 holds it", () => {
    expect(
      HEROES.map((hero: Hero): string => {
        return relative(hero.file);
      }),
    ).not.toContain("Components/TelemetryResource/ResourceOverview.tsx");
  });
});
