import { AiAgentAction } from "./AiAgentActions";
import IconProp from "Common/Types/Icon/IconProp";
import CardMoreMenu from "Common/UI/Components/Card/CardMoreMenu";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { ReactElement } from "react";

/*
 * The AI agent card's ⋯ and the line that says a connection test is
 * running, shared by a Kubernetes cluster's AI agent page and every other
 * resource's. Which actions the ⋯ holds is AiAgentActions.ts.
 */

export const AI_AGENT_ACTIONS_BUTTON_TEST_ID: string =
  "ai-agent-actions-button";

/*
 * The same ⋯ as a table's card header (CardMoreMenu), named for what it
 * holds: the page has no other ⋯, but "More options" would not say whose
 * options they are. A locked item stays reachable from the keyboard and
 * says why it is locked (MoreMenuItem).
 */
export function AiAgentActionsMenu(props: {
  actions: Array<AiAgentAction>;
}): ReactElement {
  return (
    <CardMoreMenu
      ariaLabel="AI agent actions"
      dataTestId={AI_AGENT_ACTIONS_BUTTON_TEST_ID}
    >
      {props.actions.map((action: AiAgentAction): ReactElement => {
        return (
          <MoreMenuItem
            key={action.id}
            text={action.text}
            icon={action.icon}
            isDisabled={action.isDisabled}
            tooltip={action.disabledReason}
            dataTestId={action.dataTestId}
            onClick={action.onClick}
          />
        );
      })}
    </CardMoreMenu>
  );
}

/*
 * The agent card's header buttons: the ⋯ when there is anything in it, and
 * nothing at all otherwise - never an empty menu.
 */
export function getAiAgentCardButtons(
  actions: Array<AiAgentAction>,
): Array<ReactElement> {
  if (actions.length === 0) {
    return [];
  }

  return [<AiAgentActionsMenu key="ai-agent-actions" actions={actions} />];
}

/*
 * Shown in the card, where the result will appear, while a connection test
 * runs. The test starts from the ⋯, which closes as it starts - so the
 * progress cannot live on the menu item the way it lived on the old
 * button's spinner. A status region, so a screen reader hears that the
 * test started; the result's alert follows.
 */
export function AiAgentTestProgress(): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <div
      className="flex items-center gap-2 text-sm text-gray-600"
      role="status"
      aria-live="polite"
      data-testid="ai-agent-test-progress"
    >
      <Icon
        icon={IconProp.Spinner}
        className="h-4 w-4 flex-shrink-0 animate-spin text-indigo-500"
      />
      <span>{translator.translateText("Testing the connection…")}</span>
    </div>
  );
}
