import { getListSeparator, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import PhoneNumberText from "./PhoneNumberText";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  phoneNumbers: ReadonlyArray<string>;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * PHONE NUMBERS LISTED IN A LINE OF THE PAGE, EACH READ +447700900123.
 *
 * A Twilio account's SMS or secondary numbers, typed as one list
 * ("+6581234567, +447700900123") and drawn as one string, read on an
 * Arabic page from its last number, with every "+" at the end of its
 * digits. Each number is a PhoneNumberText here, and they are separated
 * the reader's way (", " - "، " in Persian and Arabic, "、" in Japanese and
 * Chinese: getListSeparator), so the list follows the page while no
 * number is turned round inside it - as IsolatedTextList lists names.
 */
const PhoneNumberTextList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const separator: string = getListSeparator(translator.language);
  const phoneNumbers: Array<string> = props.phoneNumbers
    .map((phoneNumber: string): string => {
      return phoneNumber.trim();
    })
    .filter((phoneNumber: string): boolean => {
      return phoneNumber.length > 0;
    });

  return (
    <span className={props.className} data-testid={props.dataTestId}>
      {phoneNumbers.map((phoneNumber: string, index: number): ReactElement => {
        return (
          <Fragment key={index}>
            {index > 0 ? separator : <></>}
            <PhoneNumberText phoneNumber={phoneNumber} />
          </Fragment>
        );
      })}
    </span>
  );
};

export default PhoneNumberTextList;
