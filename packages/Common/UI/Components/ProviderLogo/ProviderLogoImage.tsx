import IconProp from "../../../Types/Icon/IconProp";
import ProviderLogo, {
  getProviderLogoName,
} from "../../../Types/ProviderLogo/ProviderLogo";
import { ProviderLogoMarkShapes } from "../../../Types/ProviderLogo/ProviderLogoMark";
import {
  getProviderLogoMark,
  getProviderLogoMarkBox,
  getProviderLogoMarkSize,
  getProviderLogoStandInIcon,
  ProviderLogoMarkBox,
  ProviderLogoMarkSize,
} from "../../../Types/ProviderLogo/ProviderLogoMarks";
import Icon from "../Icon/Icon";
import {
  getLoadedProviderLogoMark,
  loadProviderLogoMark,
} from "./ProviderLogoMarkLoader";
import ProviderLogoMarkSvg from "./ProviderLogoMarkSvg";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A third-party product's official mark: Slack, PagerDuty, Python. Drawn as
 * the product's own icons are - an inline SVG in one colour, the colour of
 * the icons around it - on the same tile a generic icon sits on (white with
 * a hairline edge, the page's own surface in the dark theme), so a list
 * that mixes products and generic things (Google Cloud Storage beside a
 * webhook) reads as one set, in the light theme and the dark. Never an
 * image, never in the brand's colours.
 *
 * A product whose brand allows no logo in a product like this (Amazon Web
 * Services, which asks to be named in plain text) is drawn by an icon of
 * OneUptime's instead (Common/Types/ProviderLogo/ProviderLogoMarks.ts); its
 * name beside it says whose it is.
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

// A tile's size and corners.
const TILE_CLASS_NAMES: Readonly<Record<ProviderLogoSize, string>> = {
  16: "h-4 w-4 rounded",
  20: "h-5 w-5 rounded",
  24: "h-6 w-6 rounded-md",
  28: "h-7 w-7 rounded-md",
  32: "h-8 w-8 rounded-lg",
  36: "h-9 w-9 rounded-lg",
  40: "h-10 w-10 rounded-lg",
  44: "h-11 w-11 rounded-xl",
  48: "h-12 w-12 rounded-xl",
};

/*
 * The icon on a tile of each size, in pixels and as the icon's classes: a
 * mark is drawn as large as one of the product's own icons on the same
 * tile, so the two kinds sit side by side as equals.
 */
export const PROVIDER_LOGO_TILE_ICON_SIZES: Readonly<
  Record<ProviderLogoSize, number>
> = {
  16: 10,
  20: 12,
  24: 14,
  28: 14,
  32: 16,
  36: 20,
  40: 20,
  44: 24,
  48: 24,
};

export const PROVIDER_LOGO_TILE_ICON_CLASS_NAMES: Readonly<
  Record<ProviderLogoSize, string>
> = {
  16: "h-2.5 w-2.5",
  20: "h-3 w-3",
  24: "h-3.5 w-3.5",
  28: "h-3.5 w-3.5",
  32: "h-4 w-4",
  36: "h-5 w-5",
  40: "h-5 w-5",
  44: "h-6 w-6",
  48: "h-6 w-6",
};

// An icon drawn bare, as large as the size given.
const BARE_ICON_CLASS_NAMES: Readonly<Record<ProviderLogoSize, string>> = {
  16: "h-4 w-4",
  20: "h-5 w-5",
  24: "h-6 w-6",
  28: "h-7 w-7",
  32: "h-8 w-8",
  36: "h-9 w-9",
  40: "h-10 w-10",
  44: "h-11 w-11",
  48: "h-12 w-12",
};

export const PROVIDER_LOGO_TEST_ID_PREFIX: string = "provider-logo-";

/*
 * The neutral tile a mark or an icon sits on: white with a hairline edge,
 * which the dark theme draws as its own surface and edge
 * (Common/UI/Styles/Theme.css).
 */
export const PROVIDER_LOGO_TILE_CLASS_NAME: string =
  "bg-white ring-1 ring-inset ring-gray-200";

/*
 * The colour a mark is drawn in when the place it sits gives none: the grey
 * of the product's icons on a tile, which the dark theme lightens.
 */
export const PROVIDER_LOGO_COLOR_CLASS_NAME: string = "text-gray-500";

// The tile's size and corners, for a tile of this many pixels.
export function getProviderLogoTileSizeClassName(
  size: ProviderLogoSize,
): string {
  return TILE_CLASS_NAMES[size];
}

/*
 * The size a mark is drawn at: on a tile, as large as the tile's icon, a
 * wordmark at most three quarters of the tile wide; bare, as large as the
 * size given, a wordmark at most one and three quarters of it wide.
 */
export function getProviderLogoDrawnSize(data: {
  box: ProviderLogoMarkBox;
  size: ProviderLogoSize;
  isBare: boolean;
}): ProviderLogoMarkSize {
  if (data.isBare) {
    return getProviderLogoMarkSize({
      box: data.box,
      size: data.size,
      maxWidth: Math.round(data.size * 1.75),
    });
  }

  return getProviderLogoMarkSize({
    box: data.box,
    size: PROVIDER_LOGO_TILE_ICON_SIZES[data.size],
    maxWidth: Math.round(data.size * 0.75),
  });
}

export interface ComponentProps {
  logo: ProviderLogo;
  // 40 (a card's tile) when left out; 16 for a bare mark.
  size?: ProviderLogoSize | undefined;
  // The mark alone, without its tile: beside words, where an icon would be.
  isBare?: boolean | undefined;
  // Its name is written right beside it, so it is not read out again.
  isDecorative?: boolean | undefined;
  /*
   * The colour it is drawn in, as a text colour class: the grey of a tile's
   * icon when left out. A place that colours its icons (a picked row's
   * indigo) passes its own.
   */
  colorClassName?: string | undefined;
  className?: string | undefined;
}

const ProviderLogoImage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const size: ProviderLogoSize = props.size || (props.isBare ? 16 : 40);
  const isBare: boolean = Boolean(props.isBare);
  const mark: ProviderLogo | undefined = getProviderLogoMark(props.logo);
  const box: ProviderLogoMarkBox | undefined = getProviderLogoMarkBox(
    props.logo,
  );
  const standInIcon: IconProp | undefined = getProviderLogoStandInIcon(
    props.logo,
  );
  const shapes: ProviderLogoMarkShapes | undefined = mark
    ? getLoadedProviderLogoMark(mark)
    : undefined;
  // Set once a mark this logo waits for arrives, to draw it.
  const [, setArrivedMark] = useState<ProviderLogo | undefined>(undefined);

  useEffect(() => {
    if (!mark || shapes) {
      return;
    }

    let isMounted: boolean = true;

    void loadProviderLogoMark(mark).then(
      (loaded: ProviderLogoMarkShapes | undefined): void => {
        if (isMounted && loaded) {
          setArrivedMark(mark);
        }
      },
    );

    return () => {
      isMounted = false;
    };
  }, [mark, shapes]);

  const accessibility: React.HTMLAttributes<HTMLSpanElement> =
    props.isDecorative
      ? { "aria-hidden": true }
      : { role: "img", "aria-label": getProviderLogoName(props.logo) };

  const colorClassName: string =
    props.colorClassName || PROVIDER_LOGO_COLOR_CLASS_NAME;

  let drawing: ReactElement | null = null;

  if (mark && box) {
    const drawn: ProviderLogoMarkSize = getProviderLogoDrawnSize({
      box,
      size,
      isBare,
    });

    drawing = shapes ? (
      <ProviderLogoMarkSvg
        mark={mark}
        shapes={shapes}
        width={drawn.width}
        height={drawn.height}
        className="block flex-shrink-0"
      />
    ) : (
      // The mark's own room, kept while it loads, so nothing moves when it arrives.
      <span
        className="block flex-shrink-0"
        style={{ width: `${drawn.width}px`, height: `${drawn.height}px` }}
      />
    );
  } else if (standInIcon) {
    drawing = (
      <Icon
        icon={standInIcon}
        className={
          isBare
            ? BARE_ICON_CLASS_NAMES[size]
            : PROVIDER_LOGO_TILE_ICON_CLASS_NAMES[size]
        }
      />
    );
  }

  return (
    <span
      {...accessibility}
      data-testid={`${PROVIDER_LOGO_TEST_ID_PREFIX}${props.logo}`}
      data-provider-logo={props.logo}
      {...(mark ? { "data-provider-logo-mark": mark } : {})}
      {...(standInIcon ? { "data-provider-logo-icon": standInIcon } : {})}
      className={
        isBare
          ? `inline-flex flex-shrink-0 items-center justify-center ${colorClassName} ${props.className || ""}`
          : `inline-flex flex-shrink-0 items-center justify-center ${PROVIDER_LOGO_TILE_CLASS_NAME} ${TILE_CLASS_NAMES[size]} ${colorClassName} ${props.className || ""}`
      }
    >
      {drawing}
    </span>
  );
};

export default ProviderLogoImage;
