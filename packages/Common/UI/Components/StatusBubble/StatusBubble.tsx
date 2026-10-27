import Color from "../../../Types/Color";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

export interface ComponentProps {
  text: string;
  color: Color;
  style?: CSSProperties;
  shouldAnimate: boolean;
}

/*
 * The dot, then the status: one row with a gap between them, so the dot
 * sits at the start of the line and 10px before the words in either
 * reading direction. It used to be pushed into place with a negative
 * margin and a translate, which only work left to right: on a Persian page
 * the dot lay on the status's first letter.
 */
export const STATUS_BUBBLE_ROW_CLASS_NAME: string = "flex items-center gap-2.5";

// 14px, 2px in from the start of the line, never squeezed.
export const STATUS_BUBBLE_DOT_CLASS_NAME: string =
  "relative ms-0.5 flex h-3.5 w-3.5 flex-none";

const Statusbubble: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const text: string = translator.translateText(props.text) || props.text;
  const backgroundColor: string = props.color
    ? props.color.toString()
    : "var(--ou-text-subtle, #9ca3af)";

  return (
    <div
      className={STATUS_BUBBLE_ROW_CLASS_NAME}
      style={props.style}
      role="status"
      aria-label={translator.translateTemplate("Status: {{status}}", {
        status: text,
      })}
    >
      <span
        className={STATUS_BUBBLE_DOT_CLASS_NAME}
        aria-hidden="true"
        data-testid="status-bubble-dot"
      >
        <span
          className={`${
            props.shouldAnimate ? "motion-safe:animate-ping" : ""
          } absolute inline-flex h-full w-full rounded-full`}
          style={{
            backgroundColor: backgroundColor,
          }}
        ></span>
        <span
          className="relative inline-flex rounded-full h-3.5 w-3.5"
          style={{
            backgroundColor: backgroundColor,
            boxShadow: "0 0 0 1px var(--ou-border-strong, #d1d5db)",
          }}
        ></span>
      </span>
      {/*
       * On a value's 24px line (leading-6), as a table's cell and a detail
       * card's value are: text-sm alone set a 20px one, which drew the
       * status 2px above the values beside it in a row.
       */}
      <div
        className="text-sm font-medium leading-6"
        style={{
          color: "var(--ou-text-secondary, #4b5563)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

export default Statusbubble;
