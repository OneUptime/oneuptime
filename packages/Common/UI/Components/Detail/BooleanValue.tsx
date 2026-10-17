import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A yes/no value as details and a form's summary step show it: a green "Yes"
 * pill, or a grey "No" one. Detail draws every FieldType.Boolean field with
 * it; a summary element of its own that still needs to say whether a box was
 * ticked uses it too, so the two cannot drift apart.
 *
 * As tall as a value's line (24px: py-0.5 round text-sm's 20px), so a row of
 * a detail card holding a yes/no is as tall as one holding text, and the
 * word sits level with the values beside it - top to top on the value's
 * line (align-top), not on its baseline. At py-1 the pill was 28px: its row
 * 4px taller than the others, its word lower than its neighbours'.
 */

export interface ComponentProps {
  value: boolean;
  dataTestId?: string | undefined;
}

const BooleanValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.value) {
    return (
      <span
        data-testid={props.dataTestId}
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-green-50 text-green-700 text-sm font-medium align-top"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
        {translator.translateText("Yes")}
      </span>
    );
  }

  return (
    <span
      data-testid={props.dataTestId}
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-sm font-medium align-top"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
      {translator.translateText("No")}
    </span>
  );
};

export default BooleanValue;
