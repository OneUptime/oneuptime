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
import useTranslateValue from "../../Utils/Translation";

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
  /*
   * Words too long for the room run onto a next line inside the pill,
   * rather than end in "..." with the whole of them under the pointer -
   * for where nothing points: a phone's card (a record's labels in a
   * table's row on a phone). A pill of one line looks as any other.
   */
  isWrapping?: boolean | undefined;
}

/*
 * Spacing is in em, so each size is the same pill scaled: a Small pill in a
 * dense table and an ExtraLarge one in a page header keep their proportions.
 *
 * Every pill in the product is this one shape - a label, a state, a yes/no
 * (Detail/BooleanValue) and a choice (Dropdown/DropdownValueBadge) - so a
 * card that shows all of them shows one pill, not three: the yes/no was a
 * 14px pill and a choice a 12px rounded-corner badge beside 13px labels.
 */
export const PILL_CLASS_NAME: string =
  "inline-flex max-w-full items-center gap-[0.4em] rounded-full px-[0.6em] py-[0.2em] font-medium leading-[1.35]";

// Its dot: half its text's size, the colour itself.
export const PILL_DOT_CLASS_NAME: string =
  "h-[0.5em] w-[0.5em] flex-shrink-0 rounded-full";

/*
 * A pill whose words may run onto a next line: its dot on the first line,
 * and corners as round as a one-line pill's (half its 1.75em height), so a
 * pill of two lines is a rounded box, not a stadium, and one of one line is
 * the pill above.
 */
export const WRAPPING_PILL_CLASS_NAME: string =
  "inline-flex max-w-full items-start gap-[0.4em] rounded-[0.875em] px-[0.6em] py-[0.2em] font-medium leading-[1.35]";

// Its dot, centred on the first line: (1.35em - 0.5em) / 2 above it.
export const WRAPPING_PILL_DOT_CLASS_NAME: string = "mt-[0.425em]";

// And an icon in the dot's place: (1.35em - 1em) / 2 above it.
export const WRAPPING_PILL_ICON_CLASS_NAME: string = "mt-[0.175em]";

export const PILL_TEXT_CLASS_NAME: string = "min-w-0 truncate";

export const WRAPPING_PILL_TEXT_CLASS_NAME: string =
  "min-w-0 whitespace-normal [overflow-wrap:anywhere]";

const Pill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const colors: PillColors = getPillColors(props.color || Gray500);
  const { translateString } = useTranslateValue();
  const text: string = translateString(props.text) ?? props.text;

  const getPillElement: GetReactElementFunction = (): ReactElement => {
    return (
      <span
        data-testid="pill"
        data-ou-pill={props.isMinimal ? undefined : ""}
        /*
         * Its words end in "..." where its box ends, so a table that would
         * run past its card may narrow it (TableLayout's
         * TABLE_SHRINKABLE_ATTRIBUTE); a pill that wraps does not.
         */
        data-table-shrinks={props.isWrapping ? undefined : "true"}
        className={`${
          props.isWrapping ? WRAPPING_PILL_CLASS_NAME : PILL_CLASS_NAME
        } ${
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
            className={`h-[1em] w-[1em] flex-shrink-0${
              props.isWrapping ? ` ${WRAPPING_PILL_ICON_CLASS_NAME}` : ""
            }`}
          />
        ) : props.isPulsing ? (
          /*
           * The dot, with a copy of itself behind it that grows and fades.
           * Both are painted like the plain dot, so the dark theme swaps both.
           */
          <span
            data-testid="pill-dot"
            data-pulsing="true"
            className={`relative inline-flex h-[0.5em] w-[0.5em] flex-shrink-0${
              props.isWrapping ? ` ${WRAPPING_PILL_DOT_CLASS_NAME}` : ""
            }`}
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
            className={`${PILL_DOT_CLASS_NAME}${
              props.isWrapping ? ` ${WRAPPING_PILL_DOT_CLASS_NAME}` : ""
            }`}
            style={getPillDotStyle(colors)}
            aria-hidden="true"
          ></span>
        )}
        <span
          data-testid="pill-text"
          className={
            props.isWrapping
              ? WRAPPING_PILL_TEXT_CLASS_NAME
              : PILL_TEXT_CLASS_NAME
          }
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
              textElement.title = text;
            } else {
              textElement.removeAttribute("title");
            }
          }}
        >
          {text}
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
