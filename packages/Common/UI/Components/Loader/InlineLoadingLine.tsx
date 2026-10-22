import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One quiet line saying what is being read, with a small spinner: inside a
 * dialog that opened at once and is still asking the server something -
 * "Checking what deleting it would change…" - so a click is never left
 * without an answer, and the dialog does not jump about when a bar loader
 * swaps for its words. A screen reader hears the line once (status, polite).
 */

export interface ComponentProps {
  // English, looked up here.
  text: string;
  dataTestId?: string | undefined;
  className?: string | undefined;
}

const InlineLoadingLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={props.dataTestId || "inline-loading-line"}
      className={`flex items-center gap-2 text-sm text-gray-500 ${
        props.className || ""
      }`.trim()}
    >
      <Icon
        icon={IconProp.Spinner}
        className="h-4 w-4 flex-none animate-spin text-gray-400 motion-reduce:animate-none"
      />
      <span>{translator.translateText(props.text) || props.text}</span>
    </div>
  );
};

export default InlineLoadingLine;
