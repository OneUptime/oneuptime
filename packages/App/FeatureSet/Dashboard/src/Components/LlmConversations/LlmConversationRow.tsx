import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import {
  LlmConversationKeyKind,
  LlmConversationListItem,
} from "Common/Types/Telemetry/LlmConversationApi";
import {
  LlmAnswerIssue,
  LlmAnswerIssueUtil,
} from "Common/Types/Telemetry/LlmAnswerIssue";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AppLink from "../AppLink/AppLink";
import LlmIssueBadge from "./LlmIssueBadge";
import {
  LLM_HEALTHY_DOT_CLASS_NAME,
  LLM_ISSUE_STYLES,
} from "./LlmConversationCopy";
import {
  formatLlmCost,
  formatLlmDuration,
  truncateLlmText,
} from "./LlmConversationFormat";

/*
 * One conversation in the list: what the person first asked, who asked it,
 * in which app, with which model, how long it ran, what it cost - and, when
 * something went wrong, what. The whole row opens the conversation.
 */

export interface ComponentProps {
  conversation: LlmConversationListItem;
  route: Route;
  // App (telemetry service) names by id.
  serviceNames: Map<string, string>;
}

// The dot's colour: the worst issue the conversation had, or healthy.
export function getConversationDotClassName(
  conversation: LlmConversationListItem,
): string {
  for (const issue of LlmAnswerIssueUtil.getAllIssues()) {
    if ((conversation.issueCounts[issue] || 0) > 0) {
      return LLM_ISSUE_STYLES[issue].dotClassName;
    }
  }

  return LLM_HEALTHY_DOT_CLASS_NAME;
}

const LlmConversationRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const conversation: LlmConversationListItem = props.conversation;

  const issues: Array<LlmAnswerIssue> =
    LlmAnswerIssueUtil.getAllIssues().filter(
      (issue: LlmAnswerIssue): boolean => {
        return (conversation.issueCounts[issue] || 0) > 0;
      },
    );

  const title: string = conversation.title
    ? truncateLlmText(conversation.title, 160)
    : conversation.kind === LlmConversationKeyKind.Request
      ? translator.translateTemplate("Request {{id}}", {
          id: conversation.traceId.slice(0, 8),
        })
      : translator.translateTemplate("Conversation {{id}}", {
          id: truncateLlmText(conversation.conversationId, 32),
        });

  const appNames: Array<string> = conversation.serviceIds
    .map((id: string): string => {
      return props.serviceNames.get(id) || "";
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  const facts: Array<{ key: string; text: string }> = [];

  if (conversation.people[0]) {
    facts.push({ key: "person", text: conversation.people[0] });
  }

  if (appNames[0]) {
    facts.push({ key: "app", text: appNames.join(", ") });
  }

  if (conversation.models.length > 0) {
    facts.push({ key: "models", text: conversation.models.join(", ") });
  }

  facts.push({
    key: "answers",
    text: translator.translatePlural(
      { one: "{{count}} answer", other: "{{count}} answers" },
      conversation.answerCount,
    ),
  });

  if (conversation.durationMs > 0) {
    facts.push({
      key: "duration",
      text: formatLlmDuration(conversation.durationMs),
    });
  }

  if (conversation.costUsd > 0) {
    facts.push({ key: "cost", text: formatLlmCost(conversation.costUsd) });
  }

  const startedAt: Date = new Date(conversation.startedAt);
  const hasDate: boolean = !Number.isNaN(startedAt.getTime());

  return (
    <AppLink
      to={props.route}
      className="group block px-4 py-3.5 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:px-6"
    >
      <div
        className="flex items-start gap-3"
        data-testid="llm-conversation-row"
        data-key={conversation.key}
      >
        <div
          className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${getConversationDotClassName(conversation)}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <div
              className={`line-clamp-2 break-words text-sm font-medium ${
                conversation.title ? "text-gray-900" : "text-gray-500"
              }`}
              data-testid="llm-conversation-row-title"
            >
              {title}
            </div>
            {hasDate ? (
              <div
                className="flex-shrink-0 text-xs text-gray-500"
                title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  startedAt,
                )}
              >
                {OneUptimeDate.fromNow(startedAt)}
              </div>
            ) : (
              <></>
            )}
          </div>
          <div
            className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-500"
            data-testid="llm-conversation-row-facts"
          >
            {facts.map((fact: { key: string; text: string }, index: number) => {
              return (
                <React.Fragment key={fact.key}>
                  {index > 0 ? (
                    <span className="text-gray-300" aria-hidden="true">
                      ·
                    </span>
                  ) : (
                    <></>
                  )}
                  <span className="max-w-[16rem] truncate" data-fact={fact.key}>
                    {fact.text}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
          {issues.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {issues.map((issue: LlmAnswerIssue) => {
                return (
                  <LlmIssueBadge
                    key={issue}
                    issue={issue}
                    count={conversation.issueCounts[issue]}
                  />
                );
              })}
            </div>
          ) : (
            <></>
          )}
        </div>
        <div className="mt-0.5 flex-shrink-0 text-gray-300 group-hover:text-gray-500">
          <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
        </div>
      </div>
    </AppLink>
  );
};

export default LlmConversationRow;
