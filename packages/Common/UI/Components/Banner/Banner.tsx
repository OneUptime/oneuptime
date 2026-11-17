import readAsWritten from "../IsolatedText/ReadAsWritten";
import useTranslator from "../../Utils/UseTranslator";
import { Translator } from "../../Utils/TranslateTemplate";
import DirectionArrow from "../DirectionArrow/DirectionArrow";
import Link from "../Link/Link";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import { GetReactElementFunction } from "../../Types/FunctionTypes";

export interface ComponentProps {
  title: string;
  description: string;
  link?: URL | Route | undefined;
  openInNewTab?: boolean | undefined;
  hideOnMobile?: boolean | undefined;
}

/*
 * A banner's words. They were gray-400, 2.5:1 on the page, and the banner
 * looked switched off while it says what a person has to know: that SCIM
 * Push Groups manage a project's users, so nobody can be invited here, or
 * where a setting's guide is (#9024). The sentence is gray-600 (7.6:1), the
 * title gray-900, as the Dashboard's other quiet text is (SECONDARY_LINK).
 */
export const BANNER_TEXT_CLASS_NAME: string = "text-sm text-gray-600";

export const BANNER_TITLE_CLASS_NAME: string = "font-semibold text-gray-900";

/*
 * A banner that leads somewhere reads as a link: darker and underlined under
 * the pointer, ringed when focused.
 */
export const BANNER_LINK_CLASS_NAME: string =
  "rounded underline-offset-2 hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const Banner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();
  const translatedTitle: string = translateString(props.title) || props.title;
  const translatedDescription: string =
    translateString(props.description) || props.description;
  const getContent: GetReactElementFunction = (): ReactElement => {
    return (
      <>
        <strong className={BANNER_TITLE_CLASS_NAME}>{translatedTitle}</strong>
        <svg
          viewBox="0 0 2 2"
          className="mx-2 inline h-0.5 w-0.5 fill-current"
          aria-hidden="true"
        >
          <circle cx="1" cy="1" r="1" />
        </svg>
        {readAsWritten(translatedDescription, translator.language)}
        {/*
         * The arrow says the banner leads somewhere, so only one that does
         * draws it: the SCIM notice, which links nowhere, ended in an arrow
         * that went nowhere.
         */}
        {props.link ? (
          <>
            &nbsp;
            <DirectionArrow isDecorative={true} />
          </>
        ) : null}
      </>
    );
  };

  return (
    <div
      className={`flex border-gray-200 rounded-xl border-2 py-2.5 px-6 sm:px-3.5 mb-5${props.hideOnMobile ? " max-md:hidden md:flex" : ""}`}
    >
      <p className={BANNER_TEXT_CLASS_NAME}>
        {props.link && (
          <Link
            to={props.link}
            openInNewTab={props.openInNewTab}
            className={BANNER_LINK_CLASS_NAME}
          >
            {getContent()}
          </Link>
        )}
        {!props.link && getContent()}
      </p>
    </div>
  );
};

export default Banner;
