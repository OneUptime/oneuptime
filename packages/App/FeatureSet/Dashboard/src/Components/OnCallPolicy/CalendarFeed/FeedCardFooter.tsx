import IconProp from "Common/Types/Icon/IconProp";
import {
  CARD_RULED_BODY_CLASS_NAME,
  useIsCardSection,
} from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * The quiet line along the bottom of a calendar link card: a footnote worth
 * having on the card but never worth reading first - the personal link's
 * pointer to the On-Call Time Log, the shared link's "it belongs to the
 * project". It is small grey type, so it reads as the card's footer rather
 * than as one more paragraph of the same weight as everything above it.
 *
 * On a page it runs from edge to edge of the card under a rule across it,
 * on the card's grey, its bottom corners the card's: the card's ruled body
 * (CardSurface), whose negative margins undo the card's own padding. In a
 * section of another card a rule across would read as the divider of a
 * section without a title, so there it is the same grey line, with no rule
 * and no ground of its own.
 */
export const FEED_CARD_FOOTER_CLASS_NAME: string = `${CARD_RULED_BODY_CLASS_NAME} mt-6 flex items-start gap-2 rounded-b-xl bg-gray-50 px-5 py-3 text-xs leading-5 text-gray-500 md:px-6`;

export const FEED_CARD_FOOTER_SECTION_CLASS_NAME: string =
  "mt-6 flex items-start gap-2 text-xs leading-5 text-gray-500";

export const FEED_CARD_FOOTER_TEXT_CLASS_NAME: string = "min-w-0 text-pretty";

export interface ComponentProps {
  icon: IconProp;
  children: ReactNode;
  dataTestId: string;
}

const FeedCardFooter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isCardSection: boolean = useIsCardSection();

  return (
    <div
      className={
        isCardSection
          ? FEED_CARD_FOOTER_SECTION_CLASS_NAME
          : FEED_CARD_FOOTER_CLASS_NAME
      }
      data-testid={props.dataTestId}
    >
      <Icon
        icon={props.icon}
        className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400"
      />
      {/*
       * Wrapped the way a person would set it: a line that breaks never
       * leaves one short word alone on the last line ("Log", of "Open the
       * On-Call Time Log").
       */}
      <p className={FEED_CARD_FOOTER_TEXT_CLASS_NAME}>{props.children}</p>
    </div>
  );
};

export default FeedCardFooter;
