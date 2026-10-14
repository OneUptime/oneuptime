import IconProp from "Common/Types/Icon/IconProp";
import CardMoreMenu from "Common/UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import React, { ReactElement } from "react";

/*
 * What a calendar link card keeps out of sight: Regenerate link, Disable or
 * Enable link and, for a personal link, Delete link. Each is something a
 * reader does rarely - when a link leaked, to pause it, to be rid of it -
 * and none of them should sit above the subscribe options as three buttons,
 * one a red Delete. So they are the card header's ⋯ (CardMoreMenu, the same
 * button a table's and a feed's card header has), named for what it holds.
 *
 * Regenerate and Delete still ask before they act (the cards' ConfirmModal);
 * Disable does not - it is undone with Enable link, which the status panel
 * offers at once.
 *
 * An action the reader may not take stays in the menu, locked, saying which
 * permission it needs (MoreMenuItem's explained lock) - a shared link's
 * viewer can see that editors regenerate it. An action with nothing useful
 * to say about why it is locked is left out, and a menu with nothing in it
 * is not drawn at all.
 */
export interface FeedManageAction {
  key: string;
  text: string;
  icon: IconProp;
  onClick: () => void;
  isDestructive?: boolean | undefined;
  isDisabled?: boolean | undefined;
  // Why the action is locked: read on hover and to screen readers.
  disabledReason?: string | undefined;
  dataTestId: string;
}

export function getFeedManageMenuButtons(data: {
  actions: Array<FeedManageAction>;
  idPrefix: string;
}): Array<ReactElement> {
  if (data.actions.length === 0) {
    return [];
  }

  return [
    <CardMoreMenu
      key="manage-link"
      ariaLabel="Manage link"
      dataTestId={`${data.idPrefix}-manage`}
    >
      {data.actions.map((action: FeedManageAction): ReactElement => {
        return (
          <MoreMenuItem
            key={action.key}
            text={action.text}
            icon={action.icon}
            isDestructive={action.isDestructive}
            isDisabled={action.isDisabled || Boolean(action.disabledReason)}
            tooltip={action.disabledReason}
            dataTestId={action.dataTestId}
            onClick={action.onClick}
          />
        );
      })}
    </CardMoreMenu>,
  ];
}
