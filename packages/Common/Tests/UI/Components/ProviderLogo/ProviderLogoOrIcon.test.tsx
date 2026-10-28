import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import IconProp from "../../../../Types/Icon/IconProp";
import ProviderLogo from "../../../../Types/ProviderLogo/ProviderLogo";
import {
  PROVIDER_LOGO_TEST_ID_PREFIX,
  PROVIDER_LOGO_TILE_CLASS_NAME,
  ProviderLogoSize,
  getProviderLogoTileSizeClassName,
} from "../../../../UI/Components/ProviderLogo/ProviderLogoImage";
import ProviderLogoOrIcon, {
  PROVIDER_ICON_TILE_TEST_ID,
} from "../../../../UI/Components/ProviderLogo/ProviderLogoOrIcon";

/*
 * What stands for a destination, a connection or a step (official logos
 * audit): its product's official logo, or - for a generic thing such as a
 * webhook, syslog or any S3-compatible storage - its icon, on the same
 * neutral tile, so a list that mixes the two reads as one set.
 */

jest.mock("../../../../UI/Components/ProviderLogo/ProviderLogoAssets", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Components/ProviderLogo/ProviderLogoAssets",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    getLoadedProviderLogoFile: (fileName: string): string => {
      return `data:image/svg+xml;utf8,${fileName}`;
    },
  };
});

const SIZES: Array<ProviderLogoSize> = [16, 20, 24, 28, 32, 36, 40, 44, 48];

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(" ").filter(Boolean);
}

describe("ProviderLogoOrIcon", () => {
  describe("with a logo", () => {
    test("draws the product's logo, not the icon", () => {
      render(
        <ProviderLogoOrIcon
          logo={ProviderLogo.AmazonS3}
          icon={IconProp.Archive}
        />,
      );

      const logo: HTMLElement = screen.getByTestId(
        `${PROVIDER_LOGO_TEST_ID_PREFIX}amazon-s3`,
      );

      expect(logo).toHaveAttribute("data-provider-logo", "amazon-s3");
      expect(logo.querySelector("img")).not.toBeNull();
      expect(screen.queryByTestId(PROVIDER_ICON_TILE_TEST_ID)).toBeNull();
      expect(logo.querySelector("svg")).toBeNull();
    });

    test("is named for a screen reader, unless its name is written beside it", () => {
      const { unmount } = render(
        <ProviderLogoOrIcon logo={ProviderLogo.Slack} icon={IconProp.Slack} />,
      );

      expect(screen.getByRole("img", { name: "Slack" })).toBeInTheDocument();
      unmount();

      render(
        <ProviderLogoOrIcon
          logo={ProviderLogo.Slack}
          icon={IconProp.Slack}
          isDecorative={true}
        />,
      );

      expect(screen.queryByRole("img")).toBeNull();
      expect(
        screen.getByTestId(`${PROVIDER_LOGO_TEST_ID_PREFIX}slack`),
      ).toHaveAttribute("aria-hidden", "true");
    });

    test("is a 40 pixel tile when no size is given, and the size given otherwise", () => {
      const { unmount } = render(
        <ProviderLogoOrIcon logo={ProviderLogo.Okta} icon={IconProp.Key} />,
      );

      expect(
        classesOf(screen.getByTestId(`${PROVIDER_LOGO_TEST_ID_PREFIX}okta`)),
      ).toEqual(expect.arrayContaining(["h-10", "w-10"]));
      unmount();

      render(
        <ProviderLogoOrIcon
          logo={ProviderLogo.Okta}
          icon={IconProp.Key}
          size={24}
        />,
      );

      expect(
        classesOf(screen.getByTestId(`${PROVIDER_LOGO_TEST_ID_PREFIX}okta`)),
      ).toEqual(expect.arrayContaining(["h-6", "w-6"]));
    });

    test("bare, it is the logo alone, an icon's size", () => {
      render(
        <ProviderLogoOrIcon
          logo={ProviderLogo.Python}
          icon={IconProp.Code}
          isBare={true}
          iconClassName="h-4 w-4 text-gray-500"
        />,
      );

      const logo: HTMLElement = screen.getByTestId(
        `${PROVIDER_LOGO_TEST_ID_PREFIX}python`,
      );

      expect(classesOf(logo)).not.toContain("bg-white");
      expect(classesOf(logo.firstElementChild!)).toEqual(
        expect.arrayContaining(["h-4", "w-4"]),
      );
    });
  });

  describe("without a logo: a generic thing", () => {
    test("draws its icon on the logo's neutral tile, out of the reading order", () => {
      render(<ProviderLogoOrIcon icon={IconProp.Link} />);

      const tile: HTMLElement = screen.getByTestId(PROVIDER_ICON_TILE_TEST_ID);

      expect(tile).toHaveAttribute("aria-hidden", "true");
      expect(tile.querySelector("svg")).not.toBeNull();
      expect(classesOf(tile)).toEqual(
        expect.arrayContaining([
          ...PROVIDER_LOGO_TILE_CLASS_NAME.split(" "),
          ...getProviderLogoTileSizeClassName(40).split(" "),
          "text-gray-500",
        ]),
      );
      expect(tile.querySelector("img")).toBeNull();
    });

    test.each(SIZES)(
      "a %i pixel tile is the same size as a logo's",
      (size: ProviderLogoSize) => {
        render(<ProviderLogoOrIcon icon={IconProp.Webhook} size={size} />);

        expect(
          classesOf(screen.getByTestId(PROVIDER_ICON_TILE_TEST_ID)),
        ).toEqual(
          expect.arrayContaining(
            getProviderLogoTileSizeClassName(size).split(" "),
          ),
        );
      },
    );

    test("the icon is smaller than its tile, as a logo's mark is", () => {
      render(<ProviderLogoOrIcon icon={IconProp.Terminal} size={40} />);

      const svg: SVGElement | null = screen
        .getByTestId(PROVIDER_ICON_TILE_TEST_ID)
        .querySelector("svg");

      expect(svg).not.toBeNull();
      expect(classesOf(svg!)).toEqual(expect.arrayContaining(["h-5", "w-5"]));
    });

    test("bare, it is the icon alone, in the colour and place given", () => {
      render(
        <ProviderLogoOrIcon
          icon={IconProp.Server}
          isBare={true}
          iconClassName="h-4 w-4 text-gray-500"
          className="mt-0.5"
        />,
      );

      const svg: Element | null = document.querySelector(
        `svg[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`,
      );

      expect(svg).not.toBeNull();
      expect(classesOf(svg!)).toEqual(
        expect.arrayContaining(["h-4", "w-4", "text-gray-500", "mt-0.5"]),
      );
      // No tile around it.
      expect(document.querySelector(".ring-1")).toBeNull();
    });

    test("bare without classes of its own, it is a grey 16 pixel icon", () => {
      render(<ProviderLogoOrIcon icon={IconProp.Server} isBare={true} />);

      const svg: Element | null = document.querySelector(
        `svg[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`,
      );

      expect(classesOf(svg!)).toEqual(
        expect.arrayContaining(["h-4", "w-4", "text-gray-500"]),
      );
    });
  });

  test("a logo and an icon of one size sit on tiles of the same classes", () => {
    render(
      <div>
        <ProviderLogoOrIcon
          logo={ProviderLogo.AmazonS3}
          icon={IconProp.Archive}
          size={36}
        />
        <ProviderLogoOrIcon icon={IconProp.Webhook} size={36} />
      </div>,
    );

    const logoTile: Array<string> = classesOf(
      screen.getByTestId(`${PROVIDER_LOGO_TEST_ID_PREFIX}amazon-s3`),
    );
    const iconTile: Array<string> = classesOf(
      screen.getByTestId(PROVIDER_ICON_TILE_TEST_ID),
    );
    const shared: Array<string> = [
      ...PROVIDER_LOGO_TILE_CLASS_NAME.split(" "),
      ...getProviderLogoTileSizeClassName(36).split(" "),
    ];

    expect(logoTile).toEqual(expect.arrayContaining(shared));
    expect(iconTile).toEqual(expect.arrayContaining(shared));
  });
});
