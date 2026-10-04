import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * "Card descriptions say what each list or card is for, not 'Here is a list
 * of…'".
 *
 * About sixty descriptions opened with boilerplate: "Here is a list of all
 * the incident templates in this project.", "Here are more details for this
 * workflow.", "Here are the list of subscribers who have subscribed to the
 * status page.", "This is the timeline and feed for this incident. You can
 * see all the updates and information about this incident here." They tell
 * the reader nothing the card's title and rows do not, and since #4269 a
 * list's description is also what its empty state explains: a new project
 * read "No incident templates yet. Here is a list of all the incident
 * templates in this project."
 *
 * Each now says what the thing is for (or, on a details card whose title
 * says it all, says nothing). This keeps it so in every frontend - the
 * Dashboard, the Admin Dashboard, the Status Page, Accounts, the Public
 * Dashboard, the shared Common/UI components, and the enterprise dashboards
 * when ee/ is present. It reads every string the code holds (string and
 * template literals, JSX text) and fails on one that opens with:
 *
 *   - "Here is", "Here are", "Here's", "Here the", "Here you can": the card
 *     is right there, so pointing at it says nothing;
 *   - "List of", "A list of", "The list of", "This is a list of": the same;
 *   - "This is the timeline and feed": the feeds' old filler;
 *   - "Manage ... here.": a sentence that only says the page is for
 *     managing what it shows.
 *
 * A string that has to keep such an opener goes in ALLOWED, with the reason.
 * Say what the list or card is for instead: what the items are, what they
 * do, and when to use them.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");

const SCAN_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet", "Dashboard", "src"),
  path.join(PACKAGES_DIR, "App", "FeatureSet", "AdminDashboard", "src"),
  path.join(PACKAGES_DIR, "App", "FeatureSet", "StatusPage", "src"),
  path.join(PACKAGES_DIR, "App", "FeatureSet", "Accounts", "src"),
  path.join(PACKAGES_DIR, "App", "FeatureSet", "PublicDashboard", "src"),
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

interface Opener {
  name: string;
  pattern: RegExp;
}

const OPENERS: Array<Opener> = [
  {
    name: "Here is / Here are",
    pattern: /^Here(?:'s|\s+(?:is|are|the|you)\b)/i,
  },
  {
    name: "List of",
    pattern: /^(?:(?:this|that)\s+is\s+)?(?:(?:a|the)\s+)?list\s+of\b/i,
  },
  {
    name: "This is the timeline and feed",
    pattern: /^This\s+is\s+the\s+timeline\s+and\s+feed\b/i,
  },
  {
    name: "Manage ... here",
    pattern: /^Manage\b[\s\S]*\bhere\.?$/i,
  },
];

const WHITESPACE: RegExp = /\s+/g;

interface AllowedString {
  // Relative to the repository root, with forward slashes.
  file: string;
  text: string;
  reason: string;
}

const ALLOWED: Array<AllowedString> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/Settings/SSO.tsx",
    text: "Here's a link which will help you test SSO integration before you force it on your organization: {{link}}",
    reason:
      "Hands over the test sign-in link it carries and says what the link is for.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SSO.tsx",
    text: "Here's a link which will help you test SSO integration before you force it on your organization: {{link}}",
    reason:
      "Hands over the test sign-in link it carries and says what the link is for.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/Settings/OIDC.tsx",
    text: "Here's a link which will help you test OIDC integration before you force it on your organization: {{link}}",
    reason:
      "Hands over the test sign-in link it carries and says what the link is for.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/OIDC.tsx",
    text: "Here's a link which will help you test OIDC integration before you force it on your organization: {{link}}",
    reason:
      "Hands over the test sign-in link it carries and says what the link is for.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/StatusPagePreviewLink.tsx",
    text: "Here's a link to preview your status page: {{link}}",
    reason: "Hands over the status page's preview link.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults.ts",
    text: "Here are more details for this scheduled event:",
    reason:
      "The default email a status page's subscribers are sent, not a card. Rewording it changes the email existing customers' subscribers get.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateVariables.ts",
    text: "List of affected resources/monitors",
    reason:
      "Says what a template variable holds - a list - in the variables reference, not what a card is for.",
  },
];

interface FoundString {
  // Relative to the repository root, with forward slashes.
  file: string;
  line: number;
  text: string;
  opener: string;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_DIR, file).split(path.sep).join("/");
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...listSourceFiles(fullPath));
      }
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function findOpener(text: string): string | undefined {
  const sentence: string = text.replace(WHITESPACE, " ").trim();

  return OPENERS.find((opener: Opener): boolean => {
    return opener.pattern.test(sentence);
  })?.name;
}

// A module's own name for another module is not something a reader sees.
function isModuleSpecifier(node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;

  if (!parent) {
    return false;
  }

  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    (ts.isLiteralTypeNode(parent) &&
      Boolean(parent.parent && ts.isImportTypeNode(parent.parent)))
  );
}

interface ReadStrings {
  strings: number;
  found: Array<FoundString>;
}

function readStrings(file: string, text: string): ReadStrings {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<FoundString> = [];
  let strings: number = 0;

  const check: (node: ts.Node, value: string) => void = (
    node: ts.Node,
    value: string,
  ): void => {
    strings++;

    const opener: string | undefined = findOpener(value);

    if (opener) {
      found.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        text: value.replace(WHITESPACE, " ").trim(),
        opener: opener,
      });
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !isModuleSpecifier(node)
    ) {
      check(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      // The words before the first ${...}.
      check(node, node.head.text);
    } else if (ts.isJsxText(node) && node.text.trim()) {
      check(node, node.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return { strings: strings, found: found };
}

function isAllowed(found: FoundString): boolean {
  return ALLOWED.some((allowed: AllowedString): boolean => {
    return allowed.file === found.file && allowed.text === found.text;
  });
}

const SOURCE_FILES: Array<string> = SCAN_DIRS.flatMap(
  (directory: string): Array<string> => {
    return listSourceFiles(directory);
  },
);

let STRINGS_READ: number = 0;

const FOUND: Array<FoundString> = SOURCE_FILES.flatMap(
  (file: string): Array<FoundString> => {
    const result: ReadStrings = readStrings(
      relative(file),
      fs.readFileSync(file, "utf8"),
    );

    STRINGS_READ += result.strings;

    return result.found;
  },
);

function describeFound(found: FoundString): string {
  return `${found.file}:${found.line} (${found.opener}) "${found.text}"`;
}

describe("the openers this guard refuses", () => {
  test.each([
    "Here is a list of all the incident templates in this project.",
    "Here are more details for this workflow.",
    "Here are the list of subscribers who have subscribed to the status page.",
    "Here are a list of private users for this status page.",
    "Here is the status timeline for this incident",
    "Here is your current AI balance for this project.",
    "Here's a list of everything in this project.",
    "Here the 90 day uptime history of this monitor group.",
    "Here you can manage block permissions for this API Key.",
    "List of monitors that are added to this monitor group.",
    "A list of every probe in this project.",
    "The list of teams in this project.",
    "This is a list of your invoices.",
    "This is the timeline and feed for this incident. You can see all the updates and information about this incident here.",
    "Manage your incident settings here.",
    "Manage team members from your identity provider or disable Push Groups in Settings > SCIM to make changes here.",
    "  Here is a description that a long JSX line wrapped.  ",
  ])("refuses %j", (sentence: string) => {
    expect(findOpener(sentence)).toBeDefined();
  });

  test.each([
    "Ready-made incidents for problems you expect, with the title, severity, monitors and on-call policy filled in.",
    "Everything that has happened to this incident: status changes, notes, owners and every notification sent.",
    "People who get this status page's updates by email. Visitors subscribe on the status page, or you can add them here.",
    "When someone invites you to a project or a team, the invitation waits here until you accept or reject it.",
    "Manage replica sets and rollouts",
    "Manage this resource as code with the OneUptime Terraform provider.",
    "Wherever this monitor runs, here is where its logs land.",
    "Hereford cattle",
    "Listening on port 8080.",
    "No monitors yet.",
  ])("accepts %j", (sentence: string) => {
    expect(findOpener(sentence)).toBeUndefined();
  });

  test("it reads string literals, template literals and JSX text, and skips module names", () => {
    const result: ReadStrings = readStrings(
      "Synthetic.tsx",
      `
import Card from "Here is a module path that is not copy";
const DEFAULT_DESCRIPTION: string = "Here is how your monitor is performing at this moment.";
const template: string = \`Here are \${count} things\`;
const plain: string = \`List of things\`;
const Page = () => {
  return (
    <Card
      title="Workflow Details"
      description={translator.translateTemplate("Here are the details of this {{itemName}}.", {})}
    >
      <p>
        Here is what happened when this workflow ran.
      </p>
      <p>Everything that has happened to this workflow.</p>
    </Card>
  );
};
`,
    );

    expect(
      result.found.map((found: FoundString): [number, string] => {
        return [found.line, found.text];
      }),
    ).toEqual([
      [3, "Here is how your monitor is performing at this moment."],
      [4, "Here are"],
      [5, "List of things"],
      [10, "Here are the details of this {{itemName}}."],
      // The line the words are on, not the line of the tag before them.
      [13, "Here is what happened when this workflow ran."],
    ]);
  });
});

describe("card descriptions say what each list or card is for", () => {
  test("the guard reads every frontend's sources", () => {
    // A path that stopped resolving would read nothing and pass.
    expect(SOURCE_FILES.length).toBeGreaterThan(1500);
    expect(STRINGS_READ).toBeGreaterThan(50000);
    expect(
      SOURCE_FILES.some((file: string): boolean => {
        return relative(file).startsWith(
          "packages/App/FeatureSet/AdminDashboard/src/",
        );
      }),
    ).toBe(true);
    expect(
      SOURCE_FILES.some((file: string): boolean => {
        return relative(file).startsWith("packages/Common/UI/");
      }),
    ).toBe(true);
  });

  test("no string opens with a boilerplate opener", () => {
    const unexpected: Array<string> = FOUND.filter(
      (found: FoundString): boolean => {
        return !isAllowed(found);
      },
    ).map(describeFound);

    expect(unexpected).toEqual([]);
  });

  test("every allowed string is still there, and still needs allowing", () => {
    const stale: Array<string> = ALLOWED.filter(
      (allowed: AllowedString): boolean => {
        return !FOUND.some((found: FoundString): boolean => {
          return found.file === allowed.file && found.text === allowed.text;
        });
      },
    ).map((allowed: AllowedString): string => {
      return `${allowed.file}: "${allowed.text}"`;
    });

    expect(stale).toEqual([]);
  });

  test("every allowed string says why", () => {
    for (const allowed of ALLOWED) {
      expect(allowed.reason.length).toBeGreaterThan(20);
    }
  });

  test("the shared components that every page leans on say what they show", () => {
    const ruleView: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "Common", "UI", "Components", "RuleRun", "RuleView.tsx"),
      "utf8",
    );
    const workflowLogModal: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "Common",
        "UI",
        "Components",
        "Workflow",
        "WorkflowLogModal.tsx",
      ),
      "utf8",
    );

    expect(ruleView).toContain(
      '"What this rule matches, and what it does to each match."',
    );
    // A run's Steps and Full Log tabs say what they hold: no filler line.
    expect(workflowLogModal).toContain("description={props.description}");
  });
});
