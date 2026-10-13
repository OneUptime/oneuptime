import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * The quiet line along the bottom of a calendar link card: a footnote worth
 * having on the card but never worth reading first - the personal link's
 * pointer to the On-Call Time Log, the shared link's "it belongs to the
 * project". It runs from edge to edge of the card under a rule, in small
 * grey type on the card's grey, so it reads as the card's footer rather than
 * as one more paragraph of the same weight as everything above it.
 *
 * The negative margins undo the card's own padding (Card's
 * CARD_PADDING_CLASS_NAME: py-6 px-5 md:px-6), and the bottom corners follow
 * the card's.
 */
export const FEED_CARD_FOOTER_CLASS_NAME: string =
  "-mx-5 -mb-6 mt-6 flex items-start gap-2 rounded-b-xl border-t border-gray-100 bg-gray-50 px-5 py-3 text-xs leading-5 text-gray-500 md:-mx-6 md:px-6";

export interface ComponentProps {
  icon: IconProp;
  children: ReactNode;
  dataTestId: string;
}

const FeedCardFooter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className={FEED_CARD_FOOTER_CLASS_NAME} data-testid={props.dataTestId}>
      <Icon
        icon={props.icon}
        className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400"
      />
      <p className="min-w-0">{props.children}</p>
    </div>
  );
};

export default FeedCardFooter;
