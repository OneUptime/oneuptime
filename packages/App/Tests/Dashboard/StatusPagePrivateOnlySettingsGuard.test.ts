// UX rule: Docs/ux/README.md#settings-and-danger
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import StatusPagePrivateOnlyCopy, {
  isStatusPagePublicNoticeShown,
  StatusPagePrivateOnlyPage,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPagePrivateOnlyCopy";
import {
  STATUS_PAGE_ACCESS_CHOICES,
  StatusPageAccess,
} from "Common/Types/StatusPage/StatusPageAccess";

/*
 * A SETTING THAT DOES NOTHING YET SAYS SO WHERE IT IS SET.
 *
 * A public status page (Access: "Anyone with the link") lets every visitor
 * in without signing in, so its private users, its single sign-on providers
 * (SAML and OIDC) and SCIM do nothing there. A person could add them all to
 * a public page, and none of their pages said a word: only Private Users
 * warned, and only about the master password (#9130).
 *
 * Each of those pages now draws StatusPagePrivateOnlySettings, which says,
 * while the page is public, "This status page is public, so these settings
 * do nothing until you make it private." with the way to Access, and folds
 * the page's settings under it. This holds it so:
 *
 *   - the status page menu's Security section is Access, then exactly the
 *     pages listed here as private-only, so a sign-in page added to it
 *     later has to say whether it does anything on a public page;
 *   - each such page, as the routes draw it, draws the notice, with who can
 *     see the page read by useStatusPageAccess and its own words for what
 *     it folds;
 *   - every page that lists private users or sign-on providers is one of
 *     them, or a tab drawn inside one;
 *   - the notice shows on a public page only, never on a private one or
 *     before the page is read, and every Dashboard locale words it.
 *
 * Source is read as text: App's tests never import a React module.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");

const DASHBOARD_SRC: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const VIEW_DIR: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "StatusPages",
  "View",
);
const MENU_FILE: string = path.join(VIEW_DIR, "SideMenu.tsx");
const ROUTES_FILE: string = path.join(
  DASHBOARD_SRC,
  "Routes",
  "StatusPagesRoutes.tsx",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

// The menu's Security entries after Access, the page each opens, and its words.
const PRIVATE_ONLY_PAGES: Array<{
  pageMap: string;
  file: string;
  page: StatusPagePrivateOnlyPage;
}> = [
  {
    pageMap: "STATUS_PAGE_VIEW_PRIVATE_USERS",
    file: "PrivateUser.tsx",
    page: StatusPagePrivateOnlyPage.PrivateUsers,
  },
  {
    pageMap: "STATUS_PAGE_VIEW_SSO",
    file: "SingleSignOn.tsx",
    page: StatusPagePrivateOnlyPage.SingleSignOn,
  },
  {
    pageMap: "STATUS_PAGE_VIEW_SCIM",
    file: "SCIM.tsx",
    page: StatusPagePrivateOnlyPage.Scim,
  },
];

// Access itself chooses who can see the page: it works on every page.
const ACCESS_PAGE_MAP: string = "STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS";

// The records only a private page reads.
const PRIVATE_ONLY_MODELS: Array<string> = [
  "StatusPagePrivateUser",
  "StatusPageSSO",
  "StatusPageOIDC",
];

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

// Without comments, so a sentence about a page is not mistaken for code.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// The PageMap keys the menu's Security section links to, in order.
function securityEntries(): Array<string> {
  const menu: string = withoutComments(read(MENU_FILE));
  const start: number = menu.indexOf('<SideMenuSection title="Security">');

  expect(start).toBeGreaterThan(-1);

  const end: number = menu.indexOf("</SideMenuSection>", start);
  const section: string = menu.substring(start, end);

  return Array.from(section.matchAll(/PageMap\.([A-Z_]+)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

/*
 * The View file a route draws for a PageMap key: the element after its
 * path, by the name it is imported under.
 */
function routedFile(pageMap: string): string {
  const routes: string = withoutComments(read(ROUTES_FILE));
  const pathMatch: RegExpMatchArray | null = routes.match(
    new RegExp(
      `RouteUtil\\.getLastPathForKey\\(\\s*PageMap\\.${pageMap}\\s*,?\\s*\\)`,
    ),
  );

  expect([pageMap, pathMatch !== null]).toEqual([pageMap, true]);

  const at: number = pathMatch!.index!;

  const element: RegExpMatchArray | null = routes
    .substring(at)
    .match(/element=\{\s*<([A-Za-z0-9_]+)/);

  expect(element).not.toBeNull();

  const name: string = element![1]!;
  const imported: RegExpMatchArray | null = routes.match(
    new RegExp(`import ${name} from "\\.\\./Pages/StatusPages/View/([^"]+)";`),
  );

  expect([name, imported !== null]).toEqual([name, true]);

  return `${imported![1]!}.tsx`;
}

function viewFiles(): Array<string> {
  return fs.readdirSync(VIEW_DIR).filter((file: string): boolean => {
    return file.endsWith(".tsx");
  });
}

// The View files a View file draws, by its imports.
function viewImports(file: string): Array<string> {
  return Array.from(
    read(path.join(VIEW_DIR, file)).matchAll(/from "\.\/([A-Za-z0-9_]+)";/g),
  ).map((match: RegExpMatchArray): string => {
    return `${match[1]!}.tsx`;
  });
}

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(read(path.join(LOCALES_DIR, `${code}.json`))) as Record<
    string,
    unknown
  >;
}

describe("the status page menu's Security section", () => {
  test("is Access, then the pages that only a private page reads", () => {
    expect(securityEntries()).toEqual([
      ACCESS_PAGE_MAP,
      ...PRIVATE_ONLY_PAGES.map((entry: { pageMap: string }): string => {
        return entry.pageMap;
      }),
    ]);
  });

  test.each(PRIVATE_ONLY_PAGES)(
    "$pageMap is drawn by $file",
    (entry: { pageMap: string; file: string }) => {
      expect(routedFile(entry.pageMap)).toBe(entry.file);
    },
  );
});

describe("each private-only page says so while the page is public", () => {
  test.each(PRIVATE_ONLY_PAGES)(
    "$file draws the notice, with who can see the page and its own words",
    (entry: { file: string; page: StatusPagePrivateOnlyPage }) => {
      const source: string = withoutComments(
        read(path.join(VIEW_DIR, entry.file)),
      );

      expect(source).toContain("<StatusPagePrivateOnlySettings");
      expect(source).toContain(
        `page={StatusPagePrivateOnlyPage.${entry.page}}`,
      );
      expect(source).toContain("useStatusPageAccess(");
      expect(source).toContain("access={accessRead.access}");
    },
  );

  test("every page that lists private users or sign-on providers is one of them, or drawn inside one", () => {
    const privateOnlyFiles: Array<string> = PRIVATE_ONLY_PAGES.map(
      (entry: { file: string }): string => {
        return entry.file;
      },
    );
    const drawnInside: Array<string> = privateOnlyFiles.flatMap(
      (file: string): Array<string> => {
        return viewImports(file);
      },
    );

    const unsaid: Array<string> = viewFiles().filter(
      (file: string): boolean => {
        const source: string = withoutComments(read(path.join(VIEW_DIR, file)));
        const listsPrivateOnly: boolean = PRIVATE_ONLY_MODELS.some(
          (model: string): boolean => {
            return source.includes(`modelType={${model}}`);
          },
        );

        return (
          listsPrivateOnly &&
          !privateOnlyFiles.includes(file) &&
          !drawnInside.includes(file)
        );
      },
    );

    expect(unsaid).toEqual([]);
    // The SAML and OIDC tabs are drawn inside the Single Sign-On page.
    expect(drawnInside).toEqual(
      expect.arrayContaining(["SSO.tsx", "OIDC.tsx"]),
    );
  });

  test("the SAML and OIDC tabs have no route of their own", () => {
    const routes: string = withoutComments(read(ROUTES_FILE));

    expect(routes).not.toContain('from "../Pages/StatusPages/View/SSO"');
    expect(routes).not.toContain('from "../Pages/StatusPages/View/OIDC"');
  });
});

describe("the notice", () => {
  test.each(STATUS_PAGE_ACCESS_CHOICES)(
    "shows for %s only when the page is public",
    (access: StatusPageAccess) => {
      expect(isStatusPagePublicNoticeShown(access)).toBe(
        access === StatusPageAccess.Anyone,
      );
    },
  );

  test("shows nothing before the page is read", () => {
    expect(isStatusPagePublicNoticeShown(undefined)).toBe(false);
  });

  test("says what is true and what to do, in one sentence", () => {
    expect(StatusPagePrivateOnlyCopy.publicNotice).toBe(
      "This status page is public, so these settings do nothing until you make it private.",
    );
  });

  test("names what each page folds", () => {
    for (const page of Object.values(StatusPagePrivateOnlyPage)) {
      expect(StatusPagePrivateOnlyCopy.foldSummary[page]).toBeTruthy();
    }
  });
});

describe("in every language", () => {
  const strings: Array<string> = [
    StatusPagePrivateOnlyCopy.publicNotice,
    StatusPagePrivateOnlyCopy.publicNoticeAction,
    StatusPagePrivateOnlyCopy.foldTitle,
    StatusPagePrivateOnlyCopy.foldDescription,
    ...Object.values(StatusPagePrivateOnlyCopy.foldSummary),
  ];

  /*
   * The menu's name for the page: German, Italian and Dutch write it as
   * English does, and list it as theirs (i18n/Progress), so it is only
   * required to be there.
   */
  const names: Array<string> = ["Single Sign-On"];

  const locales: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    });

  test("en.json maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const text of strings) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test.each(locales)("%s words every string its own way", (code: string) => {
    const locale: Record<string, unknown> = readLocale(code);

    for (const text of strings) {
      expect([text, typeof locale[text]]).toEqual([text, "string"]);
      expect([text, locale[text]]).not.toEqual([text, text]);
    }

    for (const text of names) {
      expect([text, typeof locale[text]]).toEqual([text, "string"]);
    }
  });
});
