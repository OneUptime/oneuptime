import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import StatusPageTheme, {
  STATUS_PAGE_THEME_ATTRIBUTE,
  STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
} from "../../../Types/StatusPage/StatusPageTheme";
import File from "../../../Models/DatabaseModels/File";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import StatusPageThemeUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPageTheme";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import ThemeSwitch, {
  THEME_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/StatusPage/src/Components/ThemeSwitch/ThemeSwitch";
import LogoPlate, {
  LOGO_PLATE_ATTRIBUTE,
  LOGO_VARIANT_ATTRIBUTE,
} from "../../../../App/FeatureSet/StatusPage/src/Components/Logo/LogoPlate";
import PageLogo, {
  getStatusPageLogoUrl,
} from "../../../../App/FeatureSet/StatusPage/src/Components/Logo/PageLogo";
import StatusPageHeader from "../../../../App/FeatureSet/StatusPage/src/Components/Header/Header";
import englishLocale from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";
import { getJestSpyOn } from "../../Spy";

/*
 * Two follow-ups of the status page's theme (#4936):
 *
 *   - A light / dark switch on the Dashboard's preview of a page - its
 *     address on OneUptime, /status-page/<id>, which the Dashboard opens.
 *     A Light or Dark page offers its visitors no switch, so its owner
 *     could not see it in the other theme without changing the setting for
 *     everyone. On the preview the footer offers the switch on every page;
 *     on a Light or Dark page the pick lasts for the visit and is kept
 *     nowhere, so the page opens in its own theme again. A page that
 *     follows each visitor's device keeps the visitor's pick as before.
 *   - A logo for the dark theme. A page had one logo, made for the light
 *     page and its emails, put on a light backdrop wherever the page is
 *     dark. With a Dark Theme Logo that one is shown instead while the page
 *     is dark, as it is; without one, nothing changes.
 */

const PAGE_ID: string = "3f3f3f3f-0000-4000-8000-0000000000f1";

const translation: i18n = createInstance();

const root: () => HTMLElement = (): HTMLElement => {
  return document.documentElement;
};

const isDark: () => boolean = (): boolean => {
  return root().classList.contains("dark");
};

const openAt: (path: string) => void = (path: string): void => {
  window.history.replaceState(null, "", path);
};

const renderWithTranslation: (element: React.ReactElement) => void = (
  element: React.ReactElement,
): void => {
  render(<I18nextProvider i18n={translation}>{element}</I18nextProvider>);
};

const setTheme: (theme: StatusPageTheme) => void = (
  theme: StatusPageTheme,
): void => {
  act(() => {
    StatusPageThemeUtil.setPageTheme(theme);
  });
};

beforeAll(async () => {
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  root().removeAttribute("class");
  root().removeAttribute("data-theme");
  root().removeAttribute(STATUS_PAGE_THEME_ATTRIBUTE);
  document.head.innerHTML = '<meta name="theme-color" content="#f9fafb">';

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      return {
        media: query,
        matches: false,
        addEventListener: (): void => {},
        removeEventListener: (): void => {},
      };
    },
  });

  // Each test is a fresh visit: no pick from an earlier one.
  (
    StatusPageThemeUtil as unknown as {
      previewColorScheme: string | null;
    }
  ).previewColorScheme = null;

  openAt("/");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  openAt("/");
});

describe("the light / dark switch on the Dashboard's preview of a page", () => {
  test.each([[StatusPageTheme.Light], [StatusPageTheme.Dark]])(
    "a %s page offers it on its preview address, and not on its own domain",
    (theme: StatusPageTheme) => {
      setTheme(theme);
      renderWithTranslation(<ThemeSwitch />);

      // On its custom domain (the page's own address): no switch, as before.
      expect(screen.queryByTestId(THEME_SWITCH_TEST_ID)).toBeNull();
      cleanup();

      openAt(`/status-page/${PAGE_ID}`);
      renderWithTranslation(<ThemeSwitch />);

      expect(screen.getByTestId(THEME_SWITCH_TEST_ID)).toBeInTheDocument();
    },
  );

  test("on a Light page's preview it shows the page dark, and back, for the visit only", () => {
    openAt(`/status-page/${PAGE_ID}/incidents`);
    setTheme(StatusPageTheme.Light);

    renderWithTranslation(<ThemeSwitch />);

    expect(isDark()).toBe(false);

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Switch to dark theme" }),
      );
    });

    expect(isDark()).toBe(true);
    // Kept nowhere: not even with the pick every page on the address shares.
    expect(
      window.localStorage.getItem(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY),
    ).toBeNull();

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Switch to light theme" }),
      );
    });

    expect(isDark()).toBe(false);
  });

  test("on a Dark page's preview it shows the page light", () => {
    openAt(`/status-page/${PAGE_ID}`);
    setTheme(StatusPageTheme.Dark);

    expect(isDark()).toBe(true);

    renderWithTranslation(<ThemeSwitch />);

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Switch to light theme" }),
      );
    });

    expect(isDark()).toBe(false);
    expect(StatusPageThemeUtil.getColorScheme()).toBe("light");
  });

  test("a new visit opens the page in its own theme again", () => {
    openAt(`/status-page/${PAGE_ID}`);
    setTheme(StatusPageTheme.Light);

    act(() => {
      StatusPageThemeUtil.switchColorScheme();
    });

    expect(isDark()).toBe(true);

    // The page's settings read again, as a new visit reads them.
    setTheme(StatusPageTheme.Dark);
    setTheme(StatusPageTheme.Light);

    expect(isDark()).toBe(false);
  });

  test("on a page's own domain a Light page cannot be switched, even by a call", () => {
    setTheme(StatusPageTheme.Light);

    act(() => {
      StatusPageThemeUtil.switchColorScheme();
    });

    expect(isDark()).toBe(false);
  });

  test("on a System page's preview the switch keeps the visitor's pick, as on its domain", () => {
    openAt(`/status-page/${PAGE_ID}`);
    setTheme(StatusPageTheme.System);

    act(() => {
      StatusPageThemeUtil.switchColorScheme();
    });

    expect(isDark()).toBe(true);
    expect(
      window.localStorage.getItem(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY),
    ).toBe("dark");
  });

  test("which page is the preview: its address on OneUptime", () => {
    openAt(`/status-page/${PAGE_ID}/scheduled-events`);
    expect(StatusPageThemeUtil.isPreview()).toBe(true);
    expect(StatusPageThemeUtil.canVisitorSwitch(StatusPageTheme.Light)).toBe(
      true,
    );

    openAt("/scheduled-events");
    expect(StatusPageThemeUtil.isPreview()).toBe(false);
    expect(StatusPageThemeUtil.canVisitorSwitch(StatusPageTheme.Light)).toBe(
      false,
    );
    expect(StatusPageThemeUtil.canVisitorSwitch(StatusPageTheme.System)).toBe(
      true,
    );
  });
});

describe("what the logo sits on, and which logo it is", () => {
  const renderPlate: (darkLogo: boolean) => HTMLElement = (
    darkLogo: boolean,
  ): HTMLElement => {
    render(
      <LogoPlate
        id="logo-under-test"
        className="flex"
        darkLogo={
          darkLogo ? <img alt="Acme" src="/dark-theme-logo.svg" /> : undefined
        }
      >
        <img alt="Acme" src="/logo.svg" />
      </LogoPlate>,
    );

    return document.getElementById("logo-under-test")!;
  };

  test("while the page is dark, a dark theme logo is shown instead, with no backdrop", () => {
    setTheme(StatusPageTheme.Dark);

    const plate: HTMLElement = renderPlate(true);

    expect(plate.querySelector("img")).toHaveAttribute(
      "src",
      "/dark-theme-logo.svg",
    );
    expect(plate).toHaveAttribute(LOGO_VARIANT_ATTRIBUTE, "dark");
    expect(plate.hasAttribute(LOGO_PLATE_ATTRIBUTE)).toBe(false);
    expect(plate).toHaveClass("flex");
  });

  test("while the page is light, the logo, whatever else it has", () => {
    setTheme(StatusPageTheme.Light);

    const plate: HTMLElement = renderPlate(true);

    expect(plate.querySelector("img")).toHaveAttribute("src", "/logo.svg");
    expect(plate).toHaveAttribute(LOGO_VARIANT_ATTRIBUTE, "light");
  });

  test("without a dark theme logo, a dark page puts the logo on its backdrop, as before", () => {
    setTheme(StatusPageTheme.Dark);

    const plate: HTMLElement = renderPlate(false);

    expect(plate.querySelector("img")).toHaveAttribute("src", "/logo.svg");
    expect(plate).toHaveAttribute(LOGO_PLATE_ATTRIBUTE, "");
  });

  test("it follows the page when it turns dark and light again", () => {
    openAt(`/status-page/${PAGE_ID}`);
    setTheme(StatusPageTheme.Light);

    const plate: () => HTMLElement = (): HTMLElement => {
      return document.getElementById("logo-under-test")!;
    };

    renderPlate(true);
    expect(plate().querySelector("img")).toHaveAttribute("src", "/logo.svg");

    act(() => {
      StatusPageThemeUtil.switchColorScheme();
    });

    expect(plate().querySelector("img")).toHaveAttribute(
      "src",
      "/dark-theme-logo.svg",
    );
  });

  test("a Light page's preview, which can be switched dark, gives the logo its backdrop", () => {
    openAt(`/status-page/${PAGE_ID}`);
    setTheme(StatusPageTheme.Light);

    expect(renderPlate(false)).toHaveAttribute(LOGO_PLATE_ATTRIBUTE, "");
    cleanup();

    // On its own domain, as before: a Light page is never dark.
    openAt("/");
    expect(renderPlate(false).hasAttribute(LOGO_PLATE_ATTRIBUTE)).toBe(false);
  });

  test("a page with only a dark theme logo shows nothing while it is light", () => {
    setTheme(StatusPageTheme.System);

    render(
      <LogoPlate
        id="only-dark"
        darkLogo={<img alt="Acme" src="/dark-theme-logo.svg" />}
      />,
    );

    expect(document.getElementById("only-dark")).toBeNull();
  });
});

describe("the header's logo for the dark theme", () => {
  const imageFile: (bytes: Array<number>) => File = (
    bytes: Array<number>,
  ): File => {
    const file: File = new File();
    file.file = new Uint8Array(bytes) as unknown as Buffer;
    file.fileType = MimeType.svg;
    return file;
  };

  beforeEach(() => {
    let created: number = 0;

    // jsdom has no object URLs; the header draws the logo from one.
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (): string => {
        created++;
        return `blob:logo-${created}`;
      },
    });
  });

  test("a Dark page's header shows its dark theme logo, with no backdrop, named as the logo is", () => {
    setTheme(StatusPageTheme.Dark);

    render(
      <StatusPageHeader
        links={[]}
        logo={imageFile([60, 115, 118, 103, 47, 62])}
        darkLogo={imageFile([60, 115, 118, 103, 32, 47, 62])}
        logoAltText="Acme"
        onLogoClicked={() => {}}
      />,
    );

    const logo: HTMLElement = document.getElementById("status-page-logo")!;

    expect(logo).toHaveAttribute(LOGO_VARIANT_ATTRIBUTE, "dark");
    expect(logo.hasAttribute(LOGO_PLATE_ATTRIBUTE)).toBe(false);
    expect(logo.querySelectorAll("img")).toHaveLength(1);
    expect(logo.querySelector("img")).toHaveAttribute("alt", "Acme");
  });

  test("a header with only a dark theme logo is still drawn", () => {
    setTheme(StatusPageTheme.Dark);

    render(
      <StatusPageHeader
        links={[]}
        darkLogo={imageFile([60, 115, 118, 103, 47, 62])}
        logoAltText="Acme"
        onLogoClicked={() => {}}
      />,
    );

    expect(document.getElementById("status-page-logo")).toHaveAttribute(
      LOGO_VARIANT_ATTRIBUTE,
      "dark",
    );
  });
});

describe("the logo of a page shown on its own (sign-in, password, unsubscribe)", () => {
  beforeEach(() => {
    getJestSpyOn(StatusPageUtil, "getStatusPageId").mockReturnValue(
      new ObjectID(PAGE_ID),
    );
  });

  const renderPageLogo: (data: {
    logo: boolean;
    darkThemeLogo: boolean;
  }) => void = (data: { logo: boolean; darkThemeLogo: boolean }): void => {
    render(
      <PageLogo
        logoFileId={data.logo ? ObjectID.generate() : new ObjectID("")}
        darkThemeLogoFileId={
          data.darkThemeLogo ? ObjectID.generate() : new ObjectID("")
        }
        altText="Acme Status"
      />,
    );
  };

  test("reads the logo from the page's /logo route, named by the page", () => {
    setTheme(StatusPageTheme.Light);
    renderPageLogo({ logo: true, darkThemeLogo: true });

    const image: HTMLElement = screen.getByRole("img", {
      name: "Acme Status",
    });

    expect(image).toHaveAttribute(
      "src",
      getStatusPageLogoUrl({ route: "logo", statusPageId: PAGE_ID }),
    );
    expect(image.getAttribute("src")).toContain(`/logo/${PAGE_ID}`);
  });

  test("while the page is dark, the dark theme logo from /dark-theme-logo", () => {
    setTheme(StatusPageTheme.Dark);
    renderPageLogo({ logo: true, darkThemeLogo: true });

    expect(screen.getByRole("img", { name: "Acme Status" })).toHaveAttribute(
      "src",
      getStatusPageLogoUrl({
        route: "dark-theme-logo",
        statusPageId: PAGE_ID,
      }),
    );
  });

  test("while it is dark without one, the logo on its backdrop", () => {
    setTheme(StatusPageTheme.Dark);
    renderPageLogo({ logo: true, darkThemeLogo: false });

    const image: HTMLElement = screen.getByRole("img", {
      name: "Acme Status",
    });

    expect(image.getAttribute("src")).toContain(`/logo/${PAGE_ID}`);
    expect(image.parentElement).toHaveAttribute(LOGO_PLATE_ATTRIBUTE, "");
  });

  test("a page with no logo at all draws nothing", () => {
    setTheme(StatusPageTheme.Dark);
    renderPageLogo({ logo: false, darkThemeLogo: false });

    expect(screen.queryByRole("img")).toBeNull();
  });
});
