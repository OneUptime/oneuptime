import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import React, { FunctionComponent, ReactElement } from "react";
import EventName from "../../Utils/EventName";

export interface ComponentProps {
  /*
   * Label defaults to "Ask AI" — pass e.g. "Ask AI about this incident" where
   * the surrounding page has room for the longer affordance.
   */
  label?: string | undefined;
}

/*
 * The entity-page entry point into Ask AI. It only opens the panel — the chat
 * detects what "this" is from the current route, so the button placed on an
 * incident view opens a conversation already grounded in that incident.
 * forceOpen (rather than toggle) so a click never closes an open panel.
 */
const AskAIButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <button
      type="button"
      data-testid="ask-ai-button"
      onClick={() => {
        GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE, {
          forceOpen: true,
        });
      }}
      className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
    >
      <Icon icon={IconProp.Sparkles} className="h-3.5 w-3.5" />
      {props.label || "Ask AI"}
    </button>
  );
};

export default AskAIButton;
