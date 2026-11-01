import IconProp from "../../../Types/Icon/IconProp";
import ProviderLogo from "../../../Types/ProviderLogo/ProviderLogo";
import Icon from "../Icon/Icon";
import ProviderLogoImage, {
  getProviderLogoTileSizeClassName,
  PROVIDER_LOGO_COLOR_CLASS_NAME,
  PROVIDER_LOGO_TILE_CLASS_NAME,
  PROVIDER_LOGO_TILE_ICON_CLASS_NAMES,
  ProviderLogoSize,
} from "./ProviderLogoImage";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What stands for something that goes to, or comes from, another product:
 * that product's mark (Google Cloud Storage), or, for a generic thing that
 * has none (a webhook, syslog, any S3-compatible storage), its icon - on the
 * same tile, in the same colour, at the same size, so a list that mixes the
 * two reads as one set.
 *
 * Bare (isBare), it is the mark alone or the icon alone, beside words: the
 * icon then takes iconClassName, the colour and place an icon there has.
 */

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
  /*
   * The colour the mark, or the icon on a tile, is drawn in: the grey of a
   * tile's icon when left out. A picked row passes its indigo.
   */
  colorClassName?: string | undefined;
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
        colorClassName={props.colorClassName}
        className={props.className}
      />
    );
  }

  // A generic thing's icon: the words beside it say what it is.
  if (props.isBare) {
    return (
      <Icon
        icon={props.icon}
        className={`${props.iconClassName || `h-4 w-4 ${props.colorClassName || PROVIDER_LOGO_COLOR_CLASS_NAME}`} ${props.className || ""}`}
        data-testid={PROVIDER_ICON_TILE_TEST_ID}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      data-testid={PROVIDER_ICON_TILE_TEST_ID}
      className={`inline-flex flex-shrink-0 items-center justify-center ${props.colorClassName || PROVIDER_LOGO_COLOR_CLASS_NAME} ${PROVIDER_LOGO_TILE_CLASS_NAME} ${getProviderLogoTileSizeClassName(size)} ${props.className || ""}`}
    >
      <Icon
        icon={props.icon}
        className={PROVIDER_LOGO_TILE_ICON_CLASS_NAMES[size]}
      />
    </span>
  );
};

export default ProviderLogoOrIcon;
