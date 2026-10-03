import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import MoreMenu from "../MoreMenu/MoreMenu";

export interface ComponentProps {
  // The feed's actions: MoreMenuItems such as Add Public Note.
  children: Array<ReactElement>;
}

/*
 * A feed's main action - the Actions menu of the incident, alert, episode and
 * scheduled maintenance feeds: add a note, run a runbook, page an on-call
 * policy. FeedCard shows it beside the ⋯ that holds everything else, the way
 * a table keeps its Create button beside its ⋯, so the one thing a reader
 * comes to a feed to do besides reading it is never hidden.
 *
 * One component, so every feed's Actions looks the same and is named in the
 * reader's language.
 */
const FeedActionsMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <MoreMenu
      elementToBeShownInsteadOfButton={
        <div
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all duration-150 cursor-pointer select-none"
          data-testid="feed-actions-button"
        >
          <Icon icon={IconProp.Bolt} className="h-4 w-4 text-gray-500" />
          <span>{translator.translateText("Actions")}</span>
          <Icon
            icon={IconProp.ChevronDown}
            className="h-3.5 w-3.5 text-gray-400 ml-0.5"
          />
        </div>
      }
    >
      {props.children}
    </MoreMenu>
  );
};

export default FeedActionsMenu;
