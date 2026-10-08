import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";

/*
 * The shape esbuild hands the components an imported SVG in: a data: URL
 * (see HeaderImageAssets.test.tsx). Its text is #121212, the colour the
 * dark-theme variant recolours. Common's jest maps every image to one stub
 * module, so this stands in for each of them in this file.
 */
jest.mock("../../../UI/Images/logos/OneUptimeSVG/3-transparent.svg", () => {
  return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjx0ZXh0IGZpbGw9IiMxMjEyMTIiPk9uZVVwdGltZTwvdGV4dD48L3N2Zz4=";
});
import i18next, { i18n as I18nInstance } from "i18next";
import React from "react";
import Page from "../../../UI/Components/Page/Page";
import ProductLogo, {
  getProductLogoSource,
  PAGE_LOGO_CLASS_NAME,
  PAGE_PRODUCT_NAME_CLASS_NAME,
} from "../../../UI/Components/ProductLogo/ProductLogo";
import PublicFormLogo from "../../../UI/Components/PublicForm/PublicFormLogo";
import Container from "../../../UI/Container";
import {
  getPoweredByLink,
  getProductBranding,
  getProductLogoUrl,
  getProductName,
  isProductRenamed,
  withProductName,
} from "../../../UI/Utils/ProductBranding";
import {
  getProductNamePostProcess,
  PRODUCT_NAME_POST_PROCESSOR,
  productNamePostProcessor,
} from "../../../UI/Utils/ProductNameTranslation";
import ThemeUtil, { Theme } from "../../../UI/Utils/Theme";
import Route from "../../../Types/API/Route";

/*
 * How the frontends name and show the product, from what env.js carries
 * (PRODUCT_BRANDING, present only when the installation's branding may differ
 * from OneUptime's). Without it, everything here is OneUptime's own.
 *
 * Pinned: reading env.js (and what a bad value means), the page title, the
 * shared logo (each theme), the form page's fallback logo, the "Powered by"
 * link, and the translation post-processor every product-facing frontend
 * registers - which replaces the name in every translated sentence when the
 * installation goes by another one, and is off otherwise.
 */

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

// The wordmark's data: URL, as the mock above hands it out.
const SVG_DATA_URL: RegExp = /^data:image\/svg\+xml;base64,/;

const ACME: string = JSON.stringify({
  productName: "Acme",
  websiteUrl: "https://acme.example",
  logoUrl: "/api/branding/logo?v=1",
  darkLogoUrl: "/api/branding/dark-logo?v=1",
  faviconUrl: "/api/branding/favicon?v=1",
});

afterEach(() => {
  cleanup();
  setBranding(null);
  document.documentElement.classList.remove("dark");
});

describe("reading the branding from env.js", () => {
  test("no PRODUCT_BRANDING: OneUptime, not renamed, no logo of its own", () => {
    expect(getProductBranding()).toBeNull();
    expect(getProductName()).toBe("OneUptime");
    expect(isProductRenamed()).toBe(false);
    expect(getProductLogoUrl(Theme.Light)).toBeNull();
    expect(getProductLogoUrl(Theme.Dark)).toBeNull();
  });

  test("a branded installation", () => {
    setBranding(ACME);

    expect(getProductName()).toBe("Acme");
    expect(isProductRenamed()).toBe(true);
    expect(getProductLogoUrl(Theme.Light)).toBe("/api/branding/logo?v=1");
    expect(getProductLogoUrl(Theme.Dark)).toBe("/api/branding/dark-logo?v=1");
  });

  test("a dark theme falls back to the light-background logo", () => {
    setBranding(JSON.stringify({ logoUrl: "/api/branding/logo?v=1" }));

    expect(getProductLogoUrl(Theme.Dark)).toBe("/api/branding/logo?v=1");
  });

  test("follows env.js when it changes (read at call time)", () => {
    setBranding(JSON.stringify({ productName: "First" }));
    expect(getProductName()).toBe("First");

    setBranding(JSON.stringify({ productName: "Second" }));
    expect(getProductName()).toBe("Second");
  });

  test.each(["", "{", "[]", '"Acme"'])(
    "a PRODUCT_BRANDING of %j counts as none",
    (value: string) => {
      setBranding(value);

      expect(getProductBranding()).toBeNull();
      expect(getProductName()).toBe("OneUptime");
    },
  );

  test("an image address that is not on this host is never used", () => {
    setBranding(
      JSON.stringify({
        productName: "Acme",
        logoUrl: "https://evil.example/logo.png",
      }),
    );

    expect(getProductLogoUrl(Theme.Light)).toBeNull();
  });
});

describe("Powered by", () => {
  test("is OneUptime, linking to oneuptime.com, by default", () => {
    expect(getPoweredByLink()).toEqual({
      name: "OneUptime",
      url: "https://oneuptime.com",
    });
  });

  test("is the installation's name, linking to its website", () => {
    setBranding(ACME);

    expect(getPoweredByLink()).toEqual({
      name: "Acme",
      url: "https://acme.example",
    });
  });

  test("links nowhere when the installation has no website", () => {
    setBranding(JSON.stringify({ productName: "Acme" }));

    expect(getPoweredByLink()).toEqual({ name: "Acme", url: null });
  });
});

describe("withProductName", () => {
  test("replaces the word when renamed", () => {
    setBranding(ACME);

    expect(withProductName("Sign in to OneUptime")).toBe("Sign in to Acme");
  });

  test("leaves the text alone otherwise", () => {
    expect(withProductName("Sign in to OneUptime")).toBe(
      "Sign in to OneUptime",
    );

    setBranding(JSON.stringify({ logoUrl: "/api/branding/logo" }));
    expect(withProductName("Sign in to OneUptime")).toBe(
      "Sign in to OneUptime",
    );
  });
});

describe("the page title", () => {
  test("is 'OneUptime | <page>' by default", () => {
    render(<Page title="Incidents" breadcrumbLinks={[]} />);

    expect(document.title).toBe("OneUptime | Incidents");
  });

  test("is '<name> | <page>' on a renamed installation", () => {
    setBranding(ACME);

    render(
      <Page
        title="Incidents"
        breadcrumbLinks={[
          { title: "Project", to: new Route("/dashboard/p") },
          { title: "Incidents", to: new Route("/dashboard/p/incidents") },
        ]}
      />,
    );

    expect(document.title).toBe("Acme | Project - Incidents");
  });

  test("Container names the product too", () => {
    setBranding(ACME);

    render(
      <Container title="Status">
        <div />
        <div />
      </Container>,
    );

    expect(document.title).toBe("Acme | Status");
  });
});

describe("ProductLogo", () => {
  test("is OneUptime's logo, named OneUptime, by default", () => {
    render(<ProductLogo />);

    const logo: HTMLElement = screen.getByRole("img", { name: "OneUptime" });

    expect(logo.getAttribute("src")).toBe(getProductLogoSource(Theme.Light));
    expect(logo.getAttribute("src")).toMatch(SVG_DATA_URL);
    expect(logo.getAttribute("src")).not.toContain("/api/branding");
    // Sized for the top of a sign-in page, and never wider than it.
    expect(logo.getAttribute("class")).toBe(PAGE_LOGO_CLASS_NAME);
    expect(logo).toHaveClass("h-10", "max-w-full", "object-contain");
  });

  test("takes the classes it is given in place of the page's", () => {
    render(<ProductLogo className="h-8 w-auto" />);

    expect(
      screen.getByRole("img", { name: "OneUptime" }).getAttribute("class"),
    ).toBe("h-8 w-auto");
  });

  test("is the installation's logo, named after it", () => {
    setBranding(ACME);

    render(<ProductLogo />);

    expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute(
      "src",
      "/api/branding/logo?v=1",
    );
  });

  test("in the dark theme, the logo for dark backgrounds", () => {
    setBranding(ACME);
    ThemeUtil.setTheme(Theme.Dark);

    render(<ProductLogo />);

    expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute(
      "src",
      "/api/branding/dark-logo?v=1",
    );

    ThemeUtil.setTheme(Theme.Light);
  });

  test("OneUptime's own logo is recoloured for a dark background", () => {
    expect(getProductLogoSource(Theme.Dark)).not.toBe(
      getProductLogoSource(Theme.Light),
    );
  });

  test("the alt text of a name with quotes and ampersands in it is that text", () => {
    setBranding(
      JSON.stringify({
        productName: 'Acme "Q" & Co',
        logoUrl: "/api/branding/logo?v=1",
      }),
    );

    render(<ProductLogo />);

    expect(
      screen.getByRole("img", { name: 'Acme "Q" & Co' }),
    ).toBeInTheDocument();
  });

  test("a logo of its own without a name of its own keeps OneUptime's name as the alt text", () => {
    setBranding(JSON.stringify({ logoUrl: "/api/branding/logo?v=1" }));

    render(<ProductLogo />);

    expect(screen.getByRole("img", { name: "OneUptime" })).toHaveAttribute(
      "src",
      "/api/branding/logo?v=1",
    );
  });

  describe("a name of its own and no logo", () => {
    test("draws the name in the logo's place: never OneUptime's wordmark", () => {
      setBranding(JSON.stringify({ productName: "Acme" }));

      expect(getProductLogoSource(Theme.Light)).toBeNull();
      expect(getProductLogoSource(Theme.Dark)).toBeNull();

      render(<ProductLogo dataTestId="product-logo" />);

      const name: HTMLElement = screen.getByTestId("product-logo");

      expect(name.tagName).toBe("DIV");
      expect(name).toHaveTextContent("Acme");
      expect(name.getAttribute("class")).toBe(PAGE_PRODUCT_NAME_CLASS_NAME);
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    test("in the classes it is given for the name", () => {
      setBranding(JSON.stringify({ productName: "Acme" }));

      render(
        <ProductLogo
          className="h-8"
          nameClassName="text-lg font-semibold"
          dataTestId="product-logo"
        />,
      );

      expect(screen.getByTestId("product-logo").getAttribute("class")).toBe(
        "text-lg font-semibold",
      );
    });

    test("draws a name with quotes and ampersands as that text", () => {
      setBranding(JSON.stringify({ productName: 'Acme "Q" & Co' }));

      const { container } = render(<ProductLogo dataTestId="product-logo" />);

      expect(screen.getByTestId("product-logo").textContent).toBe(
        'Acme "Q" & Co',
      );
      expect(container.querySelectorAll("*")).toHaveLength(1);
    });

    test("is clickable like the logo it stands in for", () => {
      setBranding(JSON.stringify({ productName: "Acme" }));

      let clicks: number = 0;

      render(
        <ProductLogo
          dataTestId="product-logo"
          onClick={() => {
            clicks += 1;
          }}
        />,
      );

      screen.getByTestId("product-logo").click();

      expect(clicks).toBe(1);
    });
  });
});

describe("a form page without a logo of its own", () => {
  test("shows the product's logo: OneUptime's by default", () => {
    render(<PublicFormLogo />);

    expect(screen.getByTestId("form-logo")).toHaveAttribute("alt", "OneUptime");
  });

  test("shows the installation's logo when it has one", () => {
    setBranding(ACME);

    render(<PublicFormLogo />);

    expect(screen.getByTestId("form-logo")).toHaveAttribute(
      "src",
      "/api/branding/logo?v=1",
    );
    expect(screen.getByTestId("form-logo")).toHaveAttribute("alt", "Acme");
  });

  test("shows the installation's name when it has a name of its own and no logo", () => {
    setBranding(JSON.stringify({ productName: "Acme" }));

    render(<PublicFormLogo />);

    const logo: HTMLElement = screen.getByTestId("form-logo");

    expect(logo.tagName).toBe("DIV");
    expect(logo).toHaveTextContent("Acme");
    expect(logo).toHaveAttribute("data-logo", "oneuptime");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("the translation post-processor", () => {
  const createI18n: () => Promise<I18nInstance> =
    async (): Promise<I18nInstance> => {
      const instance: I18nInstance = i18next.createInstance();

      await instance.use(productNamePostProcessor).init({
        lng: "de",
        fallbackLng: "en",
        postProcess: getProductNamePostProcess(),
        resources: {
          en: {
            translation: {
              footer: { poweredBy: "Powered by OneUptime" },
            },
          },
          de: {
            translation: {
              footer: { poweredBy: "Bereitgestellt von OneUptime" },
              "Sign in to OneUptime": "Bei OneUptime anmelden",
            },
          },
        },
        interpolation: { escapeValue: false },
      });

      return instance;
    };

  test("is off when the installation is not renamed: every string as written", async () => {
    expect(getProductNamePostProcess()).toBe(false);

    const i18n: I18nInstance = await createI18n();

    expect(i18n.t("footer.poweredBy")).toBe("Bereitgestellt von OneUptime");
    expect(i18n.t("Sign in to OneUptime")).toBe("Bei OneUptime anmelden");
  });

  test("puts the installation's name in every translated sentence when renamed", async () => {
    setBranding(ACME);

    expect(getProductNamePostProcess()).toEqual([PRODUCT_NAME_POST_PROCESSOR]);

    const i18n: I18nInstance = await createI18n();

    expect(i18n.t("footer.poweredBy")).toBe("Bereitgestellt von Acme");
    expect(i18n.t("Sign in to OneUptime")).toBe("Bei Acme anmelden");
  });

  test("covers the English the code passes as the default, and the language fallback", async () => {
    setBranding(ACME);

    const i18n: I18nInstance = await createI18n();

    expect(
      i18n.t("A sentence no locale has, about OneUptime", {
        defaultValue: "A sentence no locale has, about OneUptime",
      }),
    ).toBe("A sentence no locale has, about Acme");
    expect(i18n.t("Unknown key naming OneUptime")).toBe(
      "Unknown key naming Acme",
    );
  });

  test("reads interpolated values too, as documented", async () => {
    setBranding(ACME);

    const i18n: I18nInstance = await createI18n();

    expect(
      i18n.t("Probe {{name}} is offline", { name: "OneUptime Probe EU" }),
    ).toBe("Probe Acme Probe EU is offline");
  });

  test("leaves commands, URLs and identifiers in a sentence alone", async () => {
    setBranding(ACME);

    const i18n: I18nInstance = await createI18n();

    expect(
      i18n.t(
        "Run oneuptime login, see https://oneuptime.com and call OneUptimeReplay.identify()",
      ),
    ).toBe(
      "Run oneuptime login, see https://oneuptime.com and call OneUptimeReplay.identify()",
    );
  });
});
