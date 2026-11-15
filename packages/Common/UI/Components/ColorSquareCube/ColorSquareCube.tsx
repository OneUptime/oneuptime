import Tooltip from "../Tooltip/Tooltip";
import Color from "../../../Types/Color";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  color: Color;
  // In English, looked up by the tooltip - unless isTooltipTranslated says.
  tooltip: string;
  /*
   * The tooltip is in the reader's words already: a sentence the page built
   * around a name ("{{name}} Service Color"). Drawn as given, never looked
   * up again (#8423): looked up again, a translation that is itself an
   * English key reads as another word, as the Spanish "Red" (Network) read
   * "Rojo".
   */
  isTooltipTranslated?: boolean | undefined;
  /*
   * The tooltip is a name someone gave - a service's - drawn as written,
   * never looked up: a service named "Network" read "Red" in Spanish.
   */
  isTooltipUserContent?: boolean | undefined;
}

const ColorSquareCube: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Tooltip
      text={props.tooltip}
      isTextTranslated={props.isTooltipTranslated}
      isTextUserContent={props.isTooltipUserContent}
    >
      <div
        className="rounded h-3 w-3"
        style={{
          backgroundColor: props.color.toString(),
        }}
      ></div>
    </Tooltip>
  );
};

export default ColorSquareCube;
