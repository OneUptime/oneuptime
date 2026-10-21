import React, { FunctionComponent, ReactElement } from "react";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import AttributeKeySentence from "./AttributeKeySentence";
import { TYPE_A_VALUE_HINT } from "./AttributeValuesLoadError";

/*
 * What the `@key:` dropdown says when the lookup of a key's values came back
 * with none (issue #4708): the key is not on the rows of the time range on
 * screen, or none of its values is one the picker offers (empty, or longer
 * than a dropdown line). The dropdown used to show "Loading values for
 * <key>..." and then vanish, which read as the picker breaking.
 *
 * "To suggest", not "no values": the lookup reads a sample of the range and
 * leaves out values too long for a line, so the key may still have values
 * the reader can type.
 */

export const ATTRIBUTE_VALUES_EMPTY_TEST_ID: string = "attribute-values-empty";

const NO_VALUES_SENTENCE: string = translationKey(
  "No values to suggest for {{key}} in this time range.",
);

export interface AttributeValuesEmptyProps {
  attributeKey: string;
}

const AttributeValuesEmpty: FunctionComponent<AttributeValuesEmptyProps> = (
  props: AttributeValuesEmptyProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      role="status"
      data-testid={ATTRIBUTE_VALUES_EMPTY_TEST_ID}
      className="flex items-start gap-2.5 px-3 py-2.5 text-sm"
    >
      <div className="mt-0.5 flex-none">
        <Icon icon={IconProp.Info} className="h-4 w-4 text-gray-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words text-gray-700">
          <AttributeKeySentence
            template={NO_VALUES_SENTENCE}
            attributeKey={props.attributeKey}
          />
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {translator.translateText(TYPE_A_VALUE_HINT)}
        </p>
      </div>
    </div>
  );
};

export default AttributeValuesEmpty;
