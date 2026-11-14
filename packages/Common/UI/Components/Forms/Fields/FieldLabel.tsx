import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import DefinedTerm from "../../Glossary/LazyDefinedTerm";
import readAsWritten from "../../IsolatedText/ReadAsWritten";
import { PRODUCT_TEXT_CLASS_NAME } from "../../../Utils/ProductText";
import useTranslator from "../../../Utils/UseTranslator";
import { Translator } from "../../../Utils/TranslateTemplate";
import Link from "../../Link/Link";
import InfoTooltip from "../../Tooltip/InfoTooltip";
import { FormFieldSideLink } from "../Types/Field";
import {
  splitTitleOptionalMark,
  TitleOptionalMark,
} from "../Utils/OptionalMark";
import useTranslateValue from "../../../Utils/Translation";
import React, { FunctionComponent, ReactElement, useRef } from "react";

export interface ComponentProps {
  title: string;
  id?: string | undefined;
  htmlFor?: string | undefined;
  required?: boolean | undefined;
  sideLink?: FormFieldSideLink | undefined;
  description?: string | ReactElement | undefined;
  /*
   * The id the description is drawn with, for the field's control to be
   * described by it (aria-describedby): a screen reader reads the help as
   * the reader reaches the field, not only when reading the page through.
   */
  descriptionId?: string | undefined;
  /*
   * More about the field than its one-line description should hold - the
   * exact rule a probe follows, say. Shown in an (i) beside the title, on
   * hover or keyboard focus, so the field itself reads in one line - the
   * same prop, and the same (i), as a details card's FieldLabel. The (i)
   * sits outside the <label>: inside it, its "About <title>" would join the
   * name the field is read out by.
   */
  tooltip?: string | undefined;
  /*
   * The Glossary term the title names: the title is drawn as a defined
   * term (Glossary/DefinedTerm), and hovering, focusing or tapping it shows
   * what the word means. For the field where a page first uses a word
   * people trip on ("Criteria", "Probes"), not every field that uses it.
   */
  glossaryTerm?: GlossaryTerm | undefined;
  isHeading?: boolean | undefined;
  hideOptionalLabel?: boolean | undefined;
  className?: string | undefined;
}

// The data-testid of the (i) beside a field's title.
export const FIELD_LABEL_TOOLTIP_TEST_ID: string = "field-label-tooltip";

const FieldLabelElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString, translateValue } = useTranslateValue();
  const translator: Translator = useTranslator();
  const translatedTitle: string = translateString(props.title) ?? props.title;
  const translatedSideLinkText: string | undefined = translateString(
    props.sideLink?.text,
  );
  const translatedDescription: string | ReactElement | undefined =
    translateValue(props.description);

  /*
   * A title that says "(Optional)" itself - "DNS Server (Optional)", the
   * LLM budgets' "Service (optional)" - is drawn without those words and
   * with the label's own mark: one mark, worded as every other field's on
   * the form ("Service (optional)" beside "Daily Budget (USD) (Optional)",
   * or a French "(facultatif)" beside "(Optionnel)", read as two different
   * marks). Its mark shows even on a field marked required or told to hide
   * it, as its title asks (Utils/OptionalMark).
   */
  const titleMark: TitleOptionalMark = splitTitleOptionalMark({
    englishTitle: props.title,
    drawnTitle: translatedTitle,
  });

  const drawnTitle: string = titleMark.mark
    ? titleMark.title.trimEnd()
    : translatedTitle;

  const showsOptionalMark: boolean =
    Boolean(titleMark.mark) || !(props.required || props.hideOptionalLabel);

  const className: string =
    props.className ||
    `block ${
      props.isHeading ? "text-lg" : "text-sm"
    }  font-medium text-gray-700 flex justify-between`;

  /*
   * Where a defined term's definition is drawn: right after the title, not
   * in it. The title names the field - a dropdown or a picker through its
   * id (aria-labelledby), a native input as its <label for> - and a field
   * is named by every word inside its title: drawn in it, the open
   * definition and its Read more were read out as the field's name ("Probes
   * Probe A machine that runs checks. Read more") for as long as it showed.
   * Right after the title, it is still the next place Tab goes from the
   * word (after a side link, which a sign-in form's title has and no
   * defined term's does), before the (i) and the field. It draws no box.
   */
  const definitionPlace: React.RefObject<HTMLSpanElement> =
    useRef<HTMLSpanElement>(null);

  const words: ReactElement = (
    <>
      <span className={PRODUCT_TEXT_CLASS_NAME}>
        {props.glossaryTerm ? (
          <DefinedTerm term={props.glossaryTerm} popoverPlace={definitionPlace}>
            {drawnTitle}
          </DefinedTerm>
        ) : (
          drawnTitle
        )}{" "}
        <span className="text-gray-400 text-xs">
          {showsOptionalMark
            ? translateString("(Optional)") ?? "(Optional)"
            : ""}
        </span>
      </span>
      {props.sideLink && translatedSideLinkText && props.sideLink?.url && (
        <span data-testid="login-forgot-password">
          <Link
            to={props.sideLink?.url}
            openInNewTab={props.sideLink?.openLinkInNewTab}
            className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
          >
            {translatedSideLinkText}
          </Link>
        </span>
      )}
    </>
  );

  /*
   * A title with no control to point at (no `for`: a dropdown's, a
   * picker's) whose word is a defined term is not a <label>. A <label> with
   * no `for` takes the first button inside it, the word's, for the control
   * it labels, and the browser hands that control a click on any of the
   * label's own words or space: a click on "(Optional)", or on the empty
   * end of the row, opened the definition. The control is named by the
   * title through its id (aria-labelledby) all the same, and the title
   * keeps a label's arrow over its words.
   */
  const title: ReactElement =
    props.glossaryTerm && !props.htmlFor ? (
      <span id={props.id} className={`${className} cursor-default`}>
        {words}
      </span>
    ) : (
      <label id={props.id} htmlFor={props.htmlFor} className={className}>
        {words}
      </label>
    );

  const label: ReactElement = props.glossaryTerm ? (
    <>
      {title}
      <span ref={definitionPlace} className="contents" />
    </>
  ) : (
    title
  );

  return (
    <>
      {props.tooltip ? (
        <div className="flex items-center gap-1">
          {label}
          {/*
           * The English title: InfoTooltip words "About <title>" in the
           * reader's language and translates the title within it.
           */}
          <InfoTooltip
            text={props.tooltip}
            label={props.title}
            dataTestId={FIELD_LABEL_TOOLTIP_TEST_ID}
          />
        </div>
      ) : (
        label
      )}

      {translatedDescription && (
        <div id={props.descriptionId} className="mt-1 text-sm text-gray-500">
          {readAsWritten(translatedDescription, translator.language)}
        </div>
      )}
    </>
  );
};

export default FieldLabelElement;
