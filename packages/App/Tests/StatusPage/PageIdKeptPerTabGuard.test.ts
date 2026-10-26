import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * What the status page and public dashboard apps keep in the browser's
 * storage, and under which names (issue #5277).
 *
 * OneUptime's own host shows every status page at /status-page/<id> and
 * every public dashboard at /public-dashboard/<id>, and every tab open on
 * that host shares its localStorage. The apps kept the id of the page a tab
 * showed there, under one name ("statusPageId", "dashboardId"), so the page
 * a second tab opened became every tab's: the first one's next refresh drew
 * the second one's content, its links and Subscribe form led to the second
 * one, and a password entered in it unlocked the second one. Single sign-on
 * kept where to go afterwards under one name too ("redirectUrl"), which any
 * tab's overview, on any page, took.
 *
 * A tab's page is now read from its address, else from the tab's memory
 * (Common/UI/Utils/TabPageId), and what the browser keeps about a page is
 * kept under a name that ends in the page's id. This guard reads every
 * browser module of both apps and holds each storage call to that:
 *
 *   - no name written out as a string - one name for every page;
 *   - a name computed with the page's id, or one of the few names kept for
 *     the visitor rather than for a page, each with its reason below.
 */

const FEATURE_SET: string = path.join(__dirname, "..", "..", "FeatureSet");

const BROWSER_ROOTS: Array<string> = [
  path.join(FEATURE_SET, "StatusPage", "src"),
  path.join(FEATURE_SET, "PublicDashboard", "src"),
];

// The objects whose getItem / setItem / removeItem reach the browser's storage.
const STORAGE_RECEIVERS: Array<string> = [
  "LocalStorage",
  "SessionStorage",
  "localStorage",
  "sessionStorage",
  "window.localStorage",
  "window.sessionStorage",
];

const STORAGE_METHODS: Array<string> = ["getItem", "setItem", "removeItem"];

/*
 * Names kept for the visitor, not for a page: the same for every page on the
 * host, on purpose. A new one belongs here only with a reason as good.
 */
const VISITOR_WIDE_NAMES: Record<string, string> = {
  LANGUAGE_STORAGE_KEY:
    "the language the visitor reads in - each page still decides which of its languages it offers (applyStatusPageLanguageSettings)",
  LANGUAGE_USER_CHOICE_KEY:
    "whether the visitor picked that language, so a page's own default applies until they do",
  STATUS_PAGE_VISITOR_THEME_STORAGE_KEY:
    "the visitor's light or dark pick on pages that follow their device (StatusPageTheme)",
  STATUS_PAGE_LOGIN_CODE_STORAGE_KEY:
    "the single sign-on code the page's first script hands the app, in this tab's session storage, taken at once",
  MASTER_PASSWORD_VALIDATED_STORAGE_KEY:
    "only removed: the one name every page shared before names ended in the page's id",
};

/*
 * Variables holding a name computed with the page's id (the page's
 * getPageStorageKey / getDashboardStorageKey, User's per-page names).
 */
const PAGE_SCOPED_VARIABLES: Array<string> = ["storageKey"];

// Identifiers that are the page's id, in a name computed from it.
const PAGE_ID_IDENTIFIERS: Array<string> = ["statusPageId", "dashboardId"];

interface StorageCall {
  file: string;
  line: number;
  receiver: string;
  method: string;
  key: ts.Expression | undefined;
  keyText: string;
}

const listSourceFiles: (root: string) => Array<string> = (
  root: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full: string = path.join(root, entry.name);

    if (entry.isDirectory()) {
      // The node side that renders the pages, and the words: no storage.
      if (entry.name === "Server" || entry.name === "Locales") {
        continue;
      }

      files.push(...listSourceFiles(full));
      continue;
    }

    if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
};

// Every storage call in a module's text, with the name it is called with.
const findStorageCalls: (file: string, text: string) => Array<StorageCall> = (
  file: string,
  text: string,
): Array<StorageCall> => {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const calls: Array<StorageCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      STORAGE_METHODS.includes(node.expression.name.text) &&
      STORAGE_RECEIVERS.includes(node.expression.expression.getText(source))
    ) {
      const key: ts.Expression | undefined = node.arguments[0];

      calls.push({
        file: path.relative(FEATURE_SET, file),
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        receiver: node.expression.expression.getText(source),
        method: node.expression.name.text,
        key,
        keyText: key ? key.getText(source) : "",
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return calls;
};

// Whether a name is computed with the page's id: "<id>user_email", `...-${id}`.
const isComputedWithPageId: (key: ts.Expression) => boolean = (
  key: ts.Expression,
): boolean => {
  let found: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && PAGE_ID_IDENTIFIERS.includes(node.text)) {
      found = true;
    }

    ts.forEachChild(node, visit);
  };

  visit(key);

  return found;
};

const isWrittenOut: (call: StorageCall) => boolean = (
  call: StorageCall,
): boolean => {
  return Boolean(
    call.key &&
      (ts.isStringLiteral(call.key) ||
        ts.isNoSubstitutionTemplateLiteral(call.key)),
  );
};

const isExplained: (call: StorageCall) => boolean = (
  call: StorageCall,
): boolean => {
  if (!call.key) {
    return false;
  }

  if (ts.isIdentifier(call.key)) {
    return (
      PAGE_SCOPED_VARIABLES.includes(call.key.text) ||
      call.key.text in VISITOR_WIDE_NAMES
    );
  }

  return isComputedWithPageId(call.key);
};

const describeCall: (call: StorageCall) => string = (
  call: StorageCall,
): string => {
  return `${call.file}:${call.line} ${call.receiver}.${call.method}(${call.keyText})`;
};

const ALL_CALLS: Array<StorageCall> = BROWSER_ROOTS.flatMap((root: string) => {
  return listSourceFiles(root).flatMap((file: string) => {
    return findStorageCalls(file, fs.readFileSync(file, "utf8"));
  });
});

describe("the status page and public dashboard apps' storage", () => {
  test("the guard reads both apps' storage calls", () => {
    // A guard that found nothing would pass on anything.
    expect(ALL_CALLS.length).toBeGreaterThanOrEqual(15);

    const files: Set<string> = new Set(
      ALL_CALLS.map((call: StorageCall): string => {
        return call.file;
      }),
    );

    expect(files).toContain(
      path.join("StatusPage", "src", "Utils", "StatusPage.ts"),
    );
    expect(files).toContain(path.join("StatusPage", "src", "Utils", "User.ts"));
    expect(files).toContain(
      path.join("PublicDashboard", "src", "Utils", "PublicDashboard.ts"),
    );
  });

  test("no name is written out as a string: it would be every page's", () => {
    expect(ALL_CALLS.filter(isWrittenOut).map(describeCall)).toEqual([]);
  });

  test("every name is the page's own, or kept for the visitor with a reason", () => {
    expect(
      ALL_CALLS.filter((call: StorageCall): boolean => {
        return !isExplained(call);
      }).map(describeCall),
    ).toEqual([]);
  });

  test("the name every page shared for its password is only ever removed", () => {
    const sharedPasswordName: Array<StorageCall> = ALL_CALLS.filter(
      (call: StorageCall): boolean => {
        return call.keyText === "MASTER_PASSWORD_VALIDATED_STORAGE_KEY";
      },
    );

    expect(sharedPasswordName.length).toBeGreaterThan(0);

    for (const call of sharedPasswordName) {
      expect(call.method).toBe("removeItem");
    }
  });

  test("every visitor-wide name is still used, so the list cannot outlive its reasons", () => {
    for (const name of Object.keys(VISITOR_WIDE_NAMES)) {
      expect(
        ALL_CALLS.some((call: StorageCall): boolean => {
          return call.keyText === name;
        }),
      ).toBe(true);
    }
  });

  test("it catches the names the apps used to share, and a new name for every page", () => {
    const calls: Array<StorageCall> = findStorageCalls(
      path.join(FEATURE_SET, "StatusPage", "src", "Earlier.ts"),
      [
        'const id = LocalStorage.getItem("statusPageId");',
        'LocalStorage.setItem("dashboardId", id);',
        "window.localStorage.setItem(`redirectUrl`, path);",
        "window.sessionStorage.setItem(currentPage, path);",
        'LocalStorage.setItem(statusPageId.toString() + "user_id", id);',
        "LocalStorage.getItem(storageKey);",
        "window.localStorage.getItem(LANGUAGE_STORAGE_KEY);",
      ].join("\n"),
    );

    expect(calls.filter(isWrittenOut).map((call: StorageCall) => call.keyText))
      .toEqual(['"statusPageId"', '"dashboardId"', "`redirectUrl`"]);
    expect(
      calls
        .filter((call: StorageCall): boolean => {
          return !isExplained(call);
        })
        .map((call: StorageCall) => call.keyText),
    ).toEqual(['"statusPageId"', '"dashboardId"', "`redirectUrl`", "currentPage"]);
  });
});
