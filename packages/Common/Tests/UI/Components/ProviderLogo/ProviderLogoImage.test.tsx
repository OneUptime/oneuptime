import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ProviderLogo, {
  ALL_PROVIDER_LOGOS,
  PROVIDER_LOGO_NAMES,
} from "../../../../Types/ProviderLogo/ProviderLogo";
import ProviderLogoImage, {
  PROVIDER_LOGO_TEST_ID_PREFIX,
  PROVIDER_LOGO_TILE_CLASS_NAME,
  ProviderLogoSize,
  getProviderLogoTileSizeClassName,
} from "../../../../UI/Components/ProviderLogo/ProviderLogoImage";
import ThemeUtil, { Theme } from "../../../../UI/Utils/Theme";

/*
 * A third-party product's official logo (official logos audit): drawn on a
 * neutral tile at its own proportions, named for a screen reader unless its
 * name is written beside it, and in the brand's mark for dark backgrounds on
 * the dark theme. The files are made addresses here (the bundler makes them
 * data: URLs in the app), so a test can tell which file an image shows.
 */

const requested: Array<string> = [];

jest.mock("../../../../UI/Components/ProviderLogo/ProviderLogoAssets", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Components/ProviderLogo/ProviderLogoAssets",
  ) as Record<string, unknown>;
  const loaded: Map<string, string> = new Map();

  return {
    __esModule: true,
    ...actual,
    getLoadedProviderLogoFile: (fileName: string): string | undefined => {
      return loaded.get(fileName);
    },
    loadProviderLogoFile: async (
      fileName: string,
    ): Promise<string | undefined> => {
      requested.push(fileName);
      const address: string = `data:image/svg+xml;utf8,${fileName}`;
      loaded.set(fileName, address);
      return address;
    },
  };
});

const SIZES: Array<ProviderLogoSize> = [16, 20, 24, 28, 32, 36, 40, 44, 48];

function tileOf(logo: ProviderLogo): HTMLElement {
  return screen.getByTestId(`${PROVIDER_LOGO_TEST_ID_PREFIX}${logo}`);
}

async function imageOf(logo: ProviderLogo): Promise<HTMLImageElement> {
  let found: HTMLImageElement | null = null;

  await waitFor(() => {
    found = tileOf(logo).querySelector("img");
    expect(found).not.toBeNull();
  });

  return found as unknown as HTMLImageElement;
}

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(" ").filter(Boolean);
}

describe("ProviderLogoImage", () => {
  beforeEach(() => {
    requested.length = 0;
    ThemeUtil.applyTheme(Theme.Light, false);
  });

  afterEach(() => {
    ThemeUtil.applyTheme(Theme.Light, false);
  });

  describe("its name", () => {
    test("is the product's own, read out as the image's name", async () => {
      render(<ProviderLogoImage logo={ProviderLogo.AmazonS3} />);

      const tile: HTMLElement = screen.getByRole("img", { name: "Amazon S3" });

      expect(tile).toBe(tileOf(ProviderLogo.AmazonS3));
      expect(tile).toHaveAttribute("data-provider-logo", "amazon-s3");
      // The picture inside says nothing of its own: the tile names it.
      expect((await imageOf(ProviderLogo.AmazonS3)).getAttribute("alt")).toBe(
        "",
      );
    });

    test("is not read out again when the name is written beside it", async () => {
      render(
        <div>
          <ProviderLogoImage logo={ProviderLogo.Slack} isDecorative={true} />
          <span>Slack</span>
        </div>,
      );

      const tile: HTMLElement = tileOf(ProviderLogo.Slack);

      expect(tile).toHaveAttribute("aria-hidden", "true");
      expect(tile).not.toHaveAttribute("role");
      expect(tile).not.toHaveAttribute("aria-label");
      expect(screen.queryByRole("img")).toBeNull();
      expect((await imageOf(ProviderLogo.Slack)).getAttribute("alt")).toBe("");
    });

    test.each(ALL_PROVIDER_LOGOS)(
      "%s is read out as its product's name",
      (logo: ProviderLogo) => {
        render(<ProviderLogoImage logo={logo} />);

        expect(tileOf(logo)).toHaveAttribute(
          "aria-label",
          PROVIDER_LOGO_NAMES[logo],
        );
      },
    );
  });

  describe("its file", () => {
    test("is the logo's own file, drawn once it has loaded", async () => {
      render(<ProviderLogoImage logo={ProviderLogo.PagerDuty} />);

      const image: HTMLImageElement = await imageOf(ProviderLogo.PagerDuty);

      expect(image.getAttribute("src")).toBe(
        "data:image/svg+xml;utf8,pagerduty.svg",
      );
      expect(image).toHaveAttribute("data-provider-logo-file", "pagerduty.svg");
      expect(image).toHaveAttribute("draggable", "false");
      // The whole mark is shown, at its own proportions.
      expect(classesOf(image)).toEqual(
        expect.arrayContaining(["h-full", "w-full", "object-contain"]),
      );
    });

    test("is not asked for again once it has loaded", async () => {
      const { unmount } = render(
        <ProviderLogoImage logo={ProviderLogo.Grafana} />,
      );
      await imageOf(ProviderLogo.Grafana);
      unmount();
      requested.length = 0;

      render(<ProviderLogoImage logo={ProviderLogo.Grafana} />);

      // Drawn at once, from what was loaded: no empty tile, no request.
      expect(tileOf(ProviderLogo.Grafana).querySelector("img")).not.toBeNull();
      expect(requested).toEqual([]);
    });

    test("follows the logo it is given", async () => {
      const { rerender } = render(
        <ProviderLogoImage logo={ProviderLogo.Discord} />,
      );
      await imageOf(ProviderLogo.Discord);

      rerender(<ProviderLogoImage logo={ProviderLogo.Telegram} />);

      const image: HTMLImageElement = await imageOf(ProviderLogo.Telegram);
      expect(image).toHaveAttribute("data-provider-logo-file", "telegram.svg");
      expect(
        screen.queryByTestId(`${PROVIDER_LOGO_TEST_ID_PREFIX}discord`),
      ).toBeNull();
    });
  });

  describe("on the dark theme", () => {
    test("a brand whose mark disappears on dark draws its mark for dark backgrounds", async () => {
      ThemeUtil.applyTheme(Theme.Dark, false);

      render(<ProviderLogoImage logo={ProviderLogo.OpenAI} />);

      expect(await imageOf(ProviderLogo.OpenAI)).toHaveAttribute(
        "data-provider-logo-file",
        "openai-dark.svg",
      );
      expect(requested).toEqual(["openai-dark.svg"]);
    });

    test("a colour mark that reads on dark keeps it", async () => {
      ThemeUtil.applyTheme(Theme.Dark, false);

      render(<ProviderLogoImage logo={ProviderLogo.Slack} />);

      expect(await imageOf(ProviderLogo.Slack)).toHaveAttribute(
        "data-provider-logo-file",
        "slack.svg",
      );
    });

    test("switching theme switches the mark, without reloading the page", async () => {
      render(<ProviderLogoImage logo={ProviderLogo.Aws} />);

      expect(await imageOf(ProviderLogo.Aws)).toHaveAttribute(
        "data-provider-logo-file",
        "aws.svg",
      );

      act(() => {
        ThemeUtil.applyTheme(Theme.Dark);
      });

      await waitFor(() => {
        expect(tileOf(ProviderLogo.Aws).querySelector("img")).toHaveAttribute(
          "data-provider-logo-file",
          "aws-dark.svg",
        );
      });

      act(() => {
        ThemeUtil.applyTheme(Theme.Light);
      });

      await waitFor(() => {
        expect(tileOf(ProviderLogo.Aws).querySelector("img")).toHaveAttribute(
          "data-provider-logo-file",
          "aws.svg",
        );
      });
    });
  });

  describe("its tile", () => {
    test("is the neutral tile every logo shares: white, with a hairline edge", () => {
      render(<ProviderLogoImage logo={ProviderLogo.Wasabi} />);

      expect(classesOf(tileOf(ProviderLogo.Wasabi))).toEqual(
        expect.arrayContaining([
          ...PROVIDER_LOGO_TILE_CLASS_NAME.split(" "),
          ...getProviderLogoTileSizeClassName(40).split(" "),
        ]),
      );
      // Only colours the dark theme re-colours (Theme.css): bg-white, ring-gray-200.
      expect(PROVIDER_LOGO_TILE_CLASS_NAME).toBe(
        "bg-white ring-1 ring-inset ring-gray-200",
      );
    });

    test.each(SIZES)(
      "is %i pixels when asked for that size",
      (size: number) => {
        render(
          <ProviderLogoImage
            logo={ProviderLogo.Python}
            size={size as ProviderLogoSize}
          />,
        );

        const tile: HTMLElement = tileOf(ProviderLogo.Python);
        const tileClasses: Array<string> = getProviderLogoTileSizeClassName(
          size as ProviderLogoSize,
        ).split(" ");

        expect(classesOf(tile)).toEqual(expect.arrayContaining(tileClasses));
        // Tailwind's scale: size / 4, so 40 pixels is h-10 w-10.
        expect(tileClasses).toContain(`h-${size / 4}`);
        expect(tileClasses).toContain(`w-${size / 4}`);
      },
    );

    test("is 40 pixels when no size is given", () => {
      render(<ProviderLogoImage logo={ProviderLogo.Python} />);

      expect(classesOf(tileOf(ProviderLogo.Python))).toEqual(
        expect.arrayContaining(["h-10", "w-10"]),
      );
    });

    test("holds a square mark inside it, smaller than the tile", () => {
      render(<ProviderLogoImage logo={ProviderLogo.Slack} size={40} />);

      const mark: Element = tileOf(ProviderLogo.Slack).firstElementChild!;

      expect(classesOf(mark)).toEqual(expect.arrayContaining(["h-6", "w-6"]));
    });

    test("holds a wide logo across its inside, so a wordmark is not shrunk to a square", () => {
      render(<ProviderLogoImage logo={ProviderLogo.Aws} size={40} />);

      const mark: Element = tileOf(ProviderLogo.Aws).firstElementChild!;

      expect(classesOf(mark)).toEqual(expect.arrayContaining(["h-6", "w-8"]));
    });

    test("keeps the classes it is given", () => {
      render(<ProviderLogoImage logo={ProviderLogo.Ruby} className="mt-0.5" />);

      expect(classesOf(tileOf(ProviderLogo.Ruby))).toContain("mt-0.5");
    });
  });

  describe("bare, beside words", () => {
    test("is the mark alone: no tile, no edge", () => {
      render(<ProviderLogoImage logo={ProviderLogo.Go} isBare={true} />);

      const classes: Array<string> = classesOf(tileOf(ProviderLogo.Go));

      expect(classes).not.toContain("bg-white");
      expect(classes).not.toContain("ring-1");
    });

    test("is an icon's size, 16 pixels, when no size is given", () => {
      render(<ProviderLogoImage logo={ProviderLogo.React} isBare={true} />);

      const mark: Element = tileOf(ProviderLogo.React).firstElementChild!;

      expect(classesOf(mark)).toEqual(expect.arrayContaining(["h-4", "w-4"]));
    });

    test("is still named for a screen reader unless its name is beside it", () => {
      render(<ProviderLogoImage logo={ProviderLogo.Rust} isBare={true} />);

      expect(screen.getByRole("img", { name: "Rust" })).toBe(
        tileOf(ProviderLogo.Rust),
      );
    });
  });
});
