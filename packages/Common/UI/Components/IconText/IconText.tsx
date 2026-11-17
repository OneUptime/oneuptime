import Icon, { SizeProp } from "../Icon/Icon";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
  icon: IconProp;
  iconColor?: Color | null;
  textColor?: Color | null;
  iconSize?: SizeProp;
  iconClassName?: string;
  textClassName?: string;
  containerClassName?: string;
  spacing?: "sm" | "md" | "lg";
  alignment?: "left" | "center" | "right";
  onClick?: (() => void) | undefined;
  "data-testid"?: string;
}

const IconText: FunctionComponent<ComponentProps> = ({
  text,
  icon,
  iconColor = null,
  textColor = null,
  iconSize = SizeProp.Regular,
  iconClassName = "h-5 w-5",
  textClassName = "text-sm text-gray-900",
  containerClassName = "",
  spacing = "sm",
  alignment = "left",
  onClick,
  "data-testid": dataTestId,
}: ComponentProps): ReactElement => {
  const getSpacingClass: () => string = (): string => {
    switch (spacing) {
      case "sm":
        return "gap-1";
      case "md":
        return "gap-2";
      case "lg":
        return "gap-3";
      default:
        return "gap-1";
    }
  };

  const getAlignmentClass: () => string = (): string => {
    switch (alignment) {
      case "center":
        return "justify-center";
      case "right":
        return "justify-end";
      case "left":
      default:
        return "justify-start";
    }
  };

  const content: ReactElement = (
    <>
      <span className="flex-shrink-0" aria-hidden="true">
        <Icon
          className={iconClassName}
          icon={icon}
          color={iconColor}
          size={iconSize}
        />
      </span>
      <span
        className={`flex ${getAlignmentClass()} ${textClassName}`}
        style={{ color: textColor?.toString() || "inherit" }}
      >
        {text}
      </span>
    </>
  );

  const className: string = `flex items-center ${getSpacingClass()} ${getAlignmentClass()} ${containerClassName}`;

  if (!onClick) {
    return (
      <div className={className} data-testid={dataTestId}>
        {content}
      </div>
    );
  }

  /*
   * A button when it does something: it was a div with only a click, which
   * a keyboard could not reach (#9136).
   */
  return (
    <button
      type="button"
      className={`${className} cursor-pointer rounded text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
      onClick={onClick}
      data-testid={dataTestId}
    >
      {content}
    </button>
  );
};

export default IconText;
