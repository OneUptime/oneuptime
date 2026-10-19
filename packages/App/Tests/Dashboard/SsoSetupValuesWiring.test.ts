import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The values somebody pastes into an identity provider - a SAML provider's
 * Entity ID and Reply URL, an OIDC provider's redirect URI and identifier -
 * are drawn one row each with a button that copies it
 * (Common/UI/Components/CopyableValueList), in every place they are shown:
 * the setup dialogs of a project's and a status page's SAML and OIDC
 * providers in the Dashboard, and the Admin Dashboard's global providers.
 *
 * They were a bold "Name:" line over the value as plain text, with line
 * breaks between them and nothing to copy with. The jsdom suites
 * (SsoPages, GlobalSsoOidcPages, CopyableValueList) click the buttons; this
 * holds every place to the list, and the list's colours to the dark theme.
 */

const APP: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(APP, "FeatureSet", "Dashboard", "src");
const ADMIN_SRC: string = path.join(APP, "FeatureSet", "AdminDashboard", "src");
const COMMON: string = path.join(APP, "..", "Common");

const LIST: string = path.join(
  COMMON,
  "UI",
  "Components",
  "CopyableValueList",
  "CopyableValueList.tsx",
);

const THEME_CSS_PATH: string = path.join(COMMON, "UI", "Styles", "Theme.css");

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const WHITESPACE: RegExp = /\s+/g;

function codeOf(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
}

interface Place {
  name: string;
  file: string;
  labels: Array<string>;
}

const PLACES: Array<Place> = [
  {
    name: "a project's SAML providers (Settings > SSO)",
    file: path.join(DASHBOARD_SRC, "Pages", "Settings", "SSO.tsx"),
    labels: [
      "Identifier (Entity ID):",
      "Reply URL (Assertion Consumer Service URL):",
    ],
  },
  {
    name: "a project's OIDC providers (Settings > SSO)",
    file: path.join(DASHBOARD_SRC, "Components", "Sso", "ProjectOidcProviders.tsx"),
    labels: ["Redirect URI (Callback URL):", "Identifier (audience):"],
  },
  {
    name: "a status page's SAML providers",
    file: path.join(DASHBOARD_SRC, "Pages", "StatusPages", "View", "SSO.tsx"),
    labels: [
      "Identifier (Entity ID):",
      "Reply URL (Assertion Consumer Service URL):",
    ],
  },
  {
    name: "a status page's OIDC providers",
    file: path.join(DASHBOARD_SRC, "Pages", "StatusPages", "View", "OIDC.tsx"),
    labels: ["Redirect URI (Callback URL):", "Identifier (audience):"],
  },
  {
    name: "a global SAML provider (Admin Dashboard)",
    file: path.join(ADMIN_SRC, "Pages", "Settings", "GlobalSSO", "View.tsx"),
    labels: [
      "ACS URL (Assertion Consumer Service / Reply URL):",
      "Issuer (Entity ID):",
    ],
  },
  {
    name: "a global OIDC provider (Admin Dashboard)",
    file: path.join(ADMIN_SRC, "Pages", "Settings", "GlobalOIDC", "View.tsx"),
    labels: ["Redirect URI (Callback URL):"],
  },
];

describe("every place an identity provider's values are shown", () => {
  test.each(PLACES)(
    "$name draws them one row each, with a button that copies it",
    (place: Place) => {
      const code: string = codeOf(place.file);

      expect(code).toContain(
        'import CopyableValueList from "Common/UI/Components/CopyableValueList/CopyableValueList";',
      );
      expect(code).toContain("<CopyableValueList");

      for (const label of place.labels) {
        // Each label is a row's name, in the order the provider asks.
        expect([label, code.includes(`label: "${label}"`)]).toEqual([
          label,
          true,
        ]);

        // Not a bold line of its own over plain text any more.
        expect([
          label,
          code.includes(`translator.translateText("${label}")`),
        ]).toEqual([label, false]);
        expect([
          label,
          code.includes(`<div className="font-semibold">${label}</div>`),
        ]).toEqual([label, false]);
      }

      // No line breaks standing in for spacing between the values.
      expect(code).not.toContain("<br />");
    },
  );

  test("the labels come in the order each provider asks for them", () => {
    for (const place of PLACES) {
      const code: string = codeOf(place.file);
      const positions: Array<number> = place.labels.map(
        (label: string): number => {
          return code.indexOf(`label: "${label}"`);
        },
      );

      expect([place.name, [...positions].sort((a: number, b: number) => {
        return a - b;
      })]).toEqual([place.name, positions]);
    }
  });
});

describe("the list in the dark theme", () => {
  const THEME_CSS: string = fs
    .readFileSync(THEME_CSS_PATH, "utf8")
    .replace(BLOCK_COMMENT, " ");

  const STRING_LITERAL: RegExp = /"([^"\n]*)"|`([^`]*)`/g;
  const COLOR_UTILITY: RegExp =
    /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;
  const IDENTIFIER_CHAR: RegExp = /[\w-]/;

  function isRemapped(token: string): boolean {
    if (THEME_CSS.includes(`[class~="${token}"]`)) {
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
    .readFileSync(LIST, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ");

  const tokens: Array<string> = Array.from(
    new Set(
      Array.from(code.matchAll(STRING_LITERAL))
        .flatMap((match: RegExpMatchArray): Array<string> => {
          return (match[1] ?? match[2] ?? "").split(WHITESPACE);
        })
        .filter((token: string): boolean => {
          return COLOR_UTILITY.test(token.slice(token.lastIndexOf(":") + 1));
        }),
    ),
  );

  test("no dark: variants, and every colour class remapped", () => {
    expect(code).not.toContain("dark:");
    expect(tokens).toEqual(
      expect.arrayContaining([
        "divide-gray-200",
        "border-gray-200",
        "text-gray-500",
        "text-gray-900",
      ]),
    );
    expect(
      tokens.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });
});
