import ProviderLogo from "../../../Types/ProviderLogo/ProviderLogo";
import { ProviderLogoMarkShapes } from "../../../Types/ProviderLogo/ProviderLogoMark";
import { PROVIDER_LOGO_MARK_BOXES } from "../../../Types/ProviderLogo/ProviderLogoMarks";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A brand's mark as an inline SVG, every shape filled with the current
 * colour (currentColor): it takes the colour of the text and icons around
 * it, in the light and the dark theme, and nothing in it is an image. The
 * icon set draws its brand glyphs with the same shapes
 * (renderProviderLogoMarkShapes), so Slack is the same Slack in a side menu
 * and on a tile.
 */

export function renderProviderLogoMarkShapes(
  shapes: ProviderLogoMarkShapes,
): Array<ReactElement> {
  return shapes.map(
    (shape: ProviderLogoMarkShapes[number], index: number): ReactElement => {
      return (
        <path
          key={index}
          d={shape.d}
          fill="currentColor"
          stroke="none"
          {...(shape.opacity !== undefined
            ? { fillOpacity: shape.opacity }
            : {})}
        />
      );
    },
  );
}

export interface ComponentProps {
  // The logo whose mark the shapes are: it says the box they are drawn in.
  mark: ProviderLogo;
  shapes: ProviderLogoMarkShapes;
  /*
   * Drawn at this size, in pixels, at the box's own proportions. Left out,
   * the classes size it (h-5 w-5), the mark centred in that square.
   */
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
  "data-testid"?: string | undefined;
}

const ProviderLogoMarkSvg: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={PROVIDER_LOGO_MARK_BOXES[props.mark] || "0 0 24 24"}
      {...(props.width !== undefined ? { width: props.width } : {})}
      {...(props.height !== undefined ? { height: props.height } : {})}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-provider-logo-mark-svg={props.mark}
      data-testid={props["data-testid"]}
      className={props.className}
    >
      {renderProviderLogoMarkShapes(props.shapes)}
    </svg>
  );
};

export default ProviderLogoMarkSvg;
