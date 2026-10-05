import IconProp from "../../../Types/Icon/IconProp";
import MoreMenu from "../MoreMenu/MoreMenu";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: Array<ReactElement>;
  /*
   * The button's accessible name, for a ⋯ that holds one thing's actions
   * (an AI agent's Test connection and Reset agent) rather than a list's
   * options. Left out, it is "More options", like a table's and a feed's.
   */
  ariaLabel?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * The ⋯ More button at the end of a card's header, and the menu it opens.
 * A card shows its main action as a button and keeps everything else in
 * here: a table's Refresh, Filter and Columns, a feed's sort order, its
 * event type filter and Refresh. "The idea is to have as few buttons as
 * possible visible to the user."
 *
 * Every card header's ⋯ is this one component - an outlined button with three
 * dots, named "More options" unless the card names it - so a table's and a
 * feed's are the same button, and stay so.
 */
const CardMoreMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <MoreMenu
      menuIcon={IconProp.EllipsisHorizontal}
      text=""
      ariaLabel={props.ariaLabel}
      dataTestId={props.dataTestId}
    >
      {props.children}
    </MoreMenu>
  );
};

export default CardMoreMenu;
