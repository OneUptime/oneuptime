import React, { CSSProperties, FunctionComponent, ReactElement } from "react";
import LabelModel from "../../../Models/DatabaseModels/Label";
import Pill, { ComponentProps as PillProps, PillSize } from "../Pill/Pill";
import { Black } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";

export interface ComponentProps {
  label: LabelModel;
  size?: PillSize | undefined;
  style?: CSSProperties;
  isMinimal?: boolean | undefined;
}

const LabelElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { label } = props;

  const resolveColor: Color = (() => {
    if (!label.color) {
      return Black;
    }

    if (typeof label.color === "string") {
      return Color.fromString(label.color);
    }

    return label.color;
  })();

  const text: string = label.name || label.slug || "";

  const pillProps: PillProps = {
    color: resolveColor,
    text,
    size: props.size,
    isMinimal: props.isMinimal,
    tooltip: label.description || undefined,
    icon: IconProp.EmptyCircle,
  };

  if (props.style) {
    pillProps.style = props.style;
  }

  return <Pill {...pillProps} />;
};

export default LabelElement;
