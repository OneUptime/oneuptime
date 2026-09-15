import { RuleRunType } from "Common/Types/Rules/RuleRun";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every runnable rule - label, owner, privacy and status page monitor rules -
 * has a view page with "Run Now" on it. That promise is spread over five
 * files per rule kind, and each piece fails silently rather than loudly:
 *
 *   - a table without viewRuleId renders the table on the view URL,
 *   - a View button pointing at a PageMap key RouteMap never defined goes
 *     nowhere,
 *   - a view route that does not pass ruleViewModelType renders the list,
 *   - a nested view route that takes the wrong number of path segments
 *     matches nothing and renders a blank page.
 *
 * The App suite has no renderer and cannot import dashboard route modules, so
 * these are source-level invariants. Pages are DISCOVERED by scanning for the
 * table that mounts each rule model rather than listed by file, so unrelated
 * work that moves a page does not break this suite - only losing the wiring
 * does.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function listTsxFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listTsxFiles(entryPath));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }

  return files;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// All whitespace removed, so Prettier can reflow without breaking assertions.
function dense(source: string): string {
  return stripComments(source).replace(/\s+/g, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface SourceFile {
  filePath: string;
  source: string;
}

function readDense(filePath: string): SourceFile {
  return {
    filePath: filePath,
    source: dense(fs.readFileSync(filePath, "utf8")),
  };
}

const PAGE_FILES: Array<SourceFile> = listTsxFiles(
  path.join(DASHBOARD_SRC, "Pages"),
).map(readDense);
const ROUTE_FILES: Array<SourceFile> = listTsxFiles(
  path.join(DASHBOARD_SRC, "Routes"),
).map(readDense);
/*
 * Whitespace only: RouteMap's mount paths end in `/*` inside strings, which a
 * comment stripper would read as the start of a block comment and swallow
 * half the file.
 */
const PAGE_MAP: string = fs
  .readFileSync(path.join(DASHBOARD_SRC, "Utils", "PageMap.ts"), "utf8")
  .replace(/\s+/g, "");
const ROUTE_MAP: string = fs
  .readFileSync(path.join(DASHBOARD_SRC, "Utils", "RouteMap.ts"), "utf8")
  .replace(/\s+/g, "");

interface RuleMount {
  page: SourceFile;
  tag: string;
  // The page's source from `modelType={X}` on.
  rest: string;
}

function findMounts(ruleType: RuleRunType): Array<RuleMount> {
  const mounts: Array<RuleMount> = [];
  const marker: string = `modelType={${ruleType}}`;

  for (const page of PAGE_FILES) {
    let offset: number = page.source.indexOf(marker);

    while (offset !== -1) {
      const before: string = page.source.slice(
        Math.max(0, offset - 120),
        offset,
      );
      const tagMatch: RegExpMatchArray | null = before.match(
        /<([A-Za-z]+)<[A-Za-z]+>$/,
      );

      mounts.push({
        page: page,
        tag: tagMatch ? tagMatch[1]! : "",
        rest: page.source.slice(offset),
      });

      offset = page.source.indexOf(marker, offset + marker.length);
    }
  }

  return mounts;
}

interface RuleViewWiring {
  mount: RuleMount;
  listKey: string;
  viewKey: string;
}

function getWiring(ruleType: RuleRunType): RuleViewWiring {
  const mounts: Array<RuleMount> = findMounts(ruleType);
  expect(mounts).toHaveLength(1);
  const mount: RuleMount = mounts[0]!;

  const viewMatch: RegExpMatchArray | null = mount.rest.match(
    /^modelType=\{[A-Za-z]+\}viewRuleId=\{[^}]*\}listRoute=\{RuleViewPageUtil\.getListRoute\(PageMap\.([A-Z_]+)[,)][\s\S]*?getRuleViewRoute=\{\([^)]*\):Route=>\{returnRuleViewPageUtil\.getRuleViewRoute\(PageMap\.([A-Z_]+),/,
  );

  expect(viewMatch).not.toBeNull();

  return {
    mount: mount,
    listKey: viewMatch![1]!,
    viewKey: viewMatch![2]!,
  };
}

// The relative path RouteMap declares for a page key, e.g. "settings/label-rules".
function relativePath(key: string): string {
  const match: RegExpMatchArray | null = ROUTE_MAP.match(
    new RegExp(`\\[PageMap\\.${key}\\]:[\`"]([^\`"]*)[\`"],`),
  );

  expect(match).not.toBeNull();

  return match![1]!;
}

const RULE_TYPES: Array<RuleRunType> = Object.values(RuleRunType);

describe("rule view pages", () => {
  test.each(RULE_TYPES)(
    "%s is listed by exactly one page, through a rule table",
    (ruleType: RuleRunType) => {
      const mounts: Array<RuleMount> = findMounts(ruleType);

      expect(mounts).toHaveLength(1);
      expect(["RuleTable", "LabelRuleTable"]).toContain(mounts[0]!.tag);
    },
  );

  test.each(RULE_TYPES)(
    "%s passes its view wiring to the table and reads its own view id",
    (ruleType: RuleRunType) => {
      const wiring: RuleViewWiring = getWiring(ruleType);

      /*
       * A page with several rule tables passes viewRuleId down from props;
       * either way the page must ask for THIS model's view id.
       */
      expect(wiring.mount.page.source).toMatch(
        new RegExp(`RuleViewPageUtil\\.getViewRuleId\\(props,${ruleType},?\\)`),
      );

      // A View button the table is told to hide would make the page unreachable.
      const attributes: string = wiring.mount.rest.slice(
        0,
        wiring.mount.rest.indexOf("formFields="),
      );
      expect(attributes).not.toContain("isViewable={false}");
    },
  );

  test.each(RULE_TYPES)(
    "%s has a view page key that PageMap and RouteMap both define",
    (ruleType: RuleRunType) => {
      const wiring: RuleViewWiring = getWiring(ruleType);

      expect(PAGE_MAP).toContain(`${wiring.viewKey}="${wiring.viewKey}",`);
      expect(ROUTE_MAP).toContain(`[PageMap.${wiring.viewKey}]:newRoute(`);
      expect(PAGE_MAP).toContain(`${wiring.listKey}="${wiring.listKey}",`);
    },
  );

  /*
   * The view page reads the rule id off the LAST segment of its URL, and the
   * rule's View button builds that URL from the list page's path.
   */
  test.each(RULE_TYPES)(
    "%s view path extends its list path and ends in the rule id",
    (ruleType: RuleRunType) => {
      const wiring: RuleViewWiring = getWiring(ruleType);
      const listPath: string = relativePath(wiring.listKey);
      const viewPath: string = relativePath(wiring.viewKey);

      expect(viewPath.startsWith(`${listPath}/`)).toBe(true);
      expect(viewPath).toMatch(/\$\{RouteParams\.(ModelID|SubModelID)\}$/);
    },
  );

  test.each(RULE_TYPES)(
    "%s is routed to the page that lists it, as a view of that rule",
    (ruleType: RuleRunType) => {
      const wiring: RuleViewWiring = getWiring(ruleType);
      const viewKey: string = escapeRegExp(wiring.viewKey);

      const routePattern: RegExp = new RegExp(
        `<PageRoutepath=\\{[^{}]*PageMap\\.${viewKey}\\b[^{}]*\\}element=\\{<([A-Za-z]+)\\{\\.\\.\\.props\\}pageRoute=\\{RouteMap\\[PageMap\\.${viewKey}\\]asRoute\\}ruleViewModelType=\\{${ruleType}\\}/>\\}/>`,
      );

      const routed: Array<{ file: SourceFile; component: string }> = [];

      for (const file of ROUTE_FILES) {
        const match: RegExpMatchArray | null = file.source.match(routePattern);

        if (match) {
          routed.push({ file: file, component: match[1]! });
        }
      }

      expect(routed).toHaveLength(1);

      // The routed component is the page that mounts the rule table.
      const pageImport: string = path
        .relative(
          path.join(DASHBOARD_SRC, "Routes"),
          wiring.mount.page.filePath,
        )
        .replace(/\.tsx$/, "");

      expect(routed[0]!.file.source).toContain(
        `import${routed[0]!.component}from"${pageImport}";`,
      );
      expect(routed[0]!.file.source).toContain(
        `import${ruleType}from"Common/Models/DatabaseModels/${ruleType}";`,
      );
    },
  );

  /*
   * A view route nested under a resource layout (a status page's monitor
   * rules) is declared relative to that layout's `:id`. getLastPathForKey
   * with the default count of 1 would keep only `:subModelId`, which matches
   * a different URL entirely.
   */
  test("nested view routes keep every path segment below their layout", () => {
    for (const file of ROUTE_FILES) {
      const matches: IterableIterator<RegExpMatchArray> = file.source.matchAll(
        /RouteUtil\.getLastPathForKey\(PageMap\.([A-Z_]+_RULE_VIEW)(?:,(\d+))?,?\)/g,
      );

      for (const match of matches) {
        const viewPath: string = relativePath(match[1]!);
        const segmentsBelowLayout: number = viewPath.split("/").length - 1;

        expect(Number(match[2] || "1")).toBe(segmentsBelowLayout);
      }
    }
  });
});
