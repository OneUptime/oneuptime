import { Gray500, Green500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { PILL_CLASS_NAME, PILL_DOT_CLASS_NAME, PillSize } from "../Pill/Pill";
import {
  getPillColors,
  getPillDotStyle,
  getPillToneStyle,
  PillColors,
} from "../Pill/PillColors";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A yes/no value as details and a form's summary step show it: a green "Yes"
 * pill, or a grey "No" one. Detail draws every FieldType.Boolean field with
 * it; a summary element of its own that still needs to say whether a box was
 * ticked uses it too, so the two cannot drift apart.
 *
 * It is the product's one pill (Pill's shape, size and colours, worked out
 * from green and grey as a state's are), so a card that shows a yes/no
 * beside labels and a choice shows one kind of pill. Top to top on the
 * value's 24px line (align-top), so a row holding a yes/no is as tall as
 * one holding text, and its word sits level with the values beside it.
 */

export const BOOLEAN_YES_COLOR: Color = Green500;

export const BOOLEAN_NO_COLOR: Color = Gray500;

export interface ComponentProps {
  value: boolean;
  dataTestId?: string | undefined;
}

const BooleanValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const colors: PillColors = getPillColors(
    props.value ? BOOLEAN_YES_COLOR : BOOLEAN_NO_COLOR,
  );

  return (
    <span
      data-testid={props.dataTestId}
      data-ou-pill=""
      data-boolean-value={props.value ? "yes" : "no"}
      className={`${PILL_CLASS_NAME} align-top`}
      style={{ fontSize: PillSize.Normal, ...getPillToneStyle(colors) }}
    >
      <span
        aria-hidden="true"
        data-ou-pill-dot=""
        className={PILL_DOT_CLASS_NAME}
        style={getPillDotStyle(colors)}
      ></span>
      {translator.translateText(props.value ? "Yes" : "No")}
    </span>
  );
};

export default BooleanValue;
