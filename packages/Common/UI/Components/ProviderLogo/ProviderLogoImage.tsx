import ProviderLogo, {
  getProviderLogoName,
} from "../../../Types/ProviderLogo/ProviderLogo";
import { Theme, useTheme } from "../../Utils/Theme";
import {
  getLoadedProviderLogoFile,
  getProviderLogoFileName,
  hasDarkProviderLogoMark,
  isWideProviderLogo,
  loadProviderLogoFile,
} from "./ProviderLogoAssets";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A third-party product's official logo: Amazon S3, Slack, PagerDuty,
 * Python. Drawn on a neutral tile - white with a hairline edge, the page's
 * own surface in the dark theme - at the logo's true proportions, so every
 * brand sits on the same ground and none is recoloured. On the dark theme a
 * brand whose mark would disappear there (a black or dark-navy mark) is
 * drawn in the mark that brand makes for dark backgrounds.
 *
 * Bare (isBare), it is the mark alone, the size of an icon, for a place an
 * icon sits beside words: a pill, a column header, a row of a list.
 *
 * Its name is read out as the image's name: the product's own name, never
 * translated. Where the name is written right beside it - a card's title, a
 * tile's label - pass isDecorative, so a screen reader does not read the
 * name twice.
 */

/*
 * The size in pixels: of the tile, or of the mark alone when it is bare
 * (16, 20 or 24 - an icon's sizes).
 */
export type ProviderLogoSize = 16 | 20 | 24 | 28 | 32 | 36 | 40 | 44 | 48;

interface SizeClassNames {
  tile: string;
  // The mark inside the tile, square...
  mark: string;
  // ...or across the tile's whole inside, for a logo wider than it is tall.
  wideMark: string;
}

const SIZE_CLASS_NAMES: Readonly<Record<ProviderLogoSize, SizeClassNames>> = {
  16: { tile: "h-4 w-4 rounded", mark: "h-3 w-3", wideMark: "h-3 w-3.5" },
  20: { tile: "h-5 w-5 rounded", mark: "h-3.5 w-3.5", wideMark: "h-3.5 w-4" },
  24: { tile: "h-6 w-6 rounded-md", mark: "h-4 w-4", wideMark: "h-4 w-5" },
  28: {
    tile: "h-7 w-7 rounded-md",
    mark: "h-[18px] w-[18px]",
    wideMark: "h-[18px] w-[22px]",
  },
  32: { tile: "h-8 w-8 rounded-lg", mark: "h-5 w-5", wideMark: "h-5 w-7" },
  36: {
    tile: "h-9 w-9 rounded-lg",
    mark: "h-[22px] w-[22px]",
    wideMark: "h-[22px] w-[30px]",
  },
  40: { tile: "h-10 w-10 rounded-lg", mark: "h-6 w-6", wideMark: "h-6 w-8" },
  44: { tile: "h-11 w-11 rounded-xl", mark: "h-7 w-7", wideMark: "h-7 w-9" },
  48: { tile: "h-12 w-12 rounded-xl", mark: "h-8 w-8", wideMark: "h-8 w-10" },
};

// A bare mark is the size given: wide ones half as wide again.
const BARE_CLASS_NAMES: Readonly<
  Record<ProviderLogoSize, Omit<SizeClassNames, "tile">>
> = {
  16: { mark: "h-4 w-4", wideMark: "h-4 w-6" },
  20: { mark: "h-5 w-5", wideMark: "h-5 w-[30px]" },
  24: { mark: "h-6 w-6", wideMark: "h-6 w-9" },
  28: { mark: "h-7 w-7", wideMark: "h-7 w-[42px]" },
  32: { mark: "h-8 w-8", wideMark: "h-8 w-12" },
  36: { mark: "h-9 w-9", wideMark: "h-9 w-[54px]" },
  40: { mark: "h-10 w-10", wideMark: "h-10 w-[60px]" },
  44: { mark: "h-11 w-11", wideMark: "h-11 w-[66px]" },
  48: { mark: "h-12 w-12", wideMark: "h-12 w-[72px]" },
};

export const PROVIDER_LOGO_TEST_ID_PREFIX: string = "provider-logo-";

/*
 * The neutral tile a logo sits on: white with a hairline edge, which the
 * dark theme draws as its own surface and edge (Common/UI/Styles/Theme.css).
 */
export const PROVIDER_LOGO_TILE_CLASS_NAME: string =
  "bg-white ring-1 ring-inset ring-gray-200";

// The tile's size and corners, for a tile of this many pixels.
export function getProviderLogoTileSizeClassName(
  size: ProviderLogoSize,
): string {
  return SIZE_CLASS_NAMES[size].tile;
}

export interface ComponentProps {
  logo: ProviderLogo;
  // 40 (a card's tile) when left out; 16 for a bare mark.
  size?: ProviderLogoSize | undefined;
  // The mark alone, without its tile: beside words, where an icon would be.
  isBare?: boolean | undefined;
  // Its name is written right beside it, so it is not read out again.
  isDecorative?: boolean | undefined;
  className?: string | undefined;
}

const ProviderLogoImage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const size: ProviderLogoSize = props.size || (props.isBare ? 16 : 40);
  const theme: Theme = useTheme();
  const isDarkMark: boolean =
    theme === Theme.Dark && hasDarkProviderLogoMark(props.logo);
  const fileName: string = getProviderLogoFileName(props.logo, isDarkMark);
  const address: string | undefined = getLoadedProviderLogoFile(fileName);
  // Set once a file this logo waits for arrives, to draw it.
  const [, setArrivedFileName] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (address) {
      return;
    }

    let isMounted: boolean = true;

    void loadProviderLogoFile(fileName).then(
      (loadedAddress: string | undefined): void => {
        if (isMounted && loadedAddress) {
          setArrivedFileName(fileName);
        }
      },
    );

    return () => {
      isMounted = false;
    };
  }, [fileName, address]);

  const classNames: Omit<SizeClassNames, "tile"> = props.isBare
    ? BARE_CLASS_NAMES[size]
    : SIZE_CLASS_NAMES[size];
  const markClassName: string = isWideProviderLogo(props.logo)
    ? classNames.wideMark
    : classNames.mark;
  const accessibility: React.HTMLAttributes<HTMLSpanElement> =
    props.isDecorative
      ? { "aria-hidden": true }
      : { role: "img", "aria-label": getProviderLogoName(props.logo) };

  return (
    <span
      {...accessibility}
      data-testid={`${PROVIDER_LOGO_TEST_ID_PREFIX}${props.logo}`}
      data-provider-logo={props.logo}
      className={
        props.isBare
          ? `inline-flex flex-shrink-0 items-center justify-center ${props.className || ""}`
          : `inline-flex flex-shrink-0 items-center justify-center ${PROVIDER_LOGO_TILE_CLASS_NAME} ${SIZE_CLASS_NAMES[size].tile} ${props.className || ""}`
      }
    >
      <span
        className={`flex flex-shrink-0 items-center justify-center ${markClassName}`}
      >
        {address ? (
          <img
            src={address}
            alt=""
            draggable={false}
            className="block h-full w-full object-contain"
            data-provider-logo-file={fileName}
          />
        ) : null}
      </span>
    </span>
  );
};

export default ProviderLogoImage;
