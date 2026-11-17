import readAsWritten from "../IsolatedText/ReadAsWritten";
import useTranslator from "../../Utils/UseTranslator";
import { Translator } from "../../Utils/TranslateTemplate";
import Icon from "../Icon/Icon";
import ProviderLogoImage from "../ProviderLogo/ProviderLogoImage";
import IconProp from "../../../Types/Icon/IconProp";
import ProviderLogo from "../../../Types/ProviderLogo/ProviderLogo";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * How much room an empty state takes, by where it sits. Each is a preset, so
 * an empty card is as tall on one page as on the next, and no call site
 * writes padding of its own.
 *
 * The default used to be 13rem above and 13rem below (416px), a whole page's
 * worth, so in a card on a 390px phone the message began a quarter of the
 * way down the screen; callers then overrode it with a dozen sizes of their
 * own, and two cancelled it with negative margins (#9135).
 */
export enum EmptyStateSize {
  // A short line in a panel, a step of a form, a list inside a card.
  Inline = "inline",
  // The body of a card or a list: the default.
  Card = "card",
  // A whole page with nothing else on it: not found, not set up, blocked.
  Page = "page",
}

export const EMPTY_STATE_PADDING_CLASS_NAMES: Readonly<
  Record<EmptyStateSize, string>
> = {
  [EmptyStateSize.Inline]: "px-4 py-6",
  [EmptyStateSize.Card]: "px-4 py-12 sm:py-16",
  [EmptyStateSize.Page]: "px-4 py-16 sm:py-24",
};

export interface ComponentProps {
  title: string | ReactElement;
  description: string | ReactElement;
  icon: IconProp | undefined;
  /*
   * The official mark of the product the state is about ("Slack is not
   * connected yet!"), drawn in the icon's place and in its colour.
   */
  logo?: ProviderLogo | undefined;
  footer?: ReactElement | undefined;
  id: string;
  iconClassName?: string;
  showSolidBackground?: boolean | undefined;
  // Where the state sits (EmptyStateSize); a card's room by default.
  size?: EmptyStateSize | undefined;
}

const EmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue } = useTranslateValue();
  const translator: Translator = useTranslator();
  const size: EmptyStateSize = props.size || EmptyStateSize.Card;
  return (
    <React.Fragment>
      <div
        id={props.id}
        data-size={size}
        className={`flex w-full ${EMPTY_STATE_PADDING_CLASS_NAMES[size]} ${
          props.showSolidBackground ? "bg-white rounded shadow" : ""
        }`}
      >
        {/*
         * Full width so the footer can lay out a wide block (a grid of
         * guides) without being squeezed to its content; everything inside
         * is centred on its own.
         */}
        <div className="m-auto w-full text-center">
          {props.logo ? (
            /*
             * The product's mark in the grey an empty state's icon has. A
             * filled mark carries more ink than an outline icon, so it is
             * drawn a size smaller to sit as lightly on the page.
             */
            <ProviderLogoImage
              logo={props.logo}
              size={40}
              isBare={true}
              isDecorative={true}
              colorClassName="text-gray-400"
              className="mx-auto h-12"
            />
          ) : (
            props.icon && (
              <Icon
                icon={props.icon}
                className={
                  props.iconClassName || `mx-auto h-12 w-12 text-gray-400`
                }
              />
            )
          )}

          <h3 className="mt-2 text-sm font-medium text-gray-900">
            {translateValue(props.title)}
          </h3>
          {/*
           * Capped at a readable measure. Uncapped, a long description in a
           * wide table ran edge to edge as a single line.
           */}
          {/*
           * Balanced, as centred text should be: a description just over
           * one line wraps into two even lines, not a line and an orphan.
           */}
          <p
            className="mx-auto mt-1 max-w-xl text-balance text-sm leading-6 text-gray-500"
            data-testid={`${props.id}-description`}
          >
            {readAsWritten(
              translateValue(props.description),
              translator.language,
            )}
          </p>
          {/*
           * A flex row, so a footer that is itself a block-level flex box
           * (an OUTLINE Button is one) is centred instead of stretching
           * across the row with its label pinned to the left edge.
           */}
          {props.footer && (
            <div
              className="mt-6 flex justify-center"
              data-testid={`${props.id}-footer`}
            >
              {props.footer}
            </div>
          )}
        </div>
      </div>
    </React.Fragment>
  );
};

export default EmptyState;
