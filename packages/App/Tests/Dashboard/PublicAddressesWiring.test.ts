import {
  STATUS_PAGE_EXAMPLE_DOMAIN,
  STATUS_PAGE_LINK_ACCESS_TEST_ID,
  StatusPageOverviewCopy,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageOverviewCopy";
import PublicAddressCopy from "../../FeatureSet/Dashboard/src/Components/CustomDomain/PublicAddressCopy";
import DashboardSharingCopy, {
  DASHBOARD_EXAMPLE_DOMAIN,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Sharing/DashboardSharingCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Where do visitors find my status page?" - on its Overview, the Status
 * Page Link card, and under a dashboard's public choice on its Sharing page:
 * every address it answers at, custom domains first, drawn by one component
 * (Components/CustomDomain/PublicAddresses) so both read alike.
 *
 * The App suite runs in plain Node and cannot render dashboard pages, so
 * these read the sources and the locale files: both cards draw the list,
 * with their own custom domains, Custom Domains page and example; the status
 * page card says when visitors sign in or enter a password, by the rule the
 * server enforces; every new sentence is translated in all sixteen
 * languages and the sentences the cards no longer draw are gone; and the
 * card's own colours hold in the dark theme. The cards themselves are
 * rendered in Common/Tests/App/Dashboard (PublicAddresses,
 * StatusPageCreateAndOverview, DashboardSharingCard), and drawn in Chromium
 * by the offline suite packages/E2E/PublicAddresses.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const STATUS_PAGE_CARD: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "StatusPages",
  "View",
  "StatusPagePreviewLink.tsx",
);

const STATUS_PAGE_OVERVIEW: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "StatusPages",
  "View",
  "Index.tsx",
);

const DASHBOARD_CARD: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Dashboard",
  "Sharing",
  "DashboardSharingCard.tsx",
);

const PUBLIC_ADDRESSES: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "CustomDomain",
  "PublicAddresses.tsx",
);

const THEME_CSS_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Styles",
  "Theme.css",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const WHITESPACE: RegExp = /\s+/g;

// The code of a module, without its comments, on one line.
function codeOf(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
}

type Locale = Record<string, unknown>;

const locales: Record<string, Locale> = {};

for (const file of fs.readdirSync(LOCALES_DIR).sort()) {
  if (file.endsWith(".json")) {
    locales[file.replace(".json", "")] = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Locale;
  }
}

const NON_ENGLISH: Array<string> = Object.keys(locales).filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

describe("the status page's Overview", () => {
  const card: string = codeOf(STATUS_PAGE_CARD);
  const overview: string = codeOf(STATUS_PAGE_OVERVIEW);

  test("the link card stays second, after the first step and before the details", () => {
    expect(overview.indexOf("<StatusPageFirstStep")).toBeGreaterThan(-1);
    expect(overview.indexOf("<StatusPageFirstStep")).toBeLessThan(
      overview.indexOf("<StatusPagePreviewLink"),
    );
    expect(overview.indexOf("<StatusPagePreviewLink")).toBeLessThan(
      overview.indexOf("<CardModelDetail<StatusPage>"),
    );
  });

  test("its card lists the page's custom domains, then its OneUptime address, adding a domain on its Custom Domains page", () => {
    expect(card).toContain("title={StatusPageOverviewCopy.linkCardTitle}");
    expect(card).toContain(
      "description={StatusPageOverviewCopy.linkCardDescription}",
    );
    expect(card).toContain("<PublicAddresses");
    expect(card).toContain("kind={STATUS_PAGE_CUSTOM_DOMAINS}");
    expect(card).toContain("parentId={props.modelId}");
    expect(card).toContain(
      "`${STATUS_PAGE_URL.toString()}/${modelIdString}`",
    );
    expect(card).toContain("PageMap.STATUS_PAGE_VIEW_DOMAINS");
    expect(card).toContain("exampleDomain={STATUS_PAGE_EXAMPLE_DOMAIN}");
    expect(card).toContain("note={accessNote}");
  });

  test("it says who can see the page by the rule the server enforces, read the Access page's way", () => {
    expect(card).toContain("select: getStatusPageAccessSelect()");
    expect(card).toContain(
      "getStatusPageAccess(getStatusPageAccessState(statusPage))",
    );
    expect(card).toContain(
      "access === StatusPageAccess.SignIn ? StatusPageOverviewCopy.linkCardSignInRequired",
    );
    expect(card).toContain(
      "access === StatusPageAccess.Password ? StatusPageOverviewCopy.linkCardPasswordRequired",
    );
    // Change access opens the Access page (its address is the old one).
    expect(card).toContain("PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS");
    expect(card).toContain(
      "data-testid={STATUS_PAGE_LINK_ACCESS_TEST_ID}",
    );
    expect(STATUS_PAGE_LINK_ACCESS_TEST_ID).toBe("status-page-link-access");
    // A public page needs no line, and the card never names the columns.
    expect(card).not.toContain("StatusPageAccess.Anyone");
    expect(card).not.toContain("isPublicStatusPage");
  });

  test("its words: a plain title and a sentence saying what the card is for", () => {
    expect(StatusPageOverviewCopy.linkCardTitle).toBe("Status Page Link");
    expect(StatusPageOverviewCopy.linkCardDescription).toBe(
      "Where visitors find your status page.",
    );
    expect(StatusPageOverviewCopy.linkCardSignInRequired).toBe(
      "Visitors sign in to see this status page.",
    );
    expect(StatusPageOverviewCopy.linkCardPasswordRequired).toBe(
      "Visitors enter the password to see this status page.",
    );
    expect(StatusPageOverviewCopy.linkCardChangeAccess).toBe("Change access");
  });
});

describe("a dashboard's Sharing page", () => {
  const card: string = codeOf(DASHBOARD_CARD);

  test("lists the dashboard's custom domains, then its public link, under the public choice in force", () => {
    expect(card).toContain("<PublicAddresses");
    expect(card).toContain("kind={DASHBOARD_CUSTOM_DOMAINS}");
    expect(card).toContain("parentId={props.dashboardId}");
    expect(card).toContain(
      "oneUptimeUrl={getPublicDashboardUrl(props.dashboardId)}",
    );
    expect(card).toContain("PageMap.DASHBOARD_VIEW_CUSTOM_DOMAINS");
    expect(card).toContain("exampleDomain={DASHBOARD_EXAMPLE_DOMAIN}");

    // Only under the public choice in force: a private dashboard has none.
    expect(card).toContain(
      'if (isCurrent && access !== DashboardAccess.ProjectOnly) { details = ( <div className="space-y-3"> {getPublicLink()}',
    );
  });

  test("draws no link or copy button of its own any more", () => {
    expect(card).not.toContain("<CopyTextButton");
    expect(card).not.toContain("<Link");
    expect(card).not.toContain("font-mono");
    expect(
      (DashboardSharingCopy as unknown as Record<string, unknown>)[
        "publicLinkTitle"
      ],
    ).toBeUndefined();
    expect(
      (DashboardSharingCopy as unknown as Record<string, unknown>)[
        "copyLinkTitle"
      ],
    ).toBeUndefined();
  });
});

describe("the list both cards draw", () => {
  const list: string = codeOf(PUBLIC_ADDRESSES);

  test("reads the page's custom domains by its own column, in this project, only for whoever may read them", () => {
    expect(list).toContain("ModelAPI.getList<CustomDomainModel>");
    expect(list).toContain("[kind.parentColumn]: props.parentId");
    expect(list).toContain("projectId: ProjectUtil.getCurrentProjectId()!");
    expect(list).toContain(
      "!PermissionGate.check(domainModel, ModelAction.Read).isAllowed && PermissionGate.hasPermissionSnapshot()",
    );
  });

  test("offers to add a domain only to whoever may add one, where the installation serves custom domains", () => {
    expect(list).toContain(
      "loadState === LoadState.Loaded && domains.length === 0 && Boolean(kind.getCnameRecord()) && PermissionGate.check(domainModel, ModelAction.Create).isAllowed",
    );
  });

  test("opens DNS Setup - the Custom Domains page's own dialog - with Check now for whoever may edit the domain", () => {
    expect(list).toContain("<CustomDomainDnsSetupModal");
    expect(list).toContain(
      "checkNowGate={PermissionGate.check(domainModel, ModelAction.Update)}",
    );
    expect(list).toContain("void readDomains({ isQuiet: true });");
  });

  test("each card names a reserved example domain, never somebody's real one", () => {
    expect(STATUS_PAGE_EXAMPLE_DOMAIN).toBe("status.example.com");
    expect(DASHBOARD_EXAMPLE_DOMAIN).toBe("dashboard.example.com");
  });
});

describe("the words, in every language", () => {
  // Every sentence and name the two cards and their list draw that is new.
  const NEW_KEYS: Array<string> = [
    StatusPageOverviewCopy.linkCardDescription,
    StatusPageOverviewCopy.linkCardSignInRequired,
    StatusPageOverviewCopy.linkCardPasswordRequired,
    PublicAddressCopy.customDomain,
    PublicAddressCopy.oneUptimeAddress,
    PublicAddressCopy.notLiveYet,
    PublicAddressCopy.copyLinkTo,
    PublicAddressCopy.addCustomDomainSentence,
    PublicAddressCopy.addCustomDomainLink,
    PublicAddressCopy.loadError,
    PublicAddressCopy.listLabel,
    PublicAddressCopy.loading,
  ];

  // Drawn already elsewhere, so translated already.
  const KEPT_KEYS: Array<string> = [
    StatusPageOverviewCopy.linkCardTitle,
    StatusPageOverviewCopy.linkCardChangeAccess,
    PublicAddressCopy.copyLink,
    PublicAddressCopy.copied,
    PublicAddressCopy.opensInNewTab,
    PublicAddressCopy.tryAgain,
    "DNS Setup",
  ];

  // The sentences the cards no longer draw.
  const GONE_KEYS: Array<string> = [
    "Open it to see your status page as visitors do.",
    "Public link",
    "Copy the public link",
  ];

  const PLACEHOLDER: RegExp = /\{\{\w+\}\}/g;

  function placeholdersOf(text: string): Array<string> {
    return (text.match(PLACEHOLDER) || []).sort();
  }

  test("seventeen locale files are read", () => {
    expect(Object.keys(locales)).toHaveLength(17);
  });

  test.each(NEW_KEYS)("%s is in every locale file", (key: string) => {
    for (const code of Object.keys(locales)) {
      expect([code, typeof locales[code]![key]]).toEqual([code, "string"]);
    }

    expect(locales["en"]![key]).toBe(key);
  });

  test.each(NEW_KEYS)(
    "%s is translated in all sixteen languages, with its values kept",
    (key: string) => {
      for (const code of NON_ENGLISH) {
        const value: string = locales[code]![key] as string;

        expect([code, value === key]).toEqual([code, false]);
        expect([code, placeholdersOf(value)]).toEqual([
          code,
          placeholdersOf(key),
        ]);
      }
    },
  );

  test.each(KEPT_KEYS)("%s was translated already", (key: string) => {
    for (const code of NON_ENGLISH) {
      expect([code, typeof locales[code]![key]]).toEqual([code, "string"]);
      expect([code, locales[code]![key] === key]).toEqual([code, false]);
    }
  });

  test.each(GONE_KEYS)("%s is gone from every locale file", (key: string) => {
    for (const code of Object.keys(locales)) {
      expect([code, key in locales[code]!]).toEqual([code, false]);
    }
  });

  test("the OneUptime address keeps the product's name in every language", () => {
    for (const code of Object.keys(locales)) {
      expect([
        code,
        (locales[code]![PublicAddressCopy.oneUptimeAddress] as string).includes(
          "OneUptime",
        ),
      ]).toEqual([code, true]);
    }
  });
});

/*
 * The card's own markup in the dark theme (the list's is held by
 * CustomDomainDarkMode, which reads every module of Components/CustomDomain):
 * the dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class, or for a
 * family of colours by prefix. A class it has no rule for keeps its light
 * colour in the dark theme, and nothing fails.
 */
describe("the status page's link card in the dark theme", () => {
  const THEME_CSS: string = fs
    .readFileSync(THEME_CSS_PATH, "utf8")
    .replace(BLOCK_COMMENT, " ");

  const STRING_LITERAL: RegExp = /"([^"\n]*)"|`([^`]*)`/g;
  const TEMPLATE_HOLE: RegExp = /\$\{[^}]*\}/g;
  const COLOR_UTILITY: RegExp =
    /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;
  const PREFIX_RULE: RegExp = /\[class\*="([^"]+)"\]/g;
  const IDENTIFIER_CHAR: RegExp = /[\w-]/;

  const prefixes: Array<string> = Array.from(
    THEME_CSS.matchAll(PREFIX_RULE),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  ).filter((prefix: string): boolean => {
    return prefix.includes(":");
  });

  function utilityOf(token: string): string {
    return token.slice(token.lastIndexOf(":") + 1);
  }

  function isRemapped(token: string): boolean {
    if (THEME_CSS.includes(`[class~="${token}"]`)) {
      return true;
    }

    if (
      prefixes.some((prefix: string): boolean => {
        return token.startsWith(prefix);
      })
    ) {
      return true;
    }

    const escaped: string = token.split(":").join("\\:");
    let from: number = THEME_CSS.indexOf(`.${escaped}`);

    while (from !== -1) {
      const next: string = THEME_CSS[from + escaped.length + 1] || " ";

      if (!IDENTIFIER_CHAR.test(next)) {
        return true;
      }

      from = THEME_CSS.indexOf(`.${escaped}`, from + 1);
    }

    return false;
  }

  const code: string = fs
    .readFileSync(STATUS_PAGE_CARD, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ");

  const colorTokens: Array<string> = Array.from(
    new Set(
      Array.from(code.matchAll(STRING_LITERAL))
        .flatMap((match: RegExpMatchArray): Array<string> => {
          return (match[1] ?? match[2] ?? "")
            .replace(TEMPLATE_HOLE, " ")
            .split(WHITESPACE);
        })
        .filter((token: string): boolean => {
          return COLOR_UTILITY.test(utilityOf(token));
        }),
    ),
  );

  test("no dark: variants", () => {
    expect(code).not.toContain("dark:");
  });

  test("every colour class of the card is remapped for dark mode", () => {
    // The access line and its link were found at all.
    expect(colorTokens).toEqual(
      expect.arrayContaining([
        "text-gray-500",
        "text-gray-400",
        "text-indigo-600",
        "hover:text-indigo-700",
      ]),
    );

    expect(
      colorTokens.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });

  test("the check itself tells a remapped class from one that is not", () => {
    expect(isRemapped("text-gray-500")).toBe(true);
    expect(isRemapped("hover:text-indigo-700")).toBe(true);
    expect(isRemapped("text-lime-950")).toBe(false);
  });
});
