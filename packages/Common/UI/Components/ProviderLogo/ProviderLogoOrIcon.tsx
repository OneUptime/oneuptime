import IconProp from "../../../Types/Icon/IconProp";
import ProviderLogo from "../../../Types/ProviderLogo/ProviderLogo";
import Icon from "../Icon/Icon";
import ProviderLogoImage, {
  getProviderLogoTileSizeClassName,
  PROVIDER_LOGO_TILE_CLASS_NAME,
  ProviderLogoSize,
} from "./ProviderLogoImage";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What stands for something that goes to, or comes from, another product:
 * that product's logo (Amazon S3), or, for a generic thing that has none
 * (a webhook, syslog, any S3-compatible storage), its icon - on the same
 * neutral tile as a logo, so a list that mixes the two reads as one set.
 *
 * Bare (isBare), it is the logo alone or the icon alone, beside words: the
 * icon then takes iconClassName, the colour and place an icon there has.
 */

// The icon on a tile of each size: an outline icon reads larger than a logo.
const ICON_CLASS_NAMES: Readonly<Record<ProviderLogoSize, string>> = {
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

export const PROVIDER_ICON_TILE_TEST_ID: string = "provider-icon-tile";

export interface ComponentProps {
  logo?: ProviderLogo | undefined;
  // What it shows without a logo.
  icon: IconProp;
  // In pixels: the tile's (40 when left out), or a bare logo's (16).
  size?: ProviderLogoSize | undefined;
  // The logo or the icon alone, without a tile.
  isBare?: boolean | undefined;
  // A bare icon's classes: its size, colour and place beside the words.
  iconClassName?: string | undefined;
  // Its name is written right beside it, so it is not read out again.
  isDecorative?: boolean | undefined;
  className?: string | undefined;
}

const ProviderLogoOrIcon: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const size: ProviderLogoSize = props.size || (props.isBare ? 16 : 40);

  if (props.logo) {
    return (
      <ProviderLogoImage
        logo={props.logo}
        size={size}
        isBare={props.isBare}
        isDecorative={props.isDecorative}
        className={props.className}
      />
    );
  }

  // A generic thing's icon: the words beside it say what it is.
  if (props.isBare) {
    return (
      <Icon
        icon={props.icon}
        className={`${props.iconClassName || "h-4 w-4 text-gray-500"} ${props.className || ""}`}
        data-testid={PROVIDER_ICON_TILE_TEST_ID}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      data-testid={PROVIDER_ICON_TILE_TEST_ID}
      className={`inline-flex flex-shrink-0 items-center justify-center text-gray-500 ${PROVIDER_LOGO_TILE_CLASS_NAME} ${getProviderLogoTileSizeClassName(size)} ${props.className || ""}`}
    >
      <Icon icon={props.icon} className={ICON_CLASS_NAMES[size]} />
    </span>
  );
};

export default ProviderLogoOrIcon;
