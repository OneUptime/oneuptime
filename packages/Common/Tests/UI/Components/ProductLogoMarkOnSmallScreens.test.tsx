import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * THE DASHBOARD HEADER'S LOGO ON A PHONE (#7236).
 *
 * OneUptime's wordmark is a 5:1 letterbox: at the header's 24px it is
 * 120px wide, a third of a 375px phone, and the project picker beside it -
 * the header's one entry that gives way - was left the first letter of the
 * project's name. Below sm the Dashboard's header now draws the product's
 * mark (OneUptime's "Up" square, the browser tab's icon; an installation's
 * own tab icon in place of its own logo) as one image whose source the
 * browser picks by the screen's width: <picture> with a <source> for small
 * screens, the logo itself the <img>. Everywhere else the product shows
 * itself - the Admin Dashboard's header, the sign-in pages - is unchanged.
 *
 * Jest hands every .svg the same stand-in, so the mark and the wordmark are
 * told apart here by the files themselves (read from disk below) and in a
 * browser by the offline header suite (HeaderOnPhones.spec.ts), which reads
 * the image the browser drew at each width.
 */

/*
 * Every .svg import as esbuild hands it to the components: a data: URL,
 * with the dark text the dark theme recolours and the mark's green.
 */
jest.mock("../../../UI/Images/logos/OneUptimeSVG/3-transparent.svg", () => {
  return `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#121212"/><rect fill="#7ed957"/></svg>',
  ).toString("base64")}`;
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

import ProductLogo, {
  getDarkThemeLogo,
  getProductLogoSource,
  getProductMarkSource,
  SMALL_SCREEN_MEDIA_QUERY,
} from "../../../UI/Components/ProductLogo/ProductLogo";
import ThemeUtil, { Theme } from "../../../UI/Utils/Theme";
import AdminDashboardLogo from "../../../../App/FeatureSet/AdminDashboard/src/Components/Header/Logo";
import DashboardLogo, {
  HEADER_LOGO_CLASS_NAME,
  HEADER_PRODUCT_NAME_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Logo";
import { TAILWIND_BREAKPOINTS_IN_PX } from "../../ResponsiveVisibility";

const LOGOS_DIR: string = path.resolve(
  __dirname,
  "../../../UI/Images/logos/OneUptimeSVG",
);

const ACME_WITH_EVERYTHING: string = JSON.stringify({
  productName: "Acme",
  logoUrl: "/api/branding/logo?v=1",
  darkLogoUrl: "/api/branding/dark-logo?v=1",
  faviconUrl: "/api/branding/favicon?v=1",
});

const ACME_LOGO_NO_TAB_ICON: string = JSON.stringify({
  productName: "Acme",
  logoUrl: "/api/branding/logo?v=1",
});

const ACME_NAME_ONLY: string = JSON.stringify({ productName: "Acme" });

function setBranding(value: string | null): void {
  const browserWindow: { process?: { env?: Record<string, unknown> } } =
    window as unknown as { process?: { env?: Record<string, unknown> } };

  browserWindow.process = browserWindow.process || {};
  browserWindow.process.env = browserWindow.process.env || {};

  if (value === null) {
    delete browserWindow.process.env["PRODUCT_BRANDING"];
  } else {
    browserWindow.process.env["PRODUCT_BRANDING"] = value;
  }
}

function setTheme(theme: Theme): void {
  act(() => {
    ThemeUtil.setTheme(theme);
  });
}

// The <source> a small screen draws, or null when the logo is drawn at every width.
function smallScreenSource(container: HTMLElement): HTMLSourceElement | null {
  return container.querySelector("picture > source");
}

function decode(dataUrl: string): string {
  return Buffer.from(dataUrl.split("base64,")[1]!, "base64").toString("utf8");
}

// The SVG's viewBox as width / height.
function aspectOf(file: string): number {
  const svg: string = fs.readFileSync(path.join(LOGOS_DIR, file), "utf8");
  const viewBox: RegExpMatchArray | null = svg.match(/viewBox="([^"]+)"/);
  const [, , width, height] = viewBox![1]!.trim().split(/\s+/).map(Number);
  return width! / height!;
}

afterEach(() => {
  cleanup();
  setBranding(null);
  ThemeUtil.setTheme(Theme.Light);
});

describe("the mark a small screen draws", () => {
  test("small means below Tailwind's sm, as the header's own classes say it (max-sm)", () => {
    expect(SMALL_SCREEN_MEDIA_QUERY).toBe(
      `not all and (min-width: ${TAILWIND_BREAKPOINTS_IN_PX["sm"]}px)`,
    );
  });

  test("OneUptime's mark is its own cropped file: about as tall as it is wide, where the wordmark is 5:1", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../UI/Components/ProductLogo/ProductLogo.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      'import OneUptimeMark from "../../Images/logos/OneUptimeSVG/mark-transparent.svg";',
    );
    expect(aspectOf("3-transparent.svg")).toBeGreaterThan(4.5);
    expect(aspectOf("mark-transparent.svg")).toBeLessThan(2);
    expect(aspectOf("mark-transparent.svg")).toBeGreaterThan(1.2);
  });

  test("the mark's file is the tab icon's Up and green square, on a transparent ground, with nothing it fetches", () => {
    const svg: string = fs.readFileSync(
      path.join(LOGOS_DIR, "mark-transparent.svg"),
      "utf8",
    );

    expect(svg).toContain('fill="#121212"');
    expect(svg).toContain('fill="#7ed957"');
    // No background rectangle: it sits on the header's own colour.
    expect(svg).not.toMatch(/fill="#(?:fff|ffffff)"/i);
    expect(svg).not.toMatch(/<(?:text|image|script|foreignObject)\b/);
    expect(svg).not.toMatch(/href="(?:https?:)?\/\//);
    expect(svg.length).toBeLessThan(8 * 1024);
  });

  test("in the dark theme the mark's dark letters are recoloured, as the wordmark's are, and its green kept", () => {
    const svg: string = fs.readFileSync(
      path.join(LOGOS_DIR, "mark-transparent.svg"),
      "utf8",
    );
    const dataUrl: string = `data:image/svg+xml;base64,${Buffer.from(
      svg,
    ).toString("base64")}`;

    const dark: string = decode(getDarkThemeLogo(dataUrl));

    expect(dark).not.toContain("#121212");
    expect(dark).toContain('fill="#f8fafc"');
    expect(dark).toContain('fill="#7ed957"');
  });

  test("OneUptime's: the mark, recoloured in the dark theme", () => {
    expect(getProductMarkSource(Theme.Light)).toMatch(/^data:image\/svg\+xml/);
    expect(decode(getProductMarkSource(Theme.Light)!)).toContain("#121212");
    expect(decode(getProductMarkSource(Theme.Dark)!)).toContain("#f8fafc");
    expect(decode(getProductMarkSource(Theme.Dark)!)).toContain("#7ed957");
  });

  test("an installation's own logo: its own tab icon, in both themes", () => {
    setBranding(ACME_WITH_EVERYTHING);

    expect(getProductMarkSource(Theme.Light)).toBe("/api/branding/favicon?v=1");
    expect(getProductMarkSource(Theme.Dark)).toBe("/api/branding/favicon?v=1");
  });

  test("an installation's logo without a tab icon, or a name and no logo: no mark", () => {
    setBranding(ACME_LOGO_NO_TAB_ICON);
    expect(getProductMarkSource(Theme.Light)).toBeNull();
    expect(getProductMarkSource(Theme.Dark)).toBeNull();

    setBranding(ACME_NAME_ONLY);
    expect(getProductMarkSource(Theme.Light)).toBeNull();
  });
});

describe("a logo that asks for the mark on small screens", () => {
  test("is one image, named for the product: the logo from sm, the mark below it", () => {
    const { container } = render(
      <ProductLogo className="logo" markOnSmallScreens={true} />,
    );

    const images: Array<HTMLElement> = screen.getAllByRole("img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("alt", "OneUptime");
    expect(images[0]).toHaveAttribute(
      "src",
      getProductLogoSource(Theme.Light)!,
    );
    expect(images[0]!.parentElement!.tagName).toBe("PICTURE");

    const source: HTMLSourceElement = smallScreenSource(container)!;
    expect(source).toHaveAttribute("media", SMALL_SCREEN_MEDIA_QUERY);
    expect(source).toHaveAttribute(
      "srcset",
      getProductMarkSource(Theme.Light)!,
    );
    // The <source> comes first: the browser takes the first that matches.
    expect(source.nextElementSibling).toBe(images[0]);
  });

  test("in the dark theme, the dark wordmark and the dark mark", () => {
    setTheme(Theme.Dark);

    const { container } = render(
      <ProductLogo className="logo" markOnSmallScreens={true} />,
    );

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      getProductLogoSource(Theme.Dark)!,
    );
    expect(smallScreenSource(container)).toHaveAttribute(
      "srcset",
      getProductMarkSource(Theme.Dark)!,
    );
    expect(
      decode(smallScreenSource(container)!.getAttribute("srcset")!),
    ).toContain("#f8fafc");
  });

  test("follows a theme switched while it is drawn", () => {
    const { container } = render(
      <ProductLogo className="logo" markOnSmallScreens={true} />,
    );

    setTheme(Theme.Dark);

    expect(smallScreenSource(container)).toHaveAttribute(
      "srcset",
      getProductMarkSource(Theme.Dark)!,
    );
  });

  test("an installation's logo: its tab icon below sm, its logo (dark one in the dark theme) from sm", () => {
    setBranding(ACME_WITH_EVERYTHING);
    setTheme(Theme.Dark);

    const { container } = render(
      <ProductLogo className="logo" markOnSmallScreens={true} />,
    );

    expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute(
      "src",
      "/api/branding/dark-logo?v=1",
    );
    expect(smallScreenSource(container)).toHaveAttribute(
      "srcset",
      "/api/branding/favicon?v=1",
    );
  });

  test("an installation's logo without a tab icon is drawn as it is, at every width", () => {
    setBranding(ACME_LOGO_NO_TAB_ICON);

    const { container } = render(
      <ProductLogo className="logo" markOnSmallScreens={true} />,
    );

    expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute(
      "src",
      "/api/branding/logo?v=1",
    );
    expect(container.querySelector("picture")).toBeNull();
  });

  test("a name and no logo: the name, with no image at any width", () => {
    setBranding(ACME_NAME_ONLY);

    const { container } = render(
      <ProductLogo
        className="logo"
        nameClassName="name"
        markOnSmallScreens={true}
      />,
    );

    expect(screen.getByText("Acme")).toHaveClass("name");
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("picture")).toBeNull();
  });
});

describe("a logo that does not ask for the mark", () => {
  test("the sign-in pages' logo is the logo at every width", () => {
    const { container } = render(<ProductLogo />);

    expect(screen.getByRole("img", { name: "OneUptime" })).toBeInTheDocument();
    expect(container.querySelector("picture")).toBeNull();
  });

  test("the Admin Dashboard's header is the logo at every width, with an installation's logo too", () => {
    const { container } = render(<AdminDashboardLogo onClick={() => {}} />);

    expect(screen.getByRole("img", { name: "OneUptime" })).toBeInTheDocument();
    expect(container.querySelector("picture")).toBeNull();

    cleanup();
    setBranding(ACME_WITH_EVERYTHING);

    const branded: HTMLElement = render(
      <AdminDashboardLogo onClick={() => {}} />,
    ).container;
    expect(branded.querySelector("picture")).toBeNull();
  });
});

describe("the Dashboard's header logo", () => {
  test("asks for the mark: below sm the browser draws OneUptime's mark", () => {
    const { container } = render(<DashboardLogo />);

    const logo: HTMLElement = screen.getByRole("img", { name: "OneUptime" });
    expect(logo.className).toBe(HEADER_LOGO_CLASS_NAME);
    expect(smallScreenSource(container)).toHaveAttribute(
      "srcset",
      getProductMarkSource(Theme.Light)!,
    );
  });

  test("an installation's logo with a tab icon: the tab icon below sm", () => {
    setBranding(ACME_WITH_EVERYTHING);

    const { container } = render(<DashboardLogo />);

    expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute(
      "src",
      "/api/branding/logo?v=1",
    );
    expect(smallScreenSource(container)).toHaveAttribute(
      "srcset",
      "/api/branding/favicon?v=1",
    );
  });

  test("its name, when the installation has no logo, in the header's name classes", () => {
    setBranding(ACME_NAME_ONLY);

    render(<DashboardLogo />);

    expect(screen.getByText("Acme").className).toBe(
      HEADER_PRODUCT_NAME_CLASS_NAME,
    );
  });

  test("the image: 24px tall and 5rem at most below sm (a logo without a tab icon is held to it), 32px and 12rem from sm", () => {
    const classes: Array<string> = HEADER_LOGO_CLASS_NAME.split(/\s+/);

    expect(classes).toEqual(
      expect.arrayContaining([
        "h-6",
        "w-auto",
        "max-w-[5rem]",
        "object-contain",
        "sm:h-8",
        "sm:max-w-[12rem]",
      ]),
    );
    expect(classes).not.toContain("h-8");
    expect(classes).not.toContain("max-w-[12rem]");
  });

  test("the name: one line, cut short past 6rem below sm and 12rem from sm", () => {
    const classes: Array<string> = HEADER_PRODUCT_NAME_CLASS_NAME.split(/\s+/);

    expect(classes).toEqual(
      expect.arrayContaining([
        "block",
        "truncate",
        "max-w-[6rem]",
        "sm:max-w-[12rem]",
        "leading-6",
        "sm:leading-8",
      ]),
    );
    expect(classes).not.toContain("max-w-[12rem]");
  });
});
