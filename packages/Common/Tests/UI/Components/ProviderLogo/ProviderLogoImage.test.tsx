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
import IconProp from "../../../../Types/Icon/IconProp";
import ProviderLogo, {
  ALL_PROVIDER_LOGOS,
  PROVIDER_LOGO_NAMES,
} from "../../../../Types/ProviderLogo/ProviderLogo";
import ALL_PROVIDER_LOGO_MARKS from "../../../../Types/ProviderLogo/AllProviderLogoMarks";
import { ProviderLogoMarkShapes } from "../../../../Types/ProviderLogo/ProviderLogoMark";
import {
  getProviderLogoMark,
  getProviderLogoMarkBox,
  getProviderLogoStandInIcon,
  PROVIDER_LOGO_MARK_BOXES,
} from "../../../../Types/ProviderLogo/ProviderLogoMarks";
import Icon from "../../../../UI/Components/Icon/Icon";
import ProviderLogoImage, {
  getProviderLogoDrawnSize,
  getProviderLogoTileSizeClassName,
  PROVIDER_LOGO_COLOR_CLASS_NAME,
  PROVIDER_LOGO_TEST_ID_PREFIX,
  PROVIDER_LOGO_TILE_CLASS_NAME,
  PROVIDER_LOGO_TILE_ICON_CLASS_NAMES,
  PROVIDER_LOGO_TILE_ICON_SIZES,
  ProviderLogoSize,
} from "../../../../UI/Components/ProviderLogo/ProviderLogoImage";
import ThemeUtil, { Theme } from "../../../../UI/Utils/Theme";

/*
 * A third-party product's official mark (icons-svg-one-color): drawn as the
 * product's own icons are - an inline SVG whose every shape is filled with
 * the current colour - on the tile a generic icon sits on, at the mark's
 * own proportions; named for a screen reader unless its name is written
 * beside it. Never an image, never in the brand's colours, the same in the
 * light and the dark theme (the colour around it changes, not the mark).
 *
 * The loader is held here: a test says when a mark arrives, so the room a
 * mark keeps while it loads can be seen, and which marks were asked for.
 */

const requested: Array<ProviderLogo> = [];
const loaded: Map<ProviderLogo, ProviderLogoMarkShapes> = new Map();
let holdLoads: boolean = false;
const held: Array<() => void> = [];

jest.mock(
  "../../../../UI/Components/ProviderLogo/ProviderLogoMarkLoader",
  () => {
    return {
      __esModule: true,
      getLoadedProviderLogoMark: (
        mark: ProviderLogo,
      ): ProviderLogoMarkShapes | undefined => {
        return loaded.get(mark);
      },
      loadProviderLogoMark: (
        mark: ProviderLogo,
      ): Promise<ProviderLogoMarkShapes | undefined> => {
        requested.push(mark);
        const shapes: ProviderLogoMarkShapes | undefined =
          ALL_PROVIDER_LOGO_MARKS[mark];

        return new Promise(
          (
            resolve: (value: ProviderLogoMarkShapes | undefined) => void,
          ): void => {
            const arrive: () => void = (): void => {
              if (shapes) {
                loaded.set(mark, shapes);
              }
              resolve(shapes);
            };

            if (holdLoads) {
              held.push(arrive);
            } else {
              arrive();
            }
          },
        );
      },
    };
  },
);

const SIZES: Array<ProviderLogoSize> = [16, 20, 24, 28, 32, 36, 40, 44, 48];

function tileOf(logo: ProviderLogo): HTMLElement {
  return screen.getByTestId(`${PROVIDER_LOGO_TEST_ID_PREFIX}${logo}`);
}

function markOf(logo: ProviderLogo): SVGElement | null {
  return tileOf(logo).querySelector("svg[data-provider-logo-mark-svg]");
}

function pathData(svg: Element | null): Array<string> {
  return Array.from(svg?.querySelectorAll("path") || []).map(
    (path: SVGPathElement): string => {
      return path.getAttribute("d") || "";
    },
  );
}

function registryPathData(logo: ProviderLogo): Array<string> {
  const mark: ProviderLogo | undefined = getProviderLogoMark(logo);

  return (mark ? ALL_PROVIDER_LOGO_MARKS[mark] || [] : []).map(
    (shape: { d: string }): string => {
      return shape.d;
    },
  );
}

async function drawn(
  element: React.ReactElement,
  logo: ProviderLogo,
): Promise<HTMLElement> {
  render(element);

  if (getProviderLogoMark(logo)) {
    await waitFor(() => {
      expect(markOf(logo)).not.toBeNull();
    });
  }

  return tileOf(logo);
}

beforeEach((): void => {
  requested.length = 0;
  loaded.clear();
  holdLoads = false;
  held.length = 0;
});

afterEach((): void => {
  ThemeUtil.setTheme(Theme.Light);
});

describe("ProviderLogoImage", () => {
  describe("every product is drawn, never as an image", () => {
    test.each(ALL_PROVIDER_LOGOS)(
      "%s is its one-colour mark, or the icon its brand's rules ask for",
      async (logo: ProviderLogo) => {
        const tile: HTMLElement = await drawn(
          <ProviderLogoImage logo={logo} />,
          logo,
        );

        expect(tile.querySelector("img")).toBeNull();
        expect(tile).toHaveAttribute("data-provider-logo", logo);

        const standIn: IconProp | undefined = getProviderLogoStandInIcon(logo);

        if (standIn) {
          expect(tile).toHaveAttribute("data-provider-logo-icon", standIn);
          expect(markOf(logo)).toBeNull();
          expect(tile.querySelectorAll("svg")).toHaveLength(1);
          return;
        }

        const svg: SVGElement = markOf(logo)!;

        expect(pathData(svg)).toEqual(registryPathData(logo));
        expect(svg.getAttribute("viewBox")).toBe(
          getProviderLogoMarkBox(logo)!.viewBox,
        );
        expect(svg).toHaveAttribute("fill", "currentColor");
        expect(svg).toHaveAttribute("aria-hidden", "true");
        expect(svg).toHaveAttribute("focusable", "false");

        for (const path of Array.from(svg.querySelectorAll("path"))) {
          expect(path).toHaveAttribute("fill", "currentColor");
          expect(path).toHaveAttribute("stroke", "none");
          expect(path.getAttribute("style")).toBeNull();
        }
      },
    );

    test("a product is drawn by its maker's mark where it has none of its own", async () => {
      const tile: HTMLElement = await drawn(
        <ProviderLogoImage logo={ProviderLogo.GoogleCloudStorage} />,
        ProviderLogo.GoogleCloudStorage,
      );

      expect(tile).toHaveAttribute("data-provider-logo-mark", "google-cloud");
      expect(pathData(markOf(ProviderLogo.GoogleCloudStorage))).toEqual(
        registryPathData(ProviderLogo.GoogleCloud),
      );
      // Its own name, not its maker's, is what it is read out as.
      expect(tile).toHaveAccessibleName("Google Cloud Storage");
    });

    test("Amazon Web Services is OneUptime's cloud icon: AWS asks to be named in plain text only", () => {
      render(<ProviderLogoImage logo={ProviderLogo.Aws} size={40} />);

      const tile: HTMLElement = tileOf(ProviderLogo.Aws);
      const { container } = render(
        <Icon
          icon={IconProp.Cloud}
          className={PROVIDER_LOGO_TILE_ICON_CLASS_NAMES[40]}
        />,
      );

      expect(tile).toHaveAttribute("data-provider-logo-icon", IconProp.Cloud);
      expect(tile.querySelector("svg")!.innerHTML).toBe(
        container.querySelector("svg")!.innerHTML,
      );
      // Nothing to load: an icon is drawn at once.
      expect(requested).toEqual([]);
      expect(tile).toHaveAccessibleName("Amazon Web Services");
    });

    test("a shape the brand draws lighter keeps its lightness as an opacity of the one colour", async () => {
      await drawn(
        <ProviderLogoImage logo={ProviderLogo.UptimeRobot} />,
        ProviderLogo.UptimeRobot,
      );

      const paths: Array<SVGPathElement> = Array.from(
        markOf(ProviderLogo.UptimeRobot)!.querySelectorAll("path"),
      );

      expect(paths).toHaveLength(2);
      expect(paths[0]).toHaveAttribute("fill-opacity", "0.4");
      expect(paths[1]).not.toHaveAttribute("fill-opacity");
      for (const path of paths) {
        expect(path).toHaveAttribute("fill", "currentColor");
      }
    });
  });

  describe("colour", () => {
    test("on a tile it is the grey of a tile's icon", async () => {
      const tile: HTMLElement = await drawn(
        <ProviderLogoImage logo={ProviderLogo.Slack} />,
        ProviderLogo.Slack,
      );

      expect(tile).toHaveClass(PROVIDER_LOGO_COLOR_CLASS_NAME);
      expect(tile).toHaveClass(...PROVIDER_LOGO_TILE_CLASS_NAME.split(" "));
    });

    test("bare it is the same grey, unless the place gives its own colour", async () => {
      const bare: HTMLElement = await drawn(
        <ProviderLogoImage logo={ProviderLogo.Slack} isBare={true} />,
        ProviderLogo.Slack,
      );

      expect(bare).toHaveClass(PROVIDER_LOGO_COLOR_CLASS_NAME);
      expect(bare).not.toHaveClass("bg-white");
    });

    test("a place that colours its icons colours the mark the same", async () => {
      const tile: HTMLElement = await drawn(
        <ProviderLogoImage
          logo={ProviderLogo.Python}
          isBare={true}
          colorClassName="text-indigo-600"
        />,
        ProviderLogo.Python,
      );

      expect(tile).toHaveClass("text-indigo-600");
      expect(tile).not.toHaveClass(PROVIDER_LOGO_COLOR_CLASS_NAME);
    });

    test("the dark theme draws the same mark: its colour comes from around it", async () => {
      const light: string = (
        await drawn(
          <ProviderLogoImage logo={ProviderLogo.OpenAI} />,
          ProviderLogo.OpenAI,
        )
      ).outerHTML;

      act(() => {
        ThemeUtil.setTheme(Theme.Dark);
      });

      expect(tileOf(ProviderLogo.OpenAI).outerHTML).toBe(light);
    });
  });

  describe("sizes", () => {
    test.each(SIZES)("a %spx tile has its size and corners", (size: number) => {
      render(
        <ProviderLogoImage
          logo={ProviderLogo.Aws}
          size={size as ProviderLogoSize}
        />,
      );

      expect(tileOf(ProviderLogo.Aws)).toHaveClass(
        ...getProviderLogoTileSizeClassName(size as ProviderLogoSize).split(
          " ",
        ),
      );
    });

    test.each(SIZES)(
      "on a %spx tile a square mark is as large as the tile's icon",
      async (size: number) => {
        await drawn(
          <ProviderLogoImage
            logo={ProviderLogo.Okta}
            size={size as ProviderLogoSize}
          />,
          ProviderLogo.Okta,
        );

        const svg: SVGElement = markOf(ProviderLogo.Okta)!;
        const icon: number =
          PROVIDER_LOGO_TILE_ICON_SIZES[size as ProviderLogoSize];

        expect(svg).toHaveAttribute("width", String(icon));
        expect(svg).toHaveAttribute("height", String(icon));
      },
    );

    test("a tall mark is as tall as the tile's icon, at its own width", async () => {
      await drawn(
        <ProviderLogoImage logo={ProviderLogo.MinIO} size={40} />,
        ProviderLogo.MinIO,
      );

      const svg: SVGElement = markOf(ProviderLogo.MinIO)!;

      expect(svg).toHaveAttribute("height", "20");
      expect(Number(svg.getAttribute("width"))).toBeLessThan(12);
    });

    test("a wordmark is given more width, never past three quarters of the tile", async () => {
      await drawn(
        <ProviderLogoImage logo={ProviderLogo.Zoom} size={40} />,
        ProviderLogo.Zoom,
      );

      const svg: SVGElement = markOf(ProviderLogo.Zoom)!;

      expect(svg).toHaveAttribute("width", "30");
      expect(Number(svg.getAttribute("height"))).toBeCloseTo(30 / 4.397, 0);
    });

    test("a bare mark keeps an icon's square, so the words after a column of marks line up", async () => {
      const tile: HTMLElement = await drawn(
        <ProviderLogoImage logo={ProviderLogo.MinIO} isBare={true} />,
        ProviderLogo.MinIO,
      );

      expect(tile.style.minWidth).toBe("16px");
      expect(tile.style.minHeight).toBe("16px");
      expect(markOf(ProviderLogo.MinIO)).toHaveAttribute("height", "16");
    });

    test("a bare wordmark is at most one and a half times as wide as the size given", async () => {
      await drawn(
        <ProviderLogoImage logo={ProviderLogo.Splunk} isBare={true} />,
        ProviderLogo.Splunk,
      );

      expect(markOf(ProviderLogo.Splunk)).toHaveAttribute("width", "24");
    });

    test("a tile is drawn without a ring when bare", async () => {
      const tile: HTMLElement = await drawn(
        <ProviderLogoImage
          logo={ProviderLogo.Python}
          isBare={true}
          size={20}
        />,
        ProviderLogo.Python,
      );

      expect(tile).not.toHaveClass("ring-1");
      expect(tile).not.toHaveClass("bg-white");
    });
  });

  describe("loading", () => {
    test("a mark keeps its room while it loads, then is drawn in it", async () => {
      holdLoads = true;
      render(<ProviderLogoImage logo={ProviderLogo.Okta} size={40} />);

      const tile: HTMLElement = tileOf(ProviderLogo.Okta);
      const room: HTMLElement = tile.firstElementChild as HTMLElement;

      expect(markOf(ProviderLogo.Okta)).toBeNull();
      expect(room.tagName).toBe("SPAN");
      expect(room.style.width).toBe("20px");
      expect(room.style.height).toBe("20px");
      expect(requested).toEqual([ProviderLogo.Okta]);

      act(() => {
        for (const arrive of held) {
          arrive();
        }
      });

      await waitFor(() => {
        expect(markOf(ProviderLogo.Okta)).not.toBeNull();
      });
      expect(markOf(ProviderLogo.Okta)).toHaveAttribute("width", "20");
      expect(markOf(ProviderLogo.Okta)).toHaveAttribute("height", "20");
    });

    test("a mark loaded once is drawn at once, with nothing asked again", async () => {
      await drawn(
        <ProviderLogoImage logo={ProviderLogo.Ruby} />,
        ProviderLogo.Ruby,
      );
      requested.length = 0;

      render(<ProviderLogoImage logo={ProviderLogo.Ruby} size={24} />);

      expect(
        screen
          .getAllByTestId(
            `${PROVIDER_LOGO_TEST_ID_PREFIX}${ProviderLogo.Ruby}`,
          )[1]!
          .querySelector("svg[data-provider-logo-mark-svg]"),
      ).not.toBeNull();
      expect(requested).toEqual([]);
    });

    test("products drawn by one mark share it: Azure's services ask for Azure's", async () => {
      render(
        <>
          <ProviderLogoImage logo={ProviderLogo.AzureBlobStorage} />
          <ProviderLogoImage logo={ProviderLogo.MicrosoftSentinel} />
        </>,
      );

      await waitFor(() => {
        expect(markOf(ProviderLogo.MicrosoftSentinel)).not.toBeNull();
      });
      expect(new Set(requested)).toEqual(new Set([ProviderLogo.Azure]));
    });
  });

  describe("its name", () => {
    test.each(ALL_PROVIDER_LOGOS)(
      "%s is read out by the product's own name",
      (logo: ProviderLogo) => {
        render(<ProviderLogoImage logo={logo} />);

        expect(
          screen.getByRole("img", { name: PROVIDER_LOGO_NAMES[logo] }),
        ).toBe(tileOf(logo));
      },
    );

    test("decorative, it is not read out: the words beside it name it", () => {
      render(
        <ProviderLogoImage logo={ProviderLogo.Slack} isDecorative={true} />,
      );

      expect(tileOf(ProviderLogo.Slack)).toHaveAttribute("aria-hidden", "true");
      expect(screen.queryByRole("img")).toBeNull();
    });
  });

  describe("the size table", () => {
    test("every tile size has its icon size, and the icon fits inside the tile", () => {
      for (const size of SIZES) {
        expect(PROVIDER_LOGO_TILE_ICON_SIZES[size]).toBeLessThan(size);
        expect(PROVIDER_LOGO_TILE_ICON_CLASS_NAMES[size]).toMatch(/^h-/);
      }
    });

    test.each(Object.keys(PROVIDER_LOGO_MARK_BOXES))(
      "%s fits its tile at every size",
      (logo: string) => {
        const box: ReturnType<typeof getProviderLogoMarkBox> =
          getProviderLogoMarkBox(logo as ProviderLogo)!;

        for (const size of SIZES) {
          const onTile: { width: number; height: number } =
            getProviderLogoDrawnSize({ box, size, isBare: false });
          const bare: { width: number; height: number } =
            getProviderLogoDrawnSize({ box, size, isBare: true });

          expect(onTile.width).toBeLessThanOrEqual(Math.round(size * 0.75));
          expect(onTile.height).toBeLessThanOrEqual(
            PROVIDER_LOGO_TILE_ICON_SIZES[size],
          );
          expect(bare.width).toBeLessThanOrEqual(Math.round(size * 1.5));
          expect(bare.height).toBeLessThanOrEqual(size);
        }
      },
    );
  });
});
