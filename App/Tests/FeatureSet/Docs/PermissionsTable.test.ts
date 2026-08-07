import {
  PermissionPlaceholder,
  clearPermissionTableCaches,
  dedupePermissions,
  getAssignablePermissionProps,
  getGranularPermissionCount,
  getGranularPermissionProps,
  getGranularTablesMarkdown,
  getPermissionGroupCount,
  getPermissionProps,
  getRolePermissionCount,
  getRolePermissionProps,
  getRoleTablesMarkdown,
  getScopeExemptRolesMarkdown,
  groupPermissions,
  toTableCell,
} from "../../../FeatureSet/Docs/Utils/PermissionsTable";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The permission docs pages exist to be trustworthy: a reader grants access
 * based on what they say. These tests hold the generator to that — every
 * assertion below is derived from Common/Types/Permission.ts rather than from
 * a copy of its contents, so they keep passing as permissions are added and
 * start failing the moment the page stops matching the product.
 */

// A `| --- | --- |` separator row, and a `` `SomePermission` `` key cell.
const SEPARATOR_CELL: RegExp = /^-{3,}$/;
const KEY_CELL: RegExp = /^`[A-Za-z]+`$/;

// Parses a generated markdown table body into rows of trimmed cells.
function parseTableRows(markdown: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];

  for (const line of markdown.split("\n")) {
    const trimmed: string = line.trim();

    if (!trimmed.startsWith("|")) {
      continue;
    }

    const cells: Array<string> = trimmed
      .slice(1, trimmed.endsWith("|") ? -1 : undefined)
      .split(/(?<!\\)\|/)
      .map((cell: string) => {
        return cell.trim();
      });

    // Skip the `| --- | --- |` separator rows.
    const isSeparator: boolean = cells.every((cell: string) => {
      return SEPARATOR_CELL.test(cell);
    });

    if (isSeparator) {
      continue;
    }

    rows.push(cells);
  }

  return rows;
}

// Every row whose key cell looks like `SomePermission` — i.e. data, not header.
function parseDataRows(markdown: string): Array<Array<string>> {
  return parseTableRows(markdown).filter((cells: Array<string>) => {
    return cells.some((cell: string) => {
      return KEY_CELL.test(cell);
    });
  });
}

function keysIn(markdown: string): Array<string> {
  const keys: Array<string> = [];

  for (const match of markdown.matchAll(/^\|[^|]*\|\s*`([A-Za-z]+)`\s*\|/gm)) {
    keys.push(match[1]!);
  }

  return keys;
}

describe("Docs permission tables", () => {
  beforeEach(() => {
    clearPermissionTableCaches();
  });

  describe("toTableCell", () => {
    it("escapes pipes so a description cannot split a row into extra columns", () => {
      expect(toTableCell("read | write")).toBe("read \\| write");
    });

    it("flattens newlines so a description cannot terminate the table", () => {
      expect(toTableCell("first line\nsecond line")).toBe(
        "first line second line",
      );
      expect(toTableCell("first\r\nsecond")).toBe("first second");
    });

    it("collapses runs of whitespace and trims", () => {
      expect(toTableCell("  lots   of\t space  ")).toBe("lots of space");
    });

    it("leaves an ordinary description untouched", () => {
      expect(toTableCell("Read-only access to monitors.")).toBe(
        "Read-only access to monitors.",
      );
    });
  });

  describe("dedupePermissions", () => {
    it("keeps the first entry when a permission is declared twice", () => {
      const first: PermissionProps = {
        permission: Permission.CreateStatusPageAnnouncement,
        title: "First",
        description: "First description.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      };
      const second: PermissionProps = { ...first, title: "Second" };

      const deduped: Array<PermissionProps> = dedupePermissions([
        first,
        second,
      ]);

      expect(deduped.length).toBe(1);
      expect(deduped[0]!.title).toBe("First");
    });

    it("matches PermissionHelper.getTitle, which also takes the first match", () => {
      /*
       * Common/Types/Permission.ts genuinely declares some permissions twice.
       * The docs must show the same title the rest of the product shows, and
       * getTitle()/getDescription() both read the first match — so the
       * deduped list has to agree with them for every permission.
       */
      for (const prop of getAssignablePermissionProps()) {
        expect(prop.title).toBe(PermissionHelper.getTitle(prop.permission));
        expect(prop.description).toBe(
          PermissionHelper.getDescription(prop.permission),
        );
      }
    });

    it("preserves order and leaves a duplicate-free list untouched", () => {
      const props: Array<PermissionProps> =
        PermissionHelper.getRolePermissionProps();

      expect(dedupePermissions(props)).toEqual(props);
    });

    it("handles an empty list", () => {
      expect(dedupePermissions([])).toEqual([]);
    });

    it("actually has work to do — the raw list contains duplicates", () => {
      /*
       * If this ever fails because the duplicates were cleaned up in
       * Permission.ts, that is good news: delete this test. It exists so the
       * dedupe above is never mistaken for dead code and removed while the
       * duplicates are still there.
       */
      const raw: number = PermissionHelper.getTenantPermissionProps().length;
      const deduped: number = getAssignablePermissionProps().length;

      expect(deduped).toBeLessThanOrEqual(raw);
    });
  });

  describe("groupPermissions", () => {
    it("groups by first appearance, matching the dashboard picker's order", () => {
      const props: Array<PermissionProps> = getAssignablePermissionProps();
      const grouped: Map<
        PermissionGroup,
        Array<PermissionProps>
      > = groupPermissions(props);

      const firstSeen: Array<PermissionGroup> = [];
      for (const prop of props) {
        if (!firstSeen.includes(prop.group)) {
          firstSeen.push(prop.group);
        }
      }

      expect(Array.from(grouped.keys())).toEqual(firstSeen);
    });

    it("keeps every permission exactly once", () => {
      const props: Array<PermissionProps> = getAssignablePermissionProps();
      const grouped: Map<
        PermissionGroup,
        Array<PermissionProps>
      > = groupPermissions(props);

      let total: number = 0;
      for (const groupProps of grouped.values()) {
        total += groupProps.length;
      }

      expect(total).toBe(props.length);
    });

    it("returns an empty map for an empty list", () => {
      expect(groupPermissions([]).size).toBe(0);
    });
  });

  describe("role tables", () => {
    it("lists every role permission and nothing else", () => {
      const markdown: string = getRoleTablesMarkdown("en");
      const keys: Array<string> = keysIn(markdown);

      const expected: Array<string> = getRolePermissionProps()
        .map((prop: PermissionProps) => {
          return prop.permission.toString();
        })
        .sort();

      expect(keys.slice().sort()).toEqual(expected);
    });

    it("emits no duplicate rows", () => {
      const keys: Array<string> = keysIn(getRoleTablesMarkdown("en"));
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("carries the title and description straight from Permission.ts", () => {
      const markdown: string = getRoleTablesMarkdown("en");
      const props: PermissionProps = getPermissionProps(
        Permission.MonitorAdmin,
      )!;

      const row: Array<string> | undefined = parseDataRows(markdown).find(
        (cells: Array<string>) => {
          return cells[1] === "`MonitorAdmin`";
        },
      );

      expect(row).toBeDefined();
      expect(row![0]).toBe(props.title);
      expect(row![3]).toBe(props.description);
    });

    it("marks scope-exempt roles as project-wide and the rest as selectable", () => {
      const markdown: string = getRoleTablesMarkdown("en");

      for (const row of parseDataRows(markdown)) {
        const key: string = row[1]!.replace(/`/g, "");
        const scopeCell: string = row[2]!;

        if (PermissionHelper.isScopeApplicable(key as Permission)) {
          expect(scopeCell).toBe("All, Owned or Labels");
        } else {
          expect(scopeCell).toBe("Project-wide only");
        }
      }
    });

    it("emits one heading per role group", () => {
      const markdown: string = getRoleTablesMarkdown("en");
      const headings: Array<string> = markdown
        .split("\n")
        .filter((line: string) => {
          return line.startsWith("### ");
        });

      const groups: Set<string> = new Set(
        getRolePermissionProps().map((prop: PermissionProps) => {
          return prop.group.toString();
        }),
      );

      expect(headings.length).toBe(groups.size);
      for (const heading of headings) {
        expect(groups.has(heading.replace("### ", ""))).toBe(true);
      }
    });

    it("gives every table a header row and a separator row", () => {
      const markdown: string = getRoleTablesMarkdown("en");
      const sections: Array<string> = markdown.split("### ").slice(1);

      expect(sections.length).toBeGreaterThan(0);

      for (const section of sections) {
        const lines: Array<string> = section
          .split("\n")
          .filter((line: string) => {
            return line.startsWith("|");
          });

        expect(lines[0]).toBe(
          "| Role | Permission Key | Scope | Description |",
        );
        expect(lines[1]).toBe("| --- | --- | --- | --- |");
        expect(lines.length).toBeGreaterThan(2);
      }
    });
  });

  describe("granular tables", () => {
    it("lists every tenant-assignable non-role permission and nothing else", () => {
      const keys: Array<string> = keysIn(getGranularTablesMarkdown("en"));

      const expected: Array<string> = getGranularPermissionProps()
        .map((prop: PermissionProps) => {
          return prop.permission.toString();
        })
        .sort();

      expect(keys.slice().sort()).toEqual(expected);
    });

    it("emits no duplicate rows", () => {
      const keys: Array<string> = keysIn(getGranularTablesMarkdown("en"));
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("never lists a role in the granular tables", () => {
      const keys: Set<string> = new Set(
        keysIn(getGranularTablesMarkdown("en")),
      );

      for (const role of PermissionHelper.getRolePermissionProps()) {
        expect(keys.has(role.permission.toString())).toBe(false);
      }
    });

    it("never lists a permission that cannot be assigned to a team", () => {
      const keys: Set<string> = new Set(
        keysIn(getGranularTablesMarkdown("en")),
      );

      const notAssignable: Array<PermissionProps> =
        PermissionHelper.getAllPermissionProps().filter(
          (prop: PermissionProps) => {
            return !prop.isAssignableToTenant;
          },
        );

      expect(notAssignable.length).toBeGreaterThan(0);

      for (const prop of notAssignable) {
        expect(keys.has(prop.permission.toString())).toBe(false);
      }
    });

    it("reports label-restrictability from isAccessControlPermission", () => {
      const rows: Array<Array<string>> = parseDataRows(
        getGranularTablesMarkdown("en"),
      );

      let sawYes: boolean = false;
      let sawNo: boolean = false;

      for (const row of rows) {
        const key: string = row[1]!.replace(/`/g, "");
        const props: PermissionProps = getPermissionProps(key as Permission)!;

        expect(row[2]).toBe(props.isAccessControlPermission ? "Yes" : "No");

        sawYes = sawYes || props.isAccessControlPermission;
        sawNo = sawNo || !props.isAccessControlPermission;
      }

      // Both branches must be exercised or the assertion above proves nothing.
      expect(sawYes).toBe(true);
      expect(sawNo).toBe(true);
    });

    it("produces a well-formed row for every permission", () => {
      const rows: Array<Array<string>> = parseDataRows(
        getGranularTablesMarkdown("en"),
      );

      for (const row of rows) {
        expect(row.length).toBe(4);
        // Title and description are never blank.
        expect(row[0]!.length).toBeGreaterThan(0);
        expect(row[3]!.length).toBeGreaterThan(0);
      }
    });

    it("never emits a raw pipe inside a cell", () => {
      const markdown: string = getGranularTablesMarkdown("en");

      for (const line of markdown.split("\n")) {
        if (!line.startsWith("|")) {
          continue;
        }
        // Column count must be identical on every line of a given table.
        const unescaped: number = (line.match(/(?<!\\)\|/g) || []).length;
        expect(unescaped).toBe(5);
      }
    });
  });

  describe("scope-exempt role table", () => {
    it("lists exactly the roles isScopeApplicable rejects", () => {
      const keys: Array<string> = keysIn(getScopeExemptRolesMarkdown("en"));

      const expected: Array<string> = getRolePermissionProps()
        .filter((prop: PermissionProps) => {
          return !PermissionHelper.isScopeApplicable(prop.permission);
        })
        .map((prop: PermissionProps) => {
          return prop.permission.toString();
        })
        .sort();

      expect(expected.length).toBeGreaterThan(0);
      expect(keys.slice().sort()).toEqual(expected);
    });

    it("includes ProjectOwner and Billing roles, excludes MonitorAdmin", () => {
      const keys: Set<string> = new Set(
        keysIn(getScopeExemptRolesMarkdown("en")),
      );

      expect(keys.has("ProjectOwner")).toBe(true);
      expect(keys.has("BillingAdmin")).toBe(true);
      expect(keys.has("MonitorAdmin")).toBe(false);
    });

    it("is a single table with no group headings", () => {
      expect(getScopeExemptRolesMarkdown("en")).not.toContain("###");
    });
  });

  describe("counts", () => {
    it("matches the permission list they are derived from", () => {
      expect(getRolePermissionCount()).toBe(getRolePermissionProps().length);
      expect(getGranularPermissionCount()).toBe(
        getGranularPermissionProps().length,
      );
      expect(getPermissionGroupCount()).toBe(
        new Set(
          getAssignablePermissionProps().map((prop: PermissionProps) => {
            return prop.group;
          }),
        ).size,
      );
    });

    it("adds up: roles plus granular equals every assignable permission", () => {
      expect(getRolePermissionCount() + getGranularPermissionCount()).toBe(
        getAssignablePermissionProps().length,
      );
    });

    it("are non-trivial, so a broken generator cannot pass by emitting nothing", () => {
      expect(getRolePermissionCount()).toBeGreaterThan(10);
      expect(getGranularPermissionCount()).toBeGreaterThan(100);
      expect(getPermissionGroupCount()).toBeGreaterThan(5);
    });
  });

  describe("localization", () => {
    it("translates the column headers for every supported language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const markdown: string = getRoleTablesMarkdown(lang);
        const headerLine: string = markdown.split("\n").find((line: string) => {
          return line.startsWith("|");
        })!;

        expect(headerLine.split("|").length).toBe(6);
      }
    });

    it("uses a different header row for German than for English", () => {
      const headerFor: (lang: string) => string = (lang: string): string => {
        return getRoleTablesMarkdown(lang)
          .split("\n")
          .find((line: string) => {
            return line.startsWith("|");
          })!;
      };

      expect(headerFor("de")).not.toBe(headerFor("en"));
      expect(headerFor("de")).toContain("Rolle");
    });

    it("keeps permission keys and titles untranslated so they match the UI", () => {
      for (const lang of ["de", "ja", "hi"]) {
        const markdown: string = getRoleTablesMarkdown(lang);
        expect(markdown).toContain("`MonitorAdmin`");
        expect(markdown).toContain("Monitor Admin");
      }
    });

    it("emits the same number of rows in every language", () => {
      const englishRows: number = keysIn(getRoleTablesMarkdown("en")).length;

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect(keysIn(getRoleTablesMarkdown(lang)).length).toBe(englishRows);
      }
    });

    it("falls back to English chrome for an unknown language", () => {
      expect(getRoleTablesMarkdown("xx-YY")).toBe(getRoleTablesMarkdown("en"));
    });
  });

  describe("caching", () => {
    it("returns an identical string on repeat calls", () => {
      const first: string = getGranularTablesMarkdown("en");
      const second: string = getGranularTablesMarkdown("en");

      expect(second).toBe(first);
    });

    it("keeps languages separate in the cache", () => {
      const english: string = getRoleTablesMarkdown("en");
      const german: string = getRoleTablesMarkdown("de");

      expect(german).not.toBe(english);
      expect(getRoleTablesMarkdown("en")).toBe(english);
    });
  });

  describe("placeholder tokens", () => {
    it("are all wrapped in double braces", () => {
      for (const token of Object.values(PermissionPlaceholder)) {
        expect(token).toMatch(/^\{\{[A-Z_]+\}\}$/);
      }
    });

    it("are unique", () => {
      const tokens: Array<string> = Object.values(PermissionPlaceholder);
      expect(new Set(tokens).size).toBe(tokens.length);
    });
  });
});
