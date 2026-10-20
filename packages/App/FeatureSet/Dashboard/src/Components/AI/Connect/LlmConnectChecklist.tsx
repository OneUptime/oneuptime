import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Where the project stands, ticked by what is true rather than by what
 * was clicked: AI calls have arrived from an app, a provider account is
 * connected, a company AI tool is connected, a budget is set. Each line
 * says what it unlocks and takes you to where it is done.
 *
 * Undefined is "not known yet" (still loading, or the read failed): the
 * line shows neither a tick nor an empty circle.
 */

export type LlmConnectChecklistKey =
  | "apps"
  | "providers"
  | "companyTools"
  | "budget";

export interface LlmConnectChecklistFacts {
  hasAiCalls: boolean | undefined;
  hasProviderAccount: boolean | undefined;
  hasCompanyTool: boolean | undefined;
  hasBudget: boolean | undefined;
}

interface ChecklistItem {
  key: LlmConnectChecklistKey;
  title: string;
  doneTitle: string;
  description: string;
  isDone: boolean | undefined;
  actionTitle: string;
}

export function getLlmConnectChecklistItems(
  facts: LlmConnectChecklistFacts,
): Array<ChecklistItem> {
  return [
    {
      key: "apps",
      title: translationKey("Send AI calls from your apps"),
      doneTitle: translationKey("Your apps send their AI calls"),
      description: translationKey(
        "Every call as it happens: the conversation, the person, tokens, cost and bad answers.",
      ),
      isDone: facts.hasAiCalls,
      actionTitle: translationKey("Show the snippet"),
    },
    {
      key: "providers",
      title: translationKey("Connect an AI provider account"),
      doneTitle: translationKey("A provider account is connected"),
      description: translationKey(
        "What your OpenAI, Anthropic, Azure, Bedrock or Vertex AI accounts used and cost, with no code.",
      ),
      isDone: facts.hasProviderAccount,
      actionTitle: translationKey("Pick a provider"),
    },
    {
      key: "companyTools",
      title: translationKey("Connect your company's AI tools"),
      doneTitle: translationKey("A company AI tool is connected"),
      description: translationKey(
        "What your people ask Claude Enterprise or Microsoft 365 Copilot, by person.",
      ),
      isDone: facts.hasCompanyTool,
      actionTitle: translationKey("Pick a tool"),
    },
    {
      key: "budget",
      title: translationKey("Set a daily budget"),
      doneTitle: translationKey("A daily budget is set"),
      description: translationKey(
        "Get told when a day's AI spend passes what you planned.",
      ),
      isDone: facts.hasBudget,
      actionTitle: translationKey("Open Budgets"),
    },
  ];
}

export interface ComponentProps {
  facts: LlmConnectChecklistFacts;
  onOpen: (key: LlmConnectChecklistKey) => void;
}

const LlmConnectChecklist: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const items: Array<ChecklistItem> = getLlmConnectChecklistItems(props.facts);
  const done: number = items.filter((item: ChecklistItem): boolean => {
    return item.isDone === true;
  }).length;

  return (
    <div data-testid="llm-connect-checklist">
      <div
        className="text-sm text-gray-600"
        data-testid="llm-connect-checklist-progress"
      >
        {translator.translateTemplate("{{done}} of {{total}} done", {
          done: String(done),
          total: String(items.length),
        })}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((item: ChecklistItem): ReactElement => {
          return (
            <li
              key={item.key}
              data-testid={`llm-connect-checklist-${item.key}`}
              data-done={
                item.isDone === undefined ? "unknown" : String(item.isDone)
              }
              className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="mt-0.5 flex-shrink-0" aria-hidden="true">
                {item.isDone === true ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Icon icon={IconProp.Check} className="h-3 w-3" />
                  </div>
                ) : item.isDone === false ? (
                  <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
                ) : (
                  <div className="h-5 w-5 rounded-full bg-gray-100" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-sm font-medium ${
                    item.isDone ? "text-gray-500" : "text-gray-900"
                  }`}
                >
                  <span className="sr-only">
                    {item.isDone === true
                      ? translator.translateText("Done:")
                      : translator.translateText("To do:")}{" "}
                  </span>
                  {translator.translateText(
                    item.isDone ? item.doneTitle : item.title,
                  )}
                </div>
                <div className="mt-0.5 text-sm text-gray-500">
                  {translator.translateText(item.description)}
                </div>
                {item.isDone ? (
                  <></>
                ) : (
                  <button
                    type="button"
                    data-testid={`llm-connect-checklist-open-${item.key}`}
                    onClick={() => {
                      props.onOpen(item.key);
                    }}
                    className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    {translator.translateText(item.actionTitle)}
                    <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default LlmConnectChecklist;
