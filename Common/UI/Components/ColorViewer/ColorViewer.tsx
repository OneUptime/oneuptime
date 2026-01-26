import { Gray500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  placeholder?: undefined | string;
  className?: undefined | string;
  value?: Color | undefined;
  dataTestId?: string;
  onClick?: (() => void) | undefined;
}

const ColorInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const hasOnClick: boolean = Boolean(props.onClick);
  const colorLabel: string = props.value?.toString() || props.placeholder || "No Color Selected";

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (hasOnClick && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      props.onClick?.();
    }
  };

  return (
    <div
      className={`flex ${props.className}`}
      onClick={() => {
        props.onClick?.();
      }}
      onKeyDown={handleKeyDown}
      role={hasOnClick ? "button" : undefined}
      tabIndex={hasOnClick ? 0 : undefined}
      aria-label={hasOnClick ? `Color picker: ${colorLabel}` : undefined}
      data-testid={props.dataTestId}
    >
      {props.value && (
        <div
          style={{
            backgroundColor: props.value.toString(),
            height: "20px",
            borderWidth: "1px",
            borderColor: Gray500.toString(),
            width: "20px",
            borderRadius: "300px",
            boxShadow: "rgb(149 157 165 / 20%) 0px 8px 24px",
            marginRight: "7px",
            borderStyle: "solid",
          }}
          aria-hidden="true"
        ></div>
      )}
      <div>
        {colorLabel}
      </div>
    </div>
  );
};

export default ColorInput;
