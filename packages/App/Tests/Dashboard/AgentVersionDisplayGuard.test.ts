import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * "If the agent version is outdated, can you please show the sign beside the
 * agent version and also, when I click on it, show how to upgrade the agent?
 * Please do this for all the resources like Hosts / docker / etc etc."
 *
 * Every page that shows an agent version draws it with the shared
 * AgentVersion component (Components/AgentVersion), naming the kind of agent
 * that reported it - the component decides whether the version is outdated
 * and opens the upgrade dialog. This guard keeps it that way: a page that
 * draws `agentVersion` any other way would show an outdated agent with no
 * sign, and nothing else would notice. It fails on:
 *
 *   1. a front-end file that mentions agentVersion and is in neither list
 *      below - every new one is a page to wire, or a reason to write down;
 *   2. a page in DISPLAYS that does not draw AgentVersion with exactly the
 *      agent kinds listed for it;
 *   3. agentVersion read anywhere but as the `version` of an AgentVersion, a
 *      yes/no check (Boolean(x), !x), or the plain `value` of a details row
 *      whose `element` is an AgentVersion - so a JSX child, a String(), a
 *      template or a translated chip label all fail;
 *   4. a details field or table column on agentVersion (`field: {
 *      agentVersion: true }`, `key: "agentVersion"`) without a getElement
 *      that draws AgentVersion: a FieldType.Text field shows the bare value;
 *   5. the hero's "Agent {{version}}" chip anywhere but the component;
 *   6. a stale entry in either list.
 *
 * Rendering is tested in Common/Tests/App/Dashboard/AgentVersion.test.tsx.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");
const DASHBOARD_SRC: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const SCAN_DIRS: Array<string> = [
  DASHBOARD_SRC,
  path.join(PACKAGES_DIR, "App", "FeatureSet", "AdminDashboard", "src"),
  path.join(PACKAGES_DIR, "Common", "UI"),
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

// The component itself, which is where the version is drawn.
const COMPONENT_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "AgentVersion",
);

function relative(file: string): string {
  return path.relative(REPOSITORY_DIR, file).split(path.sep).join("/");
}

/*
 * Every page that shows an agent version, and the agent kind(s) it draws
 * (AgentKind member names).
 */
const DISPLAYS: Record<string, Array<string>> = {
  "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index.tsx": [
    "KubernetesAgent",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/Docker/View/Overview.tsx": [
    "DockerAgent",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/Podman/View/Overview.tsx": [
    "PodmanAgent",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Index.tsx": [
    "DockerSwarmAgent",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/Database/View/Overview.tsx": [
    "DatabaseAgent",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView.tsx":
    ["KubernetesAgent", "Runner"],
  "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/Overview.tsx": [
    "HostCollector",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Index.tsx": [
    "ProxmoxAgent",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index.tsx": [
    "CephAgent",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/VMware/View/Index.tsx": [
    "VMwareAgent",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/VMware/VCenters.tsx": [
    "VMwareAgent",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/IoT/View/Index.tsx": [
    "IoTExporter",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/Serverless/View/Overview.tsx": [
    "ServerlessSdk",
  ],
  "packages/App/FeatureSet/Dashboard/src/Pages/Rum/View/Overview.tsx": [
    "RumSdk",
  ],
  // The cluster's AI agent page: the Kubernetes AI agent ships in the chart.
  "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI/Agent.tsx": [
    "KubernetesAgent",
  ],
  // Every other resource's AI agent page.
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentPage.tsx":
    ["ResourceAiAgent"],
  // The Overviews' AI agent cards: a cluster's, and every other resource's.
  "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatusSummaryCard.tsx":
    ["KubernetesAgent"],
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard.tsx":
    ["ResourceAiAgent"],
};

/*
 * Files that read agentVersion without drawing it as a version on a
 * resource, each with the reason.
 */
const NOT_DRAWN: Record<string, string> = {
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/RumInstrumentation.ts":
    "Reads the SDK version only to tell whether the RUM SDK ever reported; it draws nothing.",
};

const AGENT_KIND_SOURCE: string = fs.readFileSync(
  path.join(COMPONENT_DIR, "AgentKind.ts"),
  "utf8",
);

// The members of the AgentKind enum, read from its source.
function agentKindMembers(): Array<string> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    "AgentKind.ts",
    AGENT_KIND_SOURCE,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const members: Array<string> = [];
  sourceFile.forEachChild((node: ts.Node): void => {
    if (ts.isEnumDeclaration(node) && node.name.text === "AgentKind") {
      for (const member of node.members) {
        members.push(member.name.getText(sourceFile));
      }
    }
  });
  return members;
}

const TS_SOURCE: RegExp = /\.tsx?$/;

const AGENT_VERSION_IMPORT: RegExp =
  /^import AgentVersion from "[./]+\/Components\/AgentVersion\/AgentVersion";$/;

const AGENT_KIND_IMPORT: RegExp =
  /^import \{ AgentKind \} from "[./]+\/Components\/AgentVersion\/AgentKind";$/;

function walkFiles(dir: string, found: Array<string>): void {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        walkFiles(full, found);
      }
      continue;
    }
    if (TS_SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      found.push(full);
    }
  }
}

function filesMentioningAgentVersion(): Array<string> {
  const files: Array<string> = [];
  for (const dir of SCAN_DIRS) {
    walkFiles(dir, files);
  }
  return files.filter((file: string): boolean => {
    return (
      !file.startsWith(COMPONENT_DIR + path.sep) &&
      fs.readFileSync(file, "utf8").includes("agentVersion")
    );
  });
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

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  node.forEachChild((child: ts.Node): void => {
    visit(child, callback);
  });
}

function jsxTagName(node: ts.Node): string | null {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    return node.tagName.getText();
  }
  return null;
}

function isAgentVersionElement(node: ts.Node): boolean {
  return jsxTagName(node) === "AgentVersion";
}

function containsAgentVersionElement(node: ts.Node): boolean {
  let found: boolean = false;
  visit(node, (child: ts.Node): void => {
    if (isAgentVersionElement(child)) {
      found = true;
    }
  });
  return found;
}

function attributeOf(
  element: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  name: string,
): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (property: ts.JsxAttributeLike): property is ts.JsxAttribute => {
      return ts.isJsxAttribute(property) && property.name.getText() === name;
    },
  );
}

function isAgentVersionRead(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "agentVersion";
  }
  if (ts.isElementAccessExpression(node)) {
    return (
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === "agentVersion"
    );
  }
  return false;
}

function skipParentheses(node: ts.Node): ts.Node {
  let current: ts.Node = node.parent;
  while (current && ts.isParenthesizedExpression(current)) {
    current = current.parent;
  }
  return current;
}

function propertyNameOf(node: ts.PropertyAssignment): string {
  return node.name.getText().replace(/^["']|["']$/g, "");
}

/*
 * Whether a read of agentVersion is one of the three allowed: the version an
 * AgentVersion draws, a yes/no check, or a details row's plain value beside
 * an AgentVersion element.
 */
function isAllowedRead(read: ts.Node): boolean {
  // 1. Inside the `version` attribute of an <AgentVersion>.
  let ancestor: ts.Node | undefined = read.parent;
  while (ancestor) {
    if (ts.isJsxAttribute(ancestor)) {
      const element: ts.Node = ancestor.parent.parent;
      return (
        ancestor.name.getText() === "version" && isAgentVersionElement(element)
      );
    }
    if (ts.isFunctionLike(ancestor) || ts.isSourceFile(ancestor)) {
      break;
    }
    ancestor = ancestor.parent;
  }

  const parent: ts.Node = skipParentheses(read);

  // 2. A yes/no check: Boolean(x.agentVersion), !x.agentVersion, if (x.agentVersion).
  if (
    ts.isCallExpression(parent) &&
    parent.expression.getText() === "Boolean"
  ) {
    return true;
  }
  if (
    ts.isPrefixUnaryExpression(parent) &&
    parent.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return true;
  }
  if (
    ts.isIfStatement(parent) &&
    parent.expression === skipToExpression(read)
  ) {
    return true;
  }

  // 3. A details row's `value`, whose `element` draws it with AgentVersion.
  if (ts.isPropertyAssignment(parent) && propertyNameOf(parent) === "value") {
    const row: ts.Node = parent.parent;
    if (ts.isObjectLiteralExpression(row)) {
      return row.properties.some((property: ts.ObjectLiteralElementLike) => {
        return (
          ts.isPropertyAssignment(property) &&
          propertyNameOf(property) === "element" &&
          containsAgentVersionElement(property.initializer)
        );
      });
    }
  }

  return false;
}

function skipToExpression(node: ts.Node): ts.Node {
  let current: ts.Node = node;
  while (current.parent && ts.isParenthesizedExpression(current.parent)) {
    current = current.parent;
  }
  return current;
}

// `field: { agentVersion: true }` or `key: "agentVersion"`.
function isAgentVersionFieldDescriptor(
  object: ts.ObjectLiteralExpression,
): boolean {
  return object.properties.some((property: ts.ObjectLiteralElementLike) => {
    if (!ts.isPropertyAssignment(property)) {
      return false;
    }
    const name: string = propertyNameOf(property);
    if (name === "key") {
      return (
        ts.isStringLiteral(property.initializer) &&
        property.initializer.text === "agentVersion"
      );
    }
    if (
      name === "field" &&
      ts.isObjectLiteralExpression(property.initializer)
    ) {
      return property.initializer.properties.some(
        (inner: ts.ObjectLiteralElementLike) => {
          return (
            ts.isPropertyAssignment(inner) &&
            propertyNameOf(inner) === "agentVersion"
          );
        },
      );
    }
    return false;
  });
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

const MENTIONING: Array<string> = filesMentioningAgentVersion().map(relative);

describe("every front-end file that mentions agentVersion is accounted for", () => {
  test("each one is a page that draws it with AgentVersion, or has a reason not to", () => {
    const unlisted: Array<string> = MENTIONING.filter((file: string) => {
      return !(file in DISPLAYS) && !(file in NOT_DRAWN);
    });
    expect(unlisted).toEqual([]);
  });

  test("no entry is stale: every listed file still mentions agentVersion", () => {
    const stale: Array<string> = [
      ...Object.keys(DISPLAYS),
      ...Object.keys(NOT_DRAWN),
    ].filter((file: string) => {
      return !MENTIONING.includes(file);
    });
    expect(stale).toEqual([]);
  });

  test("the kinds named here are AgentKind's members", () => {
    const members: Array<string> = agentKindMembers();
    expect(members.length).toBeGreaterThan(0);
    for (const kinds of Object.values(DISPLAYS)) {
      for (const kind of kinds) {
        expect(members).toContain(kind);
      }
    }
  });

  test("every agent kind is drawn somewhere", () => {
    const drawn: Set<string> = new Set(Object.values(DISPLAYS).flat());
    expect(
      agentKindMembers().filter((kind: string) => {
        return !drawn.has(kind);
      }),
    ).toEqual([]);
  });
});

describe.each(Object.entries(DISPLAYS))(
  "%s",
  (file: string, expectedKinds: Array<string>) => {
    const sourceFile: ts.SourceFile = parse(path.join(REPOSITORY_DIR, file));

    test("imports the shared AgentVersion component and AgentKind", () => {
      const imports: Array<string> = [];
      sourceFile.forEachChild((node: ts.Node): void => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          imports.push(node.getText(sourceFile));
        }
      });
      expect(
        imports.some((statement: string): boolean => {
          return AGENT_VERSION_IMPORT.test(statement);
        }),
      ).toBe(true);
      expect(
        imports.some((statement: string): boolean => {
          return AGENT_KIND_IMPORT.test(statement);
        }),
      ).toBe(true);
    });

    test(`draws AgentVersion with exactly ${expectedKinds.join(" and ")}, from the agentVersion it read`, () => {
      const kinds: Set<string> = new Set();
      let elements: number = 0;

      visit(sourceFile, (node: ts.Node): void => {
        if (
          !(ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) ||
          !isAgentVersionElement(node)
        ) {
          return;
        }
        elements++;

        const kind: ts.JsxAttribute | undefined = attributeOf(node, "kind");
        expect(kind).toBeDefined();
        visit(kind as ts.Node, (inner: ts.Node): void => {
          if (
            ts.isPropertyAccessExpression(inner) &&
            inner.expression.getText() === "AgentKind"
          ) {
            kinds.add(inner.name.text);
          }
        });

        const version: ts.JsxAttribute | undefined = attributeOf(
          node,
          "version",
        );
        expect(version?.getText()).toMatch(/agentVersion/);
      });

      expect(elements).toBeGreaterThan(0);
      expect([...kinds].sort()).toEqual([...expectedKinds].sort());
    });

    test("reads agentVersion only as an AgentVersion's version, a yes/no check, or a row's plain value", () => {
      const violations: Array<string> = [];
      visit(sourceFile, (node: ts.Node): void => {
        if (isAgentVersionRead(node) && !isAllowedRead(node)) {
          violations.push(
            `${file}:${lineOf(sourceFile, node)} ${node.parent.getText()}`,
          );
        }
      });
      expect(violations).toEqual([]);
    });

    test("every details field or table column on agentVersion draws it with AgentVersion", () => {
      const fields: Array<string> = [];
      const bare: Array<string> = [];
      visit(sourceFile, (node: ts.Node): void => {
        if (
          !ts.isObjectLiteralExpression(node) ||
          !isAgentVersionFieldDescriptor(node)
        ) {
          return;
        }
        const where: string = `${file}:${lineOf(sourceFile, node)}`;
        fields.push(where);
        const getElement: ts.ObjectLiteralElementLike | undefined =
          node.properties.find((property: ts.ObjectLiteralElementLike) => {
            return property.name?.getText() === "getElement";
          });
        if (!getElement || !containsAgentVersionElement(getElement)) {
          bare.push(where);
        }
      });
      expect(bare).toEqual([]);
    });
  },
);

describe("the hero's agent chip lives in the component only", () => {
  test('no page builds its own "Agent {{version}}" chip', () => {
    const files: Array<string> = [];
    walkFiles(DASHBOARD_SRC, files);
    const builders: Array<string> = files
      .filter((file: string): boolean => {
        return fs.readFileSync(file, "utf8").includes('"Agent {{version}}"');
      })
      .map(relative);
    expect(builders).toEqual([
      "packages/App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentVersion.tsx",
    ]);
  });
});

describe("the details row draws the element it is given", () => {
  test("ResourceOverview shows a row's element in place of its plain value, and '—' when there is no value", () => {
    const source: string = fs
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
    expect(source).toContain("element?: ReactElement | undefined;");
    expect(source).toContain(
      '{row.value && row.value.length > 0 ? row.element || row.value : "—"}',
    );
  });
});
