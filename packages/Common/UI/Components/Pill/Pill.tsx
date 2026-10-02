import { Gray500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import Icon, { ThickProp } from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";
import Tooltip from "../Tooltip/Tooltip";
import { GetReactElementFunction } from "../../Types/FunctionTypes";
import {
  getPillColors,
  getPillDotStyle,
  getPillToneStyle,
  PillColors,
} from "./PillColors";

export enum PillSize {
  Small = "10px",
  Normal = "13px",
  Large = "15px",
  ExtraLarge = "18px",
}

export interface ComponentProps {
  text: string;
  color: Color;
  size?: PillSize | undefined;
  style?: CSSProperties;
  isMinimal?: boolean | undefined;
  tooltip?: string | undefined;
  icon?: IconProp | undefined;
  /*
   * A ring ripples out of the dot, over and over: "this is happening right
   * now". Only while motion is welcome - under prefers-reduced-motion the dot
   * stays still and the text alone says it. Ignored when `icon` replaces the
   * dot.
   */
  isPulsing?: boolean | undefined;
}

/*
 * Spacing is in em, so each size is the same pill scaled: a Small pill in a
 * dense table and an ExtraLarge one in a page header keep their proportions.
 */
const PILL_CLASS_NAME: string =
  "inline-flex max-w-full items-center gap-[0.4em] rounded-full px-[0.6em] py-[0.2em] font-medium leading-[1.35]";

const Pill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const colors: PillColors = getPillColors(props.color || Gray500);

  const getPillElement: GetReactElementFunction = (): ReactElement => {
    return (
      <span
        data-testid="pill"
        data-ou-pill={props.isMinimal ? undefined : ""}
        className={`${PILL_CLASS_NAME} ${
          props.isMinimal ? "text-gray-700 ring-1 ring-inset ring-gray-200" : ""
        }`}
        style={{
          fontSize: props.size ? props.size.toString() : PillSize.Normal,
          // A minimal pill is a neutral outline: its classes colour it.
          ...(props.isMinimal ? {} : getPillToneStyle(colors, props.style)),
          ...props.style,
        }}
      >
        {props.icon ? (
          <Icon
            icon={props.icon}
            thick={ThickProp.Thick}
            className="h-[1em] w-[1em] flex-shrink-0"
          />
        ) : props.isPulsing ? (
          /*
           * The dot, with a copy of itself behind it that grows and fades.
           * Both are painted like the plain dot, so the dark theme swaps both.
           */
          <span
            data-testid="pill-dot"
            data-pulsing="true"
            className="relative inline-flex h-[0.5em] w-[0.5em] flex-shrink-0"
            aria-hidden="true"
          >
            <span
              data-testid="pill-dot-pulse"
              data-ou-pill-dot=""
              className="absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping"
              style={getPillDotStyle(colors)}
            ></span>
            <span
              data-ou-pill-dot=""
              className="relative inline-flex h-full w-full rounded-full"
              style={getPillDotStyle(colors)}
            ></span>
          </span>
        ) : (
          <span
            data-testid="pill-dot"
            data-ou-pill-dot=""
            className="h-[0.5em] w-[0.5em] flex-shrink-0 rounded-full"
            style={getPillDotStyle(colors)}
            aria-hidden="true"
          ></span>
        )}
        <span
          className="min-w-0 truncate"
          onMouseEnter={(event: React.MouseEvent<HTMLSpanElement>) => {
            /*
             * A pill stays on one line and ellipsizes in a container too
             * narrow for it, so the cut-short ones show their whole text on
             * hover. A pill with a tooltip already has hover text.
             */
            const textElement: HTMLSpanElement = event.currentTarget;

            if (
              !props.tooltip &&
              textElement.scrollWidth > textElement.clientWidth
            ) {
              textElement.title = props.text;
            } else {
              textElement.removeAttribute("title");
            }
          }}
        >
          {props.text}
        </span>
      </span>
    );
  };

  if (props.tooltip) {
    return <Tooltip text={props.tooltip}>{getPillElement()}</Tooltip>;
  }

  return getPillElement();
};

export default Pill;
