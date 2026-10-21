import {
  getSentenceParts,
  PluralTemplate,
  SentencePart,
  TemplateValues,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
} from "react";

/*
 * A whole sentence in the reader's language with some of its values drawn as
 * elements - "{{field}} contains {{value}}" with the field and the value in
 * bold. Gluing translated fragments around the elements instead ("Status" +
 * t("contains") + "api") reads each word out of context and keeps English
 * word order in every language; here the locale moves {{field}} and {{value}}
 * wherever its grammar puts them.
 *
 * The slots are drawn exactly as given and never go through translation. A
 * translation that lost a slot or repeated one falls back to the English
 * sentence, so nothing the reader needs is dropped.
 */

export interface ComponentProps {
  // English template (the translation key), or a count-dependent one.
  template: string | PluralTemplate;
  // Picks the form of a PluralTemplate; fills its {{count}}.
  count?: number | undefined;
  // Placeholder name -> what to draw there.
  slots: Record<string, ReactNode>;
  // Values for the other placeholders (text, numbers, translatableTerm()).
  values?: TemplateValues | undefined;
  /*
   * Draws the text between the slots. By default it is plain text; a flex
   * row, which drops the spaces at the ends of loose text, can wrap each
   * piece in an element of its own instead.
   */
  renderText?: ((text: string) => ReactNode) | undefined;
}

const TranslatedSentence: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const parts: Array<SentencePart> = getSentenceParts({
    translator: translator,
    template: props.template,
    slots: Object.keys(props.slots),
    values: props.values,
    count: props.count,
  });

  return (
    <>
      {parts.map((part: SentencePart, index: number): ReactElement => {
        return (
          <Fragment key={index}>
            {part.kind === "slot"
              ? props.slots[part.slot]
              : props.renderText
                ? props.renderText(part.text)
                : part.text}
          </Fragment>
        );
      })}
    </>
  );
};

export default TranslatedSentence;
