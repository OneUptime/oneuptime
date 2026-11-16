import Tooltip from "../Tooltip/Tooltip";
import Color from "../../../Types/Color";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  color: Color;
  /*
   * What the dot stands for: its tooltip and its name for a screen reader.
   * In English, looked up here - unless isTooltipTranslated says.
   */
  tooltip: string;
  /*
   * The tooltip is in the reader's words already: a status the page looked
   * up itself, a sentence built around a value. Drawn and named as given,
   * never looked up again (#8423): looked up again, a translation that is
   * itself an English key reads as another word, as the Spanish "Red"
   * (Network) read "Rojo".
   */
  isTooltipTranslated?: boolean | undefined;
}

const ColorCircle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  /*
   * Looked up once, here, so the dot's name is the words its tooltip shows:
   * it named the dot by the English its tooltip was handed.
   */
  const tooltip: string = props.isTooltipTranslated
    ? props.tooltip
    : translateString(props.tooltip) || props.tooltip;

  return (
    <Tooltip text={tooltip} isTextTranslated={true}>
      <div
        className="rounded-full h-3 w-3"
        style={{
          backgroundColor: props.color.toString(),
        }}
        role="img"
        aria-label={tooltip}
      ></div>
    </Tooltip>
  );
};

export default ColorCircle;
