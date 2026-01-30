import Color from "../../../Types/Color";
import { Black, White } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  name: string;
  color?: Color | undefined;
  icon?: IconProp | string | undefined;
  description?: string | undefined;
}

const RoleLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const resolvedColor: Color = props.color || Black;

  // Convert string icon to IconProp if needed
  const resolvedIcon: IconProp | undefined = (() => {
    if (!props.icon) {
      return undefined;
    }
    if (typeof props.icon === "string") {
      // Check if it's a valid IconProp value
      if (Object.values(IconProp).includes(props.icon as IconProp)) {
        return props.icon as IconProp;
      }
      return undefined;
    }
    return props.icon;
  })();

  const iconColor: Color = Color.shouldUseDarkText(resolvedColor)
    ? Black
    : White;

  const element: ReactElement = (
    <div className="flex items-center gap-2">
      {resolvedIcon ? (
        <div
          className="flex items-center justify-center h-6 w-6 rounded-md flex-shrink-0"
          style={{
            backgroundColor: resolvedColor.toString(),
          }}
        >
          <Icon
            icon={resolvedIcon}
            className="h-4 w-4"
            color={iconColor}
          />
        </div>
      ) : (
        <div
          className="h-3 w-3 rounded-full flex-shrink-0"
          style={{
            backgroundColor: resolvedColor.toString(),
          }}
          aria-hidden="true"
        />
      )}
      <span className="text-sm font-medium text-gray-900">{props.name}</span>
    </div>
  );

  if (props.description) {
    return <Tooltip text={props.description}>{element}</Tooltip>;
  }

  return element;
};

export default RoleLabel;
