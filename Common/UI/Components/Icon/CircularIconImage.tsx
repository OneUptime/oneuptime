import Icon, { SizeProp } from "./Icon";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  backgroundColor?: undefined | Color;
  icon: IconProp;
  iconColor?: undefined | Color;
}

const CircularIconImage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className="mr-3 flex h-10 w-10 items-center justify-center rounded-full shadow-md"
      style={{
        backgroundColor: props.backgroundColor
          ? props.backgroundColor.toString()
          : "black",
      }}
    >
      <Icon
        icon={props.icon}
        size={SizeProp.Large}
        color={props.iconColor ? props.iconColor : new Color("#ffffff")}
      />
    </div>
  );
};

export default CircularIconImage;
