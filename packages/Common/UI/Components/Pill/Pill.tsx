import { Gray500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import Icon, { SizeProp, ThickProp } from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";
import Tooltip from "../Tooltip/Tooltip";
import { GetReactElementFunction } from "../../Types/FunctionTypes";

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

const Pill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const color: Color = props.color || Gray500;
  const backgroundColor: string = color.toString();

  if (props.isMinimal) {
    return (
      <span
        className="relative inline-flex items-center rounded-full border px-3 py-0.5 text-sm"
        style={{
          borderColor: "var(--ou-border-strong, #d1d5db)",
        }}
      >
        <span className="absolute flex flex-shrink-0 items-center justify-center">
          <span
            className="h-1.5 w-1.5 rounded-full bg-rose-500"
            style={{
              backgroundColor: backgroundColor,
            }}
            aria-hidden="true"
          ></span>
        </span>
        <span
          className="ml-3.5 font-medium"
          style={{ color: "var(--ou-text-primary, #111827)" }}
        >
          {props.text}
        </span>
      </span>
    );
  }

  const getPillElement: GetReactElementFunction = (): ReactElement => {
    return (
      <span
        data-testid="pill"
        className="inline-flex items-center rounded-full border p-1 pl-3 pr-3"
        style={{
          // https://stackoverflow.com/questions/3942878/how-to-decide-font-color-in-white-or-black-depending-on-background-color

          color:
            props.style?.color || Color.shouldUseDarkText(color)
              ? "#000000"
              : "#ffffff",
          backgroundColor: backgroundColor,
          borderColor: "var(--ou-border-strong, #d1d5db)",
          fontSize: props.size ? props.size.toString() : PillSize.Normal,
          ...props.style,
        }}
      >
        {props.icon ? (
          <Icon
            icon={props.icon}
            size={SizeProp.Small}
            thick={ThickProp.Thick}
            className="mr-2"
          />
        ) : null}
        {props.text}
      </span>
    );
  };

  if (props.tooltip) {
    return <Tooltip text={props.tooltip}>{getPillElement()}</Tooltip>;
  }

  return getPillElement();
};

export default Pill;
