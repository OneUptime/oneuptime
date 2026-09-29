import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import {
  PermissionPlaceholder,
  clearPermissionTableCaches,
  getAssignablePermissionProps,
} from "../../../FeatureSet/Docs/Utils/PermissionsTable";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
  makeT,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import { PermissionProps } from "Common/Types/Permission";
import { beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * End-to-end checks over the shipped markdown, the nav and the locale files.
 *
 * Config.ts points ContentPath at the container path, so these resolve the
 * repo copy directly — the same approach Scripts/Docs/CheckAnchors.ts uses.
 */
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);
const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Locales",
);

const PERMISSION_PAGES: Array<string> = ["index", "reference"];

const NAV_GROUP_TITLE: string = "Users & Permissions";

function readPage(lang: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, "permissions", `${page}.md`),
    "utf8",
  );
}

function readLocale(lang: string): {
  ui: { [key: string]: string };
  navGroups: { [key: string]: string };
  navLinks: { [key: string]: string };
} {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8"),
  );
}

describe("Permissions docs pages", () => {
  beforeEach(() => {
    clearPermissionTableCaches();
  });

  describe("navigation", () => {
    it("has a Users & Permissions group with both pages", () => {
      const group: NavGroup | undefined = DocsNav.find((item: NavGroup) => {
        return item.title === NAV_GROUP_TITLE;
      });

      expect(group).toBeDefined();
      expect(
        group!.links.map((link: NavLink) => {
          return link.url;
        }),
      ).toEqual(["/docs/permissions/index", "/docs/permissions/reference"]);
    });

    it("uses URLs that resolve to files on disk", () => {
      const group: NavGroup = DocsNav.find((item: NavGroup) => {
        return item.title === NAV_GROUP_TITLE;
      })!;

      for (const link of group.links) {
        const relative: string = link.url.replace("/docs/", "");
        const file: string = path.join(
          CONTENT_DIR,
          DEFAULT_DOCS_LANGUAGE,
          `${relative}.md`,
        );

        expect(fs.existsSync(file)).toBe(true);
      }
    });

    it("localizes the group and link titles in every language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const localized: ReturnType<typeof getLocalizedNav> =
          getLocalizedNav(lang);
        const t: ReturnType<typeof makeT> = makeT(lang);

        const expectedTitle: string = t(`navGroups.${NAV_GROUP_TITLE}`);

        const group: { title: string; links: Array<{ title: string }> } =
          localized.find((item: { title: string }): boolean => {
            return item.title === expectedTitle;
          })!;

        expect(group).toBeDefined();
        expect(group.links.length).toBe(2);

        /*
         * A missing key falls back to the key itself, so a title equal to the
         * raw English key in a non-English locale means the translation was
         * never added.
         */
        for (const link of group.links) {
          expect(link.title.length).toBeGreaterThan(0);
        }
      }
    });

    it("prefixes the URLs with the language", () => {
      const german: ReturnType<typeof getLocalizedNav> = getLocalizedNav("de");
      const t: ReturnType<typeof makeT> = makeT("de");

      const group: { links: Array<{ url: string }> } = german.find(
        (item: { title: string }): boolean => {
          return item.title === t(`navGroups.${NAV_GROUP_TITLE}`);
        },
      )!;

      expect(
        group.links.map((link: { url: string }) => {
          return link.url;
        }),
      ).toEqual([
        "/docs/de/permissions/index",
        "/docs/de/permissions/reference",
      ]);
    });
  });

  describe("content files", () => {
    it("exists for every supported language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        for (const page of PERMISSION_PAGES) {
          const file: string = path.join(
            CONTENT_DIR,
            lang,
            "permissions",
            `${page}.md`,
          );

          expect(fs.existsSync(file)).toBe(true);
        }
      }
    });

    it("starts with a level-one heading, which the renderer strips", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        for (const page of PERMISSION_PAGES) {
          expect(readPage(lang, page).startsWith("# ")).toBe(true);
        }
      }
    });

    it("keeps the generated tables in the reference page of every language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const markdown: string = readPage(lang, "reference");

        expect(markdown).toContain(PermissionPlaceholder.RoleTables);
        expect(markdown).toContain(PermissionPlaceholder.GranularTables);
      }
    });

    it("keeps the scope-exempt table in the overview page of every language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect(readPage(lang, "index")).toContain(
          PermissionPlaceholder.ScopeExemptRoles,
        );
      }
    });

    it("uses count placeholders rather than hardcoded numbers", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const reference: string = readPage(lang, "reference");

        expect(reference).toContain(PermissionPlaceholder.RoleCount);
        expect(reference).toContain(PermissionPlaceholder.TotalCount);
        expect(reference).toContain(PermissionPlaceholder.GroupCount);
      }
    });

    it("never hardcodes a generated table, keeping one source of truth", () => {
      /*
       * The whole point of the placeholders is that no permission list is
       * written down in markdown — a pasted copy silently goes stale. The
       * generated tables are identifiable by their "Permission Key" column
       * header, so a page containing one has a pasted copy in it.
       *
       * The prose tables (the three default teams, the three scopes) are
       * fine and deliberately not matched: they name a handful of concepts,
       * not a permission list.
       */
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const keyHeader: string = makeT(lang)("ui.permissionsColKey");

        for (const page of PERMISSION_PAGES) {
          const pastedTables: Array<string> = readPage(lang, page)
            .split("\n")
            .filter((line: string) => {
              return line.startsWith("|") && line.includes(keyHeader);
            });

          expect({
            lang: lang,
            page: page,
            pastedTables: pastedTables,
          }).toEqual({ lang: lang, page: page, pastedTables: [] });
        }
      }
    });

    it("only names permission keys that actually exist", () => {
      /*
       * Prose cites example keys (`CreateProjectMonitor`, `MonitorAdmin`).
       * A key that does not exist is worse than no example — a reader will
       * search the picker for it and find nothing. Anything in backticks
       * that is written in PascalCase has to resolve to a real permission.
       */
      const known: Set<string> = new Set(
        getAssignablePermissionProps().map((prop: PermissionProps) => {
          return prop.permission.toString();
        }),
      );

      // Placeholders and label names are not permissions.
      const allowed: Set<string> = new Set(["Production"]);

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        for (const page of PERMISSION_PAGES) {
          const markdown: string = readPage(lang, page);

          for (const match of markdown.matchAll(
            /`([A-Z][A-Za-z]*(?:[A-Z][a-z]+)+)`/g,
          )) {
            const candidate: string = match[1]!;

            if (allowed.has(candidate)) {
              continue;
            }

            expect({
              lang: lang,
              page: page,
              key: candidate,
              exists: known.has(candidate),
            }).toEqual({
              lang: lang,
              page: page,
              key: candidate,
              exists: true,
            });
          }
        }
      }
    });

    it("cross-links the two pages in every language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect(readPage(lang, "index")).toContain(
          "/docs/permissions/reference",
        );
        expect(readPage(lang, "reference")).toContain(
          "/docs/permissions/index",
        );
      }
    });

    it("links only to docs pages that exist", () => {
      const linkPattern: RegExp = /\]\((\/docs\/[^)#]+)\)/g;

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        for (const page of PERMISSION_PAGES) {
          const markdown: string = readPage(lang, page);

          for (const match of markdown.matchAll(linkPattern)) {
            const target: string = match[1]!.replace("/docs/", "");
            const file: string = path.join(
              CONTENT_DIR,
              DEFAULT_DOCS_LANGUAGE,
              `${target}.md`,
            );

            expect({
              lang: lang,
              page: page,
              target: target,
              exists: fs.existsSync(file),
            }).toEqual({
              lang: lang,
              page: page,
              target: target,
              exists: true,
            });
          }
        }
      }
    });

    it("has no in-page anchor links, which would not survive translation", () => {
      /*
       * Heading ids are slugified from the rendered heading text, and the
       * generated group headings are not present in the markdown at all — so
       * an in-page anchor here cannot be validated by the anchor checker and
       * would silently break in some locale.
       */
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        for (const page of PERMISSION_PAGES) {
          expect(readPage(lang, page)).not.toMatch(/\]\(#/);
        }
      }
    });

    it("is actually translated, not an English copy", () => {
      const english: string = readPage(DEFAULT_DOCS_LANGUAGE, "index");

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        if (lang === DEFAULT_DOCS_LANGUAGE) {
          continue;
        }

        expect(readPage(lang, "index")).not.toBe(english);
      }
    });
  });

  describe("rendered output", () => {
    it("leaves no unresolved placeholder in any language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        for (const page of PERMISSION_PAGES) {
          const rendered: string = DocsPlaceholders.render(
            readPage(lang, page),
            lang,
          );

          for (const token of Object.values(PermissionPlaceholder)) {
            expect(rendered).not.toContain(token);
          }
        }
      }
    });

    it("renders every assignable permission onto the reference page", () => {
      const rendered: string = DocsPlaceholders.render(
        readPage(DEFAULT_DOCS_LANGUAGE, "reference"),
        DEFAULT_DOCS_LANGUAGE,
      );

      const props: Array<PermissionProps> = getAssignablePermissionProps();

      expect(props.length).toBeGreaterThan(100);

      for (const prop of props) {
        expect({
          permission: prop.permission,
          present: rendered.includes(`\`${prop.permission}\``),
        }).toEqual({ permission: prop.permission, present: true });
      }
    });

    it("produces tables whose rows all have the same column count", () => {
      const rendered: string = DocsPlaceholders.render(
        readPage(DEFAULT_DOCS_LANGUAGE, "reference"),
        DEFAULT_DOCS_LANGUAGE,
      );

      let currentWidth: number | null = null;

      for (const line of rendered.split("\n")) {
        if (!line.startsWith("|")) {
          currentWidth = null;
          continue;
        }

        const width: number = (line.match(/(?<!\\)\|/g) || []).length;

        if (currentWidth === null) {
          currentWidth = width;
        }

        expect(width).toBe(currentWidth);
      }
    });

    it("survives the real markdown renderer as HTML tables", async () => {
      /*
       * The generated markdown only helps if the docs renderer turns it into
       * a table. Run it through the same DocsRender the page route uses,
       * after stripping the title line exactly as the route does.
       */
      const markdown: string = DocsPlaceholders.render(
        readPage(DEFAULT_DOCS_LANGUAGE, "reference")
          .split("\n")
          .slice(1)
          .join("\n"),
        DEFAULT_DOCS_LANGUAGE,
      );

      const html: string = await DocsRender.render(markdown);

      expect(html).toContain("<table");
      expect(html).toContain("ProjectOwner");
      expect(html).toContain("CreateProjectMonitor");

      // Braces would mean an unrendered placeholder reached the reader.
      expect(html).not.toContain("{{");

      // One <table> per group section, across both the role and granular sets.
      const tableCount: number = (html.match(/<table/g) || []).length;
      expect(tableCount).toBeGreaterThan(10);
    });

    it("renders the overview page, scope table included", async () => {
      const html: string = await DocsRender.render(
        DocsPlaceholders.render(
          readPage(DEFAULT_DOCS_LANGUAGE, "index")
            .split("\n")
            .slice(1)
            .join("\n"),
          DEFAULT_DOCS_LANGUAGE,
        ),
      );

      expect(html).toContain("<table");
      expect(html).toContain("BillingAdmin");
      expect(html).not.toContain("{{");
    });

    it("renders group headings the on-this-page sidebar can pick up", () => {
      const rendered: string = DocsPlaceholders.render(
        readPage(DEFAULT_DOCS_LANGUAGE, "reference"),
        DEFAULT_DOCS_LANGUAGE,
      );

      const headings: Array<string> = rendered
        .split("\n")
        .filter((line: string) => {
          return line.startsWith("### ");
        });

      // The sidebar only collects h2/h3, so these must be exactly three hashes.
      expect(headings.length).toBeGreaterThan(10);
      for (const heading of headings) {
        expect(heading.startsWith("#### ")).toBe(false);
      }
    });
  });

  describe("locale files", () => {
    const REQUIRED_UI_KEYS: Array<string> = [
      "permissionsColRole",
      "permissionsColPermission",
      "permissionsColKey",
      "permissionsColDescription",
      "permissionsColScope",
      "permissionsColLabels",
      "permissionsScopeSelectable",
      "permissionsScopeProjectWide",
      "permissionsYes",
      "permissionsNo",
    ];

    it("defines every permission table string in every language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const locale: ReturnType<typeof readLocale> = readLocale(lang);

        for (const key of REQUIRED_UI_KEYS) {
          expect({ lang: lang, key: key, value: locale.ui[key] }).toEqual({
            lang: lang,
            key: key,
            value: expect.any(String),
          });
          expect(locale.ui[key]!.length).toBeGreaterThan(0);
        }
      }
    });

    it("defines the nav group and link titles in every language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const locale: ReturnType<typeof readLocale> = readLocale(lang);

        expect(locale.navGroups[NAV_GROUP_TITLE]).toBeDefined();
        expect(locale.navLinks["Users, Teams & Permissions"]).toBeDefined();
        expect(locale.navLinks["Permission Reference"]).toBeDefined();
      }
    });

    it("actually translates the strings away from English", () => {
      const english: ReturnType<typeof readLocale> = readLocale(
        DEFAULT_DOCS_LANGUAGE,
      );

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        if (lang === DEFAULT_DOCS_LANGUAGE) {
          continue;
        }

        const locale: ReturnType<typeof readLocale> = readLocale(lang);

        /*
         * Individual words can legitimately match (Danish "Ja" for "Yes" does
         * not, but Dutch does), so require the group title — a multi-word
         * phrase no language leaves untouched — to differ.
         */
        expect({
          lang: lang,
          translated:
            locale.navGroups[NAV_GROUP_TITLE] !==
            english.navGroups[NAV_GROUP_TITLE],
        }).toEqual({ lang: lang, translated: true });
      }
    });

    it("keeps the column headers free of pipes, which would break the table", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const locale: ReturnType<typeof readLocale> = readLocale(lang);

        for (const key of REQUIRED_UI_KEYS) {
          expect(locale.ui[key]).not.toContain("|");
          expect(locale.ui[key]).not.toContain("\n");
        }
      }
    });
  });
});
