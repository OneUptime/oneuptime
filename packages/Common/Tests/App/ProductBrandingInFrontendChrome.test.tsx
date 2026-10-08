import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * Where each frontend shows the product around its pages - the Dashboard
 * and Admin Dashboard headers, the Dashboard footer, the status page footer
 * and the public dashboard footer - with and without the branding env.js
 * carries (PRODUCT_BRANDING, present only when the installation's branding
 * may differ from OneUptime's).
 *
 * Without it, every one of these is OneUptime's own, exactly as before. With
 * a name of its own, the installation's pages stop pointing people at
 * OneUptime: no OneUptime support or legal links, no OneUptime edition pill,
 * no OneUptime wordmark, and "Powered by" names the installation and links
 * to its website (or nowhere).
 *
 * The translated sentences themselves ("footer.poweredBy") are covered by
 * ProductNameInFrontendTranslations.test.ts; here the translator hands back
 * keys, so what is pinned is which links, logos and names each page draws.
 */

/*
 * The wordmark as esbuild hands it to the components: a data: URL. Its text
 * is #121212, the colour the dark-theme variant recolours.
 */
jest.mock("../../UI/Images/logos/OneUptimeSVG/3-transparent.svg", () => {
  return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjx0ZXh0IGZpbGw9IiMxMjEyMTIiPk9uZVVwdGltZTwvdGV4dD48L3N2Zz4=";
});

// The edition pill fetches the license on mount; here it only has to be seen.
jest.mock("../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <span data-testid="edition-label" />;
    },
  };
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

jest.mock(
  "../../../App/FeatureSet/Dashboard/src/Components/LanguageSwitcher/LanguageSwitcher",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <span data-testid="language-switcher" />;
      },
    };
  },
);

jest.mock(
  "../../../App/FeatureSet/StatusPage/src/Components/LanguageSwitcher/LanguageSwitcher",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <span data-testid="language-switcher" />;
      },
    };
  },
);

import AdminDashboardLogo from "../../../App/FeatureSet/AdminDashboard/src/Components/Header/Logo";
import DashboardFooter from "../../../App/FeatureSet/Dashboard/src/Components/Footer/Footer";
import DashboardLogo from "../../../App/FeatureSet/Dashboard/src/Components/Header/Logo";
import PublicDashboardPoweredByFooter from "../../../App/FeatureSet/PublicDashboard/src/Components/PoweredByFooter";
import StatusPageFooter from "../../../App/FeatureSet/StatusPage/src/Components/Footer/Footer";
import ThemeUtil, { Theme } from "../../UI/Utils/Theme";

const SVG_DATA_URL: RegExp = /^data:image\/svg\+xml;base64,/;

const ONEUPTIME_ADDRESS: RegExp = /^https:\/\/oneuptime\.com/;

const ACME_WITH_EVERYTHING: string = JSON.stringify({
  productName: "Acme",
  websiteUrl: "https://acme.example",
  logoUrl: "/api/branding/logo?v=1",
  darkLogoUrl: "/api/branding/dark-logo?v=1",
  faviconUrl: "/api/branding/favicon?v=1",
});

const ACME_NAME_ONLY: string = JSON.stringify({ productName: "Acme" });

const LOGO_ONLY: string = JSON.stringify({
  logoUrl: "/api/branding/logo?v=1",
});

const setBranding: (value: string | null) => void = (
  value: string | null,
): void => {
  const browserWindow: { process?: { env?: Record<string, unknown> } } =
    window as unknown as { process?: { env?: Record<string, unknown> } };

  browserWindow.process = browserWindow.process || {};
  browserWindow.process.env = browserWindow.process.env || {};

  if (value === null) {
    delete browserWindow.process.env["PRODUCT_BRANDING"];
  } else {
    browserWindow.process.env["PRODUCT_BRANDING"] = value;
  }
};

// Every link the page draws, as the address it goes to.
const linkAddresses: () => Array<string> = (): Array<string> => {
  return Array.from(document.querySelectorAll("a[href]")).map(
    (anchor: Element): string => {
      return anchor.getAttribute("href") || "";
    },
  );
};

const linksToOneUptime: () => Array<string> = (): Array<string> => {
  return linkAddresses().filter((address: string): boolean => {
    return ONEUPTIME_ADDRESS.test(address);
  });
};

afterEach(() => {
  cleanup();
  setBranding(null);
  ThemeUtil.setTheme(Theme.Light);
  window.localStorage.clear();
});

describe("the Dashboard footer", () => {
  const renderFooter: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      render(<DashboardFooter />);
    });
  };

  test("is OneUptime's by default: the edition pill, support, legal and the copyright line", async () => {
    await renderFooter();

    expect(screen.getByTestId("edition-label")).toBeInTheDocument();
    expect(linksToOneUptime()).toEqual([
      "https://oneuptime.com/support",
      "https://oneuptime.com/legal",
    ]);
    expect(screen.getByText("footer.helpSupport")).toBeInTheDocument();
    expect(screen.getByText("footer.legal")).toBeInTheDocument();
    expect(document.body.textContent).toContain("footer.copyright");
  });

  test("on an installation with a name of its own, points nowhere at OneUptime", async () => {
    setBranding(ACME_WITH_EVERYTHING);

    await renderFooter();

    expect(screen.queryByTestId("edition-label")).not.toBeInTheDocument();
    expect(screen.queryByText("footer.helpSupport")).not.toBeInTheDocument();
    expect(screen.queryByText("footer.legal")).not.toBeInTheDocument();
    expect(linksToOneUptime()).toEqual([]);
    expect(document.body.textContent).not.toContain("footer.copyright");
    expect(document.body.textContent).toContain("Acme");
  });

  test("keeps what belongs to the installation itself: its version and the language", async () => {
    setBranding(ACME_NAME_ONLY);

    await renderFooter();

    expect(screen.getByText("footer.version")).toBeInTheDocument();
    expect(screen.getByTestId("language-switcher")).toBeInTheDocument();
  });

  test("a logo of its own without a name of its own is still OneUptime: its links stay", async () => {
    setBranding(LOGO_ONLY);

    await renderFooter();

    expect(screen.getByTestId("edition-label")).toBeInTheDocument();
    expect(linksToOneUptime()).toHaveLength(2);
  });
});

describe.each([
  ["the Dashboard header", DashboardLogo],
  ["the Admin Dashboard header", AdminDashboardLogo],
] as Array<[string, typeof DashboardLogo]>)(
  "%s logo",
  (_name: string, Logo: typeof DashboardLogo) => {
    const renderLogo: (onClick?: () => void) => void = (
      onClick?: () => void,
    ): void => {
      render(
        <Logo
          onClick={
            onClick ||
            (() => {
              // Where the logo leads is not what is pinned here.
            })
          }
        />,
      );
    };

    test("is OneUptime's wordmark by default", () => {
      renderLogo();

      const logo: HTMLElement = screen.getByRole("img", { name: "OneUptime" });

      expect(logo.getAttribute("src")).toMatch(SVG_DATA_URL);
    });

    test("is OneUptime's wordmark recoloured in the dark theme", () => {
      renderLogo();
      const lightSource: string | null = screen
        .getByRole("img", { name: "OneUptime" })
        .getAttribute("src");
      cleanup();

      ThemeUtil.setTheme(Theme.Dark);
      renderLogo();

      const darkSource: string | null = screen
        .getByRole("img", { name: "OneUptime" })
        .getAttribute("src");

      expect(darkSource).toMatch(SVG_DATA_URL);
      expect(darkSource).not.toBe(lightSource);
    });

    test("is the installation's own logo, named after it", () => {
      setBranding(ACME_WITH_EVERYTHING);

      renderLogo();

      expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute(
        "src",
        "/api/branding/logo?v=1",
      );
    });

    test("is the installation's logo for dark backgrounds in the dark theme", () => {
      setBranding(ACME_WITH_EVERYTHING);
      ThemeUtil.setTheme(Theme.Dark);

      renderLogo();

      expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute(
        "src",
        "/api/branding/dark-logo?v=1",
      );
    });

    test("is the installation's name, not OneUptime's wordmark, when it has a name and no logo", () => {
      setBranding(ACME_NAME_ONLY);

      renderLogo();

      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByText("Acme")).toBeInTheDocument();
      expect(screen.getByText("Acme")).toHaveClass("truncate");
    });

    test("the name is clickable, as the logo is", () => {
      setBranding(ACME_NAME_ONLY);

      let clicks: number = 0;

      renderLogo(() => {
        clicks += 1;
      });

      screen.getByText("Acme").click();

      expect(clicks).toBe(1);
    });

    test("a logo is held to the header's height and to a width that leaves it its buttons", () => {
      setBranding(ACME_WITH_EVERYTHING);

      renderLogo();

      const logo: HTMLElement = screen.getByRole("img", { name: "Acme" });

      expect(logo).toHaveClass("object-contain");
      expect(logo.getAttribute("class")).toContain("max-w-[12rem]");
    });
  },
);

describe("the status page footer", () => {
  const renderFooter: (
    props?: Partial<React.ComponentProps<typeof StatusPageFooter>>,
  ) => void = (
    props?: Partial<React.ComponentProps<typeof StatusPageFooter>>,
  ): void => {
    render(<StatusPageFooter links={[]} {...props} />);
  };

  test("says Powered by OneUptime, linking to oneuptime.com, by default", () => {
    renderFooter();

    const poweredBy: HTMLElement = screen.getByText("footer.poweredBy");

    // The shared Link writes the address out as a URL, with its path.
    expect(poweredBy.closest("a")).toHaveAttribute(
      "href",
      "https://oneuptime.com/",
    );
    expect(poweredBy.closest("a")).toHaveAttribute("target", "_blank");
  });

  test("links to the installation's website when it goes by a name of its own", () => {
    setBranding(ACME_WITH_EVERYTHING);

    renderFooter();

    expect(screen.getByText("footer.poweredBy").closest("a")).toHaveAttribute(
      "href",
      "https://acme.example/",
    );
    expect(linksToOneUptime()).toEqual([]);
  });

  test("links nowhere when the installation has a name of its own and no website", () => {
    setBranding(ACME_NAME_ONLY);

    renderFooter();

    expect(screen.getByText("footer.poweredBy").closest("a")).toBeNull();
    expect(linkAddresses()).toEqual([]);
  });

  test("a status page that hides the line hides it whatever the branding", () => {
    setBranding(ACME_WITH_EVERYTHING);

    renderFooter({ hidePoweredByOneUptimeBranding: true });

    expect(screen.queryByText("footer.poweredBy")).not.toBeInTheDocument();
  });

  test("keeps the status page's own links and copyright", () => {
    setBranding(ACME_NAME_ONLY);

    renderFooter({ copyright: "Example Inc." });

    expect(document.body.textContent).toContain("Example Inc.");
    expect(screen.getByTestId("language-switcher")).toBeInTheDocument();
  });
});

describe("the public dashboard footer", () => {
  // "Powered by" and the name sit side by side, a margin apart.
  const expectPoweredBy: (name: string) => void = (name: string): void => {
    const footer: HTMLElement = screen.getByTestId(
      "public-dashboard-powered-by",
    );

    expect(footer.textContent).toBe(`Powered by${name}`);
    expect(screen.getByText("Powered by")).toBeInTheDocument();
    expect(screen.getByText(name)).toHaveClass("ml-1");
  };

  test("says Powered by OneUptime, linking to oneuptime.com, by default", () => {
    render(<PublicDashboardPoweredByFooter />);

    expectPoweredBy("OneUptime");
    expect(screen.getByText("OneUptime").closest("a")).toHaveAttribute(
      "href",
      "https://oneuptime.com",
    );
  });

  test("names the installation and links to its website", () => {
    setBranding(ACME_WITH_EVERYTHING);

    render(<PublicDashboardPoweredByFooter />);

    expectPoweredBy("Acme");
    expect(screen.getByText("Acme").closest("a")).toHaveAttribute(
      "href",
      "https://acme.example",
    );
    expect(linksToOneUptime()).toEqual([]);
  });

  test("names the installation without a link when it has no website", () => {
    setBranding(ACME_NAME_ONLY);

    render(<PublicDashboardPoweredByFooter />);

    expectPoweredBy("Acme");
    expect(linkAddresses()).toEqual([]);
  });
});
