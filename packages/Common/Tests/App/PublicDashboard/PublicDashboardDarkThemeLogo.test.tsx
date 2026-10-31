import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A public dashboard's logo for its dark theme (the #5284 follow-up). A
 * dashboard had one logo, made for its light page, and on the dark page it
 * sat on a small light backdrop. Now its Branding page takes a second logo,
 * made for a dark background, which the page draws instead while it is
 * dark - a Dark dashboard, one that follows a dark device, and any one a
 * visitor turns dark from its toolbar - as it is, with no backdrop. Without
 * one, nothing changes: the logo on its backdrop. The status page does the
 * same (StatusPage/src/Components/Logo/LogoPlate).
 *
 * The public API's /view-config sends both logos (Common/Server/API/
 * DashboardAPI), each only when it is a file of the dashboard's own
 * project; the page draws its header from that answer.
 */

class FakeMediaQueryList {
  public matches: boolean;
  public media: string;

  public constructor(media: string, matches: boolean) {
    this.media = media;
    this.matches = matches;
  }

  public addEventListener(): void {
    // The device does not change here.
  }

  public removeEventListener(): void {
    // Nothing to stop.
  }
}

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string): FakeMediaQueryList => {
    return new FakeMediaQueryList(query, false);
  },
});

const publicPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return publicPostMock(...args);
      },
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
    },
  };
});

import DashboardViewPage, {
  getImageDataUrl,
} from "../../../../App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage";
import LogoPlate, {
  LOGO_PLATE_ATTRIBUTE,
  LOGO_VARIANT_ATTRIBUTE,
} from "../../../../App/FeatureSet/PublicDashboard/src/Components/LogoPlate";
import { LOGO_VARIANT_ATTRIBUTE as STATUS_PAGE_LOGO_VARIANT_ATTRIBUTE } from "../../../../App/FeatureSet/StatusPage/src/Components/Logo/LogoPlate";
import DashboardThemeUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/DashboardTheme";
import DashboardTheme from "../../../Types/Dashboard/DashboardTheme";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import JSONFunctions from "../../../Types/JSONFunctions";

const DASHBOARD_ID: ObjectID = new ObjectID(
  "d5d5d5d5-2222-4222-8222-d5d5d5d5d5d5",
);

const base64Of: (text: string) => string = (text: string): string => {
  return Buffer.from(text).toString("base64");
};

const LIGHT_LOGO: JSONObject = {
  file: base64Of("<svg>light logo</svg>"),
  fileType: "image/svg+xml",
};

const DARK_LOGO: JSONObject = {
  file: base64Of("<svg>dark logo</svg>"),
  fileType: "image/svg+xml",
};

const LIGHT_LOGO_URL: string = `data:image/svg+xml;base64,${LIGHT_LOGO["file"] as string}`;
const DARK_LOGO_URL: string = `data:image/svg+xml;base64,${DARK_LOGO["file"] as string}`;

// What /view-config answers: the dashboard, with the logos it is given.
function serve(logos: {
  logoFile: JSONObject | null;
  darkThemeLogoFile: JSONObject | null;
}): void {
  publicPostMock.mockImplementation((...args: Array<any>) => {
    const url: string = String(args[0]?.url || "");

    if (!url.includes("/view-config/")) {
      return Promise.resolve({
        isFailure: (): boolean => {
          return true;
        },
        data: {},
      });
    }

    return Promise.resolve({
      isFailure: (): boolean => {
        return false;
      },
      data: {
        name: "Acme Production",
        pageTitle: "Acme Production",
        logoFile: logos.logoFile,
        darkThemeLogoFile: logos.darkThemeLogoFile,
        dashboardViewConfig: JSONFunctions.serialize({
          _type: "DashboardViewConfig",
          heightInDashboardUnits: 2,
          components: [DashboardTextComponentUtil.getDefaultComponent()],
        } as unknown as JSONObject),
      },
    });
  });
}

function setScheme(scheme: "light" | "dark"): void {
  act(() => {
    DashboardThemeUtil.setVisitorChoice("auto");
    DashboardThemeUtil.setDashboardTheme(
      scheme === "dark" ? DashboardTheme.Dark : DashboardTheme.Light,
    );
  });
}

async function openDashboard(): Promise<void> {
  render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

  await waitFor(() => {
    expect(
      screen.getByRole("heading", { level: 1, name: "Acme Production" }),
    ).toBeInTheDocument();
  });
}

function headerLogos(): Array<HTMLImageElement> {
  return Array.from(
    document.querySelectorAll<HTMLImageElement>(
      '[data-testid="public-dashboard-header"] img',
    ),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("class");
  publicPostMock.mockReset();
});

afterEach(() => {
  cleanup();
  act(() => {
    DashboardThemeUtil.setVisitorChoice("auto");
    DashboardThemeUtil.setDashboardTheme(DashboardTheme.Light);
  });
});

describe("LogoPlate: which logo, on what", () => {
  const plate: (darkLogo: boolean, logo: boolean) => HTMLElement | null = (
    darkLogo: boolean,
    logo: boolean,
  ): HTMLElement | null => {
    const { container } = render(
      <LogoPlate
        className="flex-shrink-0"
        darkLogo={darkLogo ? <img alt="Acme" src="/dark.svg" /> : undefined}
      >
        {logo ? <img alt="Acme" src="/light.svg" /> : undefined}
      </LogoPlate>,
    );

    return container.firstElementChild as HTMLElement | null;
  };

  test("the light page draws the logo, never the dark theme logo", () => {
    setScheme("light");

    const element: HTMLElement = plate(true, true)!;

    expect(element.getAttribute(LOGO_VARIANT_ATTRIBUTE)).toBe("light");
    expect(element.querySelector("img")).toHaveAttribute("src", "/light.svg");
    expect(element.querySelectorAll("img")).toHaveLength(1);
    expect(element).toHaveClass("flex-shrink-0");
  });

  test("the dark page draws the dark theme logo as it is: no backdrop", () => {
    setScheme("dark");

    const element: HTMLElement = plate(true, true)!;

    expect(element.getAttribute(LOGO_VARIANT_ATTRIBUTE)).toBe("dark");
    expect(element.hasAttribute(LOGO_PLATE_ATTRIBUTE)).toBe(false);
    expect(element.querySelector("img")).toHaveAttribute("src", "/dark.svg");
    expect(element.querySelectorAll("img")).toHaveLength(1);
    expect(element).toHaveClass("flex-shrink-0");
  });

  test("without a dark theme logo, the dark page keeps the logo on its light backdrop", () => {
    setScheme("dark");

    const element: HTMLElement = plate(false, true)!;

    expect(element.getAttribute(LOGO_VARIANT_ATTRIBUTE)).toBe("light");
    expect(element.hasAttribute(LOGO_PLATE_ATTRIBUTE)).toBe(true);
    expect(element.querySelector("img")).toHaveAttribute("src", "/light.svg");
  });

  test("with only a dark theme logo, the light page draws no logo at all", () => {
    setScheme("light");

    expect(plate(true, false)).toBeNull();
  });

  test("follows the page as it turns dark and light again, while it is open", () => {
    setScheme("light");

    const { container } = render(
      <LogoPlate darkLogo={<img alt="Acme" src="/dark.svg" />}>
        <img alt="Acme" src="/light.svg" />
      </LogoPlate>,
    );

    expect(container.querySelector("img")).toHaveAttribute("src", "/light.svg");

    setScheme("dark");

    expect(container.querySelector("img")).toHaveAttribute("src", "/dark.svg");

    setScheme("light");

    expect(container.querySelector("img")).toHaveAttribute("src", "/light.svg");
  });

  test("marks which logo it drew as the status page's logo does", () => {
    expect(LOGO_VARIANT_ATTRIBUTE).toBe(STATUS_PAGE_LOGO_VARIANT_ATTRIBUTE);
  });
});

describe("the public dashboard's header", () => {
  test("draws the logo on the light page and the dark theme logo on the dark one", async () => {
    serve({ logoFile: LIGHT_LOGO, darkThemeLogoFile: DARK_LOGO });
    setScheme("light");

    await openDashboard();

    expect(headerLogos()).toHaveLength(1);
    expect(headerLogos()[0]).toHaveAttribute("src", LIGHT_LOGO_URL);
    expect(headerLogos()[0]).toHaveAttribute("alt", "Acme Production");

    setScheme("dark");

    expect(headerLogos()).toHaveLength(1);
    expect(headerLogos()[0]).toHaveAttribute("src", DARK_LOGO_URL);
    expect(headerLogos()[0]).toHaveAttribute("alt", "Acme Production");
    expect(headerLogos()[0]!.closest(`[${LOGO_PLATE_ATTRIBUTE}]`)).toBeNull();
  });

  test("a dashboard with no dark theme logo keeps its logo, on the backdrop, on the dark page", async () => {
    serve({ logoFile: LIGHT_LOGO, darkThemeLogoFile: null });
    setScheme("dark");

    await openDashboard();

    expect(headerLogos()).toHaveLength(1);
    expect(headerLogos()[0]).toHaveAttribute("src", LIGHT_LOGO_URL);
    expect(
      headerLogos()[0]!.closest(`[${LOGO_PLATE_ATTRIBUTE}]`),
    ).not.toBeNull();
  });

  test("a dashboard with only a dark theme logo shows it on the dark page, and nothing on the light one", async () => {
    serve({ logoFile: null, darkThemeLogoFile: DARK_LOGO });
    setScheme("light");

    await openDashboard();

    expect(headerLogos()).toHaveLength(0);

    setScheme("dark");

    expect(headerLogos()).toHaveLength(1);
    expect(headerLogos()[0]).toHaveAttribute("src", DARK_LOGO_URL);
  });

  test("a dashboard with no logo shows none, light or dark", async () => {
    serve({ logoFile: null, darkThemeLogoFile: null });
    setScheme("dark");

    await openDashboard();

    expect(headerLogos()).toHaveLength(0);

    setScheme("light");

    expect(headerLogos()).toHaveLength(0);
  });
});

describe("getImageDataUrl: an image the public API sends, as a data: URL", () => {
  test("its bytes and type", () => {
    expect(getImageDataUrl(LIGHT_LOGO)).toBe(LIGHT_LOGO_URL);
  });

  test("a PNG when the API names no type", () => {
    expect(getImageDataUrl({ file: "AAAA" })).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(getImageDataUrl({ file: "AAAA", fileType: "" })).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  test("nothing for an image the dashboard does not have, or that the API left out", () => {
    for (const value of [
      null,
      undefined,
      "",
      "AAAA",
      12,
      {},
      { file: "" },
      { file: 12 },
      { fileType: "image/png" },
    ]) {
      expect(getImageDataUrl(value)).toBeNull();
    }
  });
});
