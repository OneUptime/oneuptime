import Icon from "../Icon/Icon";
import { Green, Red } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
  isChecked: boolean;
}

const CheckboxViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      <div className="flex">
        <div className="h-6 w-6">
          {props.isChecked ? (
            <Icon
              className="h-5 w-5"
              icon={IconProp.CheckCircle}
              color={Green}
            />
          ) : (
            <Icon className="h-5 w-5" icon={IconProp.CircleClose} color={Red} />
          )}
        </div>
        <div className="text-sm text-gray-900 flex justify-left">
          {props.text}
        </div>
      </div>
    </div>
  );
};

export default CheckboxViewer;
