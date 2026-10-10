import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { LlmAnswerIssue } from "Common/Types/Telemetry/LlmAnswerIssue";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { LLM_ISSUE_STYLES, LlmIssueStyle } from "./LlmConversationCopy";

/*
 * What went wrong with an answer, as a small pill: "Refused", or with a
 * count "2 refusals". Hovering says what the issue means in one sentence -
 * the pill is the only place many people will meet the word.
 */

export interface ComponentProps {
  issue: LlmAnswerIssue;
  // Show "2 refusals" instead of "Refused".
  count?: number | undefined;
  dataTestId?: string | undefined;
}

const LlmIssueBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const style: LlmIssueStyle = LLM_ISSUE_STYLES[props.issue];

  const label: string =
    props.count !== undefined
      ? translator.translatePlural(style.countLabel, props.count)
      : translator.translateText(style.title) || style.title;

  return (
    // Tooltip translates its own text: it is handed the English.
    <Tooltip text={style.description}>
      <div
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.badgeClassName}`}
        data-testid={props.dataTestId || `llm-issue-badge-${props.issue}`}
        data-issue={props.issue}
      >
        <Icon icon={style.icon} className="h-3 w-3" />
        <div>{label}</div>
      </div>
    </Tooltip>
  );
};

export default LlmIssueBadge;
