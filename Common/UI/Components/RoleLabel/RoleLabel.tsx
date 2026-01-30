import Color from "../../../Types/Color";
import { Black } from "../../../Types/BrandColors";
import Tooltip from "../Tooltip/Tooltip";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  name: string;
  color?: Color | undefined;
  description?: string | undefined;
}

const RoleLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const resolvedColor: Color = props.color || Black;

  const element: ReactElement = (
    <div className="flex items-center gap-2">
      <div
        className="h-3 w-3 rounded-full flex-shrink-0"
        style={{
          backgroundColor: resolvedColor.toString(),
        }}
        aria-hidden="true"
      />
      <span className="text-sm font-medium text-gray-900">{props.name}</span>
    </div>
  );

  if (props.description) {
    return <Tooltip text={props.description}>{element}</Tooltip>;
  }

  return element;
};

export default RoleLabel;
