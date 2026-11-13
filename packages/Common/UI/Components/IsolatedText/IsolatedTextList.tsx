import { getListSeparator, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import IsolatedText from "./IsolatedText";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /*
   * The values, each set apart as written. An element is drawn as given, in
   * its place in the list: words of the page's own, such as the reader's
   * word for a record deleted since, read the page's way, and an isolate
   * would turn a translated phrase round.
   */
  texts: ReadonlyArray<string | ReactElement>;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * VALUES SOMEONE WROTE, LISTED IN A LINE OF THE PAGE, EACH READ THE WAY IT IS
 * WRITTEN.
 *
 * A list of names or patterns - the components an External Status Page
 * monitor watches, a service's tags - joined into one string and drawn on a
 * Persian page read as one line in the page's direction: a pattern's star
 * left the end of "Git*" and stood at its start ("*Git"), and one value's
 * full stop or bracket jumped to the next value. Each value is its own
 * isolate here (IsolatedText: the way most of its letters read), and the
 * items are separated the reader's way (", " - "، " in Persian, "、" in
 * Japanese and Chinese: getListSeparator), so the list itself follows the
 * page while no value is turned round inside it.
 */
const IsolatedTextList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const separator: string = getListSeparator(translator.language);

  return (
    <span className={props.className} data-testid={props.dataTestId}>
      {props.texts.map(
        (text: string | ReactElement, index: number): ReactElement => {
          return (
            <Fragment key={index}>
              {index > 0 ? separator : <></>}
              {typeof text === "string" ? <IsolatedText text={text} /> : text}
            </Fragment>
          );
        },
      )}
    </span>
  );
};

export default IsolatedTextList;
