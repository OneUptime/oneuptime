import Tooltip from "../Tooltip/Tooltip";
import Color from "../../../Types/Color";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  color: Color;
  tooltip: string;
}

const ColorCircle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Tooltip text={props.tooltip}>
      <div
        className="rounded-full h-3 w-3"
        style={{
          backgroundColor: props.color.toString(),
        }}
        role="img"
        aria-label={props.tooltip}
      ></div>
    </Tooltip>
  );
};

export default ColorCircle;
