import IconText from "../IconText/IconText";
import { Green, Red } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
  isChecked: boolean;
}

const CheckboxViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="h-6">
      <IconText
        text={props.text}
        icon={props.isChecked ? IconProp.CheckCircle : IconProp.CircleClose}
        iconColor={props.isChecked ? Green : Red}
      />
    </div>
  );
};

export default CheckboxViewer;
