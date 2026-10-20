import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { llmConnectionDocsUrl } from "./LlmConnectApi";

/*
 * The AI tools a company uses that OneUptime cannot read with a key and a
 * click, and what to do for each instead - so nobody is left wondering
 * whether their tool was forgotten.
 */

export const LLM_COMPANY_TOOLS_DOCS_PATH: string =
  "/docs/telemetry/ai-company-tools";

interface OtherTool {
  key: string;
  title: string;
  body: string;
  docsPath: string;
}

export const LLM_OTHER_AI_TOOLS: Array<OtherTool> = [
  {
    key: "chatgpt-enterprise",
    title: translationKey("ChatGPT Enterprise"),
    body: translationKey(
      "OpenAI opens its Compliance API to a workspace on request. Until then, connect your OpenAI organization for usage and cost.",
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
      "Self-hosted chat apps: put them behind a LiteLLM proxy, or turn on their OpenTelemetry export.",
    ),
    docsPath: `${LLM_COMPANY_TOOLS_DOCS_PATH}#open-webui-and-librechat`,
  },
];

const LlmOtherAiTools: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div data-testid="llm-other-ai-tools">
      <div className="text-sm font-medium text-gray-900">
        {translator.translateText("Using another AI tool?")}
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        {LLM_OTHER_AI_TOOLS.map((tool: OtherTool): ReactElement => {
          return (
            <li
              key={tool.key}
              className="rounded-lg border border-gray-200 bg-gray-50 p-3"
              data-testid={`llm-other-ai-tool-${tool.key}`}
            >
              <div className="text-sm font-medium text-gray-900">
                {translator.translateText(tool.title)}
              </div>
              <div className="mt-0.5 text-sm text-gray-600">
                {translator.translateText(tool.body)}
              </div>
              <a
                href={llmConnectionDocsUrl(tool.docsPath).toString()}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                <Icon icon={IconProp.Book} className="h-4 w-4" />
                <span>{translator.translateText("How")}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default LlmOtherAiTools;
