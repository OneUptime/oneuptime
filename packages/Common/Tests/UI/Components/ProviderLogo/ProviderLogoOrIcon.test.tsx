import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeAll, describe, expect, test } from "@jest/globals";
import IconProp from "../../../../Types/Icon/IconProp";
import ProviderLogo from "../../../../Types/ProviderLogo/ProviderLogo";
import {
  PROVIDER_LOGO_COLOR_CLASS_NAME,
  PROVIDER_LOGO_TEST_ID_PREFIX,
  PROVIDER_LOGO_TILE_CLASS_NAME,
  PROVIDER_LOGO_TILE_ICON_CLASS_NAMES,
  ProviderLogoSize,
  getProviderLogoTileSizeClassName,
} from "../../../../UI/Components/ProviderLogo/ProviderLogoImage";
import ProviderLogoOrIcon, {
  PROVIDER_ICON_TILE_TEST_ID,
} from "../../../../UI/Components/ProviderLogo/ProviderLogoOrIcon";
import {
  getDrawnMark,
  getDrawnPathData,
  getMarkPathData,
  preloadProviderLogoMarks,
} from "../../../Helpers/ProviderLogoMarks";

/*
 * What stands for a destination, a connection or a step: its product's
 * official mark, or - for a generic thing such as a webhook, syslog or any
 * S3-compatible storage - its icon, on the same neutral tile, in the same
 * grey, at the same size, so a list that mixes the two reads as one set
 * (the maintainer's screenshot of the audit log export showed colour
 * images beside grey outline icons). Both are inline SVG: never an image.
 */

const SIZES: Array<ProviderLogoSize> = [16, 20, 24, 28, 32, 36, 40, 44, 48];

beforeAll(async (): Promise<void> => {
  await preloadProviderLogoMarks();
});

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(" ").filter(Boolean);
}

describe("ProviderLogoOrIcon", () => {
  describe("with a logo", () => {
    test("draws the product's mark, inline, not the icon", () => {
      render(
        <ProviderLogoOrIcon
          logo={ProviderLogo.GoogleCloudStorage}
          icon={IconProp.Archive}
        />,
      );

      const logo: HTMLElement = screen.getByTestId(
        `${PROVIDER_LOGO_TEST_ID_PREFIX}google-cloud-storage`,
      );

      expect(logo).toHaveAttribute("data-provider-logo", "google-cloud-storage");
      expect(logo.querySelector("img")).toBeNull();
      expect(getDrawnPathData(getDrawnMark(logo))).toEqual(
        getMarkPathData(ProviderLogo.GoogleCloudStorage),
      );
      expect(screen.queryByTestId(PROVIDER_ICON_TILE_TEST_ID)).toBeNull();
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

    test("bare, it is the mark alone, an icon's size, the icon's grey", () => {
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
      expect(classesOf(logo)).toContain(PROVIDER_LOGO_COLOR_CLASS_NAME);
      expect(getDrawnMark(logo)).toHaveAttribute("width", "16");
    });

    test("the colour given colours the mark, as it does the icon", () => {
      render(
        <div>
          <ProviderLogoOrIcon
            logo={ProviderLogo.Kubernetes}
            icon={IconProp.Kubernetes}
            isBare={true}
            colorClassName="text-indigo-600"
          />
          <ProviderLogoOrIcon
            icon={IconProp.Code}
            isBare={true}
            colorClassName="text-indigo-600"
          />
        </div>,
      );

      expect(
        screen.getByTestId(`${PROVIDER_LOGO_TEST_ID_PREFIX}kubernetes`),
      ).toHaveClass("text-indigo-600");
      expect(
        document.querySelector(
          `svg[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`,
        ),
      ).toHaveClass("text-indigo-600");
    });

    test("a brand that allows no logo here is drawn by its icon of OneUptime's, on the same tile", () => {
      render(
        <ProviderLogoOrIcon
          logo={ProviderLogo.AmazonS3}
          icon={IconProp.Archive}
        />,
      );

      const logo: HTMLElement = screen.getByTestId(
        `${PROVIDER_LOGO_TEST_ID_PREFIX}amazon-s3`,
      );

      expect(logo).toHaveAttribute("data-provider-logo-icon", IconProp.Archive);
      expect(getDrawnMark(logo)).toBeNull();
      expect(logo.querySelectorAll("svg")).toHaveLength(1);
      expect(classesOf(logo)).toEqual(
        expect.arrayContaining(PROVIDER_LOGO_TILE_CLASS_NAME.split(" ")),
      );
    });
  });

  describe("without a logo: a generic thing", () => {
    test("draws its icon on the marks' neutral tile, out of the reading order", () => {
      render(<ProviderLogoOrIcon icon={IconProp.Link} />);

      const tile: HTMLElement = screen.getByTestId(PROVIDER_ICON_TILE_TEST_ID);

      expect(tile).toHaveAttribute("aria-hidden", "true");
      expect(tile.querySelector("svg")).not.toBeNull();
      expect(classesOf(tile)).toEqual(
        expect.arrayContaining([
          ...PROVIDER_LOGO_TILE_CLASS_NAME.split(" "),
          ...getProviderLogoTileSizeClassName(40).split(" "),
          PROVIDER_LOGO_COLOR_CLASS_NAME,
        ]),
      );
      expect(tile.querySelector("img")).toBeNull();
    });

    test.each(SIZES)(
      "a %i pixel tile is the same size as a mark's, with the same icon",
      (size: ProviderLogoSize) => {
        render(<ProviderLogoOrIcon icon={IconProp.Webhook} size={size} />);

        const tile: HTMLElement = screen.getByTestId(PROVIDER_ICON_TILE_TEST_ID);

        expect(classesOf(tile)).toEqual(
          expect.arrayContaining(
            getProviderLogoTileSizeClassName(size).split(" "),
          ),
        );
        expect(classesOf(tile.querySelector("svg")!)).toEqual(
          expect.arrayContaining(
            PROVIDER_LOGO_TILE_ICON_CLASS_NAMES[size].split(" "),
          ),
        );
      },
    );

    test("the colour given colours the icon on its tile", () => {
      render(
        <ProviderLogoOrIcon
          icon={IconProp.Terminal}
          colorClassName="text-indigo-600"
        />,
      );

      const tile: HTMLElement = screen.getByTestId(PROVIDER_ICON_TILE_TEST_ID);

      expect(tile).toHaveClass("text-indigo-600");
      expect(tile).not.toHaveClass(PROVIDER_LOGO_COLOR_CLASS_NAME);
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
        expect.arrayContaining(["h-4", "w-4", PROVIDER_LOGO_COLOR_CLASS_NAME]),
      );
    });
  });

  test("a mark and an icon of one size sit on tiles of the same classes", () => {
    render(
      <div>
        <ProviderLogoOrIcon
          logo={ProviderLogo.GoogleCloudStorage}
          icon={IconProp.Archive}
          size={36}
        />
        <ProviderLogoOrIcon icon={IconProp.Webhook} size={36} />
      </div>,
    );

    const logoTile: Array<string> = classesOf(
      screen.getByTestId(`${PROVIDER_LOGO_TEST_ID_PREFIX}google-cloud-storage`),
    );
    const iconTile: Array<string> = classesOf(
      screen.getByTestId(PROVIDER_ICON_TILE_TEST_ID),
    );
    const shared: Array<string> = [
      ...PROVIDER_LOGO_TILE_CLASS_NAME.split(" "),
      ...getProviderLogoTileSizeClassName(36).split(" "),
      PROVIDER_LOGO_COLOR_CLASS_NAME,
    ];

    expect(logoTile).toEqual(expect.arrayContaining(shared));
    expect(iconTile).toEqual(expect.arrayContaining(shared));
  });
});
