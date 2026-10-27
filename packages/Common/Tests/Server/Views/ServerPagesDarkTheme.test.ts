import { describe, expect, it, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";
import {
  BrandAssetsPath,
  OneUptimeDarkLogoUrl,
  OneUptimeLogoUrl,
} from "../../../Server/Utils/VendorAssets";

/*
 * The pages the server draws itself on the way in - acknowledging an
 * on-call page from a text message at three in the morning, passing it on,
 * a message after either; a single sign-on that did not work, or that asks
 * to be confirmed - in the person's theme. They have no app of their own:
 * the theme partial (Partials/Theme.ejs, ThemeBeforeFirstPaint.test.ts)
 * draws the dark class on <html>, and each colour on the page has its dark
 * partner as a Tailwind dark: class beside it (the pages' Tailwind is told
 * the dark theme is that class). A colour without one would be a white card
 * or dark words on the dark page.
 *
 * The logo is the one made for the page's theme: OneUptime's wordmark in
 * light letters on a dark page, an installation's own logo for dark
 * backgrounds when it has one, and its only logo on a small light plate
 * when it does not.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..", "..");
const COMMON_VIEWS: string = path.join(PACKAGES, "Common", "Server", "Views");
const IDENTITY_VIEWS: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Identity",
  "Views",
);

const SERVER_PAGE_FILES: Array<string> = [
  path.join(COMMON_VIEWS, "AcknowledgeUserOnCallNotification.ejs"),
  path.join(COMMON_VIEWS, "PassOnUserOnCallNotification.ejs"),
  path.join(COMMON_VIEWS, "ViewMessage.ejs"),
  path.join(COMMON_VIEWS, "Partials", "OnCallNotificationDetails.ejs"),
  path.join(COMMON_VIEWS, "Partials", "OnCallPassOnForm.ejs"),
  path.join(COMMON_VIEWS, "Partials", "OnCallPassOnWarning.ejs"),
  path.join(COMMON_VIEWS, "Partials", "ProductLogo.ejs"),
  path.join(IDENTITY_VIEWS, "Message.ejs"),
  path.join(IDENTITY_VIEWS, "SsoSignInConfirmation.ejs"),
];

const HEADS: Array<string> = [
  path.join(COMMON_VIEWS, "Partials", "Head.ejs"),
  path.join(IDENTITY_VIEWS, "Partials", "Head.ejs"),
];

const CLASS_ATTRIBUTE: RegExp = /class="([^"<>]*)"/g;

const COLOUR_NAMES: string =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

// A light colour class: no dark: variant in it.
const LIGHT_COLOUR: RegExp = new RegExp(
  `^(?:(?!dark:)[a-z-]+:)*(?:bg|text|border|ring|ring-offset|divide|placeholder)-(?:white|black|(?:${COLOUR_NAMES})-\\d{2,3})(?:/\\d{1,3})?$`,
);

/*
 * Reads the same on a light and a dark card: a mid-tone hue's fill, ring
 * or border (the acknowledge button's yellow, the confirmation's indigo),
 * and white words on such a fill.
 */
const SAME_IN_BOTH_THEMES: RegExp =
  /^(?:[a-z-]+:)*(?:(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600|700)|text-white)$/;

const WHITESPACE: RegExp = /\s+/;

// The dark partner a light class needs beside it: dark: plus the same variants.
const darkPartnerPrefix: (token: string) => string = (
  token: string,
): string => {
  const parts: Array<string> = token.split(":");
  const utility: string = parts.pop() as string;
  const kind: string = utility.slice(0, utility.indexOf("-", 1));

  return `dark:${parts.map((part: string): string => {
    return `${part}:`;
  }).join("")}${kind}-`;
};

const render: (view: string, variables: Record<string, unknown>) => string = (
  view: string,
  variables: Record<string, unknown>,
): string => {
  return ejs.render(fs.readFileSync(view, "utf8"), variables, {
    filename: view,
  });
};

const LOGO: string = path.join(COMMON_VIEWS, "Partials", "ProductLogo.ejs");

describe("every colour on the server's own pages", () => {
  test.each(
    SERVER_PAGE_FILES.map((file: string): [string, string] => {
      return [path.relative(PACKAGES, file), file];
    }),
  )("%s has its dark partner beside it", (_name: string, file: string) => {
    const source: string = fs.readFileSync(file, "utf8");
    const missing: Array<string> = [];
    let lightColours: number = 0;

    for (const match of source.matchAll(CLASS_ATTRIBUTE)) {
      const tokens: Array<string> = (match[1] as string)
        .split(WHITESPACE)
        .filter((token: string): boolean => {
          return token.length > 0;
        });

      for (const token of tokens) {
        if (!LIGHT_COLOUR.test(token) || SAME_IN_BOTH_THEMES.test(token)) {
          continue;
        }

        lightColours++;

        const prefix: string = darkPartnerPrefix(token);

        if (
          !tokens.some((candidate: string): boolean => {
            return candidate.startsWith(prefix);
          })
        ) {
          missing.push(`${token} in: ${match[1]}`);
        }
      }
    }

    expect(missing).toEqual([]);
    // The partials with a colour at all: OnCallPassOnForm and the rest.
    expect(lightColours).toBeGreaterThan(0);
  });

  test("the heads tell Tailwind the dark theme is the dark class, and include the theme partial following changes", () => {
    for (const head of HEADS) {
      const source: string = fs.readFileSync(head, "utf8");

      expect(source).toContain('tailwind.config = { darkMode: "class" };');
      expect(source).toContain("Theme', { followChanges: true }) -%>");
      expect(source).not.toContain('<meta name="theme-color" content="#000000">');
    }
  });

  test("the page's ground is the dark page's, and its cards a surface above it", () => {
    for (const view of [
      "AcknowledgeUserOnCallNotification.ejs",
      "PassOnUserOnCallNotification.ejs",
      "ViewMessage.ejs",
    ]) {
      const source: string = fs.readFileSync(
        path.join(COMMON_VIEWS, view),
        "utf8",
      );

      expect(source).toContain('<body class="bg-gray-100 dark:bg-slate-900">');
      expect(source).toContain('class="bg-white dark:bg-slate-800 ');
    }
  });

  test("the strongest button stays the strongest: the dark one turns light", () => {
    const form: string = fs.readFileSync(
      path.join(COMMON_VIEWS, "Partials", "OnCallPassOnForm.ejs"),
      "utf8",
    );

    expect(form).toContain(
      "text-white dark:text-slate-900 bg-gray-900 dark:bg-slate-100 hover:bg-gray-800 dark:hover:bg-white",
    );
  });
});

describe("the logo", () => {
  it("is OneUptime's wordmark for each theme, the other one hidden before the first paint", () => {
    const html: string = render(LOGO, {});

    expect(html).toContain(
      `data-theme-only="light" src="${OneUptimeLogoUrl}" alt="OneUptime"`,
    );
    expect(html).toContain(
      `data-theme-only="dark" src="${OneUptimeDarkLogoUrl}" alt="OneUptime"`,
    );
  });

  it("is the installation's logo for each theme, when it has both", () => {
    const html: string = render(LOGO, {
      productName: "Acme",
      productLogoUrl: "/api/branding/logo?v=1",
      productDarkLogoUrl: "/api/branding/dark-logo?v=1",
    });

    expect(html).toContain(
      'data-theme-only="light" src="/api/branding/logo?v=1" alt="Acme"',
    );
    expect(html).toContain(
      'data-theme-only="dark" src="/api/branding/dark-logo?v=1" alt="Acme"',
    );
    expect(html).not.toContain("dark:bg-slate-50");
  });

  it("is the installation's only logo on a light plate while the page is dark", () => {
    const html: string = render(LOGO, {
      productName: "Acme",
      productLogoUrl: "/api/branding/logo?v=1",
    });

    expect(html.split("<img").length - 1).toBe(1);
    expect(html).not.toContain("data-theme-only");
    expect(html).toContain("dark:rounded-lg dark:bg-slate-50");
  });

  it("is the installation's name in light words on a dark page, when it has no logo", () => {
    const html: string = render(LOGO, { productName: "Acme" });

    expect(html).toContain("text-gray-900 dark:text-slate-50");
    expect(html).not.toContain("<img");
  });

  it("escapes what it is handed", () => {
    const html: string = render(LOGO, {
      productName: 'Acme "Q"',
      productLogoUrl: '/logo"onerror="x()',
      productDarkLogoUrl: '/dark"onerror="x()',
    });

    expect(html).not.toContain('onerror="x()');
  });
});

describe("OneUptime's wordmark for a dark page", () => {
  const light: string = fs.readFileSync(
    path.join(BrandAssetsPath, "oneuptime-logo.svg"),
    "utf8",
  );
  const dark: string = fs.readFileSync(
    path.join(BrandAssetsPath, "oneuptime-logo-dark.svg"),
    "utf8",
  );

  it("is served beside the light one", () => {
    expect(OneUptimeDarkLogoUrl).toBe(
      "/oneuptime-assets/brand/oneuptime-logo-dark.svg",
    );
  });

  it("is exactly the light one with its dark letters light, as the apps' ProductLogo recolours it", () => {
    expect(light.split("#121212").length - 1).toBeGreaterThan(0);
    expect(dark).toBe(light.split("#121212").join("#f8fafc"));
    expect(dark).not.toContain("#121212");
    // The green mark is the same on both.
    expect(dark).toContain("#7ed957");
  });
});
