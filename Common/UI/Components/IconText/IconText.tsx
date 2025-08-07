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

  const handleClick: () => void = (): void => {
    if (onClick) {
      onClick();
    }
  };

  return (
    <div
      className={`flex items-center ${getSpacingClass()} ${getAlignmentClass()} ${containerClassName}`}
      onClick={handleClick}
      data-testid={dataTestId}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <div className="flex-shrink-0">
        <Icon
          className={iconClassName}
          icon={icon}
          color={iconColor}
          size={iconSize}
        />
      </div>
      <div
        className={`flex ${getAlignmentClass()} ${textClassName}`}
        style={{ color: textColor?.toString() || "inherit" }}
      >
        {text}
      </div>
    </div>
  );
};

export default IconText;
