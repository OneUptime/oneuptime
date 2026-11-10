import IconProp from "Common/Types/Icon/IconProp";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { llmConnectionDocsUrl } from "./LlmConnectApi";

/*
 * The AI tools a company uses that OneUptime cannot read as conversations
 * with a key and a click, and what to do for each instead - so nobody is
 * left wondering whether their tool was forgotten. Cursor is one people
 * look for here: its Admin API has usage and cost, not conversations, so
 * it is connected with the provider accounts - and it can be from here.
 */

export const LLM_COMPANY_TOOLS_DOCS_PATH: string =
  "/docs/telemetry/ai-company-tools";

interface OtherTool {
  key: string;
  title: string;
  body: string;
  docsPath: string;
  // A tool connected another way, which this entry opens.
  connects?: LlmConnectionProvider | undefined;
}

export const LLM_OTHER_AI_TOOLS: Array<OtherTool> = [
  {
    key: "cursor",
    title: translationKey("Cursor"),
    body: translationKey(
      "Cursor's Admin API gives usage and cost by person, not conversations, so Cursor is connected with your AI provider accounts.",
    ),
    docsPath: "/docs/telemetry/ai-provider-accounts#cursor",
    connects: LlmConnectionProvider.Cursor,
  },
  {
    key: "chatgpt-enterprise",
    title: translationKey("ChatGPT Enterprise"),
    body: translationKey(
      "OpenAI opens its Compliance API only on request, so ChatGPT chats cannot be read yet. Your OpenAI organization shows API usage, not ChatGPT's.",
    ),
    docsPath: `${LLM_COMPANY_TOOLS_DOCS_PATH}#chatgpt-enterprise`,
  },
  {
    key: "gemini",
    title: translationKey("Gemini for Google Workspace"),
    body: translationKey(
      "Google offers no API to read people's Gemini chats; Google Vault keeps them for eDiscovery.",
    ),
    docsPath: `${LLM_COMPANY_TOOLS_DOCS_PATH}#gemini-for-google-workspace`,
  },
  {
    key: "coding-assistants",
    title: translationKey("Coding assistants"),
    body: translationKey(
      "Claude Code, Codex, Gemini CLI, Copilot and Cursor send their own OpenTelemetry: point them at OneUptime.",
    ),
    docsPath: "/docs/telemetry/ai-coding-assistants",
  },
  {
    key: "self-hosted-chat",
    title: translationKey("Open WebUI and LibreChat"),
    body: translationKey(
      "Self-hosted chat apps: put them behind a LiteLLM proxy, whose traces carry every chat.",
    ),
    docsPath: `${LLM_COMPANY_TOOLS_DOCS_PATH}#open-webui-and-librechat`,
  },
];

export interface ComponentProps {
  // Opens a tool's connection form (Cursor's); absent: no button.
  onConnect?: ((provider: LlmConnectionProvider) => void) | undefined;
  canConnect?: boolean | undefined;
  connectDisabledReason?: string | undefined;
}

const LlmOtherAiTools: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * Folded: most people find their tool in the tiles above, and whoever
   * does not finds the question right under them.
   */
  return (
    <details
      className="group rounded-lg border border-gray-200 bg-white"
      data-testid="llm-other-ai-tools"
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-gray-900"
        data-testid="llm-other-ai-tools-summary"
      >
        <Icon
          icon={IconProp.ChevronRight}
          className="h-4 w-4 flex-shrink-0 text-gray-500 transition-transform group-open:rotate-90"
        />
        {translator.translateText("Using another AI tool?")}
      </summary>
      <ul className="divide-y divide-gray-100 border-t border-gray-100">
        {LLM_OTHER_AI_TOOLS.map((tool: OtherTool): ReactElement => {
          const connects: LlmConnectionProvider | undefined =
            props.onConnect && tool.connects ? tool.connects : undefined;
          const canConnect: boolean = props.canConnect !== false;

          const connectButton: ReactElement = connects ? (
            <button
              type="button"
              disabled={!canConnect}
              data-testid={`llm-other-ai-tool-connect-${tool.key}`}
              onClick={() => {
                props.onConnect?.(connects);
              }}
              className={`inline-flex items-center gap-1 text-sm font-medium text-indigo-600 ${getHandDrawnButtonStateClassName(
                {
                  isLocked: !canConnect,
                  hoverClassName: "hover:text-indigo-700",
                },
              )}`}
            >
              <Icon icon={IconProp.Link} className="h-4 w-4" />
              <span>
                {translator.translateTemplate("Connect {{provider}}", {
                  provider: translator.translateText(tool.title) || tool.title,
                })}
              </span>
            </button>
          ) : (
            <></>
          );

          return (
            <li
              key={tool.key}
              className="px-4 py-3"
              data-testid={`llm-other-ai-tool-${tool.key}`}
            >
              <div className="text-sm font-medium text-gray-900">
                {translator.translateText(tool.title)}
              </div>
              <div className="mt-0.5 text-sm text-gray-600">
                {translator.translateText(tool.body)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                {connects ? (
                  !canConnect && props.connectDisabledReason ? (
                    <Tooltip text={props.connectDisabledReason}>
                      {connectButton}
                    </Tooltip>
                  ) : (
                    connectButton
                  )
                ) : (
                  <></>
                )}
                <a
                  href={llmConnectionDocsUrl(tool.docsPath).toString()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
                >
                  <Icon icon={IconProp.Book} className="h-4 w-4" />
                  <span>{translator.translateText("Read how")}</span>
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
};

export default LlmOtherAiTools;
