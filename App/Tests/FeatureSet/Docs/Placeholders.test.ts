import DocsPlaceholders, {
  IP_WHITELIST_PLACEHOLDER,
} from "../../../FeatureSet/Docs/Utils/Placeholders";
import {
  PermissionPlaceholder,
  clearPermissionTableCaches,
  getGranularPermissionCount,
  getPermissionGroupCount,
  getRolePermissionCount,
} from "../../../FeatureSet/Docs/Utils/PermissionsTable";
import { beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Substitution is allow-listed on purpose: docs pages contain other
 * double-brace tokens as literal content (the website monitor page documents
 * `{{timestamp}}`, the workflow pages document `{{variable}}` syntax). A
 * blanket sweep would eat them, so these tests pin both halves — the tokens
 * that must be replaced, and the ones that must survive.
 */

describe("DocsPlaceholders", () => {
  beforeEach(() => {
    clearPermissionTableCaches();
  });

  describe("permission placeholders", () => {
    it("replaces the role table token with a markdown table", () => {
      const rendered: string = DocsPlaceholders.render(
        `before\n\n${PermissionPlaceholder.RoleTables}\n\nafter`,
        "en",
      );

      expect(rendered).not.toContain(PermissionPlaceholder.RoleTables);
      expect(rendered).toContain("before");
      expect(rendered).toContain("after");
      expect(rendered).toContain("| Role | Permission Key | Scope |");
      expect(rendered).toContain("`ProjectOwner`");
    });

    it("replaces the granular table token", () => {
      const rendered: string = DocsPlaceholders.render(
        PermissionPlaceholder.GranularTables,
        "en",
      );

      expect(rendered).not.toContain(PermissionPlaceholder.GranularTables);
      expect(rendered).toContain("`CreateProjectMonitor`");
    });

    it("replaces the scope-exempt token", () => {
      const rendered: string = DocsPlaceholders.render(
        PermissionPlaceholder.ScopeExemptRoles,
        "en",
      );

      expect(rendered).not.toContain(PermissionPlaceholder.ScopeExemptRoles);
      expect(rendered).toContain("`BillingAdmin`");
    });

    it("replaces the count tokens with the live numbers", () => {
      const rendered: string = DocsPlaceholders.render(
        `${PermissionPlaceholder.RoleCount}|${PermissionPlaceholder.TotalCount}|${PermissionPlaceholder.GroupCount}`,
        "en",
      );

      expect(rendered).toBe(
        [
          getRolePermissionCount(),
          getGranularPermissionCount(),
          getPermissionGroupCount(),
        ].join("|"),
      );
    });

    it("replaces every occurrence, not just the first", () => {
      const rendered: string = DocsPlaceholders.render(
        `${PermissionPlaceholder.RoleCount} then ${PermissionPlaceholder.RoleCount}`,
        "en",
      );

      expect(rendered).not.toContain("{{");
      expect(rendered).toBe(
        `${getRolePermissionCount()} then ${getRolePermissionCount()}`,
      );
    });

    it("localizes the generated chrome", () => {
      const german: string = DocsPlaceholders.render(
        PermissionPlaceholder.RoleTables,
        "de",
      );

      expect(german).toContain("Rolle");
      expect(german).toContain("`ProjectOwner`");
    });

    it("defaults to English when no language is given", () => {
      expect(DocsPlaceholders.render(PermissionPlaceholder.RoleTables)).toBe(
        DocsPlaceholders.render(PermissionPlaceholder.RoleTables, "en"),
      );
    });
  });

  describe("IP allow-list placeholder", () => {
    it("renders the configured-nothing message when IP_WHITELIST is unset", () => {
      /*
       * The App test suite runs with config.env exported and IP_WHITELIST
       * empty, so this is the real code path for a default install.
       */
      const rendered: string = DocsPlaceholders.render(
        IP_WHITELIST_PLACEHOLDER,
        "en",
      );

      expect(rendered).not.toContain(IP_WHITELIST_PLACEHOLDER);
      expect(rendered.startsWith("-")).toBe(true);
    });

    it("renders as a markdown list", () => {
      const rendered: string = DocsPlaceholders.render(
        IP_WHITELIST_PLACEHOLDER,
        "en",
      );

      for (const line of rendered.split("\n")) {
        expect(line.startsWith("- ")).toBe(true);
      }
    });
  });

  describe("tokens that must be left alone", () => {
    it("does not touch documented request placeholders", () => {
      const markdown: string =
        "Use `{{timestamp}}` and `{{random}}` in the request body.";

      expect(DocsPlaceholders.render(markdown, "en")).toBe(markdown);
    });

    it("does not touch workflow variable syntax", () => {
      const markdown: string = "Reference it as {{local.monitor.name}}.";

      expect(DocsPlaceholders.render(markdown, "en")).toBe(markdown);
    });

    it("does not touch an unknown uppercase token", () => {
      const markdown: string = "A {{NOT_A_REAL_PLACEHOLDER}} token.";

      expect(DocsPlaceholders.render(markdown, "en")).toBe(markdown);
    });

    it("leaves markdown with no placeholders byte-identical", () => {
      const markdown: string =
        "# Title\n\nSome prose.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";

      expect(DocsPlaceholders.render(markdown, "en")).toBe(markdown);
    });
  });

  describe("edge cases", () => {
    it("returns empty input unchanged", () => {
      expect(DocsPlaceholders.render("", "en")).toBe("");
    });

    it("handles several different placeholders in one document", () => {
      const rendered: string = DocsPlaceholders.render(
        [
          "# Page",
          PermissionPlaceholder.RoleCount,
          PermissionPlaceholder.ScopeExemptRoles,
          IP_WHITELIST_PLACEHOLDER,
          PermissionPlaceholder.GranularTables,
        ].join("\n\n"),
        "en",
      );

      for (const token of Object.values(PermissionPlaceholder)) {
        expect(rendered).not.toContain(token);
      }
      expect(rendered).not.toContain(IP_WHITELIST_PLACEHOLDER);
      expect(rendered).toContain("# Page");
    });

    it("falls back to English chrome for an unsupported language", () => {
      expect(
        DocsPlaceholders.render(PermissionPlaceholder.RoleTables, "xx-YY"),
      ).toBe(DocsPlaceholders.render(PermissionPlaceholder.RoleTables, "en"));
    });
  });

  describe("the shipped docs corpus", () => {
    /*
     * A typo'd placeholder is invisible until a reader sees literal braces on
     * the page — nothing else catches it. Walk every markdown file and require
     * that any SCREAMING_SNAKE token in double braces is one the renderer
     * knows how to replace.
     */
    const CONTENT_DIR: string = path.resolve(
      __dirname,
      "../../../FeatureSet/Docs/Content",
    );

    const KNOWN_TOKENS: Set<string> = new Set([
      IP_WHITELIST_PLACEHOLDER,
      ...Object.values(PermissionPlaceholder),
    ]);

    function markdownFilesIn(dir: string): Array<string> {
      const found: Array<string> = [];

      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          found.push(...markdownFilesIn(full));
        } else if (full.endsWith(".md")) {
          found.push(full);
        }
      }

      return found;
    }

    /*
     * Docs legitimately *document* double-brace syntax — the network device
     * pages describe `{{OID_NAME}}` as SNMP templating a reader types. Those
     * are always presented as code, and a real renderer placeholder never is,
     * so strip code spans and fenced blocks before scanning.
     */
    function withoutCode(markdown: string): string {
      return markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    }

    it("contains no placeholder-shaped token the renderer cannot resolve", () => {
      const files: Array<string> = markdownFilesIn(CONTENT_DIR);

      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        const markdown: string = withoutCode(fs.readFileSync(file, "utf8"));

        for (const match of markdown.matchAll(/\{\{[A-Z][A-Z0-9_]*\}\}/g)) {
          const token: string = match[0]!;

          expect({
            file: path.relative(CONTENT_DIR, file),
            token: token,
            known: KNOWN_TOKENS.has(token),
          }).toEqual({
            file: path.relative(CONTENT_DIR, file),
            token: token,
            known: true,
          });
        }
      }
    });

    it("renders every page without leaving a known token behind", () => {
      for (const file of markdownFilesIn(CONTENT_DIR)) {
        const rendered: string = DocsPlaceholders.render(
          fs.readFileSync(file, "utf8"),
          "en",
        );

        for (const token of KNOWN_TOKENS) {
          expect({
            file: path.relative(CONTENT_DIR, file),
            token: token,
            remaining: rendered.includes(token),
          }).toEqual({
            file: path.relative(CONTENT_DIR, file),
            token: token,
            remaining: false,
          });
        }
      }
    });
  });
});
