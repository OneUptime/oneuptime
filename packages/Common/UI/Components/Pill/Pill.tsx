import { Gray500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import Icon, { ThickProp } from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";
import Tooltip from "../Tooltip/Tooltip";
import { GetReactElementFunction } from "../../Types/FunctionTypes";
import { getPillColors, PillColors } from "./PillColors";

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
}

type PillStyle = CSSProperties & { [customProperty: `--${string}`]: string };

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

  /*
   * The light theme's colours are written inline, so a pill is right in an
   * app that never loads Theme.css. The dark theme's ride along as custom
   * properties that Theme.css applies under html.dark. A colour the caller
   * overrides through `style` is the dark value too, so it wins in both.
   */
  const toneStyle: PillStyle = props.isMinimal
    ? {}
    : {
        backgroundColor: colors.light.backgroundColor,
        color: colors.light.textColor,
        boxShadow: `inset 0 0 0 1px ${colors.light.ringColor}`,
        "--ou-pill-dark-bg": String(
          props.style?.backgroundColor || colors.dark.backgroundColor,
        ),
        "--ou-pill-dark-text": String(
          props.style?.color || colors.dark.textColor,
        ),
        "--ou-pill-dark-shadow": String(
          props.style?.boxShadow || `inset 0 0 0 1px ${colors.dark.ringColor}`,
        ),
      };

  const dotStyle: PillStyle = {
    backgroundColor: colors.light.dotColor,
    "--ou-pill-dark-dot": colors.dark.dotColor,
  };

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
          ...toneStyle,
          ...props.style,
        }}
      >
        {props.icon ? (
          <Icon
            icon={props.icon}
            thick={ThickProp.Thick}
            className="h-[1em] w-[1em] flex-shrink-0"
          />
        ) : (
          <span
            data-testid="pill-dot"
            data-ou-pill-dot=""
            className="h-[0.5em] w-[0.5em] flex-shrink-0 rounded-full"
            style={dotStyle}
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
