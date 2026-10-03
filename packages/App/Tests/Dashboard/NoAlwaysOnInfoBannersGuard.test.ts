import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Banners are for exceptions the user must act on, never for the default
 * state.
 *
 * Four pages opened on a blue info banner that said, on every visit, what was
 * already true:
 *
 *   - RUM > Settings > Session Replay: "Looking for the installation test,
 *     recording health or targeted capture?", which the roster card below it
 *     already answers;
 *   - every RUM application's Replay Policy: "Recording must also be allowed
 *     for the project", although the project's switch is on unless someone
 *     turned it off - and when it is off, the health card right below says
 *     "Session replay is switched off for this project" with a "Turn it on"
 *     action;
 *   - Inventory > Archived: "These are hidden, not gone", which every other
 *     Archived page says in its card's description;
 *   - a database's Settings: "Which telemetry this covers.", now said in the
 *     retention card's own description.
 *
 * Each is gone, and this keeps it so for every page of every app (Dashboard,
 * Admin Dashboard, Status Page, Accounts, Public Dashboard). It reads each
 * page's TypeScript and fails on an info banner the page renders no matter
 * what:
 *
 *   - an <Alert> (Common/UI/Components/Alerts/Alert) whose type is
 *     AlertType.INFO, or left out - INFO is the component's default;
 *   - an <AlertBanner> (Common/UI/Components/AlertBanner/AlertBanner) of
 *     type AlertBannerType.Info.
 *
 * A banner is fine when the page shows it under a condition: `cond && …`,
 * `cond ? … : …`, `??` or `||`, a branch of an `if` or a `switch`, a loop or
 * a catch. An early `return` for loading or an error does not count: what
 * the page's main render shows is its default state. A banner inside a
 * function the page hands to something else (a `.map` callback, a table
 * cell's getElement, a plugin's renderUpsell) or a lower-case helper is left
 * alone, because when that runs is decided where it is called.
 *
 * Whatever a page wants to say every time belongs in a card's description
 * (or a field's), where the reader looks when deciding. A banner that has to
 * stay goes under the condition it is about.
 */

const FEATURE_SET_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
);

const APPS: Array<string> = [
  "Dashboard",
  "AdminDashboard",
  "StatusPage",
  "Accounts",
  "PublicDashboard",
];

const ALERT_MODULE_SUFFIX: string = "/Components/Alerts/Alert";
const ALERT_BANNER_MODULE_SUFFIX: string =
  "/Components/AlertBanner/AlertBanner";

// Cheap first pass: only files that import one of the two are parsed.
const MENTIONS_A_BANNER: RegExp = /Alerts\/Alert"|AlertBanner\/AlertBanner"/;

const INFO_ALERT_TYPE: RegExp = /\bAlertType\.INFO\b/;
const INFO_BANNER_TYPE: RegExp = /\bAlertBannerType\.Info\b/;
const COMPONENT_NAME: RegExp = /^[A-Z]/;
const WHITESPACE: RegExp = /\s+/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;

// Code only: a comment may say what a removed banner used to say.
function stripComments(text: string): string {
  return text.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
}

type BannerComponent = "Alert" | "AlertBanner";

/*
 * When the banner shows: under a condition, decided wherever the function
 * holding it is called, or every time the page renders.
 */
type ShownWhen = "condition" | "elsewhere" | "always";

interface InfoBanner {
  // Relative to packages/App/FeatureSet, with forward slashes.
  file: string;
  line: number;
  component: BannerComponent;
  shownWhen: ShownWhen;
  // The opening tag, on one line.
  tag: string;
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function skipWrappers(node: ts.Node): ts.Node {
  let current: ts.Node = node;

  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent) ||
      ts.isNonNullExpression(current.parent))
  ) {
    current = current.parent;
  }

  return current;
}

/*
 * A React component declared at the top of the module: a capitalised
 * function declaration, or a capitalised const whose value is the function
 * (`const Page: FunctionComponent<…> = (): ReactElement => { … }`).
 */
function isModuleLevelComponent(fn: ts.Node): boolean {
  if (ts.isFunctionDeclaration(fn)) {
    return (
      ts.isSourceFile(fn.parent) &&
      Boolean(fn.name && COMPONENT_NAME.test(fn.name.text))
    );
  }

  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) {
    return false;
  }

  const holder: ts.Node = skipWrappers(fn).parent;

  if (
    !holder ||
    !ts.isVariableDeclaration(holder) ||
    !ts.isIdentifier(holder.name) ||
    !COMPONENT_NAME.test(holder.name.text)
  ) {
    return false;
  }

  const statement: ts.Node | undefined = holder.parent?.parent;

  return Boolean(
    statement &&
      ts.isVariableStatement(statement) &&
      ts.isSourceFile(statement.parent),
  );
}

const SHORT_CIRCUIT_OPERATORS: Array<ts.SyntaxKind> = [
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
];

// Whether `parent` shows `child` only some of the time.
function isConditionFor(parent: ts.Node, child: ts.Node): boolean {
  if (ts.isConditionalExpression(parent)) {
    return child !== parent.condition;
  }

  if (ts.isBinaryExpression(parent)) {
    return (
      SHORT_CIRCUIT_OPERATORS.includes(parent.operatorToken.kind) &&
      child === parent.right
    );
  }

  if (ts.isIfStatement(parent)) {
    return child !== parent.expression;
  }

  if (
    ts.isCaseClause(parent) ||
    ts.isDefaultClause(parent) ||
    ts.isCatchClause(parent)
  ) {
    return true;
  }

  if (
    ts.isForStatement(parent) ||
    ts.isForOfStatement(parent) ||
    ts.isForInStatement(parent) ||
    ts.isWhileStatement(parent) ||
    ts.isDoStatement(parent)
  ) {
    return child === parent.statement;
  }

  return false;
}

function getShownWhen(element: ts.Node): ShownWhen {
  let child: ts.Node = element;
  let parent: ts.Node | undefined = element.parent;

  while (parent) {
    if (isConditionFor(parent, child)) {
      return "condition";
    }

    if (isFunctionLike(parent)) {
      return isModuleLevelComponent(parent) ? "always" : "elsewhere";
    }

    child = parent;
    parent = parent.parent;
  }

  // A module-level value: where it shows is decided where it is used.
  return "elsewhere";
}

// The names this file gives the two banner components' default exports.
function getBannerImports(source: ts.SourceFile): Map<string, BannerComponent> {
  const names: Map<string, BannerComponent> = new Map();

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause?.name
    ) {
      continue;
    }

    const specifier: string = statement.moduleSpecifier.text;
    const localName: string = statement.importClause.name.text;

    if (specifier.endsWith(ALERT_MODULE_SUFFIX)) {
      names.set(localName, "Alert");
    } else if (specifier.endsWith(ALERT_BANNER_MODULE_SUFFIX)) {
      names.set(localName, "AlertBanner");
    }
  }

  return names;
}

function getTypeAttribute(
  attributes: ts.JsxAttributes,
): ts.JsxAttribute | undefined {
  return attributes.properties.find(
    (attribute: ts.JsxAttributeLike): attribute is ts.JsxAttribute => {
      return (
        ts.isJsxAttribute(attribute) && attribute.name.getText() === "type"
      );
    },
  );
}

function hasSpreadAttribute(attributes: ts.JsxAttributes): boolean {
  return attributes.properties.some(
    (attribute: ts.JsxAttributeLike): boolean => {
      return ts.isJsxSpreadAttribute(attribute);
    },
  );
}

// Whether this banner can be the info kind.
function isInfo(
  component: BannerComponent,
  attributes: ts.JsxAttributes,
  source: ts.SourceFile,
): boolean {
  const type: ts.JsxAttribute | undefined = getTypeAttribute(attributes);

  if (!type) {
    // An <Alert> without a type is an info alert; spread props could say otherwise.
    return component === "Alert" && !hasSpreadAttribute(attributes);
  }

  const text: string = type.initializer ? type.initializer.getText(source) : "";

  return component === "Alert"
    ? INFO_ALERT_TYPE.test(text)
    : INFO_BANNER_TYPE.test(text);
}

function findInfoBanners(file: string, text: string): Array<InfoBanner> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const bannerNames: Map<string, BannerComponent> = getBannerImports(source);
  const banners: Array<InfoBanner> = [];

  if (bannerNames.size === 0) {
    return banners;
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    let opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null;

    if (ts.isJsxSelfClosingElement(node)) {
      opening = node;
    } else if (ts.isJsxElement(node)) {
      opening = node.openingElement;
    }

    const component: BannerComponent | undefined = opening
      ? bannerNames.get(opening.tagName.getText(source))
      : undefined;

    if (opening && component && isInfo(component, opening.attributes, source)) {
      banners.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        component: component,
        shownWhen: getShownWhen(node),
        tag: opening.getText(source).replace(WHITESPACE, " ").slice(0, 160),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return banners;
}

function listPageFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listPageFiles(fullPath));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(FEATURE_SET_DIR, file).split(path.sep).join("/");
}

const PAGE_FILES: Array<string> = APPS.flatMap((app: string): Array<string> => {
  return listPageFiles(path.join(FEATURE_SET_DIR, app, "src", "Pages"));
});

const BANNERS: Array<InfoBanner> = PAGE_FILES.flatMap(
  (file: string): Array<InfoBanner> => {
    const text: string = fs.readFileSync(file, "utf8");

    return MENTIONS_A_BANNER.test(text)
      ? findInfoBanners(relative(file), text)
      : [];
  },
);

function describeBanner(banner: InfoBanner): string {
  return `${banner.file}:${banner.line} ${banner.tag}`;
}

function bannersIn(file: string): Array<InfoBanner> {
  return BANNERS.filter((banner: InfoBanner): boolean => {
    return banner.file === file;
  });
}

// A page module with the Alert component imported, wrapped around `body`.
function pageWith(body: string, imports?: string): string {
  return `
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
${imports || ""}
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Page: FunctionComponent<PageComponentProps> = (): ReactElement => {
${body}
};

export default Page;
`;
}

function shownWhenIn(text: string): Array<ShownWhen> {
  return findInfoBanners("Synthetic.tsx", text).map(
    (banner: InfoBanner): ShownWhen => {
      return banner.shownWhen;
    },
  );
}

describe("the rule, on small pages", () => {
  test("an info banner the page always renders is always on", () => {
    expect(
      shownWhenIn(
        pageWith(`
  return (
    <Fragment>
      <Alert type={AlertType.INFO} title="Good to know." />
      <Card title="Settings" />
    </Fragment>
  );`),
      ),
    ).toEqual(["always"]);
  });

  test("an <Alert> without a type is an info banner: INFO is its default", () => {
    expect(
      shownWhenIn(
        pageWith(`
  return <Alert title="Good to know." />;`),
      ),
    ).toEqual(["always"]);
  });

  test("an early return for loading or an error does not make the main render's banner conditional", () => {
    expect(
      shownWhenIn(
        pageWith(`
  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <Alert type={AlertType.INFO} strongTitle="Heads up" title="Always here." />
    </Fragment>
  );`),
      ),
    ).toEqual(["always"]);
  });

  test("a banner under &&, ||, ??, a ternary, an if, a switch or a loop is conditional", () => {
    expect(
      shownWhenIn(
        pageWith(`
  if (isEmpty) {
    return <Alert title="Nothing to show yet." />;
  }

  switch (mode) {
    case "read-only":
      return <Alert type={AlertType.INFO} title="Read-only." />;
    default:
      break;
  }

  for (const notice of notices) {
    rendered.push(<Alert title={notice} />);
  }

  return (
    <Fragment>
      {isOff && <Alert type={AlertType.INFO} title="Off." />}
      {isReady ? null : <Alert type={AlertType.INFO} title="Not ready." />}
      {isOn ? <Card /> : <Alert type={AlertType.INFO} title="Off." />}
      {customNotice || <Alert title="Default notice." />}
      {customNotice ?? <Alert title="Default notice." />}
      {scanToEdit && (
        <ModelFormModal footer={<Alert type={AlertType.INFO} title="Saving re-runs the scan." />} />
      )}
    </Fragment>
  );`),
      ),
    ).toEqual([
      // if, switch, for
      "condition",
      "condition",
      "condition",
      // &&, the two ternaries, ||, ??
      "condition",
      "condition",
      "condition",
      "condition",
      "condition",
      // a dialog's footer, while the dialog is open
      "condition",
    ]);
  });

  test("a banner in a callback or a lower-case helper is judged where that runs, not here", () => {
    expect(
      shownWhenIn(
        `
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";

const renderNotice = (): ReactElement => {
  return <Alert type={AlertType.INFO} title="Shown when the caller decides." />;
};

const NOTICE: ReactElement = <Alert title="A value, used somewhere." />;

const Page: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      {notices.map((notice: string): ReactElement => {
        return <Alert type={AlertType.INFO} title={notice} />;
      })}
      <ModelTable
        columns={[
          {
            getElement: (): ReactElement => {
              return <Alert title="In a cell." />;
            },
          },
        ]}
      />
    </Fragment>
  );
};
`,
      ),
    ).toEqual(["elsewhere", "elsewhere", "elsewhere", "elsewhere"]);
  });

  test("warnings, errors and successes are not info banners", () => {
    expect(
      shownWhenIn(
        pageWith(`
  return (
    <Fragment>
      <Alert type={AlertType.WARNING} title="Careful." />
      <Alert type={AlertType.DANGER} title="Broken." />
      <Alert type={AlertType.SUCCESS} title="Done." />
    </Fragment>
  );`),
      ),
    ).toEqual([]);
  });

  test("a type that can be INFO counts as INFO", () => {
    expect(
      shownWhenIn(
        pageWith(`
  return (
    <Alert type={isOnRoster ? AlertType.INFO : AlertType.DANGER} title="Roster." />
  );`),
      ),
    ).toEqual(["always"]);
  });

  test("the component is found by its import, under any name, and the Alert model is not it", () => {
    expect(
      shownWhenIn(`
import AlertBanner, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Alert from "Common/Models/DatabaseModels/Alert";

const Page: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const query: Query<Alert> = {};

  return (
    <Fragment>
      <CountModelSideMenuItem<Alert> modelType={Alert} />
      <AlertBanner type={AlertType.INFO} title="Renamed, still a banner." />
    </Fragment>
  );
};
`),
    ).toEqual(["always"]);
  });

  test("an info <AlertBanner> counts; a danger or warning one does not", () => {
    expect(
      shownWhenIn(`
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";

function Page(): ReactElement {
  return (
    <Fragment>
      <AlertBanner type={AlertBannerType.Info} title="Good to know." />
      <AlertBanner type={AlertBannerType.Danger} title="Node pressure." />
      <AlertBanner type={AlertBannerType.Warning} title="Careful." />
    </Fragment>
  );
}
`),
    ).toEqual(["always"]);
  });

  test("a file without either component has nothing to judge", () => {
    expect(
      shownWhenIn(`
const Page: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return <Alert title="Some other Alert." />;
};
`),
    ).toEqual([]);
  });
});

describe("every page of every app", () => {
  test("the scan reads the pages", () => {
    // About 1,100 Dashboard pages and 100 more in the other apps.
    expect(PAGE_FILES.length).toBeGreaterThan(1000);
    expect(BANNERS.length).toBeGreaterThan(10);
  });

  test("no page renders an info banner every time it renders", () => {
    const alwaysOn: Array<string> = BANNERS.filter(
      (banner: InfoBanner): boolean => {
        return banner.shownWhen === "always";
      },
    ).map(describeBanner);

    /*
     * Say it in the card's description instead, or show the banner only in
     * the case it is about: {isOff && <Alert … />}.
     */
    expect(alwaysOn).toEqual([]);
  });

  test("conditional notices stay: the scan sees them as conditional", () => {
    for (const file of [
      "Dashboard/src/Pages/Rum/View/Overview.tsx",
      "Dashboard/src/Pages/Inventory/View/Settings.tsx",
      "Dashboard/src/Pages/NetworkDevice/Discovery.tsx",
      "Dashboard/src/Pages/Slo/View/Monitors.tsx",
      "AdminDashboard/src/Pages/Projects/View/Support.tsx",
    ]) {
      const banners: Array<InfoBanner> = bannersIn(file);

      expect({ file, found: banners.length > 0 }).toEqual({
        file,
        found: true,
      });

      for (const banner of banners) {
        expect({
          banner: describeBanner(banner),
          shownWhen: banner.shownWhen,
        }).toEqual({
          banner: describeBanner(banner),
          shownWhen: "condition",
        });
      }
    }
  });
});

describe("the four pages this rule came from", () => {
  test.each([
    "Dashboard/src/Pages/Rum/Settings/SessionReplay.tsx",
    "Dashboard/src/Pages/Rum/View/SessionReplaySettings.tsx",
    "Dashboard/src/Pages/Inventory/Archived.tsx",
    "Dashboard/src/Pages/Database/View/Settings.tsx",
  ])("%s has no info banner at all", (file: string): void => {
    const text: string = fs.readFileSync(
      path.join(FEATURE_SET_DIR, file),
      "utf8",
    );

    expect(findInfoBanners(file, text).map(describeBanner)).toEqual([]);
    expect(text).not.toContain("AlertType.INFO");
  });

  test("their banners' sentences are not on the pages any more", () => {
    const read: (file: string) => string = (file: string): string => {
      return stripComments(
        fs.readFileSync(
          path.join(FEATURE_SET_DIR, "Dashboard/src/Pages", file),
          "utf8",
        ),
      );
    };

    expect(read("Rum/Settings/SessionReplay.tsx")).not.toContain(
      "Looking for the installation test",
    );
    expect(read("Rum/View/SessionReplaySettings.tsx")).not.toContain(
      "Recording must also be allowed for the project",
    );
    expect(read("Inventory/Archived.tsx")).not.toContain(
      "These are hidden, not gone",
    );
    expect(read("Database/View/Settings.tsx")).not.toContain(
      "Which telemetry this covers.",
    );
  });
});
